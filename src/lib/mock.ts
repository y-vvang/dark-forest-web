/**
 * 首页图例的静态标本。原对局 demo mock（SELF/CIVS/EVENTS/MATCH/END/INVADER 等）
 * 已随真实环境接线退役（2026-10-02）；/online 大厅 mock（ONLINE）随在线模式
 * 真实接线退役（2026-10-13——轮询 hook + 真实世界 API 替代）。
 * 标记形状 = CivLike（marker.tsx），认知阶梯见 DESIGN.md §6。
 */
import type { CivLike } from "@/components/marker";

export type { CivLike };

/** 首页图例 hero 的五态标本（认知阶梯陈列，decorative 标记） */
export const LEGEND_CIVS: CivLike[] = [
    { id: 0, x: 50, y: 50, state: "self", tech: 7.4, res: 12.5 },
    { id: 1, x: 50, y: 50, state: "known" },
    { id: 2, x: 50, y: 50, state: "observed", tech: 3.1, res: 8.4 },
    { id: 3, x: 50, y: 50, state: "public", tech: 11.2, res: 5.9 },
    { id: 4, x: 50, y: 50, state: "domain", tech: 6.0, res: 9.8 },
];
