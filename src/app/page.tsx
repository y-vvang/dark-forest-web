"use client";

import Link from "next/link";

import { LegendHero } from "@/components/legend-hero";
import { Panel } from "@/components/panel";
import { BrandLink, TopBar } from "@/components/top-bar";
import { useI18n } from "@/i18n";

export default function Home() {
    const { t } = useI18n();

    return (
        <div className="flex min-h-svh flex-col">
            <TopBar left={<BrandLink />} />
            <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10">
                <header>
                    <h1 className="text-3xl text-ink">{t("home.title")}</h1>
                    <p className="mt-1 text-sm text-dim">{t("home.titleAlt")}</p>
                </header>

                <LegendHero />

                <p className="font-sans text-base leading-relaxed text-ink">
                    {t("home.tagline")}
                </p>

                <nav className="grid gap-3 sm:grid-cols-2">
                    <Link
                        href="/solo"
                        className="flex min-h-24 flex-col justify-center gap-1 rounded-panel border border-subtle bg-panel p-4 hover:border-strong hover:bg-raised"
                    >
                        <span className="text-lg font-bold text-self">
                            {t("home.mode.solo")}
                        </span>
                        <span className="text-xs text-dim">{t("home.mode.solo.desc")}</span>
                    </Link>
                    <Link
                        href="/online"
                        className="flex min-h-24 flex-col justify-center gap-1 rounded-panel border border-subtle bg-panel p-4 hover:border-strong hover:bg-raised"
                    >
                        <span className="text-lg font-bold text-contact">
                            {t("home.mode.online")}
                        </span>
                        <span className="text-xs text-dim">
                            {t("home.mode.online.desc")}
                        </span>
                    </Link>
                </nav>

                <Panel title={t("home.rules.title")}>
                    <div className="flex flex-col gap-3 font-sans text-sm leading-7 text-dim">
                        <p>{t("home.rules.axioms")}</p>
                        <p>{t("home.rules.actions")}</p>
                        <p>{t("home.rules.economy")}</p>
                    </div>
                </Panel>

                <footer className="pb-4 text-xs text-dim">{t("home.footer")}</footer>
            </main>
        </div>
    );
}
