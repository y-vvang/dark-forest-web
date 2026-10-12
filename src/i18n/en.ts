/**
 * English dictionary — the single source of truth for every UI string.
 *
 * New UI text must be added to the bilingual vocabulary table in DESIGN.md §7
 * FIRST, then here (DESIGN.md §12). Keys are flat and grouped by screen:
 * nav. home. solo. match. actions. log. modal. end. online. legend. opp. aria.
 *
 * `zh.ts` implements `Dict` — a missing key there is a compile error, and at
 * runtime the resolver falls back to this file (default locale: en).
 */
export const en = {
    "site.name": "DARK FOREST",
    "nav.back": "Back",
    "nav.home": "Home",

    "home.title": "DARK FOREST",
    "home.titleAlt": "黑暗森林",
    "home.tagline":
        "You are a civilization, born as another is born. Your only goal: survive to tick 250.",
    "home.rules.title": "Rules at a glance",
    "home.rules.axioms":
        "The universe holds a fixed amount of matter (150), conserved every tick. Survival is a civilization's first need.",
    "home.rules.actions":
        "Eight actions. Tech gates unlock Observe, Black Domain and Strike. Staying Silent shrinks your detection cross-section.",
    "home.rules.economy":
        "Run out of resources and you starve. Invasion is a guaranteed kill that loots half. A shield blocks strikes from anyone below half your tech.",
    "home.mode.solo": "Play vs AI",
    "home.mode.solo.desc": "Face trained models or preset strategies from the original experiment.",
    "home.mode.online": "Queue into the shared world",
    "home.mode.online.desc": "No account needed. All online players queue into one world.",
    "home.footer": "A faithful port of the dark-forest multi-agent RL experiment (v2.4).",

    "legend.self": "You",
    "legend.self.desc": "Your civilization and its detection radius",
    "legend.known": "Known",
    "legend.known.desc": "Existence and position detected",
    "legend.observed": "Observed",
    "legend.observed.desc": "Exact tech and resource intel",
    "legend.public": "Public",
    "legend.public.desc": "Coordinates broadcast to everyone",
    "legend.domain": "Black Domain",
    "legend.domain.desc": "Sealed: undetectable, unstrikeable",
    "legend.dead": "The dead vanish from the chart and remain only in the log.",

    "solo.title": "Choose your opponents",
    "solo.opponents": "Choose your opponents",
    "solo.selected": "{n} selected",
    "solo.pool": "Pool",
    "solo.pool.desc": "36 slots. You take one seat; the rest fill with your chosen opponents.",
    "solo.start": "Start match",
    "solo.disclosure":
        "Action profiles are from a 150-episode mixed pool (single training seed) — indicative only.",
    "solo.loading": "Loading opponent models…",

    "solo.config": "World constants",
    "solo.config.g.clock": "Clock",
    "solo.config.g.detect": "Detection",
    "solo.config.g.econ": "Economy",
    "solo.config.g.tech": "Technology",
    "solo.config.g.force": "Force",
    "solo.config.g.gates": "Gates",
    "solo.config.g.reward": "Rewards",
    "solo.config.armPresets": "Reward-arm presets",
    "solo.config.default": "Default",
    "solo.config.reset": "Reset to defaults",
    "solo.config.deviation":
        "Defaults mirror the experiment; any change is a declared deviation.",
    "solo.config.rewardNote":
        "Reward settings change only your reward numbers — opponent models are frozen policies.",
    "solo.config.dirty": "{n} modified",

    "opp.random.name": "Random",
    "opp.random.desc": "Picks uniformly among legal actions every tick.",
    "opp.df.name": "Textbook Dark Forest",
    "opp.df.desc":
        "Strikes whenever legal, always at the strongest known civ — 14.5 kills per episode, zero loot.",
    "opp.pacifist.name": "Pacifist",
    "opp.pacifist.desc": "Only develops or stays silent; never attacks.",
    "opp.arm.a_classic.desc":
        "Mostly silent development (silent 0.62 · develop 0.36), occasional invasion harvesting",
    "opp.arm.b_terminal.desc":
        "Nearly always silent (0.82) — the only signal is death itself",
    "opp.arm.c_res.desc":
        "Plunderer: constant invasion harvesting (11.1 per episode), lives on loot",
    "opp.arm.d_malintent.desc":
        "Info-war: reveals others' coordinates (0.18) + steady invasions — the borrowed knife",

    "match.tick": "Tick",
    "match.alive": "Alive",
    "match.pool": "Free pool",
    "match.self": "Your civilization",
    "match.tech": "Tech",
    "match.res": "Resources",
    "match.domainNote": "Black domain active · irreversible",
    "match.actions": "Actions",
    "match.log": "Event log",
    "match.log.empty": "No known civilizations — stay silent and wait for signals.",
    "match.target": "Select target — click a civilization on the chart",
    "match.target.cancel": "Cancel",
    "match.target.skip": "Skip targeting — take the nearest known",
    "match.next": "Execute · next tick",
    "match.birthSelf": "Your civilization is born",
    "match.waitBirth": "Waiting to be born — the world runs on",

    "match.reward": "Reward",
    "match.reward.total": "Total",
    "match.reward.last": "This tick",
    "match.reward.stipend": "Development stipend",
    "match.reward.res": "Resource stipend",
    "match.reward.bounty": "Attack bounty",
    "match.reward.bd": "Domain penalty",
    "match.reward.death": "Death penalty",
    "match.reward.arms": "Reward-arm comparison",
    "match.reward.note": "Reward settings do not affect opponent models.",
    "match.advisor": "Advice",
    "match.advisor.title": "The four arms' choices at this step",

    "actions.silent": "Silent",
    "actions.silent.sub": "Detection cross-section ×0.25",
    "actions.develop": "Develop",
    "actions.develop.sub": "Tech +0.05 per tick",
    "actions.broadcast": "Broadcast",
    "actions.broadcast.sub": "Reveals your coordinates to all next tick",
    "actions.reveal": "Reveal",
    "actions.reveal.sub": "Publish a known target's coordinates; you stay hidden",
    "actions.observe": "Observe",
    "actions.observe.sub":
        "Intel on the chosen (or nearest known) civ; a random civ detects you next tick",
    "actions.domain": "Black Domain",
    "actions.domain.sub": "Irreversible sanctuary; growth ×0.2, explosion ×0.1",
    "actions.strike": "Strike",
    "actions.strike.sub": "Explicit target, or nearest known",
    "actions.invade": "Invade",
    "actions.invade.sub": "Guaranteed kill, loot half; target can counter",
    "actions.disabled.tech": "Tech too low (need >{v})",
    "actions.disabled.broadcast": "Need tech >1 or resources >10",
    "actions.disabled.noKnown": "No known civilizations",

    "log.contact": "Unknown signal detected ({x},{y})",
    "log.observed": "Observed: #{id} tech {tech} · res {res}",
    "log.broadcast": "#{id} broadcast its coordinates",
    "log.invaded": "#{id} is invading you — counter window open",
    "log.ownStrikeBlocked": "Your strike was blocked by a shield (#{id} shed {take})",
    "log.ownStrikeHit": "Your strike hit #{id}",
    "log.ownStrikeMiss": "Your strike missed #{id}",
    "log.ownInvade": "You invaded #{id}, looted {loot}",
    "log.ownBroadcast": "You broadcast — public to all next tick",
    "log.ownReveal": "You revealed #{id} — public to all next tick",
    "log.born": "A new civilization is born",
    "log.dark": "A known contact went dark",
    "log.death": "You are dead. Cause: {cause}. Survived {ticks} ticks.",

    "cause.starve": "starvation",
    "cause.strike": "strike",
    "cause.invade": "invasion",
    "cause.mutual": "mutual destruction",

    "modal.title": "INVASION ALERT",
    "modal.body": "#{id} is invading you · counter window",
    "modal.counter": "Counter-invade",
    "modal.counter.sub": "Mutual destruction — you both die",
    "modal.domain": "Declare Black Domain",
    "modal.domain.sub": "Cancels the invasion now; irreversible",
    "modal.cancel": "Cancel",

    "end.dead.title": "You are dead",
    "end.dead.cause": "Cause: {cause}",
    "end.dead.survived": "Survived {ticks} ticks",
    "end.stats": "Kills {kills} · Loot {loot}",
    "end.alive.title": "You survived to the end",
    "end.alive.body": "{t} ticks · {n} civilizations alive at the end",
    "end.unborn.title": "You were never born",
    "end.unborn.body": "The world fell silent before your birth.",
    "end.advisorUsed": "Model advice was used this run",
    "end.again": "Play again",
    "end.home": "Return home",

    "online.title": "Online queue",
    "online.position": "Queue position #{n}",
    "online.noAccount": "No account needed · queue to enter",
    "online.world": "World readout",
    "online.note": "The pool births a civilization as soon as it can afford one — you take the next birth.",
    "online.cancel": "Leave queue",
    "online.ghost": "Queued (not yet born)",
    "online.waiting": "Waiting",

    "aria.civ": "Civ #{id} · {state} · tech {tech} · res {res}",
    "aria.civ.plain": "Civ #{id} · {state}",

    "label.sealed": "sealed",

    "popover.noIntel": "No exact intel",
} as const;

export type MessageKey = keyof typeof en;
export type Dict = Record<MessageKey, string>;
export type TParams = Record<string, string | number>;
