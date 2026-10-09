import { useCallback, useEffect, useRef, useState } from "react";

const VIEWPORT_PAD = 8;
const ANCHOR_GAP = 4;

/**
 * Card-style overflow guard (validated 2026-10-01): the panel is anchored by
 * CSS (wrapper-relative baseline, or native anchor positioning with
 * try-fallbacks); inject a `translate` only when the rendered panel still
 * leaks past the viewport. Usually a no-op in anchor-positioning browsers.
 */
export function clampPopoverIntoViewport(pop: HTMLElement) {
    pop.style.translate = "";
    const rect = pop.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth; // replace `window.innerwidth` (fixed 2026-10-9)
    let shift = 0;
    if (rect.right > viewportWidth - VIEWPORT_PAD) {
        shift = viewportWidth - VIEWPORT_PAD - rect.width - rect.left;
    } else if (rect.left < VIEWPORT_PAD) {
        shift = VIEWPORT_PAD - rect.left;
    }
    if (shift !== 0) pop.style.translate = `${shift}px 0`;
}

/**
 * Marker-style placement: fixed coordinates computed from the anchor rect on
 * every open. Markers live inside the chart's overflow-hidden container, so
 * CSS wrapper-relative anchoring would clip; fixed coordinates escape all
 * clipping. Below the anchor, flipped above when it would leak; clamped
 * horizontally into the viewport.
 */
export function placeFixedPopover(
    pop: HTMLElement,
    anchor: HTMLElement | null,
) {
    if (anchor === null) return;
    pop.style.translate = "";
    const anchorRect = anchor.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = anchorRect.left;
    if (left + popRect.width > viewportWidth - VIEWPORT_PAD) {
        left = Math.max(VIEWPORT_PAD, viewportWidth - VIEWPORT_PAD - popRect.width);
    }
    if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;

    let top = anchorRect.bottom + ANCHOR_GAP;
    if (top + popRect.height > viewportHeight - VIEWPORT_PAD) {
        top = anchorRect.top - popRect.height - ANCHOR_GAP;
    }
    if (top < VIEWPORT_PAD) top = VIEWPORT_PAD;

    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
}

export type PopoverOnOpen = (pop: HTMLElement, anchor: HTMLButtonElement | null) => void;

/**
 * Shared "detail popover" mechanics (the pattern the user validated on
 * 2026-10-01, unified here so every detail surface behaves identically):
 *
 * - hover / keyboard focus → unpinned preview (hides on leave / blur)
 * - `togglePinned()` → click-pin / unpin; the component decides what a click
 *   means besides pinning
 * - the panel carries `popover="auto"` ⇒ Escape + light dismiss, and only
 *   ONE popover open document-wide (native behavior; the
 *   `@oddbird/popover-polyfill` mirrors it)
 * - `onOpen` runs whenever the panel opens — that is where the component
 *   positions it (clampPopoverIntoViewport / placeFixedPopover)
 *
 * All animation stays CSS-only: this hook only toggles popover state.
 */
export function useAutoPopover(onOpen?: PopoverOnOpen) {
    const anchorRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const [pinned, setPinned] = useState(false);

    const isOpen = useCallback(
        () => popoverRef.current?.matches(":popover-open") === true,
        [],
    );

    const show = useCallback(() => {
        const pop = popoverRef.current;
        if (pop !== null && !isOpen()) pop.showPopover();
    }, [isOpen]);

    const hide = useCallback(() => {
        const pop = popoverRef.current;
        if (pop !== null && isOpen()) pop.hidePopover();
    }, [isOpen]);

    const togglePinned = useCallback(() => {
        if (pinned) {
            hide();
            setPinned(false);
        } else {
            show();
            setPinned(true);
        }
    }, [hide, pinned, show]);

    // sync `pinned` with every close path (Escape, light dismiss, another
    // popover's auto-close) and hand the panel to `onOpen` on every open.
    useEffect(() => {
        const pop = popoverRef.current;
        if (pop === null) return;
        const onToggle = (event: ToggleEvent) => {
            if (event.newState === "open") {
                onOpen?.(pop, anchorRef.current);
            } else {
                pop.style.translate = "";
                pop.style.left = "";
                pop.style.top = "";
                setPinned(false);
            }
        };
        pop.addEventListener("toggle", onToggle);
        return () => pop.removeEventListener("toggle", onToggle);
    }, [onOpen]);

    const hoverHandlers = {
        onMouseEnter: show,
        onMouseLeave: () => {
            if (!pinned) hide();
        },
        onFocus: show,
        onBlur: () => {
            if (!pinned) hide();
        },
    };

    return { anchorRef, popoverRef, pinned, show, hide, togglePinned, hoverHandlers };
}
