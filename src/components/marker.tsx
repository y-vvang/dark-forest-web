import { useI18n, type MessageKey } from "@/i18n";
import type { MarkerView } from "@/lib/solo/view";

import { placeFixedPopover, useAutoPopover } from "./use-auto-popover";

/** marker 的认知状态（视图模型；/online 的幽灵与 legend 复用同一形状） */
export type MarkerState = MarkerView["state"];

/** 兼容别名：组件只依赖形状，mock 与 view 均可喂入 */
export type CivLike = {
    id: number;
    x: number;
    y: number;
    state: MarkerState;
    tech?: number;
    res?: number;
};

/** epistemic state → legend key (typed, no dynamic template keys) */
const STATE_KEY = {
    self: "legend.self",
    known: "legend.known",
    observed: "legend.observed",
    public: "legend.public",
    domain: "legend.domain",
    queued: "online.ghost",
} as const satisfies Record<MarkerState, MessageKey>;

/**
 * One civilization on the chart — the epistemic ladder made visible
 * (DESIGN.md §6 / §10.6). A real <button> so chart markers stay
 * keyboard-reachable; decorative in the legend.
 *
 * Detail popover (2026-10-01, same treatment as the opponent cards): the
 * always-on data label is gone — with many known civilizations the labels
 * would collide; state stays glanceable through the marker's shape and
 * color, while the numbers live in a hover/click popover:
 * - hover / keyboard focus → unpinned preview
 * - click → pin/unpin the popover, or pick this civ as a strike/invade
 *   target when `selectable` (target mode)
 * - the panel is placed with fixed coordinates (placeFixedPopover) because
 *   markers sit inside the chart's overflow-hidden container
 */
export function Marker({
    civ,
    ping = false,
    selectable = false,
    onPick,
    decorative = false,
}: {
    civ: CivLike;
    /** play the new-contact ping once (CSS keyframe) */
    ping?: boolean;
    /** target-selection mode: clicking picks this civ instead of pinning */
    selectable?: boolean;
    onPick?: (civ: CivLike) => void;
    /** legend/lobby specimens: not focusable, hidden from the a11y tree */
    decorative?: boolean;
}) {
    const { t } = useI18n();
    const { anchorRef, popoverRef, pinned, hide, togglePinned, hoverHandlers } =
        useAutoPopover(placeFixedPopover);

    // direct check so TS narrows the intel numbers
    const intel =
        civ.tech !== undefined && civ.res !== undefined
            ? { tech: civ.tech, res: civ.res }
            : null;

    const stateName = t(STATE_KEY[civ.state]);
    const aria =
        civ.state === "self" || intel !== null
            ? t("aria.civ", {
                  id: civ.id,
                  state: stateName,
                  tech: intel?.tech ?? 0,
                  res: intel?.res ?? 0,
              })
            : t("aria.civ.plain", { id: civ.id, state: stateName });

    const big = civ.state === "self" || civ.state === "domain";

    const shape = (
        <span
            className={`relative block ${big ? "size-2" : "size-1.5"} ${
                civ.state === "self"
                    ? "glow-self rounded-full bg-self"
                    : civ.state === "known"
                      ? "rounded-full border-2 border-contact/70 bg-transparent"
                      : civ.state === "observed"
                        ? "rounded-full bg-contact"
                        : civ.state === "public"
                          ? "rounded-full bg-contact"
                          : civ.state === "domain"
                            ? "rounded-full bg-domain"
                            : "rounded-full border border-dashed border-faint bg-transparent"
            }`}
        >
            {/* broadcast white ring / domain dark core */}
            {civ.state === "public" && (
                <span className="absolute inset-[-3px] rounded-full border border-flash" />
            )}
            {civ.state === "domain" && (
                <span className="absolute inset-[3px] rounded-full bg-void" />
            )}
        </span>
    );

    const inner = (
        <>
            {ping && (
                <span
                    aria-hidden
                    className="anim-ping pointer-events-none absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-contact"
                />
            )}
            {shape}
        </>
    );

    const position = {
        left: `${civ.x}%`,
        top: `${civ.y}%`,
    };

    if (decorative) {
        return (
            <span
                aria-hidden
                className="absolute -translate-x-1/2 -translate-y-1/2 p-1"
                style={position}
            >
                {inner}
            </span>
        );
    }

    const dataColor =
        civ.state === "self"
            ? "text-self"
            : civ.state === "domain"
              ? "text-domain"
              : "text-contact";

    return (
        <>
            <button
                ref={anchorRef}
                type="button"
                aria-label={aria}
                aria-expanded={pinned}
                {...hoverHandlers}
                onClick={() => {
                    if (selectable) {
                        hide();
                        onPick?.(civ);
                    } else {
                        togglePinned();
                    }
                }}
                className={`group absolute -translate-x-1/2 -translate-y-1/2 p-1 ${
                    selectable ? "cursor-pointer" : "cursor-default"
                }`}
                style={position}
            >
                {selectable && (
                    <span className="absolute inset-0 rounded-full border border-lethal opacity-0 group-hover:opacity-100" />
                )}
                {inner}
            </button>

            <div
                ref={popoverRef}
                popover="auto"
                className="marker-popover rounded-panel border border-subtle bg-panel p-3"
            >
                <p className="tnum text-xs text-dim">{`#${civ.id} · ${stateName}`}</p>
                {civ.state !== "queued" &&
                    (intel !== null ? (
                        <p className={`tnum mt-1 text-sm ${dataColor}`}>
                            {t("match.tech")} {intel.tech.toFixed(1)}
                            {" · "}
                            {t("match.res")} {intel.res.toFixed(1)}
                        </p>
                    ) : (
                        <p className="mt-1 text-sm text-dim">{t("popover.noIntel")}</p>
                    ))}
                {civ.state === "domain" && (
                    <p className="mt-1 text-xs text-domain">{t("label.sealed")}</p>
                )}
            </div>
        </>
    );
}
