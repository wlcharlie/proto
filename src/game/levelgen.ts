// 關卡生成:3 道傳送門,規格需求隨關數變硬(GDD:愈後期項數愈多)。
// 門的「位置」不在這裡決定 —— 裂隙撕開當下才在場上隨機挑格子;
// 這裡只排「何時撕開」(spawnAt,隨關數壓縮間隔)。
//
// v0.4(加工為核心)的規格生成原則:
//   - 需求偏「屬性」(可用附魔站解),種族需求隨關數變多(逼你擴陣容/未來的分流)。
//   - 需求的屬性一律 ⊆ 玩家現有屬性(有站可蓋才解得了 —— 質是門檻,不能變死局)。
//   - 門後異界的「自身屬性」則可以是你沒有的 → 征服它 = 拿到新附魔站(收集誘因)。

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

    // 種族需求的出現率:第 1~2 關幾乎純屬性,之後種族逐漸入場
    const raceReqP = Math.min(0.5, 0.1 + 0.1 * (level - 1));

    const doors: DoorSpec[] = reqCountsFor(level).map((n, i) => {
        const reqRace = ownedRaces.length > 0 ? pick(ownedRaces) : pick(RACES);
        const reqElem = ownedElems.length > 0 ? pick(ownedElems) : pick(ELEMENTS);
        let reqs: Trait[];
        if (n === 0) reqs = [];
        else if (n === 1) reqs = [Math.random() < raceReqP ? reqRace : reqElem];
        else reqs = [reqRace, reqElem];

        // 門後異界:涵蓋需求;屬性可以「超出」你現有的(征服 = 新附魔站)
        const race = reqs.find(t => RACES.includes(t)) ?? pick(RACES);
        const newElemP = level >= 2 && i === 2 ? 0.6 : 0.25;
        const elem = reqs.find(t => ELEMENTS.includes(t))
            ?? (Math.random() < newElemP ? pick(ELEMENTS.filter(e => !ownedElems.includes(e)).concat(ownedElems.length === ELEMENTS.length ? ELEMENTS : [])) : pick(ELEMENTS));
        const traits: Trait[] = Math.random() < 0.25 && reqs.every(t => RACES.includes(t))
            ? [race]                       // 純種族界 → 征服獲得回復站
            : [race, elem];

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
        drain: BAL.DOOR_DRAIN + BAL.DRAIN_PER_LEVEL * (level - 1),
        enemyPeriod: Math.max(BAL.ENEMY_PERIOD_MIN, BAL.ENEMY_PERIOD - BAL.ENEMY_PERIOD_PER_LEVEL * (level - 1)),
    };
}
