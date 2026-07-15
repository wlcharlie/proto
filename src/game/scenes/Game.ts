// 核心場景 v0.5「詛咒行軍」:倒置塔防。
//
// 你操作「兵流側」:固定小隊從泉水(安全區)出發,沿產線走向異界之門;
// 線上是詛咒領域(持續扣血)。設施是「對己方做加法的塔」:回復站補血(可升級)、
// 附魔站掛屬性(呼應門的弱點/頑抗)。
//
// HP 是唯一貨幣 —— 詛咒扣它、回復站補它、門吃它(貢獻=傷害,同時換魔力)、
// 復活折它(抵達生命 × 復活率)。線上歸零 = 永久死亡。
// 門 HP 歸零 = 過關(+1 技能點;魔力/設施/隊員 HP 跨關保留);全滅且補不起員 = 遠征潰滅。

import { Scene } from 'phaser';
import { BAL } from '../balance';
import { genDoor } from '../levelgen';
import { BOARD_X, BOARD_Y, CELL, COLS, Cell, ROWS, cellX, cellY, xyToCell } from '../grid';
import { StationSave, run, startNewRun } from '../run';
import { loadSave, persistSave } from '../save';
import { SKILLS, costMult, curseMult, hasSkill, manaRate, reviveRatio, squadCap, unitSpeed } from '../skills';
import { DoorSpec, FACILITY_INFO, FacilityType, TRAIT_COLOR, TRAIT_EMOJI, UnitDef } from '../types';
import { DPR, FONT, label, makeButton } from '../ui';

const SPRING_COLOR = 0x53c2d8;
const NEUTRAL_COLOR = 0x9aa0a8;
const CURSE_COLOR = 0x8a5fc8;
const FACILITY_ORDER: FacilityType[] = ['heal', '火', '水', '時'];
const SPRING_CELL: Cell = { c: 7, r: 7 };   // 固定佈局:泉水在下中
const DOOR_CELL: Cell = { c: 7, r: 1 };     // 固定佈局:傳送門在上中

interface Station {
    save: StationSave;                       // run.stations 裡的同一物件(跨關保留)
    x: number; y: number;
    cont: Phaser.GameObjects.Container;
    body: Phaser.GameObjects.Graphics;
    lvlTxt: Phaser.GameObjects.Text;
}

interface Mob {
    unit: UnitDef;                           // run.squad 成員的同一參照(HP 即時同步)
    dist: number;                            // 0 = 泉水端,routeLen = 門端(單向,不折返)
    cellK: number;                           // 目前所在格 index(設施觸發用)
    cont: Phaser.GameObjects.Container;      // 血條 + 本體 + 編號
    circle: Phaser.GameObjects.Arc;
    bar: Phaser.GameObjects.Rectangle;
    alive: boolean;
}

type Phase = 'run' | 'end';

export class Game extends Scene {
    private spec!: DoorSpec;
    private doorHp = 0;
    private stations: Station[] = [];
    private mobs: Mob[] = [];
    private reviving: { unit: UnitDef; t: number }[] = []; // 過門 → 泉水的傳送中(延遲隨機)
    private levelT = 0;
    private phase: Phase = 'run';
    private paused = false;
    private speed = 1;
    private placing: FacilityType | null = null;
    private giveupArmed = 0;

    // 固定產線(單一直線)
    private routeCells: Cell[] = [];
    private routePoints: { x: number; y: number }[] = [];
    private routeLen = 0;

    private doorBody!: Phaser.GameObjects.Graphics;
    private doorBar!: Phaser.GameObjects.Graphics;
    private doorHpTxt!: Phaser.GameObjects.Text;
    private doorX = 0;
    private doorY = 0;
    private springQTxt!: Phaser.GameObjects.Text;

    private hudMana!: Phaser.GameObjects.Text;
    private hudSkill!: Phaser.GameObjects.Text;
    private hudMsg!: Phaser.GameObjects.Text;
    private squadGfx!: Phaser.GameObjects.Graphics;
    private pauseBtn!: Phaser.GameObjects.Text;
    private speed1!: Phaser.GameObjects.Text;
    private speed2!: Phaser.GameObjects.Text;
    private giveupBtn!: Phaser.GameObjects.Text;
    private pausedTxt!: Phaser.GameObjects.Text;
    private trayCards: { key: FacilityType | 'recruit'; cont: Phaser.GameObjects.Container; costTxt: Phaser.GameObjects.Text }[] = [];
    private ghost: Phaser.GameObjects.Container | null = null;
    private logLines: string[] = [];
    private logTxt!: Phaser.GameObjects.Text;
    private lastMana = -1;
    private lastSkill = -1;

    constructor() {
        super('Game');
    }

