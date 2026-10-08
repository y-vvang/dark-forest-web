import { useI18n, type MessageKey } from "@/i18n";
import type { LogEntryView } from "@/lib/solo/view";

import { Panel } from "./panel";

/** per-key line coloring (DESIGN.md §10.5) */
const LOG_TONE: Partial<Record<string, string>> = {
    "log.contact": "text-contact",
    "log.observed": "text-contact",
    "log.broadcast": "text-ink",
    "log.invaded": "text-lethal",
    "log.ownStrikeBlocked": "text-lethal",
    "log.ownStrikeHit": "text-lethal",
    "log.ownStrikeMiss": "text-lethal",
    "log.ownInvade": "text-lethal",
    "log.ownBroadcast": "text-ink",
    "log.born": "text-resource",
    "log.dark": "text-dim",
    "log.death": "text-lethal",
    "match.birthSelf": "text-self",
    "match.waitBirth": "text-dim",
};

const CAUSE_KEYS = new Set<MessageKey>([
    "cause.starve",
    "cause.strike",
    "cause.invade",
    "cause.mutual",
]);

/**
 * The event stream (DESIGN.md §10.5): `[041]` tick in dim, message colored
 * by event kind; each new line fades in once (CSS only, 120ms).
 * Perception-filtered entries (ViewTracker; docs/game-mechanics.md §7).
 * `params.cause` carries a cause.* key name — translated here (nested).
 */
export function EventLog({ events }: { events: LogEntryView[] }) {
    const { t } = useI18n();

    const translate = (entry: LogEntryView) => {
        if (entry.params?.cause !== undefined) {
            const causeKey = entry.params.cause as MessageKey;
            const rest = { ...entry.params } as Record<string, string | number>;
            delete rest.cause;
            if (CAUSE_KEYS.has(causeKey))
                return t(entry.key, { ...rest, cause: t(causeKey) });
            return t(entry.key, rest);
        }
        return t(entry.key, entry.params);
    };

    return (
        <Panel title={t("match.log")}>
            <div
                role="log"
                aria-live="polite"
                className="scroll-quiet max-h-40 overflow-y-auto pr-1"
            >
                {events.length === 0 ? (
                    <p className="text-sm text-dim">{t("match.log.empty")}</p>
                ) : (
                    events.map((event, index) => (
                        <p
                            key={index}
                            className={`anim-log-in py-1 text-base tnum ${
                                LOG_TONE[event.key] ?? "text-ink"
                            }`}
                        >
                            <span className="text-dim">
                                [{String(event.tick).padStart(3, "0")}]
                            </span>{" "}
                            {translate(event)}
                        </p>
                    ))
                )}
            </div>
        </Panel>
    );
}
