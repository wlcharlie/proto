// 共用型別與特性表。
// v0.5:單位 = 遠征隊員(個體 HP、屬性欄 1 格);門 = Boss HP 條(可帶弱點/頑抗)。
// 種族(RACES)保留定義但休眠 —— v0.5 只玩屬性,種族層留給未來版本喚醒。

export type Trait = '龍' | '妖精' | '不死' | '野獸' | '火' | '水' | '時';

export const RACES: Trait[] = ['龍', '妖精', '不死', '野獸'];
export const ELEMENTS: Trait[] = ['火', '水', '時'];

export const TRAIT_EMOJI: Record<Trait, string> = {
    龍: '🐉', 妖精: '🧚', 不死: '💀', 野獸: '🐺', 火: '🔥', 水: '💧', 時: '⏳',
};

export const TRAIT_COLOR: Record<Trait, number> = {
    龍: 0xe07840, 妖精: 0x62c887, 不死: 0xa88cd8, 野獸: 0xc09a4a,
    火: 0xe05a4a, 水: 0x4a9ae0, 時: 0xd8c860,
};

/** 遠征隊員。HP 是唯一貨幣:詛咒扣它、回復站補它、門吃它、復活折它。跨關保留。 */
export interface UnitDef {
    id: number;
    elem: Trait | null;   // 屬性欄 1 格 —— 附魔站新蓋舊
    hp: number;
}

/** 傳送門 = 一關的 Boss。weakness / resist 至多一個(TRAIT_LEVEL 起)——
 *  溫和乘子、不是死門檻(v0.5 補充條款:特性引導加工,但不綁架基本玩法)。 */
export interface DoorSpec {
    level: number;
    name: string;
    hp: number;
    curseDps: number;     // 本關詛咒強度(線上每秒扣血)
    weakness: Trait | null;
    resist: Trait | null;
    color: number;
}

// ---- 設施(全部用魔力購買;v0.5 只有回復站可升級) ----

export type FacilityType = 'heal' | '火' | '水' | '時';

export const FACILITY_INFO: Record<FacilityType, { name: string; emoji: string; color: number }> = {
    heal: { name: '回復站', emoji: '✚', color: 0x7dd87d },
    火: { name: '火附魔站', emoji: '🔥', color: TRAIT_COLOR.火 },
    水: { name: '水附魔站', emoji: '💧', color: TRAIT_COLOR.水 },
    時: { name: '時附魔站', emoji: '⏳', color: TRAIT_COLOR.時 },
};

const RACE_CORE: Partial<Record<Trait, string>> = { 龍: '龍', 妖精: '妖', 不死: '骸', 野獸: '獸' };
const ELEM_PREFIX: Partial<Record<Trait, string>> = { 火: '焰', 水: '潮', 時: '時' };

/** 門的風味名(由弱點/頑抗屬性 + 隨機種族組出來)。 */
export function worldName(traits: Trait[]): string {
    const race = traits.find(t => RACE_CORE[t]);
    const elem = traits.find(t => ELEM_PREFIX[t]);
    if (race && elem) return `${ELEM_PREFIX[elem]}${RACE_CORE[race]}界`;
    if (race) return `${RACE_CORE[race]}之界`;
    if (elem) return `${ELEM_PREFIX[elem]}靈界`;
    return '無名界';
}