    create() {
        this.cameras.main.setZoom(DPR).centerOn(512, 384); // Retina:實體 canvas 是 DPR 倍,世界座標維持 1024×768

        if (run.squad.length === 0) startNewRun(loadSave()); // 直接進此場景時的保險

        // scene.restart() 會重跑 create,所有場景狀態在這裡歸零(run 是跨關單例)
        this.spec = genDoor(run.level);
        this.doorHp = this.spec.hp;
        this.stations = [];
        this.mobs = [];
        this.reviving = [];
        this.levelT = 0;
        this.logLines = [];
        this.phase = 'run';
        this.paused = false;
        this.speed = 1;
        this.placing = null;
        this.giveupArmed = 0;
        this.trayCards = [];
        this.ghost = null;
        this.lastMana = -1;
        this.lastSkill = -1;

        this.drawBoard();
        this.buildRoute();
        this.buildHud();
        this.buildTray();
        this.buildLog();
        this.wireInput();
        this.buildSpring();
        this.buildDoor();
        for (const s of run.stations) this.spawnStation(s);

        // 開場:小隊散佈在泉水附近出發(不是從同一點依序彈出)
        for (const u of run.squad) this.dispatch(u, Math.random() * BAL.START_SCATTER);

        const eff = (this.spec.curseDps * curseMult(run)).toFixed(1);
        const trait = this.spec.weakness
            ? `・弱點 ${TRAIT_EMOJI[this.spec.weakness]}(附魔它 ×${BAL.WEAK_MULT})`
            : this.spec.resist
                ? `・頑抗 ${TRAIT_EMOJI[this.spec.resist]}(該屬性 ×${BAL.RESIST_MULT})`
                : '';
        this.log(`⚔ 第 ${run.level} 關:${this.spec.name} —— 門 HP ${this.spec.hp}、詛咒 ${eff}/s`);
        if (this.spec.weakness) this.log(`弱點 ${TRAIT_EMOJI[this.spec.weakness]}:該屬性貢獻 ×${BAL.WEAK_MULT}`);
        if (this.spec.resist) this.log(`頑抗 ${TRAIT_EMOJI[this.spec.resist]}:該屬性貢獻 ×${BAL.RESIST_MULT}`);
        this.showMsg(`第 ${run.level} 關:${this.spec.name} —— 線上詛咒 ${eff}/s${trait},轟開它!`, '#9fc1e8');
    }

    // ---------------------------------------------------------------- 佈景

    private drawBoard() {
        const g = this.add.graphics().setDepth(0);
        g.fillStyle(0x0d1117, 1);
        g.fillRect(BOARD_X, BOARD_Y, COLS * CELL, ROWS * CELL);
        g.lineStyle(1, 0xffffff, 0.045);
        for (let c = 0; c <= COLS; c++) {
            g.lineBetween(BOARD_X + c * CELL, BOARD_Y, BOARD_X + c * CELL, BOARD_Y + ROWS * CELL);
        }
        for (let r = 0; r <= ROWS; r++) {
            g.lineBetween(BOARD_X, BOARD_Y + r * CELL, BOARD_X + COLS * CELL, BOARD_Y + r * CELL);
        }
        g.lineStyle(1.5, 0x2a3242, 1);
        g.strokeRect(BOARD_X, BOARD_Y, COLS * CELL, ROWS * CELL);
    }

    private buildRoute() {
        this.routeCells = [];
        for (let r = SPRING_CELL.r; r >= DOOR_CELL.r; r--) this.routeCells.push({ c: DOOR_CELL.c, r });
        this.routePoints = this.routeCells.map(cl => ({ x: cellX(cl.c), y: cellY(cl.r) }));
        this.routeLen = (this.routeCells.length - 1) * CELL;

        const g = this.add.graphics().setDepth(1);
        // 詛咒領域:線上格子淡紫染色(泉水格 = 安全區,不染)
        for (const cl of this.routeCells) {
            if (cl.r === SPRING_CELL.r) continue;
            g.fillStyle(CURSE_COLOR, 0.08);
            g.fillRect(BOARD_X + cl.c * CELL + 1, BOARD_Y + cl.r * CELL + 1, CELL - 2, CELL - 2);
        }
        g.lineStyle(7, SPRING_COLOR, 0.1);
        this.strokePolyline(g, this.routePoints);
        g.lineStyle(3, SPRING_COLOR, 0.7);
        this.strokePolyline(g, this.routePoints);
    }

    private strokePolyline(g: Phaser.GameObjects.Graphics, pts: { x: number; y: number }[]) {
        if (pts.length < 2) return;
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
        g.strokePath();
    }

    // ---------------------------------------------------------------- 泉水與門

    private buildSpring() {
        const built = this.buildPieceCont(SPRING_CELL, '⛲', '泉水・安全區', null, null);
        const g = built.body;
        g.fillStyle(SPRING_COLOR, 0.14);
        g.fillCircle(0, 0, 23);
        g.lineStyle(2.5, SPRING_COLOR, 1);
        g.strokeCircle(0, 0, 23);
        g.lineStyle(1.5, SPRING_COLOR, 0.5);
        g.strokeCircle(0, 0, 15);
        this.springQTxt = label(this, -24, -24, '', 11, '#53c2d8', 0.5);
        built.cont.add(this.springQTxt);
    }

    private buildDoor() {
        const x = cellX(DOOR_CELL.c), y = cellY(DOOR_CELL.r);
        this.doorX = x;
        this.doorY = y;
        const cont = this.add.container(x, y).setDepth(6);
        this.doorBody = this.add.graphics();
        const name = label(this, 0, -46, `第 ${run.level} 道門・${this.spec.name}`, 13, '#aab3c6', 0.5);
        const traitStr = this.spec.weakness
            ? `弱 ${TRAIT_EMOJI[this.spec.weakness]}`
            : this.spec.resist ? `抗 ${TRAIT_EMOJI[this.spec.resist]}` : '';
        const trait = label(this, 0, -2, traitStr, 16, this.spec.weakness ? '#ffd35c' : '#8a93a6', 0.5);
        this.doorBar = this.add.graphics();
        this.doorHpTxt = label(this, 0, 56, '', 12, '#e8ecf4', 0.5);
        cont.add([this.doorBody, name, trait, this.doorBar, this.doorHpTxt]);
        this.redrawDoorBody(false);
        this.redrawDoorBar();
    }

