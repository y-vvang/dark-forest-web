"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
    ActionGrid,
    type ActionId,
    type PendingAction,
} from "@/components/action-grid";
import { EndOverlay } from "@/components/end-overlay";
import { EventLog } from "@/components/event-log";
import { InvasionModal } from "@/components/invasion-modal";
import type { CivLike } from "@/components/marker";
import { Panel } from "@/components/panel";
import { StarChart } from "@/components/star-chart";
import { StatusPanel } from "@/components/status-panel";
import { BackLink, TopBar } from "@/components/top-bar";
import { useI18n } from "@/i18n";
import { ACTION_NUM } from "@/lib/solo/gates";
import { safetyNetDelay, useOnlineWorld } from "@/lib/online/use-online-world";

/** gates.ActionId ↔ action-grid 的 ActionId（同 /match 接线） */
const ARMED_NUM: Record<ActionId, number> = {
    silent: ACTION_NUM.silent,
    develop: ACTION_NUM.develop,
    broadcast: ACTION_NUM.broadcast,
    reveal: ACTION_NUM.reveal,
    observe: ACTION_NUM.observe,
    domain: ACTION_NUM.domain,
    invade: ACTION_NUM.invade,
    strike: ACTION_NUM.strike,
};

const NUM_ACTION: Record<number, ActionId> = Object.fromEntries(
    Object.entries(ARMED_NUM).map(([id, num]) => [num, id]),
) as Record<number, ActionId>;

/** 一次性动作（显式提交时 lethal 高亮本窗）；silent/develop 走姿态高亮 */
const ONE_SHOT: ReadonlySet<number> = new Set([
    ACTION_NUM.broadcast,
    ACTION_NUM.reveal,
    ACTION_NUM.observe,
    ACTION_NUM.domain,
    ACTION_NUM.invade,
    ACTION_NUM.strike,
]);

/** 目标武装集：strike/observe 有最近已知兜底；invade/reveal 必须显式目标 */
const TARGETING: ReadonlySet<ActionId> = new Set(["strike", "invade", "reveal", "observe"]);
const SKIPPABLE: ReadonlySet<ActionId> = new Set(["strike", "observe"]);

const GHOST: CivLike[] = [{ id: -1, x: 50, y: 50, state: "queued" }];

/**
 * /online：token 驱动单页流（DESIGN.md §10.11/§10.11a/§11）。大厅 = 排队卡 +
 * 幽灵星图；出生后 = /match 控制台同构（无 AuxButtons——参谋/奖励面板为单人专属，
 * 用户 2026-10-12 裁决③）+ 刻截止读数 + 入侵倒计时（timed）。
 *
 * **无执行钮（用户 2026-10-14 裁定）：选择即提交 + 刻末安全网**——姿态/无目标
 * 一次性点击即 POST（服务端逐窗后写覆盖）；目标动作武装后选中即 POST。刻末
 * deadline−2s：本窗无提交且姿态非静默 → 自动续交（姿态每刻自动延续）。silent
 * 不发包（服务端缺省即静默——记录零成本）。隐藏页计时器被浏览器节流 → 不触发
 * → 静默（AFK 语义）。pending 为派生量：本窗已提交的一次性动作（刻后自动回退
 * 姿态高亮）。入侵模态"取消"= 本地关闭（不再发 -1——无快进后截止保原即为环境
 * 语义）。
 */
