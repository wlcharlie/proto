// 關卡生成 v0.5:一關 = 一道門(Boss HP 隨關數指數成長)+ 本關詛咒濃度。
// TRAIT_LEVEL 起,門帶「弱點」或「頑抗」屬性 —— 溫和乘子,引導加工、不做死門檻。

import { BAL } from './balance';
import { DoorSpec, ELEMENTS, RACES, TRAIT_COLOR, Trait, worldName } from './types';

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export function genDoor(level: number): DoorSpec {
    let weakness: Trait | null = null;
    let resist: Trait | null = null;
    if (level >= BAL.TRAIT_LEVEL) {
        if (Math.random() < 0.5) weakness = pick(ELEMENTS);
        else resist = pick(ELEMENTS);
    }
    const elem = weakness ?? resist;
    const traits: Trait[] = elem ? [pick(RACES), elem] : [pick(RACES)];
    return {
        level,
        name: worldName(traits),
        hp: Math.round(BAL.DOOR_HP * Math.pow(BAL.DOOR_HP_GROWTH, level - 1)),
        curseDps: BAL.CURSE_DPS + BAL.CURSE_PER_LEVEL * (level - 1),
        weakness,
        resist,
        color: TRAIT_COLOR[elem ?? traits[0]],
    };
}
