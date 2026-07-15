// 格狀場地(GDD 場地模型:格狀棋盤,路徑沿格鋪設)+ BFS 尋路。

export const CELL = 64;
export const COLS = 15;
export const ROWS = 9;
export const BOARD_X = 32;
export const BOARD_Y = 88;

export interface Cell { c: number; r: number; }

export function cellX(c: number): number { return BOARD_X + c * CELL + CELL / 2; }
export function cellY(r: number): number { return BOARD_Y + r * CELL + CELL / 2; }

export function inBounds(c: number, r: number): boolean {
    return c >= 0 && c < COLS && r >= 0 && r < ROWS;
}

export function xyToCell(x: number, y: number): Cell | null {
    const c = Math.floor((x - BOARD_X) / CELL);
    const r = Math.floor((y - BOARD_Y) / CELL);
    return inBounds(c, r) ? { c, r } : null;
}

/** 四方向 BFS;blocked 不套用在起點與終點上。找不到路徑回傳 null。 */
export function bfsPath(start: Cell, goal: Cell, blocked: (c: number, r: number) => boolean): Cell[] | null {
    const key = (c: number, r: number) => r * COLS + c;
    const prev = new Map<number, number>();
    const seen = new Set<number>([key(start.c, start.r)]);
    const q: Cell[] = [start];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (q.length > 0) {
        const cur = q.shift()!;
        if (cur.c === goal.c && cur.r === goal.r) {
            const path: Cell[] = [cur];
            let k = key(cur.c, cur.r);
            while (prev.has(k)) {
                k = prev.get(k)!;
                path.push({ c: k % COLS, r: Math.floor(k / COLS) });
            }
            return path.reverse();
        }
        for (const [dc, dr] of dirs) {
            const nc = cur.c + dc, nr = cur.r + dr;
            if (!inBounds(nc, nr) || seen.has(key(nc, nr))) continue;
            const isGoal = nc === goal.c && nr === goal.r;
            if (!isGoal && blocked(nc, nr)) continue;
            seen.add(key(nc, nr));
            prev.set(key(nc, nr), key(cur.c, cur.r));
            q.push({ c: nc, r: nr });
        }
    }
    return null;
}
