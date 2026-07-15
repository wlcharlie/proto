// 核心場景(v0.4「後勤魔王」):玩家的手在「加工端」,不在「產量端」。
//
// 前線戰事在畫面外進行:你的軍團持續從裂隙歸返,在「泉水」復活(血量不一、種族
// 組成 = 你的異界陣容,速率固定 → 量不可放大)。玩家在路途上安排「加工站」
//(回復/附魔,線經過即生效、可串接),把兵慢慢運抵各傳送門再次投入。
//
// 門的抵抗會隨「開門時間」扎根成長 → 每扇門是一個征服窗口,拖 = 輸;
// 規格不符 ×0.05 純噪音 → 加工鏈的品質就是戰力;
// 反噬時敵人沿線殺進後勤網,摸到加工站會癱瘓它幾秒 → 火災要救。
// 全門穩定 → 過關;征服異界 = 兵源加入該族 + 獲得該界的設施(附魔站/回復站)。

import { Scene } from 'phaser';
import { BAL } from '../balance';
import { genLevel } from '../levelgen';
import { BOARD_X, BOARD_Y, CELL, COLS, Cell, ROWS, bfsPath, cellX, cellY, xyToCell } from '../grid';
import { run, startNewRun } from '../run';
import { loadSave, persistSave } from '../save';
import {
    DoorSpec, FACILITY_INFO, FacilityType, LevelSpec, TRAIT_COLOR, TRAIT_EMOJI, Trait,
    WorldDef, facilityOfWorld, worldColor,
} from '../types';
import { FONT, label, makeButton } from '../ui';

const SPRING_COLOR = 0x53c2d8;
const FACILITY_ORDER: FacilityType[] = ['heal', '火', '水', '時'];

interface Route {
    id: number;
    origin: Spring;
    door: Door;
    points: { x: number; y: number }[];
    cells: Cell[];             // 依序途經格(加工站觸發、拆線點擊、裂隙避開)
    cellKeys: Set<number>;
    length: number;
    line: Phaser.GameObjects.Graphics;
    dead: boolean;
}

/** 一包「單位」:待命與裂隙傳送中都以此形式存在。 */
interface Parcel {
    value: number;
    traits: Trait[];           // [種族, 屬性?] —— 種族先天不可變,屬性欄可被附魔覆蓋
}

interface Spring {
    c: number; r: number; x: number; y: number;
    color: number;
    routes: Route[];
    nextRoute: number;
    spawnT: number;
    parked: Parcel[];
    incoming: (Parcel & { t: number })[];
    cont: Phaser.GameObjects.Container;
    body: Phaser.GameObjects.Graphics;
    countTxt: Phaser.GameObjects.Text;
}

interface Station {
    type: FacilityType;
    c: number; r: number; x: number; y: number;
    disabledT: number;         // >0 = 被反噬敵人癱瘓中
    cont: Phaser.GameObjects.Container;
    body: Phaser.GameObjects.Graphics;
}

type DoorState = 'active' | 'locked' | 'collapsed';

interface Door {
    spec: DoorSpec;
    c: number; r: number; x: number; y: number;
    progress: number;
    age: number;               // 開門秒數:抵抗與湧出隨之扎根成長
    state: DoorState;
    enemyT: number;
    rr: number;
    routes: Route[];
    wasBacklash: boolean;
    cont: Phaser.GameObjects.Container;
    body: Phaser.GameObjects.Graphics;
    bar: Phaser.GameObjects.Graphics;
    stateTxt: Phaser.GameObjects.Text;
    lastP: number;
    rate: number;
    rateT: number;
}

interface RiftAnnounce {
    spec: DoorSpec;
    c: number; r: number;
    remain: number;
    gfx: Phaser.GameObjects.Graphics;
    txt: Phaser.GameObjects.Text;
}

interface Mob {
    kind: 'unit' | 'enemy';
    value: number;
    traits: Trait[];
    route: Route;
    dist: number;              // 0 = 泉水端,length = 門端
    dir: 1 | -1;
    cellK: number;             // 目前所在格 index(加工站觸發用)
    color: number;
    gfx: Phaser.GameObjects.Shape;
    alive: boolean;
}

interface Drawing {
    cells: Cell[];
    keys: Set<number>;
    gfx: Phaser.GameObjects.Graphics;
}

type Phase = 'run' | 'end';
type PlacingSel = 'spring' | FacilityType;

const SPAN = () => BAL.BASE * BAL.STABLE_RATIO;
const ck = (c: number, r: number) => r * COLS + c;

export class Game extends Scene {
    private lvl!: LevelSpec;
    private spring: Spring | null = null;
    private stations: Station[] = [];
    private doors: Door[] = [];
    private pending: DoorSpec[] = [];
    private announces: RiftAnnounce[] = [];
    private routesAll: Route[] = [];
    private mobs: Mob[] = [];
    private phase: Phase = 'run';
    private levelT = 0;
    private paused = false;
    private speed = 1;
    private routeSeq = 0;
    private placing: PlacingSel | null = null;
    private drawing: Drawing | null = null;
    private pulseT = 0;
    private crushArmed = 0;
    private springNagged = false;

    private hudIntegrity!: Phaser.GameObjects.Text;
    private hudDoors!: Phaser.GameObjects.Text;
    private hudConquer!: Phaser.GameObjects.Text;
    private hudMsg!: Phaser.GameObjects.Text;
    private pauseBtn!: Phaser.GameObjects.Text;
    private speed1!: Phaser.GameObjects.Text;
    private speed2!: Phaser.GameObjects.Text;
    private crushBtn!: Phaser.GameObjects.Text;
    private pausedTxt!: Phaser.GameObjects.Text;
    private riftStatus!: Phaser.GameObjects.Text;
    private riftStatusLast = '';
    private trayCards: { key: 'spring' | FacilityType; cont: Phaser.GameObjects.Container; countTxt: Phaser.GameObjects.Text | null }[] = [];
    private ghost: Phaser.GameObjects.Container | null = null;

    constructor() {
        super('Game');
    }

