import { useI18n } from "@/i18n";

import { Panel } from "./panel";

/**
 * Your civilization's readouts (DESIGN.md §10.3): tech bar on a 0–10 domain
 * with lit gate ticks at 5.0/7.0, resource bar on 0–20 (res_max).
 * Inside a black domain the panel border turns domain-violet.
 * Gates/resMax now arrive as props——环境常量可配置（2026-10-10）后不再从
 * V24_CONFIG 静态读取（res 域仍以默认 resMax 显示，环境语义不变）。
 */
export function StatusPanel({
    tech,
    res,
    gates,
    resMax,
    inDomain = false,
}: {
    tech: number;
    res: number;
    gates: [number, number];
    resMax: number;
    inDomain?: boolean;
}) {
    const { t } = useI18n();

    return (
        <Panel
            title={t("match.self")}
            meta={inDomain ? t("match.domainNote") : undefined}
            tone={inDomain ? "domain" : "default"}
        >
            <div className="flex flex-col gap-4">
                <Readout
                    label={t("match.tech")}
                    value={tech.toFixed(1)}
                    pct={(Math.min(tech, 10) / 10) * 100}
                    bar="bg-self"
                    gates={gates}
                    gateDomain={10}
                    gateValue={tech}
                />
                <Readout
                    label={t("match.res")}
                    value={res.toFixed(1)}
                    pct={(Math.min(res, resMax) / resMax) * 100}
                    bar="bg-resource"
                />
            </div>
        </Panel>
    );
}

function Readout({
    label,
    value,
    pct,
    bar,
    gates = [],
    gateDomain = 10,
    gateValue = 0,
}: {
    label: string;
    value: string;
    /** bar width in %, caller clamps to the bar domain */
    pct: number;
    bar: string;
    /** gate thresholds to draw as 1px ticks (tech bar only) */
    gates?: readonly number[];
    /** the bar domain gates are measured against */
    gateDomain?: number;
    /** current value: a passed gate lights solid, an unpassed stays dim */
    gateValue?: number;
}) {
    return (
        <div>
            <div className="flex items-baseline justify-between">
                <span className="text-sm text-dim">{label}</span>
                <span className="tnum text-base text-ink">{value}</span>
            </div>
            <div className="relative mt-1 h-2 bg-raised">
                <div
                    className={`h-full transition-[width] duration-[240ms] ${bar}`}
                    style={{ width: `${pct}%` }}
                />
                {/* 门槛 > 条域（配置后可达 0-20）钳在右端——仍在条内可读（评审修复 2026-10-12） */}
                {gates.map((gate) => (
                    <span
                        key={gate}
                        className={`absolute inset-y-0 w-px ${
                            gateValue > gate ? "bg-self" : "bg-self/60"
                        }`}
                        style={{ left: `${Math.min(100, (gate / gateDomain) * 100)}%` }}
                    />
                ))}
            </div>
        </div>
    );
}
