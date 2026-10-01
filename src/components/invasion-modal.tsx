import { useI18n } from "@/i18n";

/**
 * The invasion counter-window (DESIGN.md §10.7) — the single red moment of
 * the whole design: lethal border, the one allowed glow, role=alert.
 * Solo mode is untimed (DESIGN.md §13: turn-based pause, no countdown bar);
 * online mode passes `timed` with the remaining tick seconds.
 */
export function InvasionModal({
    invaderId,
    timed = false,
    remainingSeconds,
    onCounter,
    onDomain,
    onCancel,
}: {
    invaderId: number;
    /** online only: render the countdown bar (§13) */
    timed?: boolean;
    /** drives --dur-counter for the CSS countdown animation */
    remainingSeconds?: number;
    onCounter: () => void;
    onDomain: () => void;
    onCancel: () => void;
}) {
    const { t } = useI18n();

    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-void/80 p-4">
            <div
                role="alert"
                className="glow-lethal w-full max-w-md rounded-panel border border-lethal bg-panel p-6"
            >
                <h2 className="text-xl text-lethal">{t("modal.title")}</h2>
                <p className="tnum mt-1 text-base text-ink">
                    {t("modal.body", { id: invaderId })}
                </p>

                {timed && (
                    <div className="mt-4 h-1 bg-raised" aria-hidden>
                        <div
                            className="anim-countdown h-full bg-lethal"
                            style={{ "--dur-counter": `${remainingSeconds ?? 20}s` } as React.CSSProperties}
                        />
                    </div>
                )}

                <div className="mt-6 grid gap-2">
                    <button
                        type="button"
                        autoFocus
                        onClick={onCounter}
                        className="flex min-h-16 flex-col items-start justify-center rounded-panel border border-lethal bg-lethal px-3 py-2 text-left font-bold text-panel"
                    >
                        <span>{t("modal.counter")}</span>
                        <span className="text-xs font-normal opacity-80">
                            {t("modal.counter.sub")}
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={onDomain}
                        className="flex min-h-16 flex-col items-start justify-center rounded-panel border border-domain bg-panel px-3 py-2 text-left font-bold text-domain"
                    >
                        <span>{t("modal.domain")}</span>
                        <span className="text-xs font-normal text-dim">
                            {t("modal.domain.sub")}
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-panel border border-subtle px-3 py-2 text-base text-dim hover:border-strong hover:text-ink"
                    >
                        {t("modal.cancel")}
                    </button>
                </div>
            </div>
        </div>
    );
}
