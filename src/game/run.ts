// 一輪(= 一次遠征)的狀態。跨場景共用的模組單例。
// v0.5:魔力、已蓋設施、隊員 HP 全部跨關保留 —— 一次遠征是一條連續戰線。

import { BAL } from './balance';
import { SaveData, hasUnlock } from './save';
import { FacilityType, UnitDef } from './types';

export interface StationSave {
    type: FacilityType;
    c: number;
    r: number;
    lvl: number;
    invested: number;   // 累計投資(蓋+升級);拆除退 SELL_REFUND 比例
}

export interface RunState {
    level: number;
    squad: UnitDef[];        // 存活隊員(場景直接改同一參照的 hp / elem)
    squadBase: number;       // 起始上限(技能樹 squad-cap 另 +1)
    mana: number;
    skillPoints: number;
    skills: string[];
    stations: StationSave[]; // 已蓋設施(跨關保留,場景 create 時重建)
    unitSeq: number;
}

export let run: RunState = {
    level: 1, squad: [], squadBase: BAL.SQUAD_START, mana: 0,
    skillPoints: 0, skills: [], stations: [], unitSeq: 1,
};

export function startNewRun(save: SaveData): void {
    const base = BAL.SQUAD_START + (hasUnlock(save, 'start-squad') ? 1 : 0);
    run = {
        level: 1,
        squad: Array.from({ length: base }, (_, i) => ({ id: i + 1, elem: null, hp: BAL.UNIT_HP })),
        squadBase: base,
        mana: BAL.MANA_START + (hasUnlock(save, 'start-mana') ? 50 : 0),
        skillPoints: hasUnlock(save, 'start-skill') ? 1 : 0,
        skills: [],
        stations: [],
        unitSeq: base + 1,
    };
}
