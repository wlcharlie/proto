// 局內技能樹:每過一關 +1 點,過關面板自由花費(可留點)。
// 效果全部收斂成 helper —— 場景不直接翻 skills 陣列算數值。

import { BAL } from './balance';
import { RunState } from './run';

export interface SkillDef {
    id: string;
    name: string;
    desc: string;
    emoji: string;
    requires?: string;
}

export const SKILLS: SkillDef[] = [
    { id: 'revive-2', name: '泉水強化 I', desc: '復活率 50% → 60%', emoji: '⛲' },
    { id: 'revive-3', name: '泉水強化 II', desc: '復活率 60% → 70%', emoji: '🌊', requires: 'revive-2' },
    { id: 'squad-cap', name: '擴編', desc: '小隊上限 +1,並立即入隊一名新隊員', emoji: '🎖️' },
    { id: 'march-speed', name: '急行軍', desc: '行軍速度 +15%(少吃詛咒)', emoji: '💨' },
    { id: 'curse-ward', name: '護符', desc: '詛咒傷害 −20%', emoji: '🧿' },
    { id: 'economy', name: '榨取', desc: '魔力轉換率 +25%', emoji: '✦' },
    { id: 'builder', name: '建築學', desc: '蓋站與升級費用 −20%', emoji: '🔧' },
];

export function hasSkill(r: RunState, id: string): boolean {
    return r.skills.includes(id);
}

export function reviveRatio(r: RunState): number {
    return hasSkill(r, 'revive-3') ? 0.7 : hasSkill(r, 'revive-2') ? 0.6 : BAL.REVIVE_RATIO;
}

export function unitSpeed(r: RunState): number {
    return BAL.UNIT_SPEED * (hasSkill(r, 'march-speed') ? 1.15 : 1);
}

export function curseMult(r: RunState): number {
    return hasSkill(r, 'curse-ward') ? 0.8 : 1;
}

export function manaRate(r: RunState): number {
    return BAL.MANA_RATE * (hasSkill(r, 'economy') ? 1.25 : 1);
}

export function costMult(r: RunState): number {
    return hasSkill(r, 'builder') ? 0.8 : 1;
}

export function squadCap(r: RunState): number {
    return r.squadBase + (hasSkill(r, 'squad-cap') ? 1 : 0);
}
