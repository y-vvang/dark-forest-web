/**
 * /online 大厅与首页图例的静态 mock（在线模式是路线第 5 步，尚未接真实世界）。
 * 原对局 demo mock（SELF/CIVS/EVENTS/MATCH/END/INVADER 等）已随真实环境接线退役
 * （2026-10-02）；对手清单迁移至 src/lib/opponents/catalog.ts。
 * 标记形状 = CivLike（marker.tsx），认知阶梯见 DESIGN.md §6。
 */
import type { CivLike } from "@/components/marker";

export type { CivLike };

/** /online：排队读数（世界读数 mock——在线后端接入后替换） */
export const ONLINE = {
    position: 3,
    tick: 87,
    tMax: 250,
    alive: 5,
    pool: 26.3,
    /** queued players, not yet born — ghost markers on the mini chart */
    ghosts: [
        { id: -1, x: 50, y: 62 },
        { id: -2, x: 34, y: 55 },
        { id: -3, x: 66, y: 48 },
    ],
};

/** 首页图例 hero 的五态标本（认知阶梯陈列，decorative 标记） */
export const LEGEND_CIVS: CivLike[] = [
    { id: 0, x: 50, y: 50, state: "self", tech: 7.4, res: 12.5 },
    { id: 1, x: 50, y: 50, state: "known" },
    { id: 2, x: 50, y: 50, state: "observed", tech: 3.1, res: 8.4 },
    { id: 3, x: 50, y: 50, state: "public", tech: 11.2, res: 5.9 },
    { id: 4, x: 50, y: 50, state: "domain", tech: 6.0, res: 9.8 },
];
