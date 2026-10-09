import { expect, test } from "bun:test";

import { cameraXY } from "./camera";

/**
 * 星图相机（DESIGN.md §10.6，2026-10-09）：以自身为原点的环面重定位——
 * 玩家恒居 50%/50%；重定位后落入边界带 [0,2)∪(98,100) 的标记钳到边界线完整可见。
 */
test("cameraXY: self always centered; identity when self at world center", () => {
    expect(cameraXY(73, 31, 73, 31)).toEqual({ x: 50, y: 50 });
    expect(cameraXY(50, 50, 50, 50)).toEqual({ x: 50, y: 50 });
    expect(cameraXY(60, 40, 50, 50)).toEqual({ x: 60, y: 40 });
});

test("cameraXY: torus shortest path across the seam (both directions)", () => {
    // d = +96：self (2,2) 与 civ (98,2) 环面距离 4——应出现在中心左侧 4%，而非右缘
    expect(cameraXY(98, 2, 2, 2)).toEqual({ x: 46, y: 50 });
    // d = −96：负数取模分支——civ 在 self 左侧 4 而非右侧 96
    expect(cameraXY(2, 2, 98, 2)).toEqual({ x: 54, y: 50 });
    // 对角跨缝：self (10,90) 与 civ (90,10) → 环面 Δ=(−20,+20)
    expect(cameraXY(90, 10, 10, 90)).toEqual({ x: 30, y: 70 });
});

test("cameraXY: boundary band clamps onto the edge line (EDGE=2)", () => {
    // 恰距 50：落在 0/100 边界 → 钳到 2/98 完整可见
    expect(cameraXY(0, 50, 50, 50)).toEqual({ x: 2, y: 50 });
    expect(cameraXY(99.9, 50, 50, 50)).toEqual({ x: 98, y: 50 });
    expect(cameraXY(50, 0.5, 50, 50)).toEqual({ x: 50, y: 2 });
    expect(cameraXY(50, 99, 50, 50)).toEqual({ x: 50, y: 98 });
    // 边界带外：位置原样（钳制仅影响带内）
    expect(cameraXY(49, 48, 50, 50)).toEqual({ x: 49, y: 48 });
});
