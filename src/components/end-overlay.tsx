import Link from "next/link";

import { useI18n, type MessageKey } from "@/i18n";
import { END_ALIVE, END_DEAD } from "@/lib/mock";

const CAUSE_KEY = {
    starve: "cause.starve",
    strike: "cause.strike",
    invade: "cause.invade",
    mutual: "cause.mutual",
} as const satisfies Record<string, MessageKey>;

/**
 * End-of-match overlay (DESIGN.md §10.8). No last-man-standing victory
 * exists in this world — surviving to tick 250 IS the win.
 */
export function EndOverlay({ state }: { state: "dead" | "alive" }) {
    const { t } = useI18n();

    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-void/80 p-4">
            <div className="w-full max-w-md rounded-panel border border-strong bg-panel p-6">
                {state === "dead" ? (
                    <>
                        <h2 className="text-xl text-lethal">{t("end.dead.title")}</h2>
                        <p className="tnum mt-2 text-base text-dim">
                            {t("end.dead.cause", { cause: t(CAUSE_KEY[END_DEAD.cause]) })}
                        </p>
                        <p className="tnum text-base text-dim">
                            {t("end.dead.survived", { ticks: END_DEAD.ticks })}
                        </p>
                        <p className="tnum text-base text-dim">
                            {t("end.stats", { kills: END_DEAD.kills, loot: END_DEAD.loot })}
                        </p>
                    </>
                ) : (
                    <>
                        <h2 className="text-xl text-self">{t("end.alive.title")}</h2>
                        <p className="tnum mt-2 text-base text-dim">
                            {t("end.alive.body", { n: END_ALIVE.survivors })}
                        </p>
                    </>
                )}

                <div className="mt-6 grid gap-2">
                    <Link
                        href="/solo"
                        className="rounded-panel bg-self px-3 py-2 text-center text-base font-bold text-panel"
                    >
                        {t("end.again")}
                    </Link>
                    <Link
                        href="/"
                        className="rounded-panel border border-subtle px-3 py-2 text-center text-base text-dim hover:border-strong hover:text-ink"
                    >
                        {t("end.home")}
                    </Link>
                </div>
            </div>
        </div>
    );
}
