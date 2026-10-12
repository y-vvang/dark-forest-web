"use client";

import Link from "next/link";
import { useState } from "react";

import { ConfigPanel } from "@/components/config-panel";
import { OpponentCard } from "@/components/opponent-card";
import { Panel } from "@/components/panel";
import { BackLink, TopBar } from "@/components/top-bar";
import { useI18n } from "@/i18n";
import { V24_CONFIG, type EnvConfig } from "@/lib/engine/config";
import { OPPONENTS } from "@/lib/opponents/catalog";
import { serializeConfigDiff } from "@/lib/solo/cfg-io";

/**
 * /solo 对手选择（2026-10-10 用户修订）：预制策略与 v2.4 四臂模型**合并单一列表**
 * （原"预制/模型"分节有误导性）；对手卡**内联详情**（无 popover——与点击选择冲突），
 * 详情 = 动作画像（非胜率）。下方 = 世界常量配置面板（开局前可配置）。
 * 开始对局：op= 逗号 id + env 配置差集写 sessionStorage（df.env-cfg）。
 */
export default function SoloPage() {
    const { t } = useI18n();
    const [selected, setSelected] = useState<Set<string>>(() => new Set(["a_classic"]));
    const [cfg, setCfg] = useState<EnvConfig>({ ...V24_CONFIG });
    const toggle = (value: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(value)) next.delete(value);
            else next.add(value);
            return next;
        });
    };
    /** URL 序 = 目录序（预制在前、臂 a→d）；配置差集走 sessionStorage */
    const opParam = OPPONENTS.filter((o) => selected.has(o.id))
        .map((o) => o.id)
        .join(",");

    const start = () => {
        window.sessionStorage.setItem("df.env-cfg", serializeConfigDiff(cfg));
    };

    return (
        <div className="flex min-h-svh flex-col">
            <TopBar
                left={<BackLink href="/" />}
                right={<h1 className="text-base text-ink">{t("solo.title")}</h1>}
            />
            <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6">
                <section className="flex flex-col gap-2">
                    <h2 className="text-lg text-ink">{t("solo.opponents")}</h2>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {OPPONENTS.map((o) =>
                            o.kind === "preset" ? (
                                <OpponentCard
                                    key={o.id}
                                    value={o.id}
                                    selected={selected.has(o.id)}
                                    onSelect={toggle}
                                    title={t(o.name)}
                                    desc={t(o.desc)}
                                />
                            ) : (
                                <OpponentCard
                                    key={o.id}
                                    value={o.id}
                                    selected={selected.has(o.id)}
                                    onSelect={toggle}
                                    title={o.id}
                                    meta={o.meta}
                                    override={o.override}
                                    desc={t(o.profile)}
                                />
                            ),
                        )}
                    </div>
                </section>

                <ConfigPanel cfg={cfg} onChange={setCfg} />

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
                        onClick={start}
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
