import type { ReactNode } from "react";

/**
 * Panel container (DESIGN.md §10.2): the one surface style of this console —
 * border-brightness elevation, no shadows. `tone` picks the border deterministically.
 */
export type PanelTone = "default" | "active" | "domain";

const TONE_BORDER: Record<PanelTone, string> = {
    default: "border-subtle",
    active: "border-strong",
    domain: "border-domain",
};

export function Panel({
    title,
    meta,
    tone = "default",
    className = "",
    children,
}: {
    title?: ReactNode;
    meta?: ReactNode;
    tone?: PanelTone;
    className?: string;
    children: ReactNode;
}) {
    return (
        <section
            className={`rounded-panel border bg-panel p-4 ${TONE_BORDER[tone]} ${className}`}
        >
            {(title !== undefined || meta !== undefined) && (
                <header className="mb-3 flex items-baseline justify-between gap-4">
                    {title !== undefined && <h2 className="text-lg text-ink">{title}</h2>}
                    {meta !== undefined && (
                        <span className="tnum text-xs text-dim">{meta}</span>
                    )}
                </header>
            )}
            {children}
        </section>
    );
}