    private redrawDoorBody(broken: boolean) {
        const col = broken ? 0xffd35c : this.spec.color;
        const radius = { tl: 19, tr: 19, bl: 5, br: 5 };
        this.doorBody.clear();
        this.doorBody.fillStyle(0x0b0e13, 0.92);
        this.doorBody.fillRoundedRect(-21, -28, 42, 56, radius);
        this.doorBody.lineStyle(3, col, 1);
        this.doorBody.strokeRoundedRect(-21, -28, 42, 56, radius);
    }

    private redrawDoorBar() {
        const frac = Math.max(0, this.doorHp / this.spec.hp);
        this.doorBar.clear();
        this.doorBar.fillStyle(0x1a2330, 1);
        this.doorBar.fillRoundedRect(-32, 36, 64, 8, 3);
        this.doorBar.fillStyle(frac > 0.25 ? this.spec.color : 0xff8c42, 1);
        this.doorBar.fillRect(-31, 37, 62 * frac, 6);
        this.doorHpTxt.setText(`${Math.max(0, Math.ceil(this.doorHp))} / ${this.spec.hp}`);
    }

    // ---------------------------------------------------------------- HUD

    private buildHud() {
        const g = this.add.graphics().setDepth(9);
        g.fillStyle(0x10151d, 1);
        g.fillRect(0, 0, 1024, 76);
        g.lineStyle(1, 0x2a3242, 1);
        g.lineBetween(0, 76, 1024, 76);

        label(this, 24, 38, `第 ${run.level} 關`, 21, '#e8ecf4').setFontStyle('bold').setDepth(10);
        this.hudMana = label(this, 110, 38, '', 16, '#7dd8d8').setDepth(10);
        label(this, 200, 38, `☠ ${(this.spec.curseDps * curseMult(run)).toFixed(1)}/s`, 15, '#c88fd8').setDepth(10);
        label(this, 296, 38, '小隊', 13, '#8a93a6').setDepth(10);
        this.squadGfx = this.add.graphics().setDepth(10);
        this.hudSkill = label(this, 590, 38, '', 15, '#ffd35c').setDepth(10);

        this.pauseBtn = this.miniBtn(724, '⏸', () => this.togglePause());
        this.speed1 = this.miniBtn(772, '1×', () => this.setSpeed(1));
        this.speed2 = this.miniBtn(820, '2×', () => this.setSpeed(2));
        this.giveupBtn = this.miniBtn(922, '放棄遠征', () => this.onGiveup(), '#c07070');
        this.refreshSpeedUI();

        this.hudMsg = this.add.text(512, 102, '', {
            fontFamily: FONT, fontSize: 14, color: '#9fc1e8', resolution: DPR,
            backgroundColor: 'rgba(13,17,23,0.88)', padding: { x: 12, y: 5 },
        }).setOrigin(0.5).setDepth(15).setAlpha(0);

        this.pausedTxt = label(this, 512, 384, '⏸ 戰術暫停 — 仍可蓋站/升級/補員,空白鍵繼續', 24, '#e8ecf4', 0.5).setDepth(18).setVisible(false);
    }

    private miniBtn(x: number, str: string, cb: () => void, color = '#cfd6e4') {
        const t = this.add.text(x, 38, str, {
            fontFamily: FONT, fontSize: 14, color, resolution: DPR,
            backgroundColor: '#1a2330', padding: { x: 10, y: 6 },
        }).setOrigin(0.5).setDepth(10).setInteractive({ useHandCursor: true });
        t.on('pointerdown', cb);
        return t;
    }

    /** HUD 小隊條:每名隊員一格 HP 條(空格 = 可補員的空位;右上角小點 = 屬性)。 */
    private drawSquad() {
        const g = this.squadGfx;
        const cap = squadCap(run);
        g.clear();
        for (let i = 0; i < cap; i++) {
            const x = 340 + i * 32;
            if (i < run.squad.length) {
                const u = run.squad[i];
                const frac = Math.max(0, Math.min(1, u.hp / BAL.UNIT_HP));
                g.fillStyle(0x1a2330, 1);
                g.fillRoundedRect(x, 31, 28, 14, 3);
                g.fillStyle(frac > 0.5 ? 0x7dd87d : frac > 0.25 ? 0xff8c42 : 0xe05a4a, 1);
                g.fillRect(x + 2, 33, 24 * frac, 10);
                if (u.elem) {
                    g.fillStyle(TRAIT_COLOR[u.elem], 1);
                    g.fillCircle(x + 27, 31, 3);
                }
            } else {
                g.lineStyle(1, 0x3a4254, 1);
                g.strokeRoundedRect(x, 31, 28, 14, 3);
            }
        }
    }

    private refreshSpeedUI() {
        this.pauseBtn.setText(this.paused ? '▶' : '⏸');
        this.pauseBtn.setBackgroundColor(this.paused ? '#3c5a80' : '#1a2330');
        this.speed1.setBackgroundColor(!this.paused && this.speed === 1 ? '#3c5a80' : '#1a2330');
        this.speed2.setBackgroundColor(!this.paused && this.speed === 2 ? '#3c5a80' : '#1a2330');
    }

    private showMsg(str: string, color: string) {
        this.hudMsg.setText(str).setColor(color).setAlpha(1);
        this.tweens.killTweensOf(this.hudMsg);
        this.tweens.add({ targets: this.hudMsg, alpha: 0, delay: 2200, duration: 400 });
    }

    // ---------------------------------------------------------------- 戰報(事件 log)

