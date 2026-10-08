"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ActionGrid, type ActionId } from "@/components/action-grid";
import { EndOverlay } from "@/components/end-overlay";
import { EventLog } from "@/components/event-log";
import { InvasionModal } from "@/components/invasion-modal";
import { StarChart } from "@/components/star-chart";
import { StatusPanel } from "@/components/status-panel";
import { BrandLink, TopBar } from "@/components/top-bar";
import { useI18n } from "@/i18n";
import { ACTION_NUM, type ActionId as GridActionId } from "@/lib/solo/gates";
import type { MarkerView } from "@/lib/solo/view";
import { useSoloMatch } from "@/lib/solo/client";

/** gates.ActionId ↔ action-grid 的 ActionId（同名结构，显式对应） */
const ARMED_NUM: Record<ActionId, number> = {
    silent: ACTION_NUM.silent,
    develop: ACTION_NUM.develop,
    broadcast: ACTION_NUM.broadcast,
    observe: ACTION_NUM.observe,
    domain: ACTION_NUM.domain,
    invade: ACTION_NUM.invade,
    strike: ACTION_NUM.strike,
    strikeWeak: ACTION_NUM.strikeWeak,
    strikeStrong: ACTION_NUM.strikeStrong,
};

/** useSearchParams 必须包 Suspense（Next 16 预渲染要求）——外壳负责边界 */
export default function MatchPage() {
    return (
        <Suspense
            fallback={
                <div className="grid min-h-svh place-items-center">
                    <p className="anim-alert-blink text-base text-dim">…</p>
                </div>
            }
        >
            <MatchConsole />
        </Suspense>
    );
}

function MatchConsole() {
    const { t } = useI18n();
    const router = useRouter();
    const params = useSearchParams();
    const session = useSoloMatch(params.get("op"));
    const [armed, setArmed] = useState<ActionId | null>(null);

    // ESC 退出目标选择（状态逻辑；动画仍是 CSS-only）
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setArmed(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const state = session.state;
    useEffect(() => {
        if (state.status === "redirect") router.replace("/solo");
    }, [state.status, router]);

    if (state.status === "redirect") return null;
    if (state.status === "loading")
        return (
            <div className="grid min-h-svh place-items-center">
                <p className="anim-alert-blink text-base text-dim">{t("solo.loading")}</p>
            </div>
        );

    const v = state.view;
    const hasKnown =
        v.targetCandidates.length > 0 ||
        v.markers.some(
            (m) =>
                m.state === "known" ||
                m.state === "observed" ||
                m.state === "public" ||
                m.state === "domain",
        );
    const targeting = armed === "strike" || armed === "invade";

    const onPick = (civ: MarkerView) => {
        if (armed === null || civ.state === "self" || civ.state === "domain") return;
        session.submitAction(ARMED_NUM[armed], civ.id);
        setArmed(null);
    };

    const submitSimple = (id: ActionId) => session.submitAction(ARMED_NUM[id], -1);
    const tickStr = `${String(v.tick).padStart(3, "0")}/${v.tMax}`;

    return (
        <div className="flex min-h-svh flex-col gap-3 p-3">
            <TopBar
                left={<BrandLink />}
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
                    </>
                }
            />

            {armed !== null && (
                <div className="flex items-center justify-between rounded-panel border border-lethal bg-panel px-3 py-2">
                    <p className="text-sm text-lethal">{t("match.target")}</p>
                    <div className="flex gap-2">
                        {armed === "strike" && (
                            <button
                                type="button"
                                onClick={() => {
                                    session.submitAction(ARMED_NUM.strike, -1); // 最近已知兜底
                                    setArmed(null);
                                }}
                                className="rounded-panel border border-subtle px-2 py-1 text-xs text-dim hover:border-strong hover:text-ink"
                            >
                                {t("match.target.skip")}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setArmed(null)}
                            className="rounded-panel border border-subtle px-2 py-1 text-xs text-dim hover:border-strong hover:text-ink"
                        >
                            {t("match.target.cancel")}
                        </button>
                    </div>
                </div>
            )}

            <div className="grid flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
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
                        />
                    ) : (
                        <div className="rounded-panel border border-subtle bg-panel px-3 py-4 text-center">
                            <p className="anim-alert-blink text-sm text-dim">
                                {t("match.waitBirth")}
                            </p>
                        </div>
                    )}
                    <ActionGrid
                        tech={v.self?.tech ?? 0}
                        res={v.self?.res ?? 0}
                        hasKnown={hasKnown}
                        valid={v.valid}
                        lastAction={v.lastAction !== null ? numToActionId(v.lastAction) : null}
                        armed={armed}
                        onArm={setArmed}
                        onAction={submitSimple}
                    />
                </div>
            </div>

            <EventLog events={v.log} />

            {v.invasion !== null && (
                <InvasionModal
                    invaderId={v.invasion.invaderId}
                    /* solo untimed (DESIGN.md §13) */
                    onCounter={() => session.submitRechoice(6)}
                    onDomain={() => session.submitRechoice(5)}
                    onCancel={() => session.cancelRechoice()}
                    domainDisabled={!v.valid[5]}
                    domainTitle={
                        !v.valid[5] ? t("actions.disabled.tech", { v: 5 }) : undefined
                    }
                />
            )}
            {v.end !== null && <EndOverlay end={v.end} />}
        </div>
    );
}

function numToActionId(n: number): GridActionId | null {
    const map: Record<number, GridActionId> = {
        0: "silent",
        1: "develop",
        2: "broadcast",
        4: "strike",
        5: "domain",
        6: "invade",
        7: "observe",
        8: "strikeWeak",
        9: "strikeStrong",
    };
    return map[n] ?? null;
}
