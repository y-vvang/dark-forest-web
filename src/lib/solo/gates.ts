/**
 * 行动门理由（纯函数，自 action-grid 抽出）——给 UI 展示"为何禁用"。
 * 权威：env `valid()`（V24_CONFIG 各 gate）；parity 测试锁定 gateOf 禁用 ⊆ env 无效。
 * gateOf 只覆盖可静态解释的门（tech/已知性）；env 额外的无效化（域/风窗行、目标已死等）
 * 由会话层传入的 valid[] 表达，不在此重复。
 * v2.4：删 strikeWeak/strikeStrong（动作已退役）；新增 reveal（BROADCAST_OTHER 揭露，
 * 需已知存活非域目标 + 广播门）。
 */
import { V24_CONFIG, type EnvConfig } from "@/lib/engine/config";
import type { MessageKey, TParams } from "@/i18n";

export type ActionId =
    | "silent"
    | "develop"
    | "broadcast"
    | "reveal"
    | "observe"
    | "domain"
    | "invade"
    | "strike";

export type Block = { reason: MessageKey; params?: TParams } | null;

/**
 * env gates 按 env 自身的检查顺序求值。cfg 缺省 = V24_CONFIG（parity 测试口径）；
 * 环境常量可配置（2026-10-10）后 UI 传会话 cfg——理由文字与实际门槛一致。
 */
export function gateOf(
    id: ActionId,
    tech: number,
    res: number,
    hasKnown: boolean,
    cfg: EnvConfig = V24_CONFIG,
): Block {
    switch (id) {
        case "broadcast":
            return tech > cfg.gateBroadcastTech || res > cfg.gateBroadcastRes
                ? null
                : { reason: "actions.disabled.broadcast" };
        case "reveal": // v2.4：与 broadcast 同门 + 需已知目标（strikeable）
            if (!hasKnown) return { reason: "actions.disabled.noKnown" };
            return tech > cfg.gateBroadcastTech || res > cfg.gateBroadcastRes
                ? null
                : { reason: "actions.disabled.broadcast" };
        case "observe":
            if (!hasKnown) return { reason: "actions.disabled.noKnown" };
            return tech > cfg.gateObserveTech
                ? null
                : { reason: "actions.disabled.tech", params: { v: cfg.gateObserveTech } };
        case "domain":
            return tech > cfg.gateDomainTech
                ? null
                : { reason: "actions.disabled.tech", params: { v: cfg.gateDomainTech } };
        case "strike":
            if (!hasKnown) return { reason: "actions.disabled.noKnown" };
            return tech > cfg.gateStrikeTech
                ? null
                : { reason: "actions.disabled.tech", params: { v: cfg.gateStrikeTech } };
        case "invade":
            return hasKnown ? null : { reason: "actions.disabled.noKnown" };
        default:
            return null;
    }
}

/** ActionId → env 枚举序（v2.4 0-7：reveal = A_BOTHER=3） */
export const ACTION_NUM: Record<ActionId, number> = {
    silent: 0,
    develop: 1,
    broadcast: 2,
    reveal: 3,
    strike: 4,
    domain: 5,
    invade: 6,
    observe: 7,
};
