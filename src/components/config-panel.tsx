/**
 * 世界常量配置面板（DESIGN.md §10.14；用户 2026-10-10 需求）。
 *
 * 精选 25 参数 + 出生科技旋钮（cfg-io 的 CFG_FIELDS——参数名即 mono 标签，技术记号
 * 属数据展示非文案）；奖励节头部 = 四臂快捷预设 + 恢复默认；两条披露常驻脚注
 * （默认即实验参数/奖励不影响对手）。面板可折叠，标题行右侧 = `已改 {n} 项` 徽标。
 * 状态由 /solo 页持有（cfg + onChange），开始对局时差集序列化写 sessionStorage。
 */
import { useState } from "react";

import { V24_ARMS, V24_CONFIG, type EnvConfig } from "@/lib/engine/config";
import { useI18n, type MessageKey } from "@/i18n";
import {
    CFG_FIELDS,
    TECH_SPAWN_KEY,
    applyArmReward,
    clampValue,
    countDeviations,
    type CfgField,
} from "@/lib/solo/cfg-io";

import { Panel } from "./panel";

const GROUP_ORDER: MessageKey[] = [
    "solo.config.g.clock",
    "solo.config.g.detect",
    "solo.config.g.econ",
    "solo.config.g.tech",
    "solo.config.g.force",
    "solo.config.g.gates",
    "solo.config.g.reward",
];

const ARM_PRESET_IDS = ["a_classic", "b_terminal", "c_res", "d_malintent"] as const;

export function ConfigPanel({
    cfg,
    onChange,
}: {
    cfg: EnvConfig;
    onChange: (next: EnvConfig) => void;
}) {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const dirty = countDeviations(cfg);

    const setField = (f: CfgField, raw: string) => {
        const v = Number(raw);
        if (!Number.isFinite(v)) return; // 空/NaN：失焦钳制由 reset 或重新输入完成
        onChange({ ...cfg, [f.key]: clampValue(f, v) } as EnvConfig);
    };
    const setTechSpawn = (raw: string) => {
        const v = Number(raw);
        if (!Number.isFinite(v)) return;
        const c = Math.min(20, Math.max(0, v));
        onChange({ ...cfg, techSpawnLo: c, techSpawnHi: c });
    };

    return (
        <Panel
            title={t("solo.config")}
            meta={dirty > 0 ? t("solo.config.dirty", { n: dirty }) : undefined}
        >
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className="tnum w-full rounded-panel border border-subtle px-3 py-2 text-left text-xs text-dim hover:border-strong hover:text-ink"
            >
                {open ? "▾" : "▸"} tMax · detectRadius · killBase · …
            </button>
            {open && (
                <div className="mt-3 flex flex-col gap-4">
                    {GROUP_ORDER.map((group) => (
                        <section key={group} className="flex flex-col gap-2">
                            <h3 className="text-sm text-ink">{t(group)}</h3>
                            {group === "solo.config.g.reward" && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-dim">
                                        {t("solo.config.armPresets")}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => onChange(applyArmReward(cfg, "a_classic"))}
                                        className="rounded-panel border border-subtle px-2 py-1 text-xs text-dim hover:border-strong hover:text-ink"
                                    >
                                        {t("solo.config.default")}
                                    </button>
                                    {ARM_PRESET_IDS.map((arm) => (
                                        <button
                                            key={arm}
                                            type="button"
                                            onClick={() => onChange(applyArmReward(cfg, arm))}
                                            className="tnum rounded-panel border border-subtle px-2 py-1 text-xs text-dim hover:border-strong hover:text-ink"
                                        >
                                            {arm}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {CFG_FIELDS.filter((f) => f.group === group).map((f) => (
                                <label
                                    key={f.key}
                                    className="flex items-center justify-between gap-3"
                                >
                                    <span className="tnum text-xs text-ink">{f.key}</span>
                                    <span className="flex items-baseline gap-2">
                                        <input
                                            type="number"
                                            value={cfg[f.key as keyof EnvConfig] as number}
                                            step={f.step}
                                            min={f.min}
                                            max={f.max}
                                            onChange={(e) => setField(f, e.target.value)}
                                            className="tnum w-24 rounded-panel border border-subtle bg-panel px-2 py-1 text-right text-xs text-ink focus:border-strong"
                                        />
                                        <span className="tnum w-10 text-right text-xs text-faint">
                                            {V24_CONFIG[f.key as keyof EnvConfig]}
                                        </span>
                                    </span>
                                </label>
                            ))}
                        </section>
                    ))}
                    <section className="flex flex-col gap-2">
                        <h3 className="text-sm text-ink">{t("solo.config.g.tech")}</h3>
                        <label className="flex items-center justify-between gap-3">
                            <span className="tnum text-xs text-ink">{TECH_SPAWN_KEY}</span>
                            <span className="flex items-baseline gap-2">
                                <input
                                    type="number"
                                    value={cfg.techSpawnLo}
                                    step={0.5}
                                    min={0}
                                    max={20}
                                    onChange={(e) => setTechSpawn(e.target.value)}
                                    className="tnum w-24 rounded-panel border border-subtle bg-panel px-2 py-1 text-right text-xs text-ink focus:border-strong"
                                />
                                <span className="tnum w-10 text-right text-xs text-faint">
                                    {V24_CONFIG.techSpawnLo}
                                </span>
                            </span>
                        </label>
                    </section>
                    <div className="flex items-center justify-between">
                        <button
                            type="button"
                            onClick={() => onChange({ ...V24_CONFIG })}
                            className="rounded-panel border border-subtle px-3 py-1.5 text-xs text-dim hover:border-strong hover:text-ink"
                        >
                            {t("solo.config.reset")}
                        </button>
                    </div>
                    <p className="text-xs leading-5 text-faint">{t("solo.config.deviation")}</p>
                    <p className="text-xs leading-5 text-faint">{t("solo.config.rewardNote")}</p>
                </div>
            )}
        </Panel>
    );
}
