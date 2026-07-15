// 關卡生成:3 道傳送門,規格需求隨關數變硬(GDD:愈後期項數愈多)。
// 門的「位置」不在這裡決定 —— 裂隙撕開當下才在場上隨機挑格子;
// 這裡只排「何時撕開」(spawnAt,隨關數壓縮間隔)。
// 前兩道門的需求保證落在玩家現有特性內(可全符);第三道門自第 2 關起自由生成,
// 可能出現你還沒有的特性 —— 征服它就能把該異界收進陣容(收集誘因)。

import { BAL } from './balance';
import { DoorSpec, ELEMENTS, LevelSpec, RACES, Trait, worldColor, worldName } from './types';

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function reqCountsFor(level: number): number[] {
    if (level <= 1) return [0, 1, 1];
    if (level === 2) return [1, 1, 2];
    if (level === 3) return [1, 2, 2];
    return [2, 2, 2];
}

export function genLevel(level: number, ownedTraits: Trait[]): LevelSpec {
    const ownedRaces = RACES.filter(r => ownedTraits.includes(r));
    const ownedElems = ELEMENTS.filter(e => ownedTraits.includes(e));
    const gapMult = Math.max(0.7, 1 - 0.06 * (level - 1));
    let nextAt = BAL.RIFT_FIRST;

    const doors: DoorSpec[] = reqCountsFor(level).map((n, i) => {
        // 第 1 關全部保證可全符(完整度只有 1,別讓新手被 RNG 判死);之後第三門才自由生成
        const safe = (i < 2 || level <= 1) && ownedRaces.length > 0;
        const race = safe ? pick(ownedRaces) : pick(RACES);
        const elem = safe && ownedElems.length > 0 ? pick(ownedElems) : pick(ELEMENTS);
        const traits: Trait[] = n >= 2 || Math.random() < 0.5 ? [race, elem] : [race];
        let reqs: Trait[];
        if (n === 0) reqs = [];
        else if (n === 1) reqs = [traits.length === 1 || Math.random() < 0.6 ? traits[0] : traits[1]];
        else reqs = traits.slice(0, 2);
        const spawnAt = nextAt;
        nextAt += (BAL.RIFT_GAP + (Math.random() * 2 - 1) * BAL.RIFT_JITTER) * gapMult;
        return {
            id: `L${level}-door${i}`,
            worldName: worldName(traits),
            worldTraits: traits,
            reqs,
            spawnAt,
            color: worldColor(traits),
        };
    });

    return {
        level,
        doors,
        drain: Math.min(BAL.DRAIN_MAX, BAL.DOOR_DRAIN + BAL.DRAIN_PER_LEVEL * (level - 1)),
        enemyPeriod: Math.max(BAL.ENEMY_PERIOD_MIN, BAL.ENEMY_PERIOD - BAL.ENEMY_PERIOD_PER_LEVEL * (level - 1)),
        deployLimit: Math.min(BAL.DEPLOY_MAX, 2 + level),
    };
}
