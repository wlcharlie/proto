// 局外進度(GDD:裝置碎裂結算獎勵點 → 永久解鎖)。存 localStorage。

export interface SaveData {
    points: number;
    unlocks: string[];
}

export interface UnlockDef {
    id: string;
    name: string;
    desc: string;
    cost: number;
    requires?: string;
}

export const UNLOCKS: UnlockDef[] = [
    { id: 'start-mana', name: '魔力儲備', desc: '開局魔力 +50(開場就蓋得起半座站)', cost: 2 },
    { id: 'start-squad', name: '擴編遠征隊', desc: '起始小隊 +1 名', cost: 3 },
    { id: 'start-skill', name: '先行者', desc: '開局附帶 1 點技能點', cost: 5 },
];

const KEY = 'riftlord_save_v2'; // v0.5 起換 key:舊解鎖項已不存在,原型期直接作廢舊檔

export function loadSave(): SaveData {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
            const d = JSON.parse(raw);
            if (typeof d.points === 'number' && Array.isArray(d.unlocks)) {
                return { points: d.points, unlocks: d.unlocks };
            }
        }
    } catch { /* 存檔損毀就重來 */ }
    return { points: 0, unlocks: [] };
}

export function persistSave(s: SaveData): void {
    localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSave(): void {
    localStorage.removeItem(KEY);
}

export function hasUnlock(s: SaveData, id: string): boolean {
    return s.unlocks.includes(id);
}

export function canBuy(s: SaveData, u: UnlockDef): boolean {
    return !hasUnlock(s, u.id) && s.points >= u.cost && (!u.requires || hasUnlock(s, u.requires));
}

export function buy(s: SaveData, u: UnlockDef): void {
    if (!canBuy(s, u)) return;
    s.points -= u.cost;
    s.unlocks.push(u.id);
}
