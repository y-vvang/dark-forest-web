import type { CSSProperties, ReactNode } from "react";

import {
    clampPopoverIntoViewport,
    useAutoPopover,
} from "./use-auto-popover";

/**
 * Selectable opponent card (DESIGN.md §10.10) with a native-Popover detail
 * panel. The full info used to overflow the grid card, so the card keeps the
 * compact readouts (title / meta / stat) and the prose description lives in
 * the popover.
 *
 * Interaction contract (shared with every other detail surface via
 * useAutoPopover): hover/focus → unpinned preview; click → select the
 * opponent AND pin/unpin the popover; `popover="auto"` ⇒ Escape + light
 * dismiss + only one popover open document-wide.
 *
 * Positioning lives in `.opp-popover` (globals.css): wrapper-relative
 * absolute baseline, upgraded to CSS anchor positioning with
 * position-try-fallbacks where supported, plus the translate clamp on open
 * (clampPopoverIntoViewport). The polyfill itself is imported once in
 * client-layout.tsx.
 */
export function OpponentCard({
    value,
    selected,
    onSelect,
    title,
    meta,
    desc,
    stat,
}: {
    /** selection payload (preset kind or model id) */
    value: string;
    selected: boolean;
    onSelect: (value: string) => void;
    title: ReactNode;
    meta?: ReactNode;
    desc?: ReactNode;
    stat?: ReactNode;
}) {
    const { anchorRef, popoverRef, togglePinned, hoverHandlers } =
        useAutoPopover(clampPopoverIntoViewport);

    const anchorName = `--opp-${value}`;

    return (
        <div className="relative w-full">
            <button
                ref={anchorRef}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                    onSelect(value);
                    togglePinned();
                }}
                {...hoverHandlers}
                style={{ anchorName } as CSSProperties}
                className={`flex min-h-20 w-full flex-col items-start justify-center gap-1 rounded-panel border p-3 text-left ${
                    selected
                        ? "border-strong bg-raised"
                        : "border-subtle bg-panel hover:border-strong hover:bg-raised"
                }`}
            >
                <span className="flex w-full items-baseline justify-between gap-2">
                    <span className="text-sm font-bold text-ink">{title}</span>
                    {meta !== undefined && <span className="tnum text-xs text-dim">{meta}</span>}
                </span>
                {stat !== undefined && <span className="tnum text-xs text-ink">{stat}</span>}
            </button>

            <div
                ref={popoverRef}
                popover="auto"
                style={{ positionAnchor: anchorName } as CSSProperties}
                className="opp-popover rounded-panel border border-subtle bg-panel p-4"
            >
                <p className="text-sm font-bold text-ink">{title}</p>
                {meta !== undefined && <p className="tnum mt-1 text-xs text-dim">{meta}</p>}
                {desc !== undefined && (
                    <p className="mt-2 font-sans text-sm leading-6 text-dim">{desc}</p>
                )}
                {stat !== undefined && <p className="tnum mt-2 text-xs text-ink">{stat}</p>}
            </div>
        </div>
    );
}
