/**
 * 星图相机与环面差（DESIGN.md §10.6，2026-10-09）。
 *
 * 相机 = 以玩家为原点的环面重定位（玩家恒居 50%/50%；v2.3 位置恒定，故为一次性
 * 偏移而非逐刻动画）；边界带内的标记钳到边界线上完整可见（纯渲染让步，环境语义
 * 的环面坐标不变）。同一个 wrapDelta 也供感知日志使用——contact 的坐标必须是
 * 自身相对（与居中星图同构；玩家不知自己的世界坐标，绝对坐标会与星图失联）。
 */

/** 边界带（%）：钳制后的标记贴边完整可见 */
export const EDGE = 2;

/** 环面差 → [−50, 50)（最短径；±50 恒取 −50，确定性） */
export function wrapDelta(d: number): number {
    return ((((d + 50) % 100) + 100) % 100) - 50;
}

/** 相机坐标：以自身为原点的环面重定位（玩家恒居 50%/50%）+ 边界钳制 */
export function cameraXY(
    x: number,
    y: number,
    selfX: number,
    selfY: number,
): { x: number; y: number } {
    const tx = Math.min(100 - EDGE, Math.max(EDGE, 50 + wrapDelta(x - selfX)));
    const ty = Math.min(100 - EDGE, Math.max(EDGE, 50 + wrapDelta(y - selfY)));
    return { x: tx, y: ty };
}

/** 相对差（感知日志用）：与 cameraXY 同构的环面差，未经边界钳制 */
export function relativeDelta(
    x: number,
    y: number,
    selfX: number,
    selfY: number,
): { dx: number; dy: number } {
    return { dx: wrapDelta(x - selfX), dy: wrapDelta(y - selfY) };
}