    private buildLog() {
        const g = this.add.graphics().setDepth(7);
        g.fillStyle(0x0b0e13, 0.72);
        g.fillRoundedRect(704, 96, 300, 552, 10);
        g.lineStyle(1, 0x2a3242, 1);
        g.strokeRoundedRect(704, 96, 300, 552, 10);
        label(this, 718, 114, '戰報', 12, '#8a93a6').setDepth(7);
        this.logTxt = this.add.text(718, 132, '', {
            fontFamily: FONT, fontSize: 11, color: '#aab3c6', resolution: DPR,
            lineSpacing: 4, wordWrap: { width: 274 },
        }).setDepth(7);
    }

    /** 一行事件進戰報(帶關卡時間戳);保留最近 24 行。 */
    private log(s: string) {
        const t = Math.floor(this.levelT);
        this.logLines.push(`[${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}] ${s}`);
        if (this.logLines.length > 24) this.logLines.shift();
        this.logTxt.setText(this.logLines.join('\n'));
    }

    // ---------------------------------------------------------------- 托盤(魔力商店)

    private buildTray() {
        const bg = this.add.graphics().setDepth(10);
        bg.fillStyle(0x10151d, 1);
        bg.fillRect(0, 664, 1024, 104);
        bg.lineStyle(1, 0x2a3242, 1);
        bg.lineBetween(0, 664, 1024, 664);

        label(this, 24, 682, '魔力來自過門貢獻 —— 點卡片蓋站(蓋在產線上才生效)|點回復站升級|✕ 拆除退一半', 13, '#8a93a6').setDepth(10);

        const cardW = 118;
        const makeCard = (i: number, key: FacilityType | 'recruit', name: string, emo: string, color: number) => {
            const cx = 24 + i * (cardW + 8) + cardW / 2;
            const cont = this.add.container(cx, 726).setDepth(10);
            const g = this.add.graphics();
            g.fillStyle(0x161d29, 1);
            g.fillRoundedRect(-cardW / 2, -27, cardW, 54, 9);
            g.lineStyle(2, color, 0.9);
            g.strokeRoundedRect(-cardW / 2, -27, cardW, 54, 9);
            const nm = label(this, 0, -11, name, 13, '#e8ecf4', 0.5);
            const em = label(this, -18, 12, emo, 14, '#e8ecf4', 0.5);
            const costTxt = label(this, 12, 12, '', 13, '#7dd8d8', 0.5);
            const z = this.add.zone(0, 0, cardW, 54).setInteractive({ useHandCursor: true });
            z.on('pointerdown', () => this.onCardClick(key));
            cont.add([g, nm, em, costTxt, z]);
            this.trayCards.push({ key, cont, costTxt });
        };

        let i = 0;
        for (const t of FACILITY_ORDER) {
            const info = FACILITY_INFO[t];
            makeCard(i++, t, info.name, info.emoji, info.color);
        }
        makeCard(i++, 'recruit', '補員・新隊員', '➕', 0xc0a060);

        if (this.spec.weakness || this.spec.resist) {
            const s = this.spec.weakness
                ? `本關弱點\n${TRAIT_EMOJI[this.spec.weakness]} ×${BAL.WEAK_MULT}`
                : `本關頑抗\n${TRAIT_EMOJI[this.spec.resist!]} ×${BAL.RESIST_MULT}`;
            this.add.text(928, 716, s, {
                fontFamily: FONT, fontSize: 14, align: 'center', resolution: DPR,
                color: this.spec.weakness ? '#ffd35c' : '#c88fd8',
            }).setOrigin(0.5).setDepth(10);
        }

        this.refreshTray();
    }

    private cardCost(key: FacilityType | 'recruit'): number {
        if (key === 'recruit') return BAL.COST_RECRUIT;
        return Math.round((key === 'heal' ? BAL.COST_HEAL : BAL.COST_ENCHANT) * costMult(run));
    }

    private refreshTray() {
        for (const card of this.trayCards) {
            const cost = this.cardCost(card.key);
            card.costTxt.setText(`✦${cost}`);
            const ok = run.mana >= cost && (card.key !== 'recruit' || run.squad.length < squadCap(run));
            card.cont.setAlpha(ok ? 1 : 0.4);
        }
    }

    private onCardClick(key: FacilityType | 'recruit') {
        if (this.phase !== 'run') return;
        if (key === 'recruit') {
            this.recruit();
            return;
        }
        const cost = this.cardCost(key);
        if (run.mana < cost) {
            this.showMsg(`魔力不足(需 ✦${cost})—— 送單位過門賺取`, '#ff8c42');
            return;
        }
        this.placing = key;
        this.makeGhost(FACILITY_INFO[key].color, FACILITY_INFO[key].emoji);
    }

    private recruit() {
        if (run.squad.length >= squadCap(run)) {
            this.showMsg(`小隊已滿編(${squadCap(run)} 名)`, '#8a93a6');
            return;
        }
        if (run.mana < BAL.COST_RECRUIT) {
            this.showMsg(`補員需 ✦${BAL.COST_RECRUIT}`, '#ff8c42');
            return;
        }
        run.mana -= BAL.COST_RECRUIT;
        const u: UnitDef = { id: run.unitSeq++, elem: null, hp: BAL.UNIT_HP };
        run.squad.push(u);
        this.dispatch(u);
        this.poof(cellX(SPRING_CELL.c), cellY(SPRING_CELL.r), SPRING_COLOR);
        this.log(`➕ #${u.id} 入隊(✦${BAL.COST_RECRUIT})`);
        this.showMsg(`➕ 新隊員 #${u.id} 入隊!`, '#7dd87d');
        this.refreshTray();
    }

    // ---------------------------------------------------------------- 放置與升級

