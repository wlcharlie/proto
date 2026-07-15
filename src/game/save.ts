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
    { id: 'world-beast', name: '擴充起始陣容', desc: '開局多帶一座 荒牙異界(野獸🐺)', cost: 3 },
    { id: 'integrity-2', name: '裝置強化 I', desc: '完整度上限 2:可承受 2 次傳送門崩潰', cost: 5 },
    { id: 'integrity-3', name: '裝置強化 II', desc: '完整度上限 3(GDD 上限)', cost: 10, requires: 'integrity-2' },
];

const KEY = 'riftlord_save_v1';

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
