import "./builders";
import { PAGES } from "../pages";
import {
	type Difference,
	divergence,
	type Journal,
	journalsFor,
	type Machine,
	machineOf,
	runner,
	type Site,
	seeded,
	shrink,
	type Trace,
} from "./engine";
import { PROPERTIES, viewOf } from "./properties";

export const POOL = { seed: 7, count: 24, length: 480 } as const;
export const SAMPLE = 24;

export type Kill = {
	readonly property: string;
	readonly journal: number;
	readonly frame: number;
};
export type Row = {
	readonly site: Pick<Site, "id" | "kind" | "label" | "op">;
	readonly kills: Record<string, Kill | null>;
	readonly difference: Difference | null;
};
export type Report = {
	readonly slug: string;
	readonly title: string;
	readonly sites: number;
	readonly properties: readonly { id: string; label: string }[];
	readonly falseAlarms: Record<string, Kill | null>;
	readonly rows: readonly Row[];
};

type Lab = {
	machine: Machine;
	pool: Journal[];
	reference: Trace[];
	sample: Site[];
};
const labs = new Map<string, Lab>();

export function lab(slug: string): Lab {
	const cached = labs.get(slug);
	if (cached) return cached;
	const page = PAGES.find((p) => p.slug === slug);
	if (!page) throw new Error(`no page ${slug}`);
	const machine = machineOf(page);
	const pool = journalsFor(machine, POOL.seed, POOL.count, POOL.length);
	const reference = pool.map(runner(machine));
	const random = seeded(
		[...slug].reduce((h, c) => h * 31 + c.charCodeAt(0), 7),
	);
	const sample = machine.sites
		.map((site) => ({ site, key: random() }))
		.sort((a, b) => a.key - b.key)
		.slice(0, SAMPLE)
		.map((e) => e.site)
		.sort((a, b) => a.op - b.op);
	const made = { machine, pool, reference, sample };
	labs.set(slug, made);
	return made;
}

const killsOf = (
	slug: string,
	traces: readonly Trace[],
	pool: readonly Journal[],
) => {
	const kills: Record<string, Kill | null> = {};
	for (const property of PROPERTIES[slug] ?? []) {
		kills[property.id] = null;
		for (let j = 0; j < traces.length; j += 1) {
			const trace = traces[j] as Trace;
			if (trace.crash) {
				kills[property.id] = {
					property: property.id,
					journal: j,
					frame: trace.frames.length,
				};
				break;
			}
			const frame = property.fails(viewOf(trace.frames, pool[j] as Journal));
			if (frame >= 0) {
				kills[property.id] = { property: property.id, journal: j, frame };
				break;
			}
		}
	}
	return kills;
};

export function rowFor(slug: string, siteId: string): Row | null {
	const { machine, pool, reference, sample } = lab(slug);
	const site =
		sample.find((s) => s.id === siteId) ??
		machine.sites.find((s) => s.id === siteId);
	if (!site) return null;
	const run = runner(machine, [site]);
	const traces = pool.map(run);
	let difference: Difference | null = null;
	for (let j = 0; j < pool.length && !difference; j += 1)
		difference = divergence(reference[j] as Trace, traces[j] as Trace, j);
	return {
		site: { id: site.id, kind: site.kind, label: site.label, op: site.op },
		kills: killsOf(slug, traces, pool),
		difference,
	};
}

export function report(slug: string): Report {
	const { machine, pool, reference, sample } = lab(slug);
	return {
		slug,
		title: machine.page.title,
		sites: machine.sites.length,
		properties: (PROPERTIES[slug] ?? []).map(({ id, label }) => ({
			id,
			label,
		})),
		falseAlarms: killsOf(slug, reference, pool),
		rows: sample.map((s) => rowFor(slug, s.id) as Row),
	};
}

export function shrinkKill(
	slug: string,
	siteId: string,
	propertyId: string,
	journalIndex: number,
) {
	const { machine, pool } = lab(slug);
	const site = machine.sites.find((s) => s.id === siteId);
	const property = (PROPERTIES[slug] ?? []).find((p) => p.id === propertyId);
	if (!site || !property) return null;
	const run = runner(machine, [site]);
	const fails = (j: Journal) => {
		const t = run(j);
		return t.crash !== null || property.fails(viewOf(t.frames, j)) >= 0;
	};
	const started = performance.now();
	const original = pool[journalIndex] as Journal;
	const result = shrink(original, fails);
	return { original, ...result, ms: performance.now() - started };
}

