// 核心場景:驗證 GDD 的關鍵問題 ——
// 「鋪產線餵門 + 反噬時即時重新分配」這個 30 秒循環本身好不好玩?
//
// 全程即時:開局棋盤沒有門,裂隙會先「預告」數秒再撕開(位置隨機、分批出現)。
// 玩家隨時可放異界與泉水(下方卡片)、從源頭「按住拖曳」手繪產線到門、點線段拆除。
// 空白鍵暫停 = 戰術規劃(暫停中仍可放置與畫線)。
//
// 單位的一生(v0.3):出生(異界)→ 沿線上工(規格符合度加權貢獻)→ 過門打 4 折
// → 從「泉水」復活(小補,保留特性)→ 沿泉水的線再上工 → 折舊後 < 榨乾線即消散。
// 沒放泉水(或泉水沒連線)= 餵完即消散;不再有原路折返。
// 門進度被抵抗持續下壓;跌破反噬線,敵人沿「接到該門的所有線」湧出(產線即戰線)。

import { Scene } from 'phaser';
import { BAL } from '../balance';
import { genLevel } from '../levelgen';
import { BOARD_X, BOARD_Y, CELL, COLS, Cell, ROWS, bfsPath, cellX, cellY, xyToCell } from '../grid';
import { run, startNewRun } from '../run';
import { loadSave, persistSave } from '../save';
import { DoorSpec, LevelSpec, TRAIT_EMOJI, Trait, WorldDef, worldColor } from '../types';
import { FONT, label, makeButton } from '../ui';

const SPRING_COLOR = 0x53c2d8;

interface Route {
    id: number;
    origin: Source;
    door: Door;
    points: { x: number; y: number }[];
    cellKeys: Set<number>;     // 途經格(供點擊拆線與裂隙避開)
    length: number;
    line: Phaser.GameObjects.Graphics;
    dead: boolean;
}

/** 一包「單位」:回流待命與裂隙傳送中都以此形式存在。 */
interface Parcel {
    value: number;
    traits: Trait[];
}

interface SourceBase {
    c: number; r: number; x: number; y: number;
    color: number;
    routes: Route[];
    nextRoute: number;
    parked: Parcel[];          // 待命:沒有線可走時暫存,畫線後派出
    cont: Phaser.GameObjects.Container;
    body: Phaser.GameObjects.Graphics;
}

interface Maker extends SourceBase {
    kind: 'maker';
    world: WorldDef;
    spawnT: number;
}

interface Spring extends SourceBase {
    kind: 'spring';
    incoming: (Parcel & { t: number })[];  // 裂隙傳送中(過門 → 復活的延遲)
    countTxt: Phaser.GameObjects.Text;
}

type Source = Maker | Spring;

type DoorState = 'active' | 'locked' | 'collapsed';

interface Door {
    spec: DoorSpec;
    c: number; r: number; x: number; y: number;
    progress: number;
    state: DoorState;
    enemyT: number;
    rr: number;                // 反噬湧出的輪替索引
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

/** 裂隙預告:標記出現 RIFT_LEAD 秒後,門才真正撕開。 */
interface RiftAnnounce {
    spec: DoorSpec;
    c: number; r: number;
    remain: number;
    gfx: Phaser.GameObjects.Graphics;
    txt: Phaser.GameObjects.Text;
}

interface Mob {
    kind: 'unit' | 'enemy';
    value: number;             // 貢獻=戰力,同一個池(GDD)
    traits: Trait[];
    route: Route;
    dist: number;              // 沿路徑距離:0 = 源頭端,length = 門端
    dir: 1 | -1;
    color: number;
    gfx: Phaser.GameObjects.Shape;
    alive: boolean;
}

/** 手繪中的產線。 */
interface Drawing {
    origin: Source;
    cells: Cell[];
    keys: Set<number>;
    gfx: Phaser.GameObjects.Graphics;
}

type Phase = 'run' | 'end';
type PlacingSel = WorldDef | 'spring';

const SPAN = () => BAL.BASE * BAL.STABLE_RATIO;
const ck = (c: number, r: number) => r * COLS + c;

export class Game extends Scene {
    private lvl!: LevelSpec;
    private makers: Maker[] = [];
    private spring: Spring | null = null;
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
    private deployed = new Set<string>();
    private pulseT = 0;
    private crushArmed = 0;
    private springHintShown = false;

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
    private trayCards: { world: WorldDef | null; cont: Phaser.GameObjects.Container }[] = [];
    private deployTxt!: Phaser.GameObjects.Text;
    private ghost: Phaser.GameObjects.Container | null = null;

