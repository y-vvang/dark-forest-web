"use client";

import { Panel } from "@/components/panel";
import { StarChart } from "@/components/star-chart";
import { BackLink, TopBar } from "@/components/top-bar";
import { useI18n } from "@/i18n";
import { ONLINE, type MockCiv } from "@/lib/mock";

export default function OnlinePage() {
    const { t } = useI18n();

    const ghostCivs: MockCiv[] = ONLINE.ghosts.map((ghost, index) => ({
        id: 100 + index,
        x: ghost.x,
        y: ghost.y,
        state: "queued" as const,
    }));

    const tickStr = `${String(ONLINE.tick).padStart(3, "0")}/${ONLINE.tMax}`;

    return (
        <div className="flex min-h-svh flex-col">
            <TopBar
                left={<BackLink href="/" />}
                right={<h1 className="text-base text-ink">{t("online.title")}</h1>}
            />
            <main className="mx-auto grid w-full max-w-4xl flex-1 gap-3 px-4 py-6 md:grid-cols-2">
                <Panel>
                    <p className="tnum text-xl text-ink">
                        {t("online.position", { n: ONLINE.position })}
                    </p>
                    <p className="mt-1 text-sm text-dim">{t("online.noAccount")}</p>

                    <div className="mt-6 flex flex-col gap-2">
                        <h2 className="text-lg text-ink">{t("online.world")}</h2>
                        <p className="tnum text-base text-dim">
                            {t("match.tick")} <span className="text-ink">{tickStr}</span>
                            {" · "}
                            {t("match.alive")}{" "}
                            <span className="text-ink">{ONLINE.alive}</span>
                            {" · "}
                            {t("match.pool")}{" "}
                            <span className="text-ink">{ONLINE.pool.toFixed(1)}</span>
                        </p>
                    </div>

                    <p className="mt-4 font-sans text-sm leading-7 text-dim">
                        {t("online.note")}
                    </p>

                    <button
                        type="button"
                        className="mt-6 rounded-panel border border-subtle px-3 py-2 text-base text-dim hover:border-strong hover:text-ink"
                    >
                        {t("online.cancel")}
                    </button>
                </Panel>

                <div className="flex flex-col gap-3">
                    <StarChart civs={ghostCivs} />
                    <p className="text-xs text-dim">{t("online.ghost")}</p>
                </div>
            </main>
        </div>
    );
}
