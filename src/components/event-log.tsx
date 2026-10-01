import { useI18n, type MessageKey } from "@/i18n";
import type { MockEvent, MockEventKind } from "@/lib/mock";

import { Panel } from "./panel";

const LOG_KEY: Record<MockEventKind, MessageKey> = {
    contact: "log.contact",
    observed: "log.observed",
    broadcast: "log.broadcast",
    invaded: "log.invaded",
    blocked: "log.blocked",
    born: "log.born",
    death: "log.death",
};

/** per-kind line coloring (DESIGN.md §10.5) */
const LOG_TONE: Record<MockEventKind, string> = {
    contact: "text-contact",
    observed: "text-contact",
    broadcast: "text-ink",
    invaded: "text-lethal",
    blocked: "text-lethal",
    born: "text-resource",
    death: "text-lethal",
};

/**
 * The event stream (DESIGN.md §10.5): `[041]` tick in dim, message colored
 * by event kind; each new line fades in once (CSS only, 120ms).
 */
export function EventLog({ events }: { events: MockEvent[] }) {
    const { t } = useI18n();

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
                            className={`anim-log-in py-1 text-base tnum ${LOG_TONE[event.kind]}`}
                        >
                            <span className="text-dim">[{event.params.tick}]</span>{" "}
                            {t(LOG_KEY[event.kind], event.params)}
                        </p>
                    ))
                )}
            </div>
        </Panel>
    );
}
