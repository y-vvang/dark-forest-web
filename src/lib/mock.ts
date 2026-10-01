/**
 * Static mock data for the HTML prototype (DESIGN.md v0.2 §11).
 *
 * NO game logic lives here or anywhere in the prototype: every number is a
 * frozen readout. Sources for opponent figures: docs/ai-opponents.md —
 * main model pool survival 0.627 is the stage_b caliber (150 eps); the 11
 * sweep-arm figures are the relative 2-worlds × 40-eps caliber and must
 * never be mixed with the 600-episode main figure (CLAUDE.md 口径纪律).
 */

/** Epistemic ladder (DESIGN.md §6) + queued ghost for the online lobby. */
export type MarkerState =
    | "self"
    | "known"
    | "observed"
    | "public"
    | "domain"
    | "queued";

export interface MockCiv {
    id: number;
    /** position on the [0,100) torus, as percentages for the DOM chart */
    x: number;
    y: number;
    state: MarkerState;
    /** intel, only meaningful for observed/public/domain */
    tech?: number;
    res?: number;
}

/** The one civilization you play. */
export const SELF: MockCiv = { id: 0, x: 31, y: 42, state: "self", tech: 7.4, res: 12.5 };

/** A weak-start variant for the demo state (spawn tech ~U[0.5,10] low end). */
export const SELF_WEAK: MockCiv = { id: 0, x: 31, y: 42, state: "self", tech: 0.8, res: 6.3 };

export const CIVS: MockCiv[] = [
    { id: 3, x: 55, y: 70, state: "observed", tech: 3.1, res: 8.4 },
    { id: 5, x: 40, y: 91, state: "known" },
    { id: 7, x: 62, y: 17, state: "known" },
    { id: 9, x: 12, y: 80, state: "public", tech: 11.2, res: 5.9 },
    { id: 11, x: 84, y: 26, state: "domain", tech: 6.0, res: 9.8 },
];

export interface MatchReadout {
    tick: number;
    tMax: number;
    alive: number;
    pool: number;
}

export const MATCH: MatchReadout = { tick: 41, tMax: 250, alive: 6, pool: 31.4 };

/** Self status shown in the two demo states. */
export const SELF_NORMAL = { tech: 7.4, res: 12.5, inDomain: false };
export const SELF_WEAK_STATS = { tech: 0.8, res: 6.3, inDomain: false };

/** End-of-match readouts for the demo overlays. */
export const END_DEAD = { cause: "starve", ticks: 111, kills: 2, loot: 13.4 } as const;
export const END_ALIVE = { survivors: 2 } as const;

/** Event kinds map 1:1 to the `log.*` dictionary keys (DESIGN.md §7). */
export type MockEventKind =
    | "contact"
    | "observed"
    | "broadcast"
    | "invaded"
    | "blocked"
    | "born"
    | "death";

export interface MockEvent {
    kind: MockEventKind;
    params: Record<string, string | number>;
}

export const EVENTS: MockEvent[] = [
    { kind: "born", params: { tick: "029", id: 11, res: "9.8" } },
    { kind: "contact", params: { tick: "036", x: 62, y: 17 } },
    { kind: "observed", params: { tick: "038", id: 3, tech: "3.1", res: "8.4" } },
    { kind: "broadcast", params: { tick: "039", id: 9 } },
    { kind: "blocked", params: { tick: "040", id: 9, take: "5.2" } },
    { kind: "invaded", params: { tick: "041", id: 7 } },
];

/** The invader currently attacking you in the demo state. */
export const INVADER = 7;

/** Preset strategies (train2.py heuristic_action, stage_b targeting). */
export type PresetKind = "learner" | "random" | "df" | "pacifist";
export const PRESETS: PresetKind[] = ["learner", "random", "df", "pacifist"];

export interface OpponentModel {
    id: string;
    meta: string;
    /** null = no-override arm; mono-readout string, not localized */
    override: string | null;
    /** relative pool survival (see file doc for the two calibers) */
    survival: number;
    main?: boolean;
}

export const MODELS: OpponentModel[] = [
    { id: "main", meta: "600ep · seed 42", override: null, survival: 0.627, main: true },
    { id: "base_control", meta: "150ep · seed 42", override: null, survival: 0.669 },
    { id: "shield025", meta: "150ep · seed 42", override: "shield_cost_frac=0.25", survival: 0.775 },
    { id: "shield075", meta: "150ep · seed 42", override: "shield_cost_frac=0.75", survival: 0.613 },
    { id: "scale005", meta: "150ep · seed 42", override: "reward_scale=0.005", survival: 0.747 },
    { id: "scale02", meta: "150ep · seed 42", override: "reward_scale=0.02", survival: 0.612 },
    { id: "budget100", meta: "150ep · seed 42", override: "budget=100", survival: 0.683 },
    { id: "budget200", meta: "150ep · seed 42", override: "budget=200", survival: 0.707 },
    { id: "lr3e4", meta: "150ep · seed 42", override: "lr=3e-4", survival: 0.618 },
    { id: "lr12e3", meta: "150ep · seed 42", override: "lr=1.2e-3", survival: 0.522 },
    { id: "gamma099", meta: "150ep · seed 42", override: "gamma=0.99", survival: 0.753 },
    { id: "gamma0999", meta: "150ep · seed 42", override: "gamma=0.999", survival: 0.58 },
];

export const ONLINE = {
    position: 3,
    tick: 87,
    tMax: 250,
    alive: 5,
    pool: 26.3,
    /** queued players, not yet born — ghost markers on the mini chart */
    ghosts: [
        { x: 52, y: 64 },
        { x: 70, y: 15 },
    ],
};

/** Env gates (config_v23.yaml) — the only "rules" the prototype may reference. */
export const GATES = {
    observeTech: 5,
    domainTech: 5,
    strikeTech: 7,
    broadcastTech: 1,
    broadcastRes: 10,
} as const;
