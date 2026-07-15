// 共用型別與特性表。GDD:特性初期分「種族/屬性/體型」三類,原型先做種族+屬性。

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

/** 異界 = 生產來源(GDD「異界系統」)。征服傳送門後,門後的異界即成為你的 WorldDef。 */
export interface WorldDef {
    id: string;
    name: string;
    traits: Trait[];
    color: number;
}

/** 傳送門規格。reqs ⊆ worldTraits:征服後獲得的異界,其特性涵蓋門的需求。
 *  位置不在規格內 —— 裂隙撕開當下才隨機挑格子;spawnAt 是開始「預告」的時刻(關卡時鐘,秒)。 */
export interface DoorSpec {
    id: string;
    worldName: string;
    worldTraits: Trait[];
    reqs: Trait[];       // 0–2 項;0 項 = 任何單位皆可(早期門)
    spawnAt: number;
    color: number;
}

export interface LevelSpec {
    level: number;
    doors: DoorSpec[];
    drain: number;        // 本關門抵抗 / 秒
    enemyPeriod: number;  // 本關反噬湧出間隔
    deployLimit: number;  // 本關可部署異界數(場地空間約束)
}

export function worldColor(traits: Trait[]): number {
    return traits.length > 0 ? TRAIT_COLOR[traits[0]] : 0x9aa0a8;
}

const RACE_CORE: Partial<Record<Trait, string>> = { 龍: '龍', 妖精: '妖', 不死: '骸', 野獸: '獸' };
const ELEM_PREFIX: Partial<Record<Trait, string>> = { 火: '焰', 水: '潮', 時: '時' };

export function worldName(traits: Trait[]): string {
    const race = traits.find(t => RACE_CORE[t]);
    const elem = traits.find(t => ELEM_PREFIX[t]);
    if (race && elem) return `${ELEM_PREFIX[elem]}${RACE_CORE[race]}界`;
    if (race) return `${RACE_CORE[race]}之界`;
    if (elem) return `${ELEM_PREFIX[elem]}靈界`;
    return '無名界';
}

/** 起始陣容(GDD MVP:2–3 個起始異界;局外解鎖可擴充)。 */
export function startingLineup(extraBeast: boolean): WorldDef[] {
    const w = (id: string, name: string, traits: Trait[]): WorldDef =>
        ({ id, name, traits, color: worldColor(traits) });
    const list = [
        w('start-dragon', '龍焰異界', ['龍', '火']),
        w('start-undead', '亡骸異界', ['不死']),
        w('start-fairy', '泉妖異界', ['妖精', '水']),
    ];
    if (extraBeast) list.push(w('start-beast', '荒牙異界', ['野獸']));
    return list;
}
