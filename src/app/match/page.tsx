"use client";

import { useEffect, useState } from "react";

import { ActionGrid, type ActionId } from "@/components/action-grid";
import { EndOverlay } from "@/components/end-overlay";
import { EventLog } from "@/components/event-log";
import { InvasionModal } from "@/components/invasion-modal";
import { StarChart } from "@/components/star-chart";
import { StatusPanel } from "@/components/status-panel";
import { BrandLink, TopBar } from "@/components/top-bar";
import { useI18n, type MessageKey } from "@/i18n";
import {
    CIVS,
    EVENTS,
    INVADER,
    MATCH,
    SELF,
    SELF_NORMAL,
    SELF_WEAK,
    SELF_WEAK_STATS,
    type MockCiv,
} from "@/lib/mock";

/** prototype-only demo states (the demo bar is removed in production) */
type DemoState = "normal" | "weak" | "invade" | "dead" | "alive";

const DEMO_KEY = {
    normal: "match.demo.normal",
    weak: "match.demo.weak",
    invade: "match.demo.invade",
    dead: "match.demo.dead",
    alive: "match.demo.alive",
} as const satisfies Record<DemoState, MessageKey>;

const DEMO_STATES = Object.keys(DEMO_KEY) as DemoState[];

export default function MatchPage() {
    const { t } = useI18n();
    const [demo, setDemo] = useState<DemoState>("normal");
    const [lastAction, setLastAction] = useState<ActionId>("develop");
    const [armed, setArmed] = useState<ActionId | null>(null);

    const stats = demo === "weak" ? SELF_WEAK_STATS : SELF_NORMAL;
    const civs: MockCiv[] = [demo === "weak" ? SELF_WEAK : SELF, ...CIVS];
    const hasKnown = CIVS.some(
        (civ) => civ.state === "known" || civ.state === "observed" || civ.state === "public",
    );

    // ESC exits target-selection (state logic; animation stays CSS-only)
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setArmed(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const selectableIds =
        armed === null
            ? []
            : CIVS.filter(
                  (civ) =>
                      civ.state === "known" ||
                      civ.state === "observed" ||
                      civ.state === "public",
              ).map((civ) => civ.id);

    const onPick = (civ: MockCiv) => {
        if (armed === null || civ.state === "self" || civ.state === "domain") return;
        setLastAction(armed);
        setArmed(null);
    };

    const tickStr = `${String(MATCH.tick).padStart(3, "0")}/${MATCH.tMax}`;

    return (
        <div className="flex min-h-svh flex-col gap-3 p-3">
            <TopBar
                left={<BrandLink />}
                right={
                    <>
                        <span>
                            {t("match.tick")} <span className="text-ink">{tickStr}</span>
                        </span>
                        <span>
                            {t("match.alive")}{" "}
                            <span className="text-ink">{MATCH.alive}</span>
                        </span>
                        <span>
                            {t("match.pool")}{" "}
                            <span className="text-ink">{MATCH.pool.toFixed(1)}</span>
                        </span>
                    </>
                }
            />

            {/* prototype-only demo control — removed in production */}
            <div className="flex flex-wrap items-center gap-2 rounded-panel border border-subtle bg-panel px-3 py-2">
                <span className="text-xs text-dim">{t("match.demo")}</span>
                {DEMO_STATES.map((state) => (
                    <button
                        key={state}
                        type="button"
                        onClick={() => {
                            setDemo(state);
                            setArmed(null);
                        }}
                        className={`rounded-panel border px-2 py-1 text-xs ${
                            demo === state
                                ? "border-strong bg-raised text-ink"
                                : "border-subtle text-dim hover:border-strong"
                        }`}
                    >
                        {t(DEMO_KEY[state])}
                    </button>
                ))}
            </div>

            {armed !== null && (
                <div className="flex items-center justify-between rounded-panel border border-lethal bg-panel px-3 py-2">
                    <p className="text-sm text-lethal">{t("match.target")}</p>
                    <button
                        type="button"
                        onClick={() => setArmed(null)}
                        className="rounded-panel border border-subtle px-2 py-1 text-xs text-dim hover:border-strong hover:text-ink"
                    >
                        {t("match.target.cancel")}
                    </button>
                </div>
            )}

            <div className="grid flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="mx-auto w-full max-w-[min(720px,calc(100svh-20rem))]">
                    <StarChart
                        civs={civs}
                        selectableIds={selectableIds}
                        pingIds={demo === "normal" ? [7] : []}
                        onPick={onPick}
                    />
                </div>
                <div className="flex flex-col gap-3">
                    <StatusPanel
                        tech={stats.tech}
                        res={stats.res}
                        inDomain={stats.inDomain}
                    />
                    <ActionGrid
                        tech={stats.tech}
                        res={stats.res}
                        hasKnown={hasKnown}
                        lastAction={lastAction}
                        armed={armed}
                        onArm={setArmed}
                        onAction={setLastAction}
                    />
                </div>
            </div>

            <EventLog events={EVENTS} />

            {demo === "invade" && (
                <InvasionModal
                    invaderId={INVADER}
                    /* solo mode: untimed (DESIGN.md §13) — no countdown bar */
                    onCounter={() => setDemo("dead")}
                    onDomain={() => setDemo("normal")}
                    onCancel={() => setDemo("normal")}
                />
            )}
            {(demo === "dead" || demo === "alive") && <EndOverlay state={demo} />}
        </div>
    );
}
