import { useI18n, type MessageKey } from "@/i18n";
import type { EnvConfig } from "@/lib/engine/config";
import { ACTION_NUM, gateOf, type ActionId } from "@/lib/solo/gates";

import { Panel } from "./panel";

/**
 * The 4×2 action grid (DESIGN.md §10.4, v2.4 — user picked 2026-10-10):
 * row 1 existence·broadcast (silent/develop/broadcast/reveal),
 * row 2 intel·sanctuary·force (observe/domain/invade/strike).
 *
 * Selection model B (user-confirmed 2026-10-09): grid buttons only SELECT —
 * the full-width Execute·next-tick button below is the single submit entry.
 * - stance (silent/develop): persistent across ticks — set once, then every
 *   Execute press runs it (steady state = 1 click per tick);
 * - one-shot actions: enter a pending state (lethal highlight); after the
 *   tick resolves the highlight reverts to the stance;
 * - targeting actions (strike/invade/reveal/observe) arm a target-pick
 *   submode first (execute disabled while armed; strike/observe have a
 *   "nearest known" skip in the armed bar; invade/reveal require a pick).
 *
 * Disabled = env's own valid row (`valid[a] === false`); the inline reason
 * comes from gateOf (parity-locked against env in gates-parity.test).
 */
interface ActionDef {
    id: ActionId;
    name: MessageKey;
    sub: MessageKey;
    /** needs an explicit target on the chart */
    targets?: boolean;
}

/** display order fixed by DESIGN.md §10.4 */
const ORDER: ActionDef[] = [
    { id: "silent", name: "actions.silent", sub: "actions.silent.sub" },
    { id: "develop", name: "actions.develop", sub: "actions.develop.sub" },
    { id: "broadcast", name: "actions.broadcast", sub: "actions.broadcast.sub" },
    { id: "reveal", name: "actions.reveal", sub: "actions.reveal.sub", targets: true },
    { id: "observe", name: "actions.observe", sub: "actions.observe.sub", targets: true },
    { id: "domain", name: "actions.domain", sub: "actions.domain.sub" },
    { id: "invade", name: "actions.invade", sub: "actions.invade.sub", targets: true },
    { id: "strike", name: "actions.strike", sub: "actions.strike.sub", targets: true },
];

const STANCE_IDS: ReadonlySet<ActionId> = new Set(["silent", "develop"]);

export interface PendingAction {
    id: ActionId;
    /** explicit target slot; −1 = env nearest-fallback (STRIKE only); undefined = non-targeting */
    target?: number;
}

export function ActionGrid({
    tech,
    res,
    hasKnown,
    valid,
    stance,
    pending,
    armed,
    onSelect,
    onArm,
    onExecute,
    executeDisabled,
    cfg,
}: {
    tech: number;
    res: number;
    hasKnown: boolean;
    /** env valid row (authoritative disable); reason text from gateOf */
    valid: boolean[];
    /** 持久姿态（silent|develop）——跨刻保留 */
    stance: ActionId;
    /** 待执行一次性动作（null = 执行按钮将以姿态推进） */
    pending: PendingAction | null;
    /** 目标选择子模式（strike/invade 选目标中）——执行禁用 */
    armed: ActionId | null;
    /** 点击动作：静默/发展 = 设姿态（并清一次性）；其余 = 进入/切换待执行 */
    onSelect: (id: ActionId) => void;
    onArm: (id: ActionId) => void;
    onExecute: () => void;
    executeDisabled: boolean;
    /** 会话环境配置：门理由文字与真实门槛一致（缺省 = v2.4 默认） */
    cfg?: EnvConfig;
}) {
    const { t } = useI18n();

    // 执行按钮副行：将执行什么——pending 为动作名（目标 ≥0 追加 #编号），否则姿态名
    const pendingDef = pending !== null ? ORDER.find((d) => d.id === pending.id) : undefined;
    const stanceDef = ORDER.find((d) => d.id === stance);
    const executeSub =
        pending !== null && pendingDef !== undefined
            ? t(pendingDef.name) +
              (pending.target !== undefined && pending.target >= 0 ? ` #${pending.target}` : "")
            : t(stanceDef?.name ?? "actions.silent");

    return (
        <Panel title={t("match.actions")}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ORDER.map((def) => {
                    const reason = gateOf(def.id, tech, res, hasKnown, cfg);
                    const blocked = !valid[ACTION_NUM[def.id]] || reason !== null;
                    const isArmed = armed === def.id;
                    // 武装中仅武装钮高亮（单信号）——取消/选标后 pending 高亮回归
                    const isPending = armed === null && pending?.id === def.id;
                    // 姿态高亮仅在无待执行时显示——一次性刻后随 pending 清空而回退
                    const isStance = pending === null && STANCE_IDS.has(def.id) && stance === def.id;
                    const selected = isArmed || isPending || isStance;
                    return (
                        <button
                            key={def.id}
                            type="button"
                            disabled={blocked}
                            onClick={() =>
                                def.targets === true ? onArm(def.id) : onSelect(def.id)
                            }
                            className={`flex min-h-16 flex-col items-start justify-center gap-1 rounded-panel border px-2 py-1 text-left ${
                                selected
                                    ? isStance
                                        ? "border-self bg-raised"
                                        : "border-lethal bg-raised"
                                    : blocked
                                      ? "border-subtle opacity-40"
                                      : "border-subtle hover:border-strong hover:bg-raised"
                            }`}
                        >
                            <span
                                className={`text-sm font-bold ${
                                    isStance
                                        ? "text-self"
                                        : isArmed || isPending
                                          ? "text-lethal"
                                          : "text-ink"
                                }`}
                            >
                                {t(def.name)}
                            </span>
                            <span className="text-xs text-dim">
                                {blocked && reason !== null
                                    ? t(reason.reason, reason.params)
                                    : t(def.sub)}
                            </span>
                        </button>
                    );
                })}
            </div>
            <button
                type="button"
                onClick={onExecute}
                disabled={executeDisabled}
                className="mt-2 flex min-h-12 w-full flex-col items-center justify-center rounded-panel bg-self px-3 py-2 font-bold text-panel hover:opacity-90 disabled:cursor-default disabled:opacity-40"
            >
                <span>{t("match.next")}</span>
                <span className="tnum text-xs font-normal opacity-80">{executeSub}</span>
            </button>
        </Panel>
    );
}

export type { ActionId };
