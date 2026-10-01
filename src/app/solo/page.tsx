"use client";

import Link from "next/link";
import { useState } from "react";

import { OpponentCard } from "@/components/opponent-card";
import { Panel } from "@/components/panel";
import { BackLink, TopBar } from "@/components/top-bar";
import { useI18n, type MessageKey } from "@/i18n";
import { MODELS, PRESETS, type PresetKind } from "@/lib/mock";

const PRESET_NAME: Record<PresetKind, MessageKey> = {
    learner: "opp.learner.name",
    random: "opp.random.name",
    df: "opp.df.name",
    pacifist: "opp.pacifist.name",
};

const PRESET_DESC: Record<PresetKind, MessageKey> = {
    learner: "opp.learner.desc",
    random: "opp.random.desc",
    df: "opp.df.desc",
    pacifist: "opp.pacifist.desc",
};

export default function SoloPage() {
    const { t } = useI18n();
    const [selected, setSelected] = useState<string>("learner");
    const select = (value: string) => setSelected(value);

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
                        {PRESETS.map((kind) => (
                            <OpponentCard
                                key={kind}
                                value={kind}
                                selected={selected === kind}
                                onSelect={select}
                                title={t(PRESET_NAME[kind])}
                                desc={t(PRESET_DESC[kind])}
                            />
                        ))}
                    </div>
                </section>

                <section className="flex flex-col gap-2">
                    <h2 className="text-lg text-ink">{t("solo.models")}</h2>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {MODELS.map((model) => (
                            <OpponentCard
                                key={model.id}
                                value={model.id}
                                selected={selected === model.id}
                                onSelect={select}
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

                <Panel title={t("solo.pool")} meta={t("solo.selected", { n: 1 })}>
                    <p className="font-sans text-sm leading-7 text-dim">
                        {t("solo.pool.desc")}
                    </p>
                </Panel>

                <Link
                    href="/match"
                    className="rounded-panel bg-self px-4 py-3 text-center text-base font-bold text-panel hover:opacity-90"
                >
                    {t("solo.start")}
                </Link>

                <p className="pb-4 text-xs text-dim">{t("solo.disclosure")}</p>
            </main>
        </div>
    );
}