    constructor() {
        super('Game');
    }

    create() {
        if (run.lineup.length === 0) startNewRun(loadSave()); // 直接進此場景時的保險

        // scene.restart() 會重跑 create,所有狀態必須在這裡歸零
        this.makers = [];
        this.spring = null;
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
        this.deployed = new Set();
        this.pulseT = 0;
        this.crushArmed = 0;
        this.springHintShown = false;
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

        this.showMsg(`第 ${run.level} 關:輿圖裝置啟動,第一道裂隙即將撕開 —— 佈置你的產線!`, '#9fc1e8');
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

    private sources(): Source[] {
        return this.spring ? [...this.makers, this.spring] : [...this.makers];
    }

    private makerAt(c: number, r: number): boolean {
        return this.makers.some(m => m.c === c && m.r === r);
    }

    private springAt(c: number, r: number): boolean {
        return this.spring !== null && this.spring.c === c && this.spring.r === r;
    }

    private doorAt(c: number, r: number): boolean {
        return this.doors.some(d => d.c === c && d.r === r);
    }

    private announceAt(c: number, r: number): boolean {
        return this.announces.some(a => a.c === c && a.r === r);
    }

    // ---------------------------------------------------------------- 裂隙生成

    /** 幫新裂隙挑格子:分層放寬條件,理論上一定挑得到。 */
    private pickRiftCell(): Cell {
        const srcCells = this.sources().map(s => ({ c: s.c, r: s.r }));
        const candidates: Cell[][] = [[], [], []];
        for (let c = 1; c <= COLS - 2; c++) {
            for (let r = 1; r <= ROWS - 2; r++) {
                if (this.makerAt(c, r) || this.springAt(c, r) || this.doorAt(c, r) || this.announceAt(c, r)) continue;
                const doorNear = this.doors.some(d => Math.max(Math.abs(d.c - c), Math.abs(d.r - r)) < BAL.RIFT_DOOR_DIST)
                    || this.announces.some(a => Math.max(Math.abs(a.c - c), Math.abs(a.r - r)) < BAL.RIFT_DOOR_DIST);
                if (doorNear) continue;
                const srcDist = Math.min(...srcCells.map(s => Math.max(Math.abs(s.c - c), Math.abs(s.r - r))), 99);
                const onRoute = this.routesAll.some(rt => rt.cellKeys.has(ck(c, r)));
                if (srcDist >= BAL.RIFT_MAKER_DIST && !onRoute) candidates[0].push({ c, r });
                else if (srcDist >= BAL.RIFT_MAKER_DIST) candidates[1].push({ c, r });
                else if (srcDist >= 1) candidates[2].push({ c, r });
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
        this.showMsg(`⚠ 裂隙開啟:${a.spec.worldName}之門(需求:${reqStr})`, '#ffd35c');
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
        // zone 沒掛事件,但要擋住「點棋盤拆線」誤觸;放線時的落點判定用 doorAtPoint()
        const zone = this.add.zone(0, 4, 64, 118).setInteractive({ useHandCursor: true });
        cont.add([body, name, req, bar, stateTxt, zone]);

        const door: Door = {
            spec, c, r, x, y,
            progress: 0, state: 'active', enemyT: 0, rr: 0, routes: [],
            wasBacklash: false, cont, body, bar, stateTxt,
            lastP: 0, rate: 0, rateT: 0,
        };
        this.doors.push(door);
        this.redrawDoorBody(door);
        this.redrawDoorBar(door);
        this.updateDoorText(door);
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
            if (d.progress <= BAL.BASE * BAL.BACKLASH_RATIO) {
                str = `反噬中 ${p}${arrow}`;
                col = '#ff8c42';
            } else {
                str = `${p} / ${SPAN()}${arrow}`;
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

    // ---------------------------------------------------------------- 陣容托盤(常駐)

    private buildTray() {
        const bg = this.add.graphics().setDepth(10);
        bg.fillStyle(0x10151d, 1);
        bg.fillRect(0, 664, 1024, 104);
        bg.lineStyle(1, 0x2a3242, 1);
        bg.lineBetween(0, 664, 1024, 664);

        label(this, 24, 682, '點卡片→點棋盤放置|從異界/泉水按住拖曳,畫線到傳送門|點線段拆除', 13, '#8a93a6').setDepth(10);
        this.deployTxt = label(this, 836, 682, '', 13, '#aab3c6', 1).setDepth(10);

        const n = run.lineup.length + 1; // +1:泉水卡
        const cardW = Math.min(150, Math.floor(780 / n) - 8);
        const makeCard = (i: number, name: string, emo: string, color: number, world: WorldDef | null, onClick: () => void) => {
            const cx = 24 + i * (cardW + 8) + cardW / 2;
            const cont = this.add.container(cx, 726).setDepth(10);
            const g = this.add.graphics();
            g.fillStyle(0x161d29, 1);
            g.fillRoundedRect(-cardW / 2, -27, cardW, 54, 9);
            g.lineStyle(2, color, 0.9);
            g.strokeRoundedRect(-cardW / 2, -27, cardW, 54, 9);
            const nm = label(this, 0, -11, name, cardW < 96 ? 11 : 13, '#e8ecf4', 0.5);
            const em = label(this, 0, 12, emo, 14, '#e8ecf4', 0.5);
            const z = this.add.zone(0, 0, cardW, 54).setInteractive({ useHandCursor: true });
            z.on('pointerdown', onClick);
            cont.add([g, nm, em, z]);
            this.trayCards.push({ world, cont });
        };
        run.lineup.forEach((w, i) => {
            makeCard(i, w.name, w.traits.map(t => TRAIT_EMOJI[t]).join(' '), w.color, w, () => this.onCardClick(w));
        });
        makeCard(run.lineup.length, '泉水・復活點', '⛲', SPRING_COLOR, null, () => this.onSpringCard());

        this.riftStatus = this.add.text(928, 716, '', {
            fontFamily: FONT, fontSize: 15, color: '#c88fd8', align: 'center',
        }).setOrigin(0.5).setDepth(10);

        this.refreshTray();
    }

    private refreshTray() {
        this.deployTxt.setText(`部署 ${this.deployed.size}/${this.lvl.deployLimit}|泉水 ${this.spring ? 1 : 0}/1`);
        for (const card of this.trayCards) {
            if (card.world === null) {
                card.cont.setAlpha(this.spring ? 0.32 : 1);
            } else {
                const placed = this.deployed.has(card.world.id);
                const full = !placed && this.deployed.size >= this.lvl.deployLimit;
                card.cont.setAlpha(placed ? 0.32 : full ? 0.55 : 1);
            }
        }
    }

    private onCardClick(w: WorldDef) {
        if (this.phase !== 'run' || this.drawing) return;
        if (this.deployed.has(w.id)) {
            this.showMsg('這座異界已在場上(點它角落的 ✕ 可收回)', '#8a93a6');
            return;
        }
        if (this.deployed.size >= this.lvl.deployLimit) {
            this.showMsg(`本關部署上限 ${this.lvl.deployLimit} 座(場地空間有限)`, '#ff8c42');
            return;
        }
        this.placing = w;
        this.makeGhost(w.color, w.traits.map(tr => TRAIT_EMOJI[tr]).join(''));
    }

    private onSpringCard() {
        if (this.phase !== 'run' || this.drawing) return;
        if (this.spring) {
            this.showMsg('泉水已在場上(點它角落的 ✕ 可收回)', '#8a93a6');
            return;
        }
        this.placing = 'spring';
        this.makeGhost(SPRING_COLOR, '⛲');
    }

    // ---------------------------------------------------------------- 放置與幽靈

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

    private canPlace(c: number, r: number): boolean {
        if (this.phase !== 'run') return false;
        if (this.makerAt(c, r) || this.springAt(c, r) || this.doorAt(c, r) || this.announceAt(c, r)) return false;
        return true;
    }

    /** 建立源頭(異界/泉水)共用的容器與互動:本體、名牌、拖曳起點、收回按鈕。 */
    private buildSourceCont(cell: Cell, emo: string, name: string, getSource: () => Source, onRemove: () => void) {
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
        zone.on('pointerdown', () => this.startDrawing(getSource()));
        bz.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
            ev.stopPropagation();
            onRemove();
        });
        return { cont, body, x, y };
    }

    private placeMaker(w: WorldDef, cell: Cell) {
        const maker = {} as Maker;
        const built = this.buildSourceCont(cell, w.traits.map(t => TRAIT_EMOJI[t]).join(''), w.name,
            () => maker, () => this.removeSource(maker));
        Object.assign(maker, {
            kind: 'maker' as const, world: w,
            c: cell.c, r: cell.r, x: built.x, y: built.y,
            color: w.color, routes: [], nextRoute: 0,
            spawnT: BAL.MAKER_PERIOD,   // 滿蓄能:接上線的第一隻立刻出
            parked: [],
            cont: built.cont, body: built.body,
        });
        this.makers.push(maker);
        this.deployed.add(w.id);
        this.redrawSourceBody(maker);
        this.refreshSourceLook(maker);
        this.refreshTray();
    }

    private placeSpring(cell: Cell) {
        const spring = {} as Spring;
        const built = this.buildSourceCont(cell, '⛲', '泉水', () => spring, () => this.removeSource(spring));
        const countTxt = label(this, -24, -24, '', 11, '#53c2d8', 0.5).setVisible(false);
        built.cont.add(countTxt);
        Object.assign(spring, {
            kind: 'spring' as const,
            c: cell.c, r: cell.r, x: built.x, y: built.y,
            color: SPRING_COLOR, routes: [], nextRoute: 0,
            parked: [], incoming: [],
            cont: built.cont, body: built.body, countTxt,
        });
        this.spring = spring;
        this.redrawSourceBody(spring);
        this.refreshSourceLook(spring);
        this.refreshTray();
        this.showMsg('⛲ 泉水就位 —— 過門的單位將在此復活;拖曳畫線送他們再上工', '#53c2d8');
    }

    private removeSource(src: Source) {
        if (this.phase !== 'run') return;
        if (this.drawing?.origin === src) this.cancelDrawing();
        [...src.routes].forEach(rt => this.removeRoute(rt));
        // 它派出的在途單位失去歸屬,原地散逸
        for (const mob of this.mobs) {
            if (mob.alive && mob.kind === 'unit' && mob.route.origin === src) this.kill(mob, true);
        }
        src.cont.destroy();
        if (src.kind === 'maker') {
            this.makers = this.makers.filter(x => x !== src);
            this.deployed.delete(src.world.id);
        } else {
            this.spring = null; // 傳送中的單位一併散逸(incoming 隨物件丟棄)
        }
        this.refreshTray();
    }

    private redrawSourceBody(src: Source) {
        src.body.clear();
        if (src.kind === 'maker') {
            src.body.fillStyle(src.color, 0.18);
            src.body.fillRoundedRect(-24, -24, 48, 48, 11);
            src.body.lineStyle(2.5, src.color, 1);
            src.body.strokeRoundedRect(-24, -24, 48, 48, 11);
        } else {
            src.body.fillStyle(src.color, 0.14);
            src.body.fillCircle(0, 0, 23);
            src.body.lineStyle(2.5, src.color, 1);
            src.body.strokeCircle(0, 0, 23);
            src.body.lineStyle(1.5, src.color, 0.5);
            src.body.strokeCircle(0, 0, 15);
        }
        // 產線佔用指示(x/上限)
        for (let i = 0; i < BAL.MAX_ROUTES_PER_MAKER; i++) {
            const used = i < src.routes.length;
            src.body.fillStyle(used ? 0xffffff : 0x000000, used ? 0.9 : 0.35);
            src.body.fillCircle(-7 + i * 14, 18, 3);
        }
    }

    private refreshSourceLook(src: Source) {
        src.cont.setAlpha(src.routes.length === 0 ? 0.6 : 1);
    }

    // ---------------------------------------------------------------- 手繪產線

    private drawableCell(c: number, r: number, keys: Set<number>): boolean {
        return !this.makerAt(c, r) && !this.springAt(c, r) && !this.doorAt(c, r)
            && !this.announceAt(c, r) && !keys.has(ck(c, r));
    }

    private startDrawing(src: Source) {
        if (this.phase !== 'run' || this.placing) return;
        if (src.routes.length >= BAL.MAX_ROUTES_PER_MAKER) {
            this.showMsg(`分流上限:每個源頭最多 ${BAL.MAX_ROUTES_PER_MAKER} 條線(點舊線拆除)`, '#ff8c42');
            return;
        }
        const gfx = this.add.graphics().setDepth(3);
        this.drawing = { origin: src, cells: [{ c: src.c, r: src.r }], keys: new Set([ck(src.c, src.r)]), gfx };
        this.redrawPreview();
    }

    private extendDrawing(px: number, py: number) {
        const d = this.drawing;
        if (!d) return;
        const cell = xyToCell(px, py);
        if (!cell) return;
        const last = d.cells[d.cells.length - 1];
        if (cell.c === last.c && cell.r === last.r) return;
        // 回拉:滑回倒數第二格 = 擦掉最後一格
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
        // 游標跳了好幾格(快速拖曳):用 BFS 補中間,自動繞過障礙
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
        if (!d) return;
        const pts = d.cells.map(cl => ({ x: cellX(cl.c), y: cellY(cl.r) }));
        d.gfx.clear();
        d.gfx.lineStyle(7, d.origin.color, 0.14);
        this.strokePolyline(d.gfx, pts);
        d.gfx.lineStyle(3, d.origin.color, 0.95);
        this.strokePolyline(d.gfx, pts);
        const tip = pts[pts.length - 1];
        d.gfx.fillStyle(d.origin.color, 1);
        d.gfx.fillCircle(tip.x, tip.y, 5);
    }

    /** 放開滑鼠:落在門上(或能一小段接到門)就成線,否則取消。 */
    private finishDrawing(px: number, py: number) {
        const d = this.drawing;
        if (!d) return;
        const door = this.doorAtPoint(px, py);
        if (door && door.state === 'active') {
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
                this.commitRoute(d.origin, door, cells);
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

    private commitRoute(src: Source, door: Door, cells: Cell[]) {
        const existing = src.routes.find(rt => rt.door === door);
        if (existing) this.removeRoute(existing); // 重畫同目的地 = 取代舊線

        const points = cells.map(cl => ({ x: cellX(cl.c), y: cellY(cl.r) }));
        const line = this.add.graphics().setDepth(2);
        line.lineStyle(7, src.color, 0.12);
        this.strokePolyline(line, points);
        line.lineStyle(3, src.color, 0.8);
        this.strokePolyline(line, points);

        const cellKeys = new Set(cells.map(cl => ck(cl.c, cl.r)));
        const route: Route = {
            id: this.routeSeq++,
            origin: src, door, points, cellKeys,
            length: (points.length - 1) * CELL,
            line, dead: false,
        };
        this.routesAll.push(route);
        src.routes.push(route);
        door.routes.push(route);
        this.redrawSourceBody(src);
        this.refreshSourceLook(src);
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
        // 線上的出征單位掉頭撤退(帶著剩餘價值回源頭待命);敵人本來就朝源頭走,讓它走完散逸
        for (const mob of this.mobs) {
            if (mob.alive && mob.route === rt && mob.kind === 'unit' && mob.dir === 1) {
                mob.dir = -1;
                mob.gfx.setAlpha(0.45);
            }
        }
        this.redrawSourceBody(rt.origin);
        this.refreshSourceLook(rt.origin);
    }

    // ---------------------------------------------------------------- 輸入

    private wireInput() {
        this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
            if (over.length > 0) return; // 點到互動物件時交給物件自己處理
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
                else this.placeMaker(this.placing, cell);
                this.placing = null;
                this.destroyGhost();
            } else {
                this.showMsg('這裡不能放置(已被佔用)', '#ff8c42');
            }
            return;
        }
        // 點到產線 = 拆線
        if (cell) {
            const hit = this.routesAll.find(rt => rt.cellKeys.has(ck(cell.c, cell.r)));
            if (hit) {
                const from = hit.origin.kind === 'spring' ? '泉水' : hit.origin.world.name;
                this.removeRoute(hit);
                this.showMsg(`已拆除產線:${from} ✕ ${hit.door.spec.worldName}之門`, '#8a93a6');
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
            // 子步進:高速播放/掉幀時避免對沖偵測穿隧
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
        // 場上已無事可做(門都解決了)但還有裂隙沒開 → 提前撕開,避免乾等
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

        // 1) 生產(異界,有連線才生產)
        for (const m of this.makers) {
            if (m.routes.length > 0) {
                m.spawnT += dt;
                while (m.spawnT >= BAL.MAKER_PERIOD) {
                    m.spawnT -= BAL.MAKER_PERIOD;
                    this.dispatch(m, { value: BAL.UNIT_VALUE, traits: m.world.traits });
                }
            } else {
                m.spawnT = Math.min(m.spawnT + dt, BAL.MAKER_PERIOD);
            }
        }
        // 1.5) 泉水:裂隙傳送抵達 → 小補復活 → 派出(沒線就待命)
        if (this.spring) {
            const sp = this.spring;
            for (const tr of [...sp.incoming]) {
                tr.t -= dt;
                if (tr.t > 0) continue;
                sp.incoming = sp.incoming.filter(x => x !== tr);
                const parcel: Parcel = {
                    value: Math.min(tr.value + BAL.SPRING_HEAL, BAL.UNIT_VALUE),
                    traits: tr.traits,
                };
                this.poof(sp.x, sp.y, worldColor(parcel.traits));
                if (sp.routes.length > 0) {
                    this.dispatch(sp, parcel);
                } else {
                    sp.parked.push(parcel);
                    if (!this.springHintShown) {
                        this.springHintShown = true;
                        this.showMsg('單位已在泉水待命 —— 從泉水拖曳畫線,送他們再上工', '#53c2d8');
                    }
                }
            }
        }
        // 1.6) 待命隊伍:有線就出發(適用異界與泉水)
        for (const src of this.sources()) {
            while (src.parked.length > 0 && src.routes.length > 0) {
                this.dispatch(src, src.parked.pop()!);
            }
        }

        // 2) 移動
        for (const mob of this.mobs) {
            if (!mob.alive) continue;
            mob.dist += mob.dir * BAL.UNIT_SPEED * dt;
            const p = this.pointAt(mob.route, mob.dist);
            mob.gfx.setPosition(p.x, p.y);
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
                            w >= 0.99 ? '#ffd35c' : w >= 0.55 ? '#e8ecf4' : '#8a93a6');
                    }
                    mob.value *= BAL.PASS_MULT; // 過門打折(GDD 4 折)
                    if (mob.value < BAL.CULL_VALUE || !this.spring) {
                        this.kill(mob, true);   // 榨乾,或場上沒有泉水 → 消散
                        continue;
                    }
                    // 裂隙傳送 → 泉水復活(v0.3:不再原路折返)
                    this.spring.incoming.push({ value: mob.value, traits: mob.traits, t: BAL.RIFT_TRANSIT });
                    this.kill(mob, true);
                } else if (mob.dir === -1 && mob.dist <= 0) {
                    // 只有「線被拆」的撤退單位會走到這:回到源頭待命
                    mob.route.origin.parked.push({ value: mob.value, traits: mob.traits });
                    this.kill(mob, false);
                }
            } else if (mob.dist <= 0) {
                this.kill(mob, false); // 敵人走到產線源頭即散逸(原型簡化)
            }
        }

        // 5) 門的推拉
        for (const d of this.doors) {
            if (d.state !== 'active') continue;
            d.progress -= this.lvl.drain * dt;

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
                this.showMsg(`⚠ ${d.spec.worldName}之門開始反噬!敵人正沿產線殺回來`, '#ff8c42');
            } else if (!backlash && d.wasBacklash) {
                d.wasBacklash = false;
                d.cont.setAlpha(1);
                this.redrawDoorBody(d);
            }
            if (backlash && d.routes.length > 0) {
                d.enemyT += dt;
                while (d.enemyT >= this.lvl.enemyPeriod) {
                    d.enemyT -= this.lvl.enemyPeriod;
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

        // 6) 清理
        this.mobs = this.mobs.filter(m => m.alive);
    }

    private visualStep(rdt: number) {
        this.pulseT += rdt;
        for (const d of this.doors) {
            if (d.state === 'active' && d.progress <= BAL.BASE * BAL.BACKLASH_RATIO) {
                d.cont.setAlpha(0.74 + 0.26 * Math.sin(this.pulseT * 9));
            }
        }
        // 裂隙預告:脈動的圈
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
        // 泉水:待命人數
        if (this.spring) {
            const n = this.spring.parked.length;
            this.spring.countTxt.setVisible(n > 0);
            if (n > 0) this.spring.countTxt.setText(`${n}`);
        }
        // 右下狀態:下一道裂隙
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

    private dispatch(src: Source, parcel: Parcel) {
        const rt = src.routes[src.nextRoute % src.routes.length]; // 分流:輪流均分
        src.nextRoute++;
        const color = worldColor(parcel.traits);
        const gfx = this.add.circle(src.x, src.y, 7, color).setDepth(4);
        gfx.setStrokeStyle(1.5, 0x0b0e13);
        const mob: Mob = {
            kind: 'unit', value: parcel.value, traits: parcel.traits, route: rt,
            dist: 0, dir: 1, color, gfx, alive: true,
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
            dist: rt.length, dir: -1, color: 0xd84848, gfx, alive: true,
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
            lines.push('它們已加入你的生產陣容,下一關可以部署。');
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