    private makeGhost(color: number, emo: string) {
        this.destroyGhost();
        const c = this.add.container(-200, -200).setDepth(8);
        const g = this.add.graphics();
        g.fillStyle(color, 0.2);
        g.fillRoundedRect(-24, -24, 48, 48, 11);
        g.lineStyle(2.5, color, 1);
        g.strokeRoundedRect(-24, -24, 48, 48, 11);
        const t = label(this, 0, 0, emo, 15, '#e8ecf4', 0.5);
        c.add([g, t]);
        this.ghost = c;
    }

    private destroyGhost() {
        this.ghost?.destroy();
        this.ghost = null;
    }

    private stationAt(c: number, r: number): Station | undefined {
        return this.stations.find(s => s.save.c === c && s.save.r === r);
    }

    /** 設施可放任何空格;蓋在產線的格子上才會生效(提示寫在托盤)。 */
    private canPlace(c: number, r: number): boolean {
        if (this.phase !== 'run') return false;
        if (c === SPRING_CELL.c && r === SPRING_CELL.r) return false;
        if (c === DOOR_CELL.c && r === DOOR_CELL.r) return false;
        if (this.stationAt(c, r)) return false;
        return true;
    }

    /** 放置容器共用:本體、名牌、可選 onTap 與 ✕ 收回鈕(badge 在 zone 之後加入 = 事件優先)。 */
    private buildPieceCont(cell: Cell, emo: string, name: string, onTap: (() => void) | null, onRemove: (() => void) | null) {
        const x = cellX(cell.c), y = cellY(cell.r);
        const cont = this.add.container(x, y).setDepth(6);
        const body = this.add.graphics();
        const em = label(this, 0, -2, emo, 16, '#e8ecf4', 0.5);
        const nm = label(this, 0, 33, name, 11, '#aab3c6', 0.5);
        const zone = this.add.zone(0, 0, 54, 54).setInteractive({ useHandCursor: true });
        cont.add([body, em, nm, zone]);
        if (onTap) zone.on('pointerdown', onTap);

        if (onRemove) {
            const badge = this.add.container(24, -24);
            const bg = this.add.graphics();
            bg.fillStyle(0x30171b, 1);
            bg.fillCircle(0, 0, 9);
            bg.lineStyle(1.5, 0x8a5a5a, 1);
            bg.strokeCircle(0, 0, 9);
            const bx = label(this, 0, 0, '✕', 10, '#e8a0a0', 0.5);
            const bz = this.add.zone(0, 0, 20, 20).setInteractive({ useHandCursor: true });
            badge.add([bg, bx, bz]);
            cont.add(badge);
            bz.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
                ev.stopPropagation();
                onRemove();
            });
        }
        return { cont, body, x, y };
    }

    /** 生成設施(新蓋與跨關重建共用;錢在呼叫端已處理)。 */
    private spawnStation(save: StationSave) {
        const info = FACILITY_INFO[save.type];
        const station = {} as Station;
        const built = this.buildPieceCont({ c: save.c, r: save.r }, info.emoji, info.name,
            () => this.tapStation(station), () => this.sellStation(station));
        const lvlTxt = label(this, 0, 15, '', 9, '#ffd35c', 0.5);
        built.cont.add(lvlTxt);
        Object.assign(station, { save, x: built.x, y: built.y, cont: built.cont, body: built.body, lvlTxt });
        this.stations.push(station);
        this.redrawStation(station);
    }

    private redrawStation(st: Station) {
        const info = FACILITY_INFO[st.save.type];
        st.body.clear();
        st.body.fillStyle(info.color, 0.16);
        st.body.fillRoundedRect(-20, -20, 40, 40, 8);
        st.body.lineStyle(2.5, info.color, 1);
        st.body.strokeRoundedRect(-20, -20, 40, 40, 8);
        st.lvlTxt.setText(st.save.type === 'heal'
            ? '●'.repeat(st.save.lvl) + '○'.repeat(BAL.STATION_MAX_LVL - st.save.lvl)
            : '');
    }

    private upgradeCost(lvl: number): number {
        return Math.round(BAL.UPGRADE_BASE * Math.pow(BAL.UPGRADE_COST_GROWTH, lvl - 1) * costMult(run));
    }

    private tapStation(st: Station) {
        if (this.phase !== 'run' || this.placing) return;
        if (st.save.type !== 'heal') {
            this.showMsg('附魔站沒有升級(v0.5)—— 想換屬性就換一座蓋', '#8a93a6');
            return;
        }
        if (st.save.lvl >= BAL.STATION_MAX_LVL) {
            this.showMsg('回復站已滿級', '#8a93a6');
            return;
        }
        const cost = this.upgradeCost(st.save.lvl);
        if (run.mana < cost) {
            this.showMsg(`升級到 Lv${st.save.lvl + 1} 需 ✦${cost}`, '#ff8c42');
            return;
        }
        run.mana -= cost;
        st.save.lvl++;
        st.save.invested += cost;
        this.redrawStation(st);
        this.floatText(st.x, st.y - 26, `⬆ Lv${st.save.lvl}`, '#ffd35c');
        this.log(`⬆ ${FACILITY_INFO[st.save.type].name} 升到 Lv${st.save.lvl}(✦${cost})`);
        this.refreshTray();
    }

    private sellStation(st: Station) {
        if (this.phase !== 'run') return;
        const refund = Math.floor(st.save.invested * BAL.SELL_REFUND);
        run.mana += refund;
        st.cont.destroy();
        this.stations = this.stations.filter(x => x !== st);
        run.stations = run.stations.filter(x => x !== st.save);
        this.floatText(st.x, st.y - 26, `✦+${refund}`, '#7dd8d8');
        this.log(`⛏ 拆 ${FACILITY_INFO[st.save.type].name},退 ✦${refund}`);
        this.refreshTray();
    }

    // ---------------------------------------------------------------- 輸入

    private wireInput() {
        // pointer.x/y 是 canvas 座標(DPR 倍);worldX/Y 才是 1024×768 的世界座標
        this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
            if (over.length > 0) return;
            this.onBoardClick(p.worldX, p.worldY);
        });
        this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
            if (!this.ghost || !this.placing) return;
            const cell = xyToCell(p.worldX, p.worldY);
            if (cell && this.canPlace(cell.c, cell.r)) {
                this.ghost.setPosition(cellX(cell.c), cellY(cell.r)).setAlpha(0.95);
            } else {
                this.ghost.setPosition(p.worldX, p.worldY).setAlpha(0.3);
            }
        });

        const kb = this.input.keyboard;
        kb?.on('keydown-SPACE', () => this.togglePause());
        kb?.on('keydown-ONE', () => this.setSpeed(1));
        kb?.on('keydown-TWO', () => this.setSpeed(2));
        kb?.on('keydown-ESC', () => {
            this.placing = null;
            this.destroyGhost();
        });
    }

    private onBoardClick(x: number, y: number) {
        if (this.phase === 'end' || !this.placing) return;
        const cell = xyToCell(x, y);
        if (cell && this.canPlace(cell.c, cell.r)) {
            const type = this.placing;
            const cost = this.cardCost(type);
            if (run.mana < cost) {
                this.showMsg(`魔力不足(需 ✦${cost})`, '#ff8c42');
                this.placing = null;
                this.destroyGhost();
                return;
            }
            run.mana -= cost;
            const save: StationSave = { type, c: cell.c, r: cell.r, lvl: 1, invested: cost };
            run.stations.push(save);
            this.spawnStation(save);
            this.log(`🏗 蓋 ${FACILITY_INFO[type].name}(✦${cost})`);
            this.placing = null;
            this.destroyGhost();
            this.refreshTray();
        } else {
            this.showMsg('這裡不能放置(已被佔用)', '#ff8c42');
        }
    }

    private togglePause() {
        if (this.phase !== 'run') return;
        this.paused = !this.paused;
        this.pausedTxt.setVisible(this.paused);
        this.refreshSpeedUI();
    }

    private setSpeed(n: number) {
        if (this.phase !== 'run') return;
        this.speed = n;
        this.paused = false;
        this.pausedTxt.setVisible(false);
        this.refreshSpeedUI();
    }

    private onGiveup() {
        if (this.phase === 'end') return;
        if (this.giveupArmed > 0) {
            this.shatter();
        } else {
            this.giveupArmed = 2.5;
            this.giveupBtn.setText('確定放棄?').setColor('#ff5c5c');
        }
    }

    // ---------------------------------------------------------------- 模擬主迴圈

    update(_t: number, dms: number) {
        const rdt = Math.min(dms, 50) / 1000;
        if (this.phase === 'run' && !this.paused) {
            let sim = rdt * this.speed;
            while (sim > 0) {
                const step = Math.min(sim, 0.033);
                this.simStep(step);
                if (this.phase !== 'run') break;
                sim -= step;
            }
        }
        this.visualStep(rdt);
    }

    private simStep(dt: number) {
        this.levelT += dt;

        // 1) 復活歸隊(過門 → 泉水;延遲在範圍內隨機,節奏自然打散)
        for (const rv of [...this.reviving]) {
            rv.t -= dt;
            if (rv.t <= 0) {
                this.reviving = this.reviving.filter(x => x !== rv);
                this.poof(cellX(SPRING_CELL.c), cellY(SPRING_CELL.r),
                    rv.unit.elem ? TRAIT_COLOR[rv.unit.elem] : NEUTRAL_COLOR);
                this.dispatch(rv.unit);
                this.log(`↩ #${rv.unit.id} 歸隊出發(HP ${Math.round(rv.unit.hp)})`);
            }
        }

        // 2) 行軍:移動、吃詛咒、過站、死亡、抵達
        const spd = unitSpeed(run);
        const curse = this.spec.curseDps * curseMult(run);
        for (const mob of this.mobs) {
            if (!mob.alive) continue;
            mob.dist += spd * dt;
            mob.unit.hp -= curse * dt;
            if (mob.unit.hp <= 0) {
                this.killUnit(mob);
                if (this.phase !== 'run') return; // 全滅潰滅
                continue;
            }
            const p = this.pointAt(mob.dist);
            mob.cont.setPosition(p.x, p.y);
            this.updateMobBar(mob);
            const k = Math.round(Math.min(mob.dist, this.routeLen) / CELL);
            if (k !== mob.cellK) {
                mob.cellK = k;
                const cl = this.routeCells[k];
                const st = cl ? this.stationAt(cl.c, cl.r) : undefined;
                if (st) this.applyStation(st, mob);
            }
            if (mob.dist >= this.routeLen) {
                this.arrive(mob);
                if (this.phase !== 'run') return; // 門破過關
            }
        }
        this.mobs = this.mobs.filter(m => m.alive);
    }

    private visualStep(rdt: number) {
        const mana = Math.floor(run.mana);
        if (mana !== this.lastMana) {
            this.lastMana = mana;
            this.hudMana.setText(`✦ ${mana}`);
        }
        if (run.skillPoints !== this.lastSkill) {
            this.lastSkill = run.skillPoints;
            this.hudSkill.setText(`技能點 ${run.skillPoints}`);
        }
        this.drawSquad();
        this.springQTxt.setText(this.reviving.length > 0 ? `↩${this.reviving.length}` : '');
        if (this.giveupArmed > 0) {
            this.giveupArmed -= rdt;
            if (this.giveupArmed <= 0) this.giveupBtn.setText('放棄遠征').setColor('#c07070');
        }
    }

    // ---------------------------------------------------------------- 單位

    private pointAt(dist: number): { x: number; y: number } {
        const d = Math.max(0, Math.min(dist, this.routeLen));
        const i = Math.min(Math.floor(d / CELL), this.routePoints.length - 2);
        const t = (d - i * CELL) / CELL;
        const a = this.routePoints[i], b = this.routePoints[i + 1];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }

    /** 出擊:小兵 = 血條 + 圓 + 編號。startDist 讓開場散佈在泉水附近。 */
    private dispatch(unit: UnitDef, startDist = 0) {
        const circle = this.add.circle(0, 0, 8, unit.elem ? TRAIT_COLOR[unit.elem] : NEUTRAL_COLOR);
        circle.setStrokeStyle(1.5, 0x0b0e13);
        const idTxt = label(this, 0, 0, `${unit.id}`, 9, '#0b0e13', 0.5).setFontStyle('bold');
        const barBg = this.add.rectangle(0, -14, 18, 4, 0x10151d).setStrokeStyle(1, 0x2a3242);
        const barFill = this.add.rectangle(-9, -14, 18, 3, 0x7dd87d).setOrigin(0, 0.5);
        const cont = this.add.container(0, 0, [barBg, barFill, circle, idTxt]).setDepth(4);
        const mob: Mob = {
            unit, dist: startDist, cellK: Math.round(startDist / CELL),
            cont, circle, bar: barFill, alive: true,
        };
        const p = this.pointAt(startDist);
        cont.setPosition(p.x, p.y);
        this.updateMobBar(mob);
        this.mobs.push(mob);
    }

    /** 血條取代體型縮放:長度 = 血量,顏色跟著血量走。 */
    private updateMobBar(mob: Mob) {
        const frac = Math.max(0, Math.min(1, mob.unit.hp / BAL.UNIT_HP));
        mob.bar.setScale(frac, 1);
        mob.bar.setFillStyle(frac > 0.5 ? 0x7dd87d : frac > 0.25 ? 0xff8c42 : 0xe05a4a);
    }

    private applyStation(st: Station, mob: Mob) {
        if (st.save.type === 'heal') {
            if (mob.unit.hp >= BAL.UNIT_HP) return;
            const amt = BAL.HEAL_BASE + BAL.HEAL_PER_LVL * (st.save.lvl - 1);
            mob.unit.hp = Math.min(mob.unit.hp + amt, BAL.UNIT_HP);
            this.floatText(st.x, st.y - 26, `+${amt}`, '#7dd87d');
        } else {
            if (mob.unit.elem === st.save.type) return;
            mob.unit.elem = st.save.type;
            mob.circle.setFillStyle(TRAIT_COLOR[st.save.type]);
            this.floatText(st.x, st.y - 26, TRAIT_EMOJI[st.save.type], '#e8ecf4');
        }
    }

    private killUnit(mob: Mob) {
        mob.alive = false;
        this.poof(mob.cont.x, mob.cont.y, CURSE_COLOR);
        this.floatText(mob.cont.x, mob.cont.y - 18, '💀', '#c88fd8');
        mob.cont.destroy();
        run.squad = run.squad.filter(u => u !== mob.unit);
        this.log(`💀 #${mob.unit.id} 隕落於詛咒(小隊剩 ${run.squad.length})`);
        this.refreshTray();
        if (run.squad.length === 0) {
            if (run.mana < BAL.COST_RECRUIT) {
                this.shatter();
                return;
            }
            this.showMsg(`⚠ 全滅!剩餘魔力 ✦${Math.floor(run.mana)} —— 立刻補員,否則遠征斷絕`, '#ff5c5c');
        } else {
            this.showMsg(`💀 隊員 #${mob.unit.id} 隕落於詛咒(小隊 ${run.squad.length}/${squadCap(run)})`, '#ff8c42');
        }
    }

    private arrive(mob: Mob) {
        mob.alive = false;
        const raw = mob.unit.hp;
        const mult = this.spec.weakness && mob.unit.elem === this.spec.weakness ? BAL.WEAK_MULT
            : this.spec.resist && mob.unit.elem === this.spec.resist ? BAL.RESIST_MULT : 1;
        const dmg = raw * mult;
        this.doorHp -= dmg;
        const gain = dmg * manaRate(run);
        run.mana += gain;
        this.floatText(this.doorX + 34, this.doorY - 22, `−${dmg.toFixed(0)}`,
            mult > 1 ? '#ffd35c' : mult < 1 ? '#8a93a6' : '#e8ecf4');
        this.floatText(this.doorX - 34, this.doorY + 20, `✦+${gain.toFixed(0)}`, '#7dd8d8');
        this.poof(mob.cont.x, mob.cont.y, this.spec.color);
        mob.cont.destroy();
        this.redrawDoorBar();
        this.refreshTray();
        this.log(`#${mob.unit.id} 轟門 −${dmg.toFixed(0)}${mult !== 1 ? `(×${mult})` : ''},✦+${gain.toFixed(0)}`);
        if (this.doorHp <= 0) {
            this.levelClear();
            return;
        }
        mob.unit.hp = raw * reviveRatio(run);
        this.reviving.push({
            unit: mob.unit,
            t: BAL.REVIVE_DELAY_MIN + Math.random() * (BAL.REVIVE_DELAY_MAX - BAL.REVIVE_DELAY_MIN),
        });
    }

    private poof(x: number, y: number, color: number) {
        const c = this.add.circle(x, y, 5, color, 0.7).setDepth(5);
        this.tweens.add({ targets: c, scale: 2.2, alpha: 0, duration: 260, onComplete: () => c.destroy() });
    }

    private floatText(x: number, y: number, str: string, color: string) {
        const t = this.add.text(x, y, str, { fontFamily: FONT, fontSize: 13, color, resolution: DPR })
            .setOrigin(0.5).setDepth(15);
        this.tweens.add({ targets: t, y: y - 26, alpha: 0, duration: 700, onComplete: () => t.destroy() });
    }

    // ---------------------------------------------------------------- 關卡結局

    private levelClear() {
        if (this.phase !== 'run') return;
        this.phase = 'end';
        this.doorHp = 0;
        this.redrawDoorBar();
        this.redrawDoorBody(true);
        run.skillPoints += 1;
        this.log('✦ 門破!過關 +1 技能點');
        this.cameras.main.shake(250, 0.006);
        this.poof(this.doorX, this.doorY, 0xffd35c);
        this.floatText(this.doorX, this.doorY - 64, '突破!', '#ffd35c');
        this.time.delayedCall(800, () => this.showSkillTree());
    }

    private buySkill(id: string) {
        if (run.skillPoints < 1 || hasSkill(run, id)) return;
        run.skillPoints -= 1;
        run.skills.push(id);
        this.log(`📖 學會「${SKILLS.find(s => s.id === id)?.name}」`);
        if (id === 'squad-cap' && run.squad.length < squadCap(run)) {
            run.squad.push({ id: run.unitSeq++, elem: null, hp: BAL.UNIT_HP }); // 入隊,下一關出發
        }
    }

    private showSkillTree() {
        const c = this.add.container(0, 0).setDepth(20);
        const dim = this.add.rectangle(512, 384, 1024, 768, 0x05070a, 0.78).setInteractive();
        c.add(dim);
        const g = this.add.graphics();
        g.fillStyle(0x141a24, 1);
        g.fillRoundedRect(212, 96, 600, 576, 16);
        g.lineStyle(2, 0x3c5a80, 1);
        g.strokeRoundedRect(212, 96, 600, 576, 16);
        c.add(g);
        c.add(label(this, 512, 140, `第 ${run.level} 道門突破!`, 28, '#ffd35c', 0.5).setFontStyle('bold'));
        c.add(label(this, 512, 176, `技能點:${run.skillPoints}(過關 +1,可以留著不花)`, 15, '#e8ecf4', 0.5));

        SKILLS.forEach((sk, i) => {
            const y = 226 + i * 54;
            const owned = hasSkill(run, sk.id);
            const locked = !!sk.requires && !hasSkill(run, sk.requires);
            const row = this.add.graphics();
            row.fillStyle(0x161d29, 1);
            row.fillRoundedRect(240, y - 22, 544, 44, 8);
            row.lineStyle(1.5, owned ? 0x4a8a5a : 0x2a3242, 1);
            row.strokeRoundedRect(240, y - 22, 544, 44, 8);
            c.add(row);
            c.add(label(this, 262, y, sk.emoji, 16, '#e8ecf4'));
            c.add(label(this, 296, y - 9, sk.name, 14, owned ? '#7dd87d' : '#e8ecf4'));
            c.add(label(this, 296, y + 11, sk.desc, 11, '#8a93a6'));
            if (owned) {
                c.add(label(this, 764, y, '✓ 已學會', 13, '#7dd87d', 1));
            } else if (locked) {
                c.add(label(this, 764, y, '需前置', 13, '#5c6577', 1));
            } else if (run.skillPoints >= 1) {
                c.add(makeButton(this, 726, y, '學習(1 點)', () => {
                    this.buySkill(sk.id);
                    c.destroy();
                    this.showSkillTree();
                }, { w: 110, h: 34, fontSize: 12 }));
            } else {
                c.add(label(this, 764, y, '點數不足', 13, '#5c6577', 1));
            }
        });

        c.add(makeButton(this, 512, 630, `開拔:第 ${run.level + 1} 道門 ▶`, () => {
            run.level += 1;
            this.scene.restart();
        }, { w: 280, h: 52, fill: 0x1f3a2a, stroke: 0x4a8a5a }));
    }

    private shatter() {
        if (this.phase === 'end') return;
        this.phase = 'end';
        this.log('☠ 遠征潰滅');
        const pts = run.level - 1;
        const save = loadSave();
        save.points += pts;
        persistSave(save);
        this.cameras.main.shake(500, 0.01);
        this.showOverlay('遠 征 潰 滅', [
            '小隊全滅,詛咒吞沒了戰線 —— 這次遠征到此為止。',
            `推進到第 ${run.level} 關,轟破 ${pts} 道門 → 獎勵點 +${pts}`,
        ]);
        this.time.delayedCall(2000, () => this.scene.start('GameOver'));
    }

    private showOverlay(title: string, lines: string[]) {
        const c = this.add.container(0, 0).setDepth(20);
        const dim = this.add.rectangle(512, 384, 1024, 768, 0x05070a, 0.74).setInteractive();
        c.add(dim);
        const g = this.add.graphics();
        g.fillStyle(0x141a24, 1);
        g.fillRoundedRect(262, 268, 500, 228, 16);
        g.lineStyle(2, 0x3c5a80, 1);
        g.strokeRoundedRect(262, 268, 500, 228, 16);
        c.add(g);
        c.add(label(this, 512, 318, title, 30, '#e8ecf4', 0.5).setFontStyle('bold'));
        lines.forEach((ln, i) => c.add(label(this, 512, 368 + i * 28, ln, 15, '#aab3c6', 0.5)));
    }
}
