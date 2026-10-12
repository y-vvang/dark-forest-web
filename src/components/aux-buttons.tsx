/**
 * /match 辅助钮行（DESIGN.md §10.12/§10.13，2026-10-10 用户需求）：
 * - **奖励**：按钮 + popover——当前配置的奖励流（累计/本刻/五分量）+ v2.4 四臂
 *   固定参数累计对比（「如果我是该模型，我会得到什么信号」）；奖励参数不影响
 *   对手行为（尾注披露）。
 * - **参谋**：按钮 + popover——四臂模型对玩家当前局面的 greedy 选择（ε=0，与对局
 *   随机流隔离）；一旦用过，终局弹窗显示披露标记（诚实披露：AI 辅助 = 非独立生存）。
 *
 * 两钮均锚定式 popover（.aux-popover + clampPopoverIntoViewport——原对手卡机制），
 * 未出生禁用。数值全 mono 定点。
 */
import { useState, type CSSProperties } from "react";

import type { MessageKey } from "@/i18n";
import { useI18n } from "@/i18n";
import type { Advice } from "@/lib/solo/client";
import type { RewardView } from "@/lib/solo/view";

import { clampPopoverIntoViewport, useAutoPopover } from "./use-auto-popover";

/** env 动作枚举序 → 动作名键（v2.4 0-7） */
const ACTION_NAME: Record<number, MessageKey> = {
    0: "actions.silent",
    1: "actions.develop",
    2: "actions.broadcast",
    3: "actions.reveal",
    4: "actions.strike",
    5: "actions.domain",
    6: "actions.invade",
    7: "actions.observe",
};

/** mono 定点两位 + 正号（负数自带 −） */
function fmt(v: number): string {
    return (v >= 0 ? "+" : "") + v.toFixed(2);
}

export function AuxButtons({
    reward,
    onAdvise,
}: {
    reward: RewardView | null;
    onAdvise: () => Promise<Advice[]>;
}) {
    const { t } = useI18n();
    // 解构（同 marker.tsx 惯例）：保留对象再在渲染期取属性会被 React Compiler
    // 判为 ref 渲染期访问——逐一解构成具名绑定后编译器可追踪
    const {
        anchorRef: rewAnchor,
        popoverRef: rewPop,
        togglePinned: rewToggle,
        hoverHandlers: rewHover,
    } = useAutoPopover(clampPopoverIntoViewport);
    const {
        anchorRef: advAnchor,
        popoverRef: advPop,
        togglePinned: advToggle,
        hoverHandlers: advHover,
    } = useAutoPopover(clampPopoverIntoViewport);
    const [advice, setAdvice] = useState<Advice[] | null>(null);

    const runAdvise = () => {
        void onAdvise().then(setAdvice);
    };

    const btn =
        "rounded-panel border border-subtle px-3 py-1.5 text-xs text-dim hover:border-strong hover:text-ink disabled:cursor-default disabled:opacity-40";

    return (
        <div className="flex gap-2">
            <div className="relative">
                <button
                    ref={rewAnchor}
                    type="button"
                    disabled={reward === null}
                    onClick={rewToggle}
                    {...rewHover}
                    style={{ anchorName: "--aux-reward" } as CSSProperties}
                    className={btn}
                >
                    {t("match.reward")}
                </button>
                <div
                    ref={rewPop}
                    popover="auto"
                    style={{ positionAnchor: "--aux-reward" } as CSSProperties}
                    className="aux-popover rounded-panel border border-subtle bg-panel p-4"
                >
                    {reward !== null && (
                        <div className="flex w-64 flex-col gap-2">
                            <p className="tnum text-base text-ink">
                                {t("match.reward.total")} {fmt(reward.total)}
                            </p>
                            <p className="tnum text-xs text-dim">
                                {t("match.reward.last")} {fmt(reward.lastTick)}
                            </p>
                            <div className="flex flex-col gap-1 border-t border-subtle pt-2">
                                {(
                                    [
                                        ["match.reward.stipend", reward.parts.stipend],
                                        ["match.reward.res", reward.parts.res],
                                        ["match.reward.bounty", reward.parts.bounty],
                                        ["match.reward.bd", reward.parts.bdEntry],
                                        ["match.reward.death", reward.parts.death],
                                    ] as [MessageKey, number][]
                                ).map(([key, v]) => (
                                    <p
                                        key={key}
                                        className="flex justify-between text-xs text-dim"
                                    >
                                        <span>{t(key)}</span>
                                        <span className="tnum text-ink">{fmt(v)}</span>
                                    </p>
                                ))}
                            </div>
                            <div className="flex flex-col gap-1 border-t border-subtle pt-2">
                                <p className="text-xs text-dim">{t("match.reward.arms")}</p>
                                {reward.arms.map((a) => (
                                    <p
                                        key={a.id}
                                        className="flex justify-between text-xs text-dim"
                                    >
                                        <span className="tnum">{a.id}</span>
                                        <span className="tnum text-ink">{fmt(a.total)}</span>
                                    </p>
                                ))}
                            </div>
                            <p className="text-xs leading-4 text-faint">
                                {t("match.reward.note")}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <div className="relative">
                <button
                    ref={advAnchor}
                    type="button"
                    disabled={reward === null}
                    onClick={() => {
                        runAdvise();
                        advToggle();
                    }}
                    {...advHover}
                    style={{ anchorName: "--aux-advice" } as CSSProperties}
                    className={btn}
                >
                    {t("match.advisor")}
                </button>
                <div
                    ref={advPop}
                    popover="auto"
                    style={{ positionAnchor: "--aux-advice" } as CSSProperties}
                    className="aux-popover rounded-panel border border-subtle bg-panel p-4"
                >
                    <div className="flex w-56 flex-col gap-1">
                        <p className="text-xs text-dim">{t("match.advisor.title")}</p>
                        {(advice ?? []).map((a) => (
                            <p key={a.arm} className="flex justify-between text-xs">
                                <span className="tnum text-dim">{a.arm}</span>
                                <span className="text-ink">
                                    {t(ACTION_NAME[a.action] ?? "actions.silent")}
                                </span>
                            </p>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
