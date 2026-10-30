import { createGarage, MOTION, REFERENCE, type Twist } from "../pages/garage";

export const FRAMES = 600;
export const FIELDS = [
	"height",
	"motion",
	"beamBroken",
	"reversals",
	"blocked",
] as const;
export type Field = (typeof FIELDS)[number];
const WIDTH = FIELDS.length;

export type Event = { readonly frame: number; readonly kind: "remote" | "cat" };
export type Journal = {
	readonly length: number;
	readonly events: readonly Event[];
};
export type Trace = Float32Array;

export type Mutant = {
	readonly id: string;
	readonly label: string;
	readonly cell: string;
	readonly twist: Partial<Twist>;
	readonly kind: "compare" | "number" | "select" | "logic";
};

export const MUTANTS: readonly Mutant[] = [
	{
		id: "blind",
		label: "cat threshold 0.5 → 1.5",
		cell: "catLevel",
		twist: { catLevel: 1.5 },
		kind: "number",
	},
	{
		id: "low-beam",
		label: "beam zone ×4 → ×0.5",
		cell: "beamZone",
		twist: { beamZone: 0.5 },
		kind: "number",
	},
	{
		id: "freeze",
		label: "reverse to opening → stopped",
		cell: "reverseTo",
		twist: { reverseTo: MOTION.stopped },
		kind: "select",
	},
	{
		id: "order",
		label: "swap select order: end beats beam",
		cell: "beamFirst",
		twist: { beamFirst: true },
		kind: "select",
	},
	{
		id: "fast",
		label: "speed 0.35 → 0.36",
		cell: "speed",
		twist: { speed: 0.36 },
		kind: "number",
	},
	{
		id: "band",
		label: "rest band 0.001 → 0.0005",
		cell: "restBand",
		twist: { restBand: 0.0005 },
		kind: "number",
	},
	{
		id: "short",
		label: "end snap 0.999 → 0.9",
		cell: "endSnap",
		twist: { endSnap: 0.9 },
		kind: "compare",
	},
	{
		id: "bounce",
		label: "press-while-moving → reverse",
		cell: "pressStops",
		twist: { pressStops: false },
		kind: "logic",
	},
	{
		id: "same-way",
		label: "opposite = 3 − dir → 2 − dir",
		cell: "oppositeSum",
		twist: { oppositeSum: 2 },
		kind: "number",
	},
	{
		id: "half-memory",
		label: "remember dir: opening only",
		cell: "dirFromOpeningOnly",
		twist: { dirFromOpeningOnly: true },
		kind: "logic",
	},
	{
		id: "double",
		label: "reversal count +1 → +2",
		cell: "countStep",
		twist: { countStep: 2 },
		kind: "number",
	},
	{
		id: "twin",
		label: "cat threshold 0.5 → 0.9",
		cell: "catLevel",
		twist: { catLevel: 0.9 },
		kind: "number",
	},
];

export const twistOf = (mutant: Mutant | null): Twist => ({
	...REFERENCE,
	...(mutant?.twist ?? {}),
});

export function run(twist: Twist, journal: Journal): Trace {
	const ticker = createGarage(twist);
	const out = new Float32Array(journal.length * WIDTH);
	const byFrame = new Map<number, Event[]>();
	for (const event of journal.events)
		byFrame.set(event.frame, [...(byFrame.get(event.frame) ?? []), event]);
	let cat = 0;
	for (let f = 0; f < journal.length; f += 1) {
		for (const event of byFrame.get(f) ?? []) {
			if (event.kind === "remote") ticker.press("remote");
			else cat = 1 - cat;
		}
		ticker.set("blocked", cat);
		const frame = ticker.step();
		out.set(
			[
				frame.height,
				frame.motion,
				frame.beamBroken,
				frame.reversals,
				frame.blocked,
			],
			f * WIDTH,
		);
	}
	return out;
}

export const at = (trace: Trace, frame: number, field: Field) =>
	trace[frame * WIDTH + FIELDS.indexOf(field)] ?? Number.NaN;
export const framesOf = (trace: Trace) => trace.length / WIDTH;

