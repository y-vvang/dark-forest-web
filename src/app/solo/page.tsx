"use client";

import Link from "next/link";
import { useState } from "react";

import { OpponentCard } from "@/components/opponent-card";
import { Panel } from "@/components/panel";
import { BackLink, TopBar } from "@/components/top-bar";
import { useI18n, type MessageKey } from "@/i18n";
import { MODEL_CATALOG, PRESET_IDS } from "@/lib/opponents/catalog";

const PRESET_NAME: Record<string, MessageKey> = {
    random: "opp.random.name",
    df: "opp.df.name",
    pacifist: "opp.pacifist.name",
};

const PRESET_DESC: Record<string, MessageKey> = {
    random: "opp.random.desc",
    df: "opp.df.desc",
    pacifist: "opp.pacifist.desc",
};

export default function SoloPage() {
    const { t } = useI18n();
    const [selected, setSelected] = useState<Set<string>>(() => new Set(["main"]));
    const toggle = (value: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(value)) next.delete(value);
            else next.add(value);
            return next;
        });
    };
    /** URL 序：预制在前、模型按目录序 */
    const opParam = [
        ...PRESET_IDS.filter((id) => selected.has(id)),
        ...MODEL_CATALOG.filter((m) => selected.has(m.id)).map((m) => m.id),
    ].join(",");

    return (
        <div className="flex min-h-svh flex-col">
            <TopBar
                left={<BackLink href="/" />}
                right={<h1 className="text-base text-ink">{t("solo.title")}</h1>}
            />
            <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6">
                <section className="flex flex-col gap-2">
                    <h2 className="text-lg text-ink">{t("solo.preset")}</h2>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {PRESET_IDS.map((kind) => (
                            <OpponentCard
                                key={kind}
                                value={kind}
                                selected={selected.has(kind)}
                                onSelect={toggle}
                                title={t(PRESET_NAME[kind])}
                                desc={t(PRESET_DESC[kind])}
                            />
                        ))}
                    </div>
                </section>

                <section className="flex flex-col gap-2">
                    <h2 className="text-lg text-ink">{t("solo.models")}</h2>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {MODEL_CATALOG.map((model) => (
                            <OpponentCard
                                key={model.id}
                                value={model.id}
                                selected={selected.has(model.id)}
                                onSelect={toggle}
                                title={model.id}
                                meta={model.meta}
                                desc={
                                    model.main === true
                                        ? t("solo.model.main")
                                        : (model.override ?? t("solo.model.control"))
                                }
                                stat={t("solo.model.survivalFmt", {
                                    v: model.survival.toFixed(3),
                                })}
                            />
                        ))}
                    </div>
                </section>

                <Panel
                    title={t("solo.pool")}
                    meta={t("solo.selected", { n: selected.size })}
                >
                    <p className="font-sans text-sm leading-7 text-dim">
                        {t("solo.pool.desc")}
                    </p>
                </Panel>

                {selected.size > 0 && opParam !== "" ? (
                    <Link
                        href={`/match?op=${opParam}`}
                        className="rounded-panel bg-self px-4 py-3 text-center text-base font-bold text-panel hover:opacity-90"
                    >
                        {t("solo.start")}
                    </Link>
                ) : (
                    <button
                        type="button"
                        disabled
                        className="rounded-panel bg-strong px-4 py-3 text-center text-base font-bold text-faint"
                    >
                        {t("solo.start")}
                    </button>
                )}

                <p className="pb-4 text-xs text-dim">{t("solo.disclosure")}</p>
            </main>
        </div>
    );
}