    create() {
        if (run.lineup.length === 0) startNewRun(loadSave()); // 直接進此場景時的保險

        // scene.restart() 會重跑 create,所有狀態必須在這裡歸零
        this.spring = null;
        this.stations = [];
        this.doors = [];
        this.announces = [];
        this.routesAll = [];
        this.mobs = [];
        this.phase = 'run';
        this.levelT = 0;
        this.paused = false;
        this.speed = 1;
        this.routeSeq = 0;
        this.placing = null;
        this.drawing = null;
        this.pulseT = 0;
        this.crushArmed = 0;
        this.springNagged = false;
        this.trayCards = [];
        this.riftStatusLast = '';
        this.ghost = null;

        const ownedTraits = [...new Set(run.lineup.flatMap(w => w.traits))];
        this.lvl = genLevel(run.level, ownedTraits);
        this.pending = [...this.lvl.doors];

        this.drawBoard();
        this.buildHud();
        this.buildTray();
        this.wireInput();

        this.showMsg(`第 ${run.level} 關:先放置泉水 —— 你的軍團正從前線歸返!`, '#9fc1e8');
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

    // ---------------------------------------------------------------- 共用查詢

    private springAt(c: number, r: number): boolean {
        return this.spring !== null && this.spring.c === c && this.spring.r === r;
    }

    private doorAt(c: number, r: number): boolean {
        return this.doors.some(d => d.c === c && d.r === r);
    }

    private announceAt(c: number, r: number): boolean {
        return this.announces.some(a => a.c === c && a.r === r);
    }

    private stationAt(c: number, r: number): Station | undefined {
        return this.stations.find(s => s.c === c && s.r === r);
    }

    /** 設施獎勵:基礎回復站 ×1 + 每座擁有的異界各出一座(有屬性→附魔站,純種族→回復站)。 */
    private grantsOf(type: FacilityType): number {
        let n = type === 'heal' ? 1 : 0;
        for (const w of run.lineup) if (facilityOfWorld(w) === type) n++;
        return n;
    }

    private remainingOf(type: FacilityType): number {
        return this.grantsOf(type) - this.stations.filter(s => s.type === type).length;
    }

    // ---------------------------------------------------------------- 裂隙生成

    private pickRiftCell(): Cell {
        const candidates: Cell[][] = [[], [], []];
        for (let c = 1; c <= COLS - 2; c++) {
            for (let r = 1; r <= ROWS - 2; r++) {
                if (this.springAt(c, r) || this.doorAt(c, r) || this.announceAt(c, r) || this.stationAt(c, r)) continue;
                const doorNear = this.doors.some(d => Math.max(Math.abs(d.c - c), Math.abs(d.r - r)) < BAL.RIFT_DOOR_DIST)
                    || this.announces.some(a => Math.max(Math.abs(a.c - c), Math.abs(a.r - r)) < BAL.RIFT_DOOR_DIST);
                if (doorNear) continue;
                const springDist = this.spring
                    ? Math.max(Math.abs(this.spring.c - c), Math.abs(this.spring.r - r))
                    : 99;
                const onRoute = this.routesAll.some(rt => rt.cellKeys.has(ck(c, r)));
                if (springDist >= BAL.RIFT_MAKER_DIST && !onRoute) candidates[0].push({ c, r });
                else if (springDist >= BAL.RIFT_MAKER_DIST) candidates[1].push({ c, r });
                else if (springDist >= 1) candidates[2].push({ c, r });
            }
        }
        const tier = candidates.find(t => t.length > 0) ?? [{ c: 7, r: 4 }];
        return tier[Math.floor(Math.random() * tier.length)];
    }

    private announceRift(spec: DoorSpec) {
        const cell = this.pickRiftCell();
        const x = cellX(cell.c), y = cellY(cell.r);
        const gfx = this.add.graphics().setDepth(5);
        const txt = label(this, x, y + 40, '裂隙擴大中…', 12, '#c88fd8', 0.5).setDepth(5);
        this.announces.push({ spec, c: cell.c, r: cell.r, remain: BAL.RIFT_LEAD, gfx, txt });
        this.cameras.main.shake(100, 0.002);
        this.showMsg('⚠ 空間震顫……新的裂隙正在擴大', '#c88fd8');
    }

    private openRift(a: RiftAnnounce) {
        a.gfx.destroy();
        a.txt.destroy();
        this.createDoor(a.spec, a.c, a.r);
        this.cameras.main.shake(180, 0.005);
        this.poof(cellX(a.c), cellY(a.r), a.spec.color);
        const reqStr = a.spec.reqs.length > 0 ? a.spec.reqs.map(t => TRAIT_EMOJI[t]).join('') : '任意';
        this.showMsg(`⚠ 裂隙開啟:${a.spec.worldName}之門(需求:${reqStr})—— 越早關掉越便宜!`, '#ffd35c');
        this.updateHudDoors();
    }

    private createDoor(spec: DoorSpec, c: number, r: number) {
        const x = cellX(c), y = cellY(r);
        const cont = this.add.container(x, y).setDepth(6);
        const body = this.add.graphics();
        const name = label(this, 0, -46, spec.worldName, 13, '#aab3c6', 0.5);
        const req = spec.reqs.length > 0
            ? label(this, 0, -2, spec.reqs.map(t => TRAIT_EMOJI[t]).join(''), 17, '#e8ecf4', 0.5)
            : label(this, 0, -2, '任意', 12, '#8a93a6', 0.5);
        const bar = this.add.graphics();
        const stateTxt = label(this, 0, 56, '', 12, '#8a93a6', 0.5);
        const zone = this.add.zone(0, 4, 64, 118).setInteractive({ useHandCursor: true });
        cont.add([body, name, req, bar, stateTxt, zone]);

        const door: Door = {
            spec, c, r, x, y,
            progress: 0, age: 0, state: 'active', enemyT: 0, rr: 0, routes: [],
            wasBacklash: false, cont, body, bar, stateTxt,
            lastP: 0, rate: 0, rateT: 0,
        };
        this.doors.push(door);
        this.redrawDoorBody(door);
        this.redrawDoorBar(door);
        this.updateDoorText(door);
    }

    /** 門的當前抵抗:基礎 + 扎根成長(隨開門秒數)。 */
    private doorDrain(d: Door): number {
        return Math.min(BAL.DRAIN_ABS_MAX, this.lvl.drain + BAL.DRAIN_GROWTH * d.age);
    }

    private redrawDoorBody(d: Door) {
        const backlash = d.state === 'active' && d.progress <= BAL.BASE * BAL.BACKLASH_RATIO;
        const col =
            d.state === 'locked' ? 0xffd35c :
            d.state === 'collapsed' ? 0x6b3a3a :
            backlash ? 0xff8c42 : d.spec.color;
        const radius = { tl: 19, tr: 19, bl: 5, br: 5 };
        d.body.clear();
        d.body.fillStyle(0x0b0e13, 0.92);
        d.body.fillRoundedRect(-21, -28, 42, 56, radius);
        d.body.lineStyle(3, col, 1);
        d.body.strokeRoundedRect(-21, -28, 42, 56, radius);
        if (d.state === 'collapsed') {
            d.body.lineStyle(3, 0x8a5a5a, 1);
            d.body.lineBetween(-12, -14, 12, 14);
            d.body.lineBetween(12, -14, -12, 14);
        }
    }

    private redrawDoorBar(d: Door) {
        const span = SPAN();
        const p = Math.max(-span, Math.min(span, d.progress));
        d.bar.clear();
        d.bar.fillStyle(0x1a2330, 1);
        d.bar.fillRoundedRect(-32, 36, 64, 8, 3);
        if (p > 0) {
            d.bar.fillStyle(d.state === 'locked' ? 0xffd35c : 0x7dd87d, 1);
            d.bar.fillRect(0, 37, (p / span) * 31, 6);
        } else if (p < 0) {
            d.bar.fillStyle(0xe05a4a, 1);
            d.bar.fillRect((p / span) * 31, 37, (-p / span) * 31, 6);
        }
        d.bar.fillStyle(0xffffff, 0.35);
        d.bar.fillRect(-0.5, 34, 1, 12);
        d.bar.fillStyle(0xff8c42, 0.7);
        d.bar.fillRect((BAL.BACKLASH_RATIO / BAL.STABLE_RATIO) * 31 - 0.5, 34, 1, 12);
    }

    private updateDoorText(d: Door) {
        let str = '';
        let col = '#8a93a6';
        if (d.state === 'locked') {
            str = '✓ 穩定・鎖定';
            col = '#ffd35c';
        } else if (d.state === 'collapsed') {
            str = '✕ 已崩潰';
            col = '#a06060';
        } else {
            const p = Math.round(d.progress);
            const arrow = d.rate > 0.05 ? ' ▲' : d.rate < -0.05 ? ' ▼' : '';
            const drain = `抗${this.doorDrain(d).toFixed(1)}`;
            if (d.progress <= BAL.BASE * BAL.BACKLASH_RATIO) {
                str = `反噬 ${p}${arrow}・${drain}`;
                col = '#ff8c42';
            } else {
                str = `${p}/${SPAN()}${arrow}・${drain}`;
                col = d.rate > 0.05 ? '#7dd87d' : d.rate < -0.05 ? '#c88484' : '#aab3c6';
            }
        }
        d.stateTxt.setText(str).setColor(col);
    }

    // ---------------------------------------------------------------- HUD

    private buildHud() {
        const g = this.add.graphics().setDepth(9);
        g.fillStyle(0x10151d, 1);
        g.fillRect(0, 0, 1024, 76);
        g.lineStyle(1, 0x2a3242, 1);
        g.lineBetween(0, 76, 1024, 76);

        label(this, 24, 38, `第 ${run.level} 關`, 21, '#e8ecf4').setFontStyle('bold').setDepth(10);
        this.hudIntegrity = label(this, 128, 38, '', 15, '#ffd35c').setDepth(10);
        this.hudDoors = label(this, 288, 38, '', 15, '#aab3c6').setDepth(10);
        this.hudConquer = label(this, 462, 38, `本輪征服 ${run.conquered}`, 15, '#aab3c6').setDepth(10);
        label(this, 596, 38, `庫存獎勵點 ${loadSave().points}`, 15, '#8a93a6').setDepth(10);
        this.updateIntegrity();
        this.updateHudDoors();

        this.pauseBtn = this.miniBtn(724, '⏸', () => this.togglePause());
        this.speed1 = this.miniBtn(772, '1×', () => this.setSpeed(1));
        this.speed2 = this.miniBtn(820, '2×', () => this.setSpeed(2));
        this.crushBtn = this.miniBtn(922, '粉碎裝置', () => this.onCrush(), '#c07070');
        this.refreshSpeedUI();

        this.hudMsg = this.add.text(512, 102, '', {
            fontFamily: FONT, fontSize: 14, color: '#9fc1e8',
            backgroundColor: 'rgba(13,17,23,0.88)', padding: { x: 12, y: 5 },
        }).setOrigin(0.5).setDepth(15).setAlpha(0);

        this.pausedTxt = label(this, 512, 384, '⏸ 戰術暫停 — 仍可放置與畫線,空白鍵繼續', 24, '#e8ecf4', 0.5).setDepth(18).setVisible(false);
    }

    private miniBtn(x: number, str: string, cb: () => void, color = '#cfd6e4') {
        const t = this.add.text(x, 38, str, {
            fontFamily: FONT, fontSize: 14, color,
            backgroundColor: '#1a2330', padding: { x: 10, y: 6 },
        }).setOrigin(0.5).setDepth(10).setInteractive({ useHandCursor: true });
        t.on('pointerdown', cb);
        return t;
    }

    private updateIntegrity() {
        this.hudIntegrity.setText(`完整度 ${'❖'.repeat(run.integrity)}${'◇'.repeat(run.maxIntegrity - run.integrity)}`);
    }

    private updateHudDoors() {
        const locked = this.doors.filter(d => d.state === 'locked').length;
        this.hudDoors.setText(`傳送門 ${this.doors.length}/${this.lvl.doors.length}・穩定 ${locked}`);
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
        this.tweens.add({ targets: this.hudMsg, alpha: 0, delay: 2000, duration: 400 });
    }

    // ---------------------------------------------------------------- 托盤(泉水 + 加工站 + 兵源顯示)

    private buildTray() {
        const bg = this.add.graphics().setDepth(10);
        bg.fillStyle(0x10151d, 1);
        bg.fillRect(0, 664, 1024, 104);
        bg.lineStyle(1, 0x2a3242, 1);
        bg.lineBetween(0, 664, 1024, 664);

        label(this, 24, 682, '點卡片放置(設施蓋在線上生效,可串接)|從泉水拖曳畫線到門|點線段拆除', 13, '#8a93a6').setDepth(10);
        const roster = run.lineup.map(w => w.traits.map(t => TRAIT_EMOJI[t]).join('')).join('・');
        label(this, 836, 682, `兵源 ${roster}`, 12, '#aab3c6', 1).setDepth(10);

        const cardW = 118;
        const makeCard = (i: number, key: 'spring' | FacilityType, name: string, emo: string, color: number, showCount: boolean) => {
            const cx = 24 + i * (cardW + 8) + cardW / 2;
            const cont = this.add.container(cx, 726).setDepth(10);
            const g = this.add.graphics();
            g.fillStyle(0x161d29, 1);
            g.fillRoundedRect(-cardW / 2, -27, cardW, 54, 9);
            g.lineStyle(2, color, 0.9);
            g.strokeRoundedRect(-cardW / 2, -27, cardW, 54, 9);
            const nm = label(this, 0, -11, name, 13, '#e8ecf4', 0.5);
            const em = label(this, showCount ? -14 : 0, 12, emo, 14, '#e8ecf4', 0.5);
            const countTxt = showCount ? label(this, 16, 12, '', 13, '#aab3c6', 0.5) : null;
            const z = this.add.zone(0, 0, cardW, 54).setInteractive({ useHandCursor: true });
            z.on('pointerdown', () => this.onCardClick(key));
            cont.add(countTxt ? [g, nm, em, countTxt, z] : [g, nm, em, z]);
            this.trayCards.push({ key, cont, countTxt });
        };

        makeCard(0, 'spring', '泉水・復活點', '⛲', SPRING_COLOR, false);
        let i = 1;
        for (const t of FACILITY_ORDER) {
            if (this.grantsOf(t) > 0) {
                const info = FACILITY_INFO[t];
                makeCard(i++, t, info.name, info.emoji, info.color, true);
            }
        }

        this.riftStatus = this.add.text(928, 716, '', {
            fontFamily: FONT, fontSize: 15, color: '#c88fd8', align: 'center',
        }).setOrigin(0.5).setDepth(10);

        this.refreshTray();
    }

    private refreshTray() {
        for (const card of this.trayCards) {
            if (card.key === 'spring') {
                card.cont.setAlpha(this.spring ? 0.32 : 1);
            } else {
                const left = this.remainingOf(card.key);
                card.countTxt?.setText(`×${left}`);
                card.cont.setAlpha(left > 0 ? 1 : 0.35);
            }
        }
    }

    private onCardClick(key: 'spring' | FacilityType) {
        if (this.phase !== 'run' || this.drawing) return;
        if (key === 'spring') {
            if (this.spring) {
                this.showMsg('泉水已在場上(點它角落的 ✕ 可收回)', '#8a93a6');
                return;
            }
            this.placing = 'spring';
            this.makeGhost(SPRING_COLOR, '⛲');
            return;
        }
        if (this.remainingOf(key) <= 0) {
            this.showMsg(`${FACILITY_INFO[key].name} 沒有庫存了(征服對應的異界可獲得)`, '#8a93a6');
            return;
        }
        this.placing = key;
        this.makeGhost(FACILITY_INFO[key].color, FACILITY_INFO[key].emoji);
    }

    // ---------------------------------------------------------------- 放置

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

    /** 泉水/加工站都可放在空格;加工站允許蓋在既有的線上(改裝現有產線)。 */
    private canPlace(c: number, r: number): boolean {
        if (this.phase !== 'run') return false;
        if (this.springAt(c, r) || this.doorAt(c, r) || this.announceAt(c, r) || this.stationAt(c, r)) return false;
        return true;
    }

    /** 放置容器共用:本體、名牌、✕ 收回鈕(badge 在 zone 之後加入 = 事件優先)。 */
    private buildPieceCont(cell: Cell, emo: string, name: string, onTap: (() => void) | null, onRemove: () => void) {
        const x = cellX(cell.c), y = cellY(cell.r);
        const cont = this.add.container(x, y).setDepth(6);
        const body = this.add.graphics();
        const em = label(this, 0, -2, emo, 16, '#e8ecf4', 0.5);
        const nm = label(this, 0, 33, name, 11, '#aab3c6', 0.5);
        const zone = this.add.zone(0, 0, 54, 54).setInteractive({ useHandCursor: true });

        const badge = this.add.container(24, -24);
        const bg = this.add.graphics();
        bg.fillStyle(0x30171b, 1);
        bg.fillCircle(0, 0, 9);
        bg.lineStyle(1.5, 0x8a5a5a, 1);
        bg.strokeCircle(0, 0, 9);
        const bx = label(this, 0, 0, '✕', 10, '#e8a0a0', 0.5);
        const bz = this.add.zone(0, 0, 20, 20).setInteractive({ useHandCursor: true });
        badge.add([bg, bx, bz]);

        cont.add([body, em, nm, zone, badge]);
        if (onTap) zone.on('pointerdown', onTap);
        bz.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
            ev.stopPropagation();
            onRemove();
        });
        return { cont, body, x, y };
    }

    private placeSpring(cell: Cell) {
        const spring = {} as Spring;
        const built = this.buildPieceCont(cell, '⛲', '泉水', () => this.startDrawing(), () => this.removeSpring());
        const countTxt = label(this, -24, -24, '', 11, '#53c2d8', 0.5).setVisible(false);
        built.cont.add(countTxt);
        Object.assign(spring, {
            c: cell.c, r: cell.r, x: built.x, y: built.y,
            color: SPRING_COLOR, routes: [], nextRoute: 0,
            spawnT: BAL.SPAWN_PERIOD, parked: [], incoming: [],
            cont: built.cont, body: built.body, countTxt,
        });
        this.spring = spring;
        this.redrawSpring();
        this.refreshTray();
        this.showMsg('⛲ 泉水就位 —— 軍團開始歸返;拖曳畫線把他們送往傳送門', '#53c2d8');
    }

    private removeSpring() {
        const sp = this.spring;
        if (!sp || this.phase !== 'run') return;
        this.cancelDrawing();
        [...sp.routes].forEach(rt => this.removeRoute(rt));
        for (const mob of this.mobs) {
            if (mob.alive && mob.kind === 'unit') this.kill(mob, true); // 失去歸屬,散逸
        }
        sp.cont.destroy();
        this.spring = null; // 傳送中/待命的一併散逸
        this.refreshTray();
    }

    private redrawSpring() {
        const sp = this.spring;
        if (!sp) return;
        sp.body.clear();
        sp.body.fillStyle(sp.color, 0.14);
        sp.body.fillCircle(0, 0, 23);
        sp.body.lineStyle(2.5, sp.color, 1);
        sp.body.strokeCircle(0, 0, 23);
        sp.body.lineStyle(1.5, sp.color, 0.5);
        sp.body.strokeCircle(0, 0, 15);
        for (let i = 0; i < BAL.SPRING_MAX_LINES; i++) {
            const used = i < sp.routes.length;
            sp.body.fillStyle(used ? 0xffffff : 0x000000, used ? 0.9 : 0.35);
            sp.body.fillCircle(-21 + i * 14, 20, 3);
        }
    }

    private placeStation(type: FacilityType, cell: Cell) {
        const info = FACILITY_INFO[type];
        const station = {} as Station;
        const built = this.buildPieceCont(cell, info.emoji, info.name, null, () => this.removeStation(station));
        Object.assign(station, {
            type, c: cell.c, r: cell.r, x: built.x, y: built.y,
            disabledT: 0, cont: built.cont, body: built.body,
        });
        this.stations.push(station);
        this.redrawStation(station);
        this.refreshTray();
    }

    private removeStation(st: Station) {
        if (this.phase !== 'run') return;
        st.cont.destroy();
        this.stations = this.stations.filter(x => x !== st);
        this.refreshTray();
    }

    private redrawStation(st: Station) {
        const info = FACILITY_INFO[st.type];
        const disabled = st.disabledT > 0;
        st.body.clear();
        st.body.fillStyle(disabled ? 0x2a2a30 : info.color, disabled ? 0.4 : 0.16);
        st.body.fillRoundedRect(-20, -20, 40, 40, 8);
        st.body.lineStyle(2.5, disabled ? 0x555560 : info.color, 1);
        st.body.strokeRoundedRect(-20, -20, 40, 40, 8);
        st.cont.setAlpha(disabled ? 0.6 : 1);
    }

    // ---------------------------------------------------------------- 手繪產線(只從泉水出發)

    private drawableCell(c: number, r: number, keys: Set<number>): boolean {
        // 加工站的格子可以穿過(這正是加工的玩法);泉水/門/預告不可
        return !this.springAt(c, r) && !this.doorAt(c, r) && !this.announceAt(c, r) && !keys.has(ck(c, r));
    }

    private startDrawing() {
        const sp = this.spring;
        if (!sp || this.phase !== 'run' || this.placing) return;
        if (sp.routes.length >= BAL.SPRING_MAX_LINES) {
            this.showMsg(`泉水的線已達上限 ${BAL.SPRING_MAX_LINES} 條(點舊線拆除)`, '#ff8c42');
            return;
        }
        const gfx = this.add.graphics().setDepth(3);
        this.drawing = { cells: [{ c: sp.c, r: sp.r }], keys: new Set([ck(sp.c, sp.r)]), gfx };
        this.redrawPreview();
    }

    private extendDrawing(px: number, py: number) {
        const d = this.drawing;
        if (!d) return;
        const cell = xyToCell(px, py);
        if (!cell) return;
        const last = d.cells[d.cells.length - 1];
        if (cell.c === last.c && cell.r === last.r) return;
        if (d.cells.length >= 2) {
            const prev = d.cells[d.cells.length - 2];
            if (cell.c === prev.c && cell.r === prev.r) {
                const popped = d.cells.pop()!;
                d.keys.delete(ck(popped.c, popped.r));
                this.redrawPreview();
                return;
            }
        }
        if (d.cells.length >= BAL.DRAW_MAX_CELLS) return;
        const adjacent = Math.abs(cell.c - last.c) + Math.abs(cell.r - last.r) === 1;
        if (adjacent && this.drawableCell(cell.c, cell.r, d.keys)) {
            d.cells.push(cell);
            d.keys.add(ck(cell.c, cell.r));
            this.redrawPreview();
            return;
        }
        if (!this.drawableCell(cell.c, cell.r, d.keys)) return;
        const bridge = bfsPath(last, cell, (c, r) => !this.drawableCell(c, r, d.keys));
        if (!bridge || d.cells.length + bridge.length - 1 > BAL.DRAW_MAX_CELLS) return;
        for (const b of bridge.slice(1)) {
            d.cells.push(b);
            d.keys.add(ck(b.c, b.r));
        }
        this.redrawPreview();
    }

    private redrawPreview() {
        const d = this.drawing;
        if (!d || !this.spring) return;
        const pts = d.cells.map(cl => ({ x: cellX(cl.c), y: cellY(cl.r) }));
        d.gfx.clear();
        d.gfx.lineStyle(7, SPRING_COLOR, 0.14);
        this.strokePolyline(d.gfx, pts);
        d.gfx.lineStyle(3, SPRING_COLOR, 0.95);
        this.strokePolyline(d.gfx, pts);
        const tip = pts[pts.length - 1];
        d.gfx.fillStyle(SPRING_COLOR, 1);
        d.gfx.fillCircle(tip.x, tip.y, 5);
    }

    private finishDrawing(px: number, py: number) {
        const d = this.drawing;
        if (!d) return;
        const door = this.doorAtPoint(px, py);
        if (door && door.state === 'active' && this.spring) {
            const last = d.cells[d.cells.length - 1];
            let cells: Cell[] | null = null;
            if (Math.abs(door.c - last.c) + Math.abs(door.r - last.r) === 1) {
                cells = [...d.cells, { c: door.c, r: door.r }];
            } else {
                const blocked = (c: number, r: number) =>
                    (c !== door.c || r !== door.r) && !this.drawableCell(c, r, d.keys);
                const bridge = bfsPath(last, { c: door.c, r: door.r }, blocked);
                if (bridge && d.cells.length + bridge.length - 1 <= BAL.DRAW_MAX_CELLS + 4) {
                    cells = [...d.cells, ...bridge.slice(1)];
                }
            }
            if (cells) {
                this.cancelDrawing();
                this.commitRoute(door, cells);
                return;
            }
            this.showMsg('接不到這扇門(路被擋住了)', '#ff8c42');
        }
        this.cancelDrawing();
    }

    private cancelDrawing() {
        this.drawing?.gfx.destroy();
        this.drawing = null;
    }

    private doorAtPoint(px: number, py: number): Door | undefined {
        return this.doors.find(d => Math.abs(px - d.x) <= 32 && Math.abs(py - d.y) <= 60);
    }

    private commitRoute(door: Door, cells: Cell[]) {
        const sp = this.spring;
        if (!sp) return;
        const existing = sp.routes.find(rt => rt.door === door);
        if (existing) this.removeRoute(existing); // 重畫同目的地 = 取代舊線

        const points = cells.map(cl => ({ x: cellX(cl.c), y: cellY(cl.r) }));
        const line = this.add.graphics().setDepth(2);
        line.lineStyle(7, SPRING_COLOR, 0.12);
        this.strokePolyline(line, points);
        line.lineStyle(3, SPRING_COLOR, 0.8);
        this.strokePolyline(line, points);

        const route: Route = {
            id: this.routeSeq++,
            origin: sp, door, points, cells,
            cellKeys: new Set(cells.map(cl => ck(cl.c, cl.r))),
            length: (points.length - 1) * CELL,
            line, dead: false,
        };
        this.routesAll.push(route);
        sp.routes.push(route);
        door.routes.push(route);
        this.redrawSpring();
    }

    private strokePolyline(g: Phaser.GameObjects.Graphics, pts: { x: number; y: number }[]) {
        if (pts.length < 2) return;
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
        g.strokePath();
    }

    private removeRoute(rt: Route) {
        rt.dead = true;
        rt.line.destroy();
        this.routesAll = this.routesAll.filter(x => x !== rt);
        rt.origin.routes = rt.origin.routes.filter(x => x !== rt);
        rt.door.routes = rt.door.routes.filter(x => x !== rt);
        for (const mob of this.mobs) {
            if (mob.alive && mob.route === rt && mob.kind === 'unit' && mob.dir === 1) {
                mob.dir = -1; // 掉頭撤退回泉水待命
                mob.gfx.setAlpha(0.45);
            }
        }
        this.redrawSpring();
    }

    // ---------------------------------------------------------------- 輸入

    private wireInput() {
        this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
            if (over.length > 0) return;
            this.onBoardClick(p.x, p.y);
        });
        this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
            if (this.drawing) {
                this.extendDrawing(p.x, p.y);
                return;
            }
            if (!this.ghost || !this.placing) return;
            const cell = xyToCell(p.x, p.y);
            if (cell && this.canPlace(cell.c, cell.r)) {
                this.ghost.setPosition(cellX(cell.c), cellY(cell.r)).setAlpha(0.95);
            } else {
                this.ghost.setPosition(p.x, p.y).setAlpha(0.3);
            }
        });
        this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.finishDrawing(p.x, p.y));
        this.input.on('pointerupoutside', () => this.cancelDrawing());

        const kb = this.input.keyboard;
        kb?.on('keydown-SPACE', () => this.togglePause());
        kb?.on('keydown-ONE', () => this.setSpeed(1));
        kb?.on('keydown-TWO', () => this.setSpeed(2));
        kb?.on('keydown-ESC', () => {
            this.placing = null;
            this.destroyGhost();
            this.cancelDrawing();
        });
    }

    private onBoardClick(x: number, y: number) {
        if (this.phase === 'end') return;
        const cell = xyToCell(x, y);
        if (this.placing) {
            if (cell && this.canPlace(cell.c, cell.r)) {
                if (this.placing === 'spring') this.placeSpring(cell);
                else this.placeStation(this.placing, cell);
                this.placing = null;
                this.destroyGhost();
            } else {
                this.showMsg('這裡不能放置(已被佔用)', '#ff8c42');
            }
            return;
        }
        if (cell) {
            const hit = this.routesAll.find(rt => rt.cellKeys.has(ck(cell.c, cell.r)));
            if (hit) {
                this.removeRoute(hit);
                this.showMsg(`已拆除產線:泉水 ✕ ${hit.door.spec.worldName}之門`, '#8a93a6');
            }
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

    private onCrush() {
        if (this.phase === 'end') return;
        if (this.crushArmed > 0) {
            run.integrity = 0;
            this.updateIntegrity();
            this.shatter();
        } else {
            this.crushArmed = 2.5;
            this.crushBtn.setText('確定粉碎?').setColor('#ff5c5c');
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
                sim -= step;
            }
        }
        this.visualStep(rdt);
    }

    private simStep(dt: number) {
        // 0) 關卡時鐘與裂隙
        this.levelT += dt;
        if (this.pending.length > 0 && this.announces.length === 0 && !this.doors.some(d => d.state === 'active')) {
            this.levelT = Math.max(this.levelT, this.pending[0].spawnAt - 1);
        }
        while (this.pending.length > 0 && this.levelT >= this.pending[0].spawnAt) {
            this.announceRift(this.pending.shift()!);
        }
        for (const a of [...this.announces]) {
            a.remain -= dt;
            if (a.remain <= 0) {
                this.announces = this.announces.filter(x => x !== a);
                this.openRift(a);
            }
        }
        if (!this.spring && this.levelT > 6 && !this.springNagged) {
            this.springNagged = true;
            this.showMsg('⚠ 還沒放置泉水 —— 沒有復活點,軍團無法歸返!', '#ff8c42');
        }

        // 1) 泉水:固定兵源(歸返傷兵)+ 裂隙傳送復活 + 待命隊伍
        const sp = this.spring;
        if (sp) {
            if (sp.routes.length > 0) {
                sp.spawnT += dt;
                while (sp.spawnT >= BAL.SPAWN_PERIOD) {
                    sp.spawnT -= BAL.SPAWN_PERIOD;
                    const w = run.lineup[Math.floor(Math.random() * run.lineup.length)];
                    const hp = BAL.ARRIVAL_MIN + Math.random() * (BAL.ARRIVAL_MAX - BAL.ARRIVAL_MIN);
                    this.dispatch({ value: BAL.UNIT_VALUE * hp, traits: [...w.traits] });
                }
            } else {
                sp.spawnT = Math.min(sp.spawnT + dt, BAL.SPAWN_PERIOD);
            }
            for (const tr of [...sp.incoming]) {
                tr.t -= dt;
                if (tr.t > 0) continue;
                sp.incoming = sp.incoming.filter(x => x !== tr);
                const parcel: Parcel = {
                    value: Math.min(tr.value + BAL.SPRING_HEAL, BAL.UNIT_VALUE),
                    traits: tr.traits,
                };
                this.poof(sp.x, sp.y, worldColor(parcel.traits));
                if (sp.routes.length > 0) this.dispatch(parcel);
                else sp.parked.push(parcel);
            }
            while (sp.parked.length > 0 && sp.routes.length > 0) {
                this.dispatch(sp.parked.pop()!);
            }
        }

        // 2) 移動 + 加工站觸發(單位:生效;敵人:癱瘓它)
        for (const mob of this.mobs) {
            if (!mob.alive) continue;
            mob.dist += mob.dir * BAL.UNIT_SPEED * dt;
            const p = this.pointAt(mob.route, mob.dist);
            mob.gfx.setPosition(p.x, p.y);
            const k = Math.round(Math.max(0, Math.min(mob.dist, mob.route.length)) / CELL);
            if (k !== mob.cellK) {
                mob.cellK = k;
                const cl = mob.route.cells[k];
                if (cl) {
                    const st = this.stationAt(cl.c, cl.r);
                    if (st) {
                        if (mob.kind === 'unit' && mob.dir === 1 && st.disabledT <= 0) this.applyStation(st, mob);
                        else if (mob.kind === 'enemy') this.disableStation(st);
                    }
                }
            }
        }

        // 3) 路徑對沖(GDD:小的消滅、大的扣除續行、相等同歸於盡)
        for (const rt of this.routesAll) {
            for (const u of this.mobs) {
                if (!u.alive || u.route !== rt || u.kind !== 'unit' || u.dir !== 1) continue;
                for (const e of this.mobs) {
                    if (!e.alive || e.route !== rt || e.kind !== 'enemy') continue;
                    if (Math.abs(u.dist - e.dist) >= 14) continue;
                    const uv = u.value, ev = e.value;
                    if (uv > ev) {
                        u.value = uv - ev;
                        this.scaleMob(u);
                        this.kill(e, true);
                    } else if (ev > uv) {
                        e.value = ev - uv;
                        this.scaleMob(e);
                        this.kill(u, true);
                        break;
                    } else {
                        this.kill(u, true);
                        this.kill(e, true);
                        break;
                    }
                }
            }
        }

        // 4) 抵達
        for (const mob of this.mobs) {
            if (!mob.alive) continue;
            if (mob.kind === 'unit') {
                if (mob.dir === 1 && mob.dist >= mob.route.length) {
                    const door = mob.route.door;
                    if (door.state === 'active') {
                        const w = this.matchWeight(mob.traits, door.spec.reqs);
                        const gain = mob.value * w;
                        door.progress += gain;
                        this.floatText(door.x + 30, door.y - 26, `+${gain.toFixed(1)}`,
                            w >= 0.99 ? '#ffd35c' : w >= 0.5 ? '#e8ecf4' : '#8a93a6');
                    }
                    mob.value *= BAL.PASS_MULT;
                    if (mob.value < BAL.CULL_VALUE || !this.spring) {
                        this.kill(mob, true);   // 榨乾,或泉水不在 → 消散
                        continue;
                    }
                    this.spring.incoming.push({ value: mob.value, traits: mob.traits, t: BAL.RIFT_TRANSIT });
                    this.kill(mob, true);
                } else if (mob.dir === -1 && mob.dist <= 0) {
                    mob.route.origin.parked.push({ value: mob.value, traits: mob.traits });
                    this.kill(mob, false);
                }
            } else if (mob.dist <= 0) {
                this.kill(mob, false); // 敵人走到泉水端散逸(還不會破壞泉水)
            }
        }

        // 5) 門的推拉(抵抗隨開門時間扎根)
        for (const d of this.doors) {
            if (d.state !== 'active') continue;
            d.age += dt;
            const drain = this.doorDrain(d);
            d.progress -= drain * dt;

            if (d.progress <= BAL.BASE * BAL.COLLAPSE_RATIO) {
                this.collapseDoor(d);
                continue;
            }
            if (d.progress >= SPAN()) {
                this.lockDoor(d);
                continue;
            }

            const backlash = d.progress <= BAL.BASE * BAL.BACKLASH_RATIO;
            if (backlash && !d.wasBacklash) {
                d.wasBacklash = true;
                this.redrawDoorBody(d);
                this.cameras.main.shake(120, 0.003);
                this.showMsg(`⚠ ${d.spec.worldName}之門開始反噬!敵人正殺進你的後勤網`, '#ff8c42');
            } else if (!backlash && d.wasBacklash) {
                d.wasBacklash = false;
                d.cont.setAlpha(1);
                this.redrawDoorBody(d);
            }
            if (backlash && d.routes.length > 0) {
                d.enemyT += dt;
                // 湧出頻率隨扎根程度加快(抵抗越高、出兵越急)
                const period = Math.max(BAL.ENEMY_PERIOD_MIN, this.lvl.enemyPeriod * (this.lvl.drain / drain));
                while (d.enemyT >= period) {
                    d.enemyT -= period;
                    const rt = d.routes[d.rr % d.routes.length];
                    d.rr++;
                    this.spawnEnemy(rt);
                }
            } else {
                d.enemyT = Math.min(d.enemyT, this.lvl.enemyPeriod);
            }

            d.rateT += dt;
            if (d.rateT >= 0.5) {
                d.rate = (d.progress - d.lastP) / d.rateT;
                d.lastP = d.progress;
                d.rateT = 0;
            }
            this.redrawDoorBar(d);
            this.updateDoorText(d);
        }

        // 5.5) 加工站癱瘓恢復
        for (const st of this.stations) {
            if (st.disabledT > 0) {
                st.disabledT -= dt;
                if (st.disabledT <= 0) {
                    st.disabledT = 0;
                    this.redrawStation(st);
                }
            }
        }

        // 6) 清理
        this.mobs = this.mobs.filter(m => m.alive);
    }

    private applyStation(st: Station, mob: Mob) {
        if (st.type === 'heal') {
            if (mob.value >= BAL.UNIT_VALUE) return;
            mob.value = Math.min(mob.value + BAL.HEAL_STATION, BAL.UNIT_VALUE);
            this.scaleMob(mob);
            this.floatText(st.x, st.y - 26, `+${BAL.HEAL_STATION}`, '#7dd87d');
        } else {
            const race = mob.traits[0];
            if (mob.traits[1] === st.type) return; // 已是同屬性
            mob.traits = [race, st.type];          // 屬性欄:新蓋舊(種族先天不可變)
            mob.gfx.setStrokeStyle(2, TRAIT_COLOR[st.type]);
            this.floatText(st.x, st.y - 26, TRAIT_EMOJI[st.type], '#e8ecf4');
        }
    }

    private disableStation(st: Station) {
        if (st.disabledT > 0) {
            st.disabledT = BAL.STATION_DISABLE;
            return;
        }
        st.disabledT = BAL.STATION_DISABLE;
        this.redrawStation(st);
        this.floatText(st.x, st.y - 26, '⚡癱瘓!', '#ff8c42');
        this.showMsg(`⚡ ${FACILITY_INFO[st.type].name}被反噬敵人癱瘓了!`, '#ff8c42');
    }

    private visualStep(rdt: number) {
        this.pulseT += rdt;
        for (const d of this.doors) {
            if (d.state === 'active' && d.progress <= BAL.BASE * BAL.BACKLASH_RATIO) {
                d.cont.setAlpha(0.74 + 0.26 * Math.sin(this.pulseT * 9));
            }
        }
        for (const a of this.announces) {
            const x = cellX(a.c), y = cellY(a.r);
            const t = 1 - a.remain / BAL.RIFT_LEAD;
            const pulse = 0.5 + 0.5 * Math.sin(this.pulseT * 10);
            a.gfx.clear();
            a.gfx.lineStyle(2, 0xc88fd8, 0.35 + 0.5 * pulse);
            a.gfx.strokeCircle(x, y, 26 - 10 * t);
            a.gfx.lineStyle(1.5, 0xc88fd8, 0.25);
            a.gfx.strokeCircle(x, y, 12 + 6 * pulse);
        }
        if (this.spring) {
            const n = this.spring.parked.length;
            this.spring.countTxt.setVisible(n > 0);
            if (n > 0) this.spring.countTxt.setText(`${n}`);
        }
        let status: string;
        if (this.announces.length > 0) {
            status = '裂隙擴大中!';
        } else if (this.pending.length > 0) {
            status = `下道裂隙 ${Math.max(0, Math.ceil(this.pending[0].spawnAt - this.levelT))}s`;
        } else {
            status = '裂隙已全數開啟';
        }
        if (status !== this.riftStatusLast) {
            this.riftStatusLast = status;
            this.riftStatus.setText(status);
        }
        if (this.crushArmed > 0) {
            this.crushArmed -= rdt;
            if (this.crushArmed <= 0) this.crushBtn.setText('粉碎裝置').setColor('#c07070');
        }
    }

    // ---------------------------------------------------------------- 單位

    private matchWeight(traits: Trait[], reqs: Trait[]): number {
        if (reqs.length === 0) return 1;
        const matched = reqs.filter(r => traits.includes(r)).length;
        return BAL.MATCH_MIN_W + (1 - BAL.MATCH_MIN_W) * (matched / reqs.length);
    }

    private pointAt(rt: Route, dist: number): { x: number; y: number } {
        const d = Math.max(0, Math.min(dist, rt.length));
        const i = Math.min(Math.floor(d / CELL), rt.points.length - 2);
        const t = (d - i * CELL) / CELL;
        const a = rt.points[i], b = rt.points[i + 1];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }

    private dispatch(parcel: Parcel) {
        const sp = this.spring;
        if (!sp || sp.routes.length === 0) return;
        const rt = sp.routes[sp.nextRoute % sp.routes.length]; // 輪流均分
        sp.nextRoute++;
        const color = worldColor(parcel.traits);
        const gfx = this.add.circle(sp.x, sp.y, 7, color).setDepth(4);
        const elem = parcel.traits[1];
        gfx.setStrokeStyle(elem ? 2 : 1.5, elem ? TRAIT_COLOR[elem] : 0x0b0e13);
        const mob: Mob = {
            kind: 'unit', value: parcel.value, traits: parcel.traits, route: rt,
            dist: 0, dir: 1, cellK: 0, color, gfx, alive: true,
        };
        this.scaleMob(mob);
        this.mobs.push(mob);
    }

    private spawnEnemy(rt: Route) {
        const start = this.pointAt(rt, rt.length);
        const gfx = this.add.rectangle(start.x, start.y, 12, 12, 0xd84848).setDepth(4);
        gfx.setAngle(45);
        gfx.setStrokeStyle(1.5, 0x2a0f0f);
        const mob: Mob = {
            kind: 'enemy', value: BAL.ENEMY_VALUE, traits: [], route: rt,
            dist: rt.length, dir: -1, cellK: rt.cells.length - 1, color: 0xd84848, gfx, alive: true,
        };
        this.scaleMob(mob);
        this.mobs.push(mob);
        this.poof(start.x, start.y, 0xd84848);
    }

    private scaleMob(mob: Mob) {
        mob.gfx.setScale(0.55 + 0.45 * Math.min(1, mob.value / BAL.UNIT_VALUE));
    }

    private kill(mob: Mob, showPoof: boolean) {
        if (!mob.alive) return;
        mob.alive = false;
        if (showPoof) this.poof(mob.gfx.x, mob.gfx.y, mob.color);
        mob.gfx.destroy();
    }

    private poof(x: number, y: number, color: number) {
        const c = this.add.circle(x, y, 5, color, 0.7).setDepth(5);
        this.tweens.add({ targets: c, scale: 2.2, alpha: 0, duration: 260, onComplete: () => c.destroy() });
    }

    private floatText(x: number, y: number, str: string, color: string) {
        const t = this.add.text(x, y, str, { fontFamily: FONT, fontSize: 13, color })
            .setOrigin(0.5).setDepth(15);
        this.tweens.add({ targets: t, y: y - 26, alpha: 0, duration: 700, onComplete: () => t.destroy() });
    }

    // ---------------------------------------------------------------- 門的結局

    private lockDoor(d: Door) {
        if (this.phase === 'end') return;
        d.state = 'locked';
        d.progress = SPAN();
        d.cont.setAlpha(1);
        [...d.routes].forEach(rt => this.removeRoute(rt));
        this.redrawDoorBody(d);
        this.redrawDoorBar(d);
        this.updateDoorText(d);
        this.floatText(d.x, d.y - 64, '穩定!', '#ffd35c');
        this.updateHudDoors();
        this.showMsg(`✦ ${d.spec.worldName}已被征服!把產線改派到其他門吧`, '#ffd35c');
        this.checkLevelEnd();
    }

    private collapseDoor(d: Door) {
        if (this.phase === 'end') return;
        d.state = 'collapsed';
        d.progress = -SPAN();
        d.cont.setAlpha(1);
        [...d.routes].forEach(rt => this.removeRoute(rt));
        this.redrawDoorBody(d);
        this.redrawDoorBar(d);
        this.updateDoorText(d);
        run.integrity -= 1;
        this.updateIntegrity();
        this.updateHudDoors();
        this.cameras.main.shake(320, 0.008);
        this.floatText(d.x, d.y - 64, '崩潰!', '#ff5c5c');
        this.showMsg(`✕ ${d.spec.worldName}之門崩潰(斷尾保護魔王)—— 裝置完整度 −1`, '#ff5c5c');
        if (run.integrity <= 0) {
            this.shatter();
            return;
        }
        this.checkLevelEnd();
    }

    private checkLevelEnd() {
        if (this.phase !== 'run') return;
        if (this.pending.length > 0 || this.announces.length > 0) return;
        if (this.doors.some(d => d.state === 'active')) return;

        this.phase = 'end';
        const lockedDoors = this.doors.filter(d => d.state === 'locked');
        const gained: WorldDef[] = lockedDoors.map(d => ({
            id: `${d.spec.id}-owned`,
            name: d.spec.worldName,
            traits: d.spec.worldTraits,
            color: d.spec.color,
        }));
        run.lineup.push(...gained);
        run.conquered += gained.length;
        this.hudConquer.setText(`本輪征服 ${run.conquered}`);

        const collapsed = this.doors.length - lockedDoors.length;
        const lines: string[] = [];
        if (gained.length > 0) {
            lines.push(`征服異界:${gained.map(g => g.name).join('、')}`);
            const facs = gained.map(g => FACILITY_INFO[facilityOfWorld(g)].name).join('、');
            lines.push(`兵源加入該族,並獲得設施:${facs}`);
        } else {
            lines.push('沒有征服任何異界……勉強撐了過去。');
        }
        if (collapsed > 0) lines.push(`折損:${collapsed} 扇門崩潰(完整度 −${collapsed})`);

        this.showOverlay(`第 ${run.level} 關 — 過關!`, lines, `進入第 ${run.level + 1} 關 ▶`, () => {
            run.level += 1;
            this.scene.restart();
        });
    }

    private shatter() {
        if (this.phase === 'end') return;
        this.phase = 'end';
        const save = loadSave();
        save.points += run.conquered;
        persistSave(save);
        this.cameras.main.shake(500, 0.01);
        this.showOverlay('裝 置 碎 裂', [
            '輿圖裝置的完整度耗盡,通往諸界的門一同熄滅。',
            `結算:本輪征服 ${run.conquered} 座異界 → 獎勵點 +${run.conquered}`,
        ], null);
        this.time.delayedCall(2000, () => this.scene.start('GameOver'));
    }

    private showOverlay(title: string, lines: string[], btnLabel: string | null, cb?: () => void) {
        const c = this.add.container(0, 0).setDepth(20);
        const dim = this.add.rectangle(512, 384, 1024, 768, 0x05070a, 0.74).setInteractive();
        c.add(dim);
        const g = this.add.graphics();
        g.fillStyle(0x141a24, 1);
        g.fillRoundedRect(262, 248, 500, 268, 16);
        g.lineStyle(2, 0x3c5a80, 1);
        g.strokeRoundedRect(262, 248, 500, 268, 16);
        c.add(g);
        c.add(label(this, 512, 298, title, 30, '#e8ecf4', 0.5).setFontStyle('bold'));
        lines.forEach((ln, i) => c.add(label(this, 512, 348 + i * 28, ln, 15, '#aab3c6', 0.5)));
        if (btnLabel) {
            c.add(makeButton(this, 512, 468, btnLabel, () => cb && cb(), { w: 250, h: 52 }));
        }
    }
}