export type Step = {
	readonly attempt: number;
	readonly claim: string;
	readonly why: string;
	readonly verdict:
		| "rejected: file behaves"
		| "rejected: fix does not restore"
		| "accepted";
	readonly hint: Difference | null;
	readonly replays: number;
};

const restoresWith = (
	slug: string,
	patched: Site,
	fix: Site | null,
	cached: Difference | null,
) => {
	if (fix && fix.op !== patched.op) return cached;
	const { machine, pool, reference } = lab(slug);
	const run = runner(machine, fix ? [] : [patched]);
	for (let j = 0; j < pool.length; j += 1) {
		const d = divergence(reference[j] as Trace, run(pool[j] as Journal), j);
		if (d) return d;
	}
	return null;
};

const wireCone = (lab: Lab, d: Difference | null) => {
	if (!d) return new Map<number, number>();
	const program = lab.machine.program;
	const outputs: Record<string, number> = {};
	const walk = (v: unknown, path: string) => {
		if (typeof v === "number") outputs[path] = v;
		else if (v && typeof v === "object")
			for (const [k, x] of Object.entries(v))
				walk(x, path ? `${path}.${k}` : k);
	};
	walk(program.output, "");
	const score = new Map<number, number>();
	const circuit = program.circuit;
	for (const o of d.outputs) {
		const root = outputs[o.field];
		if (root === undefined) continue;
		const seen = new Set<number>();
		const stack: [number, number][] = [[root, 0]];
		while (stack.length) {
			const [wire, dist] = stack.pop() as [number, number];
			const i = wire - circuit.sourceSize;
			if (i < 0 || seen.has(i) || dist > 40) continue;
			seen.add(i);
			score.set(i, Math.max(score.get(i) ?? 0, 1000 - dist) + 1000);
			const op = circuit.operations[i];
			if (!op) continue;
			for (const [w] of [...op.leftTerms, ...op.gateTerms])
				stack.push([w, dist + 1]);
			if (op.macro?.kind === "select")
				stack.push(
					[op.macro.gate, dist + 1],
					[op.macro.off, dist + 1],
					[op.macro.on, dist + 1],
				);
		}
	}
	return score;
};

export function hunt(
	slug: string,
	siteId: string,
	useHint: boolean,
	maxAttempts = 40,
): Step[] {
	const l = lab(slug);
	const planted = l.machine.sites.find((s) => s.id === siteId);
	if (!planted) return [];
	const suspects = [...new Map(l.machine.sites.map((s) => [s.op, s])).values()];
	const order = seeded(siteId.length * 977 + slug.length)();
	const blind = suspects
		.map((s, i) => ({ s, k: (i * 0.618 + order) % 1 }))
		.sort((a, b) => a.k - b.k)
		.map((e) => e.s);
	const steps: Step[] = [];
	const tried = new Set<number>();
	let hint: Difference | null = null;
	let replays = 0;
	const first = restoresWith(slug, planted, null, null);
	replays += 1;
	if (!first)
		return [
			{
				attempt: 1,
				claim: "any fix",
				why: "the planted change",
				verdict: "rejected: file behaves",
				hint: null,
				replays,
			},
		];
	hint = first;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const cone = useHint ? wireCone(l, hint) : new Map<number, number>();
		const ranked = useHint
			? [...suspects]
					.filter((s) => !tried.has(s.op))
					.sort(
						(a, b) =>
							(cone.get(b.op) ?? 0) - (cone.get(a.op) ?? 0) ||
							b.depth - a.depth,
					)
			: blind.filter((s) => !tried.has(s.op));
		const guess = ranked[0];
		if (!guess) break;
		tried.add(guess.op);
		const left = restoresWith(slug, planted, guess, first);
		replays += 1;
		const why =
			useHint && hint
				? `clue: ${hint.outputs
						.slice(0, 2)
						.map((o) => o.field)
						.join(", ")} wrong at frame ${hint.frame}; this part feeds it`
				: "no clue: next guess in a fixed order";
		steps.push({
			attempt,
			claim: `fix wire ${l.machine.program.circuit.sourceSize + guess.op}`,
			why,
			verdict: left ? "rejected: fix does not restore" : "accepted",
			hint: left,
			replays,
		});
		if (!left) break;
		if (useHint) hint = left;
	}
	return steps;
}

export const machines = () =>
	PAGES.map((p) => ({ slug: p.slug, title: p.title }));