export default function OnlinePage() {
    const { t } = useI18n();
    const router = useRouter();
    const session = useOnlineWorld();
    const { submitAction, submitRechoice } = session;
    const [armed, setArmed] = useState<ActionId | null>(null);
    const [stance, setStance] = useState<ActionId>("silent");
    const [dismissedInv, setDismissedInv] = useState("");
    // 安全网刻号闸（走查回归 2026-10-28）：每刻至多一次提交——防 effect 重排 ×
    // setTimeout(0) × fire-and-forget POST 的无界请求风暴
    const netFiredTickRef = useRef(-1);

    const s = session.state;

    // ESC 退出目标选择；回车 = 重复上刻行动（一键重申——后写覆盖）
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setArmed(null);
            if (event.key !== "Enter") return;
            const cur = session.state;
            if (
                cur === null ||
                cur.kind !== "console" ||
                cur.view.invasion !== null || // 模态聚焦钮自行接管回车
                cur.view.self === null ||
                cur.view.end !== null ||
                cur.view.phase !== "awaiting-action" ||
                armed !== null
            )
                return;
            const last = session.lastAction;
            if (last !== null) submitAction(last.action, last.target);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [session, armed, submitAction]);

    // 刻末安全网：本窗无提交 ∧ 姿态非静默 ∧ 可行动 → deadline 前 2s 自动续交姿态。
    // **每刻恰一次**（刻号闸 netFiredTickRef）——失败不重试（刻照常到点结算，
    // 未提交=静默，下一窗重新武装）。决策走纯函数 safetyNetDelay（单测钉住）；
    // deps 只收稳定标识，不再收每次渲染恒新的 session 对象（走查回归 2026-10-28
    // 风暴根因：effect 重排 × setTimeout(0) × fire-and-forget POST 无界循环）。
    const tickEnds = s !== null && s.kind === "console" && s.view.end === null ? s.timing.tickEndsAtMs : null;
    const tickNow = s !== null && s.kind === "console" ? s.timing.tick : null;
    useEffect(() => {
        if (tickEnds === null || tickNow === null || s === null || s.kind !== "console") return;
        const v = s.view;
        const canAct =
            v.self !== null && v.end === null && v.invasion === null && v.phase === "awaiting-action";
        const delay = safetyNetDelay({
            nowMs: Date.now(),
            tickEndsAtMs: tickEnds,
            tick: tickNow,
            submission: s.submission,
            canAct,
            stance: stance === "develop" ? "develop" : "silent",
            firedTick: netFiredTickRef.current,
        });
        if (delay === null) return;
        const timer = setTimeout(() => {
            netFiredTickRef.current = tickNow; // 先置闸再提交：POST 落地前的重排全被挡
            submitAction(ACTION_NUM.develop, -1);
        }, delay);
        return () => clearTimeout(timer);
    }, [tickEnds, tickNow, stance, s, submitAction]);

    if (s === null)
        return (
            <div className="grid min-h-svh place-items-center">
                <p className="anim-alert-blink text-base text-dim">{t("online.waiting")}</p>
            </div>
        );

    const offlineBanner = session.offline && (
        <p className="anim-alert-blink rounded-panel border border-lethal bg-panel px-3 py-2 text-center text-sm text-lethal">
            {t("online.offline")}
        </p>
    );

    if (s.kind === "lobby-public")
        return (
            <div className="flex min-h-svh flex-col gap-3 p-3">
                <TopBar left={<BackLink href="/" />} right={<h1 className="text-base text-ink">{t("online.title")}</h1>} />
                {offlineBanner}
            </div>
        );

    if (s.kind === "lobby") {
        const tickStr = `${String(s.world.tick).padStart(3, "0")}/${s.world.tMax}`;
        return (
            <div className="flex min-h-svh flex-col gap-3 p-3">
                <TopBar
                    left={<BackLink href="/" />}
                    right={<h1 className="text-base text-ink">{t("online.title")}</h1>}
                />
                {s.rolledOver && (
                    <p className="rounded-panel border border-subtle bg-panel px-3 py-2 text-center text-sm text-dim">
                        {t("online.rollover")}
                    </p>
                )}
                {offlineBanner}
                <main className="mx-auto grid w-full max-w-4xl flex-1 gap-3 px-4 py-6 md:grid-cols-2">
                    <Panel>
                        <p className="tnum text-xl text-ink">
                            {t("online.position", { n: s.queuePosition })}
                        </p>
                        <p className="mt-1 text-sm text-dim">{t("online.noAccount")}</p>
                        <div className="mt-6 flex flex-col gap-2">
                            <h2 className="text-lg text-ink">{t("online.world")}</h2>
                            <p className="tnum text-base text-dim">
                                {t("match.tick")} <span className="text-ink">{tickStr}</span>
                                {" · "}
                                {t("match.alive")} <span className="text-ink">{s.world.nAlive}</span>
                                {" · "}
                                {t("match.pool")}{" "}
                                <span className="text-ink">{s.world.freePool.toFixed(1)}</span>
                            </p>
                        </div>
                        <p className="mt-4 font-sans text-sm leading-7 text-dim">{t("online.note")}</p>
                        <button
                            type="button"
                            onClick={() => {
                                void session.leave();
                                router.push("/");
                            }}
                            className="mt-6 rounded-panel border border-subtle px-3 py-2 text-base text-dim hover:border-strong hover:text-ink"
                        >
                            {t("online.cancel")}
                        </button>
                    </Panel>
                    <div className="flex flex-col gap-3">
                        <StarChart civs={GHOST} />
                        <p className="text-xs text-dim">{t("online.ghost")}</p>
                    </div>
                </main>
            </div>
        );
    }

    // ---- 控制台（出生后）----
    const v = s.view;
    const hasKnown =
        v.targetCandidates.length > 0 ||
        v.markers.some(
            (m) =>
                m.state === "known" ||
                m.state === "observed" ||
                m.state === "public" ||
                m.state === "domain",
        );
    const targeting = armed !== null && TARGETING.has(armed);
    const canAct =
        v.self !== null && v.end === null && v.phase === "awaiting-action" && v.invasion === null;

    // 派生 pending：本窗已提交的一次性动作（刻后随 submission 清空自动回退姿态）
    const pending: PendingAction | null =
        s.submission !== null && ONE_SHOT.has(s.submission.action)
            ? { id: NUM_ACTION[s.submission.action], target: s.submission.target }
            : null;

    /** 选择即提交：姿态（跨刻保留）与无目标一次性点击即 POST；目标动作走武装 */
    const onSelect = (id: ActionId) => {
        if (id === "silent" || id === "develop") setStance(id);
        if (canAct) submitAction(ACTION_NUM[id], -1);
    };

    const onPick = (civ: CivLike) => {
        if (armed === null || civ.state === "self" || civ.state === "domain") return;
        const id = armed;
        setArmed(null);
        submitAction(ACTION_NUM[id], civ.id);
    };

    const tickStr = `${String(v.tick).padStart(3, "0")}/${v.tMax}`;
    const invKey = v.invasion !== null ? `${s.timing.tick}-${v.invasion.invaderId}` : "";

    return (
        <div className="flex min-h-svh flex-col gap-3 p-3">
            <TopBar
                left={<BackLink href="/" />}
                right={
                    <>
                        <span>
                            {t("match.tick")} <span className="text-ink tnum">{tickStr}</span>
                        </span>
                        <span>
                            {t("match.alive")} <span className="text-ink tnum">{v.nAlive}</span>
                        </span>
                        <span>
                            {t("match.pool")}{" "}
                            <span className="text-ink tnum">{v.freePool.toFixed(1)}</span>
                        </span>
                        {v.end === null && v.invasion === null && (
                            <span className="text-dim">
                                {t("online.next", { s: s.timing.remainingSeconds })}
                            </span>
                        )}
                    </>
                }
            />
            {offlineBanner}

            {armed !== null && (
                <div className="flex items-center justify-between rounded-panel border border-lethal bg-panel px-3 py-2">
                    <p className="text-sm text-lethal">{t("match.target")}</p>
                    <div className="flex gap-2">
                        {SKIPPABLE.has(armed) && (
                            <button
                                type="button"
                                onClick={() => {
                                    const id = armed;
                                    setArmed(null);
                                    submitAction(ACTION_NUM[id], -1); // 最近已知兜底，即提交
                                }}
                                className="rounded-panel border border-subtle px-2 py-1 text-xs text-dim hover:border-strong hover:text-ink"
                            >
                                {t("match.target.skip")}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setArmed(null)} // 取消 = 本地放弃（本窗已有提交不动）
                            className="rounded-panel border border-subtle px-2 py-1 text-xs text-dim hover:border-strong hover:text-ink"
                        >
                            {t("match.target.cancel")}
                        </button>
                    </div>
                </div>
            )}

            <div className="grid flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_540px]">
                <div className="mx-auto w-full max-w-[min(720px,calc(100svh-20rem))]">
                    <StarChart
                        civs={v.markers}
                        selectableIds={targeting ? v.targetCandidates : []}
                        pingIds={[]}
                        onPick={onPick}
                    />
                </div>
                <div className="flex flex-col gap-3">
                    {v.self !== null ? (
                        <StatusPanel
                            tech={v.self.tech}
                            res={v.self.res}
                            inDomain={v.self.inDomain}
                            gates={[v.panel.gateObserveTech, v.panel.gateStrikeTech]}
                            resMax={v.panel.resMax}
                        />
                    ) : (
                        <div className="rounded-panel border border-subtle bg-panel px-3 py-4 text-center">
                            <p className="anim-alert-blink text-sm text-dim">
                                {t("match.waitBirth")}
                            </p>
                        </div>
                    )}
                    {s.submission !== null && v.end === null && v.invasion === null && (
                        <p className="tnum rounded-panel border border-subtle bg-panel px-3 py-2 text-sm text-dim">
                            {t("online.submitted", { t: s.timing.tick + 1 })}
                        </p>
                    )}
                    {canAct && (
                        <p className="text-xs text-faint">
                            {t("online.autoCommit")}
                            {session.lastAction !== null ? ` · ${t("online.enterHint")}` : ""}
                        </p>
                    )}
                    <ActionGrid
                        tech={v.self?.tech ?? 0}
                        res={v.self?.res ?? 0}
                        hasKnown={hasKnown}
                        valid={v.valid}
                        stance={stance}
                        pending={pending}
                        armed={armed}
                        onSelect={onSelect}
                        onArm={setArmed}
                        cfg={v.cfg}
                    />
                </div>
            </div>

            <EventLog events={session.log} />

            {v.invasion !== null && dismissedInv !== invKey && (
                <InvasionModal
                    invaderId={v.invasion.invaderId}
                    timed /* 在线 = 当刻剩余倒计时（§10.7/§13），恒满时长 */
                    remainingSeconds={session.invasionLeft}
                    onCounter={() => submitRechoice(6)}
                    onDomain={() => submitRechoice(5)}
                    onCancel={() => setDismissedInv(invKey)} /* 本地关闭：截止保原即环境语义 */
                    domainDisabled={!v.valid[5]}
                    domainTitle={
                        !v.valid[5]
                            ? t("actions.disabled.tech", { v: v.cfg.gateDomainTech })
                            : undefined
                    }
                />
            )}
            {v.end !== null && (
                <EndOverlay
                    end={v.end}
                    tMax={v.tMax}
                    onAgain={() => void session.requeue()}
                    againLabel="online.requeue"
                />
            )}
        </div>
    );
}
