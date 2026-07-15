// 一輪(= 一顆輿圖裝置)的狀態。跨場景共用的模組單例。

import { SaveData, hasUnlock } from './save';
import { WorldDef, startingLineup } from './types';

export interface RunState {
    level: number;
    integrity: number;     // 裝置完整度:0 = 碎裂
    maxIntegrity: number;
    lineup: WorldDef[];    // 你擁有的異界 = 你的生產陣容(GDD)
    conquered: number;     // 本輪累計征服數 = 碎裂時的獎勵點
}

export let run: RunState = { level: 1, integrity: 1, maxIntegrity: 1, lineup: [], conquered: 0 };

export function startNewRun(save: SaveData): void {
    const integrity = hasUnlock(save, 'integrity-3') ? 3 : hasUnlock(save, 'integrity-2') ? 2 : 1;
    run = {
        level: 1,
        integrity,
        maxIntegrity: integrity,
        lineup: startingLineup(hasUnlock(save, 'world-beast')),
        conquered: 0,
    };
}