export function seeded(seed: number) {
	let s = seed >>> 0 || 1;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

export function randomJournal(random: () => number): Journal {
	const events: Event[] = [];
	for (let f = 0; f < FRAMES; f += 1) {
		if (random() < 1 / 45) events.push({ frame: f, kind: "remote" });
		if (random() < 1 / 110) events.push({ frame: f, kind: "cat" });
	}
	return { length: FRAMES, events };
}

export const journals = (seed: number, count: number) => {
	const random = seeded(seed);
	return Array.from({ length: count }, () => randomJournal(random));
};

export type Property = {
	readonly id: string;
	readonly label: string;
	readonly watches: readonly Field[];
	readonly fails: (t: Trace, j: Journal) => number;
};

const each = (t: Trace, from: number, test: (f: number) => boolean) => {
	for (let f = from; f < framesOf(t); f += 1) if (test(f)) return f;
	return -1;
};

const remotesOf = (j: Journal) =>
	new Set(j.events.filter((e) => e.kind === "remote").map((e) => e.frame));

const lastMove = (t: Trace, before: number) => {
	for (let f = before - 1; f >= 0; f -= 1)
		if (at(t, f, "motion") !== MOTION.stopped) return at(t, f, "motion");
	return MOTION.stopped;
};

export const PROPERTIES: readonly Property[] = [
	{
		id: "no-crush",
		label:
			"with a cat in the doorway, the door never sinks two frames in a row below 55%",
		watches: ["height"],
		fails: (t) =>
			each(
				t,
				2,
				(f) =>
					[f, f - 1, f - 2].every((k) => at(t, k, "blocked") === 1) &&
					at(t, f, "height") < at(t, f - 1, "height") &&
					at(t, f - 1, "height") < at(t, f - 2, "height") &&
					at(t, f, "height") < 0.55,
			),
	},
	{
		id: "retreat",
		label:
			"a broken beam sends the door up next frame (unless you press the remote)",
		watches: ["motion"],
		fails: (t, j) => {
			const presses = remotesOf(j);
			return each(
				t,
				0,
				(f) =>
					at(t, f, "beamBroken") === 1 &&
					f + 1 < framesOf(t) &&
					!presses.has(f + 1) &&
					at(t, f + 1, "motion") !== MOTION.opening &&
					at(t, f + 1, "beamBroken") !== 1,
			);
		},
	},
	{
		id: "remote-stops",
		label: "remote on a moving door, no cat → it stops",
		watches: ["motion"],
		fails: (t, j) => {
			const presses = remotesOf(j);
			return each(
				t,
				1,
				(f) =>
					presses.has(f) &&
					at(t, f - 1, "motion") !== MOTION.stopped &&
					at(t, f, "blocked") === 0 &&
					at(t, f, "motion") !== MOTION.stopped,
			);
		},
	},
	{
		id: "full-travel",
		label: "a run that ends by itself ends fully open or shut",
		watches: ["height"],
		fails: (t, j) => {
			const presses = remotesOf(j);
			return each(t, 1, (f) => {
				const h = at(t, f, "height");
				return (
					at(t, f - 1, "motion") !== MOTION.stopped &&
					at(t, f, "motion") === MOTION.stopped &&
					!presses.has(f) &&
					h > 0 &&
					h < 1
				);
			});
		},
	},
	{
		id: "resume",
		label: "restart from a mid stop goes the other way",
		watches: ["motion"],
		fails: (t) =>
			each(t, 1, (f) => {
				const h = at(t, f - 1, "height");
				return (
					at(t, f - 1, "motion") === MOTION.stopped &&
					at(t, f, "motion") !== MOTION.stopped &&
					h > 0.01 &&
					h < 0.99 &&
					at(t, f, "beamBroken") !== 1 &&
					at(t, f, "motion") === lastMove(t, f - 1)
				);
			}),
	},
	{
		id: "strict-crush",
		label:
			"too strict: with a cat in the doorway, the door never moves down at all",
		watches: ["height"],
		fails: (t) =>
			each(
				t,
				1,
				(f) =>
					at(t, f, "blocked") === 1 &&
					at(t, f - 1, "blocked") === 1 &&
					at(t, f, "height") < at(t, f - 1, "height"),
			),
	},
	{
		id: "counter",
		label: "safety counter = number of beam breaks",
		watches: ["reversals"],
		fails: (t) => {
			let breaks = 0;
			return each(t, 0, (f) => {
				const wrong = at(t, f, "reversals") !== breaks;
				breaks += at(t, f, "beamBroken");
				return wrong;
			});
		},
	},
];

export type Verdict = {
	readonly property: string;
	readonly journal: number;
	readonly frame: number;
};

export function hunt(
	mutant: Mutant,
	chosen: readonly Property[],
	pool: readonly Journal[],
): Verdict | null {
	const twist = twistOf(mutant);
	for (let j = 0; j < pool.length; j += 1) {
		const journal = pool[j] as Journal;
		const trace = run(twist, journal);
		for (const property of chosen) {
			const frame = property.fails(trace, journal);
			if (frame >= 0) return { property: property.id, journal: j, frame };
		}
	}
	return null;
}

export type Difference = {
	readonly journal: number;
	readonly frame: number;
	readonly outputs: readonly {
		field: Field;
		expected: number;
		actual: number;
	}[];
};

export function divergence(a: Trace, b: Trace, journal = 0): Difference | null {
	for (let f = 0; f < framesOf(a); f += 1) {
		const outputs = FIELDS.filter(
			(field) => !Object.is(at(a, f, field), at(b, f, field)),
		).map((field) => ({
			field,
			expected: at(a, f, field),
			actual: at(b, f, field),
		}));
		if (outputs.length > 0) return { journal, frame: f, outputs };
	}
	return null;
}

export function firstDivergence(
	twist: Twist,
	pool: readonly Journal[],
): Difference | null {
	for (let j = 0; j < pool.length; j += 1) {
		const journal = pool[j] as Journal;
		const found = divergence(
			run(REFERENCE_TWIST, journal),
			run(twist, journal),
			j,
		);
		if (found) return found;
	}
	return null;
}

const REFERENCE_TWIST = twistOf(null);

export function shrink(
	journal: Journal,
	stillFails: (j: Journal) => boolean,
): { journal: Journal; tries: number } {
	let best = journal;
	let tries = 0;
	const attempt = (candidate: Journal) => {
		tries += 1;
		if (!stillFails(candidate)) return false;
		best = candidate;
		return true;
	};
	let chunk = Math.max(1, Math.ceil(best.events.length / 2));
	while (chunk >= 1) {
		let removed = false;
		for (let i = 0; i < best.events.length; i += chunk) {
			const events = [
				...best.events.slice(0, i),
				...best.events.slice(i + chunk),
			];
			if (attempt({ length: best.length, events })) {
				removed = true;
				i -= chunk;
			}
		}
		if (!removed) chunk = Math.floor(chunk / 2);
	}
	const last = Math.max(0, ...best.events.map((e) => e.frame));
	for (
		let length = last + 1;
		length < best.length;
		length = Math.ceil(length * 1.15) + 1
	) {
		if (attempt({ length, events: best.events })) break;
	}
	for (let moved = true; moved; ) {
		moved = false;
		for (let i = 0; i < best.events.length; i += 1) {
			const e = best.events[i] as Event;
			const prior = i === 0 ? 0 : (best.events[i - 1] as Event).frame;
			const target = Math.max(prior, Math.floor((prior + e.frame) / 2));
			if (target >= e.frame) continue;
			const events = best.events.map((x, k) =>
				k === i ? { ...x, frame: target } : x,
			);
			const shift = e.frame - target;
			const shorter = {
				length: Math.max(1, best.length - shift),
				events: events.map((x, k) =>
					k > i ? { ...x, frame: x.frame - shift } : x,
				),
			};
			if (attempt(shorter) || attempt({ length: best.length, events }))
				moved = true;
		}
	}
	return { journal: best, tries };
}

export const killsFor =
	(mutant: Mutant, property: Property) => (journal: Journal) =>
		property.fails(run(twistOf(mutant), journal), journal) >= 0;

export type Claim = {
	readonly suspect: string;
	readonly fix: Partial<Twist>;
	readonly note: string;
};

export type Ruling =
	| { readonly verdict: "rejected: file behaves"; readonly difference: null }
	| {
			readonly verdict: "rejected: fix does not restore";
			readonly difference: Difference;
	  }
	| { readonly verdict: "accepted"; readonly difference: null };

export function judge(
	file: Twist,
	claim: Claim,
	pool: readonly Journal[],
): Ruling {
	if (firstDivergence(file, pool) === null)
		return { verdict: "rejected: file behaves", difference: null };
	const left = firstDivergence({ ...file, ...claim.fix }, pool);
	if (left !== null)
		return { verdict: "rejected: fix does not restore", difference: left };
	return { verdict: "accepted", difference: null };
}

export type Row = {
	readonly mutant: Mutant;
	readonly kills: Record<string, Verdict | null>;
	readonly difference: Difference | null;
};

export function matrixRow(mutant: Mutant, pool: readonly Journal[]): Row {
	const twist = twistOf(mutant);
	const kills: Record<string, Verdict | null> = Object.fromEntries(
		PROPERTIES.map((p) => [p.id, null]),
	);
	let difference: Difference | null = null;
	for (let j = 0; j < pool.length; j += 1) {
		const journal = pool[j] as Journal;
		const trace = run(twist, journal);
		difference ??= divergence(run(REFERENCE_TWIST, journal), trace, j);
		for (const property of PROPERTIES) {
			if (kills[property.id]) continue;
			const frame = property.fails(trace, journal);
			if (frame >= 0)
				kills[property.id] = { property: property.id, journal: j, frame };
		}
	}
	return { mutant, kills, difference };
}

export const SUSPECTS: Record<Field, readonly (keyof Twist)[]> = {
	height: ["speed", "endSnap", "restBand"],
	motion: [
		"reverseTo",
		"pressStops",
		"oppositeSum",
		"dirFromOpeningOnly",
		"endSnap",
		"beamFirst",
		"restBand",
	],

	beamBroken: ["catLevel", "beamZone", "reverseTo"],
	reversals: ["countStep", "catLevel", "beamZone"],
	blocked: [],
};

export const BLIND_ORDER: readonly (keyof Twist)[] = [
	"speed",
	"restBand",
	"endSnap",
	"beamFirst",
	"countStep",
	"oppositeSum",
	"dirFromOpeningOnly",
	"pressStops",
	"reverseTo",
	"beamZone",
	"catLevel",
];

export function nextClaim(
	tried: ReadonlySet<string>,
	hint: Difference | null,
	useHint: boolean,
): Claim | null {
	const score = (cell: keyof Twist) =>
		hint
			? hint.outputs.filter((o) => SUSPECTS[o.field].includes(cell)).length
			: 0;
	const ranked =
		useHint && hint
			? [...BLIND_ORDER]
					.filter((c) => score(c) > 0)
					.sort(
						(x, y) =>
							score(y) - score(x) ||
							SUSPECTS.motion.indexOf(x) - SUSPECTS.motion.indexOf(y),
					)
			: BLIND_ORDER;
	const cell = [...ranked, ...BLIND_ORDER].find((c) => !tried.has(c));
	if (cell === undefined) return null;
	const why =
		useHint && hint
			? `hint says ${hint.outputs.map((o) => o.field).join("+")} differs at frame ${hint.frame}`
			: "no hint: guessing in fixed order";
	return {
		suspect: cell,
		fix: { [cell]: REFERENCE[cell] } as Partial<Twist>,
		note: why,
	};
}

export function nextProperty(
	tried: ReadonlySet<string>,
	hint: Difference | null,
): Property | null {
	const fields = hint?.outputs.map((o) => o.field) ?? [];
	const ranked = [...PROPERTIES].sort(
		(a, b) =>
			Number(b.watches.some((w) => fields.includes(w))) -
			Number(a.watches.some((w) => fields.includes(w))),
	);
	return ranked.find((p) => !tried.has(p.id)) ?? null;
}
