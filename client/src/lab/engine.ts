import { createEvaluator } from "handwired/src/runtime/cells.ts";
import type { Circuit } from "handwired/src/runtime/numeric-ui-core.ts";
import type { AnyPage, Control } from "../kit";
import { DT, type TickProgram } from "../ticker";

type Program = TickProgram<unknown, string>;
type Operation = Circuit["operations"][number];

export type Event = {
	readonly frame: number;
	readonly name: string;
	readonly value?: number;
};
export type Journal = {
	readonly length: number;
	readonly events: readonly Event[];
};
export type Trace = {
	readonly frames: readonly string[];
	readonly crash: string | null;
};

export type Site = {
	readonly id: string;
	readonly op: number;
	readonly depth: number;
	readonly kind: "stuck compare" | "stuck branch" | "number";
	readonly label: string;
	readonly patch: (op: Operation) => Operation;
};

const cloneCircuit = (
	circuit: Circuit,
	patches: ReadonlyMap<number, (op: Operation) => Operation>,
): Circuit => {
	const copy = Object.create(Object.getPrototypeOf(circuit)) as Circuit;
	Object.assign(copy, circuit);
	copy.operations = circuit.operations.map(
		(op, i) => patches.get(i)?.(op) ?? op,
	);
	copy.tensorProgram = null;
	return copy;
};

export type Machine = {
	readonly page: AnyPage;
	readonly program: Program;
	readonly sites: readonly Site[];
	readonly buttons: readonly string[];
	readonly sliders: readonly Extract<Control<string>, { kind: "slider" }>[];
};

const constant =
	(value: number) =>
	(op: Operation): Operation => ({
		...op,
		kind: "affine",
		leftTerms: [],
		leftBias: value,
		gateTerms: [],
		gateBias: 0,
		macro: undefined,
		comparisonBit: undefined,
		preserveRounding: undefined,
		roundingPoint: undefined,
	});

const fmt = (n: number) => String(Number(n.toFixed(4)));

export function sitesOf(circuit: Circuit): Site[] {
	const sites: Site[] = [];
	circuit.operations.forEach((op, i) => {
		const wire = circuit.sourceSize + i;
		if (op.comparisonBit) {
			for (const v of [0, 1])
				sites.push({
					id: `c${wire}=${v}`,
					op: i,
					depth: op.depth,
					kind: "stuck compare",
					label: `compare at wire ${wire} always says ${v === 1 ? "yes" : "no"}`,
					patch: constant(v),
				});
			return;
		}
		if (op.macro?.kind === "select") {
			const { off, on } = op.macro;
			sites.push({
				id: `s${wire}=on`,
				op: i,
				depth: op.depth,
				kind: "stuck branch",
				label: `choice at wire ${wire} always takes the “yes” branch`,
				patch: (o) => ({ ...o, leftTerms: [[on, 1]], macro: undefined }),
			});
			sites.push({
				id: `s${wire}=off`,
				op: i,
				depth: op.depth,
				kind: "stuck branch",
				label: `choice at wire ${wire} always takes the “no” branch`,
				patch: (o) => ({ ...o, leftTerms: [[off, 1]], macro: undefined }),
			});
			return;
		}
		if (
			op.kind === "affine" &&
			op.leftTerms.length === 0 &&
			op.leftBias !== 0 &&
			Math.abs(op.leftBias) < 1e5
		) {
			const value = op.leftBias;
			for (const next of [value * 2, value * 0.5, value + 1]) {
				sites.push({
					id: `n${wire}=${fmt(next)}`,
					op: i,
					depth: op.depth,
					kind: "number",
					label: `number ${fmt(value)} → ${fmt(next)} at wire ${wire}`,
					patch: (o) => ({ ...o, leftBias: next }),
				});
			}
		}
	});
	return sites;
}

export function machineOf(page: AnyPage): Machine {
	const program = buildProgram(page);
	const buttons = page.controls.flatMap((c) =>
		c.kind === "button" ? [c.event] : [],
	);
	const sliders = page.controls.flatMap((c) =>
		c.kind === "slider" ? [c] : [],
	);
	return { page, program, sites: sitesOf(program.circuit), buttons, sliders };
}

const BUILDERS = new Map<string, () => Program>();
export const registerBuilder = (slug: string, build: () => Program) =>
	BUILDERS.set(slug, build);

function buildProgram(page: AnyPage): Program {
	const build = BUILDERS.get(page.slug);
	if (!build) throw new Error(`no builder for ${page.slug}`);
	return build();
}

export type Runner = (journal: Journal) => Trace;

export function runner(
	machine: Machine,
	patches: readonly Site[] = [],
): Runner {
	const { program } = machine;
	const map = new Map(patches.map((s) => [s.op, s.patch]));
	type Evaluate = (source: Float32Array) => {
		nextValues: Float32Array;
		output: unknown;
	};
	let evaluate: Evaluate | null = null;
	let buildError: string | null = null;
	try {
		evaluate = createEvaluator({
			...program,
			circuit: cloneCircuit(program.circuit, map),
		} as never) as unknown as Evaluate;
	} catch (error) {
		buildError = String(error instanceof Error ? error.message : error).slice(
			0,
			160,
		);
	}
	return (journal) => {
		if (!evaluate) return { frames: [], crash: buildError };
		const source = new Float32Array(program.initialSource);
		const inputs = program.inputs ?? {};
		const values: Record<string, number> = Object.fromEntries(
			machine.sliders.map((s) => [s.input, s.initial]),
		);
		const byFrame = new Map<number, Event[]>();
		for (const e of journal.events)
			byFrame.set(e.frame, [...(byFrame.get(e.frame) ?? []), e]);
		const frames: string[] = [];
		try {
			for (let f = 0; f < journal.length; f += 1) {
				for (const wire of Object.values(program.events)) source[wire] = 0;
				for (const e of byFrame.get(f) ?? []) {
					if (e.value === undefined) {
						const wire = program.events[e.name];
						if (wire !== undefined) source[wire] = 1;
					} else values[e.name] = e.value;
				}
				for (const [name, wire] of Object.entries(inputs))
					source[wire] = values[name] ?? 0;
				source[program.dt] = DT;
				const result = evaluate(source);
				source.set(result.nextValues);
				frames.push(JSON.stringify(result.output));
			}
		} catch (error) {
			return {
				frames,
				crash: String(error instanceof Error ? error.message : error).slice(
					0,
					160,
				),
			};
		}
		return { frames, crash: null };
	};
}

export function seeded(seed: number) {
	let s = seed >>> 0 || 1;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return ((s >>> 8) & 0xffffff) / 0x1000000;
	};
}

export function randomJournal(
	machine: Machine,
	random: () => number,
	length: number,
): Journal {
	const events: Event[] = [];
	const pressRate = machine.buttons.length ? 1 / 25 : 0;
	for (let f = 0; f < length; f += 1) {
		if (random() < pressRate)
			events.push({
				frame: f,
				name: machine.buttons[
					Math.floor(random() * machine.buttons.length)
				] as string,
			});
		for (const s of machine.sliders) {
			if (random() >= 1 / 90) continue;
			const steps = Math.round((s.max - s.min) / s.step);
			events.push({
				frame: f,
				name: s.input,
				value: Number(
					(s.min + Math.floor(random() * (steps + 1)) * s.step).toFixed(6),
				),
			});
		}
	}
	return { length, events };
}

export const journalsFor = (
	machine: Machine,
	seed: number,
	count: number,
	length: number,
) => {
	const random = seeded(seed);
	return Array.from({ length: count }, () =>
		randomJournal(machine, random, length),
	);
};

export type Difference = {
	readonly journal: number;
	readonly frame: number;
	readonly outputs: readonly {
		field: string;
		expected: string;
		actual: string;
	}[];
};

const flat = (value: unknown, path = "", out: Record<string, string> = {}) => {
	if (value !== null && typeof value === "object")
		for (const [k, v] of Object.entries(value))
			flat(v, path ? `${path}.${k}` : k, out);
	else
		out[path] = String(
			typeof value === "number" ? Number(value.toFixed(3)) : value,
		);
	return out;
};

export function divergence(a: Trace, b: Trace, journal = 0): Difference | null {
	if (b.crash && !a.crash)
		return {
			journal,
			frame: b.frames.length,
			outputs: [{ field: "crash", expected: "runs", actual: b.crash }],
		};
	for (let f = 0; f < a.frames.length; f += 1) {
		if (a.frames[f] === b.frames[f]) continue;
		const pa = flat(JSON.parse(a.frames[f] as string));
		const pb = flat(b.frames[f] ? JSON.parse(b.frames[f] as string) : {});
		const outputs = Object.keys(pa)
			.filter((k) => pa[k] !== pb[k])
			.map((field) => ({
				field,
				expected: pa[field] ?? "",
				actual: pb[field] ?? "",
			}));
		return {
			journal,
			frame: f,
			outputs: outputs.length
				? outputs
				: [{ field: "raw", expected: "", actual: "" }],
		};
	}
	return null;
}

export function shrink(
	journal: Journal,
	stillFails: (j: Journal) => boolean,
): { journal: Journal; tries: number } {
	let best = journal;
	let tries = 0;
	const attempt = (candidate: Journal) => {
		tries += 1;
		if (tries > 400 || !stillFails(candidate)) return false;
		best = candidate;
		return true;
	};
	let chunk = Math.max(1, Math.ceil(best.events.length / 2));
	while (chunk >= 1 && tries <= 400) {
		let removed = false;
		for (let i = 0; i < best.events.length; i += chunk) {
			if (
				attempt({
					length: best.length,
					events: [...best.events.slice(0, i), ...best.events.slice(i + chunk)],
				})
			) {
				removed = true;
				i -= chunk;
			}
		}
		if (!removed) chunk = Math.floor(chunk / 2);
	}
	const last = Math.max(0, ...best.events.map((e) => e.frame));
	for (
		let length = last + 2;
		length < best.length;
		length = Math.ceil(length * 1.25) + 1
	) {
		if (attempt({ length, events: best.events })) break;
	}
	return { journal: best, tries };
}

export function cone(circuit: Circuit, roots: readonly number[]): Set<number> {
	const seen = new Set<number>();
	const stack = [...roots];
	while (stack.length) {
		const wire = stack.pop() as number;
		const i = wire - circuit.sourceSize;
		if (i < 0 || seen.has(i)) continue;
		seen.add(i);
		const op = circuit.operations[i];
		if (!op) continue;
		for (const [w] of op.leftTerms) stack.push(w);
		for (const [w] of op.gateTerms) stack.push(w);
		if (op.macro?.kind === "select")
			stack.push(op.macro.gate, op.macro.off, op.macro.on);
		if (op.macro?.kind === "multiply")
			stack.push(op.macro.left, op.macro.right);
	}
	return seen;
}

export function outputWires(program: Program): Record<string, number> {
	const out: Record<string, number> = {};
	const walk = (value: unknown, path: string) => {
		if (typeof value === "number") out[path] = value;
		else if (value && typeof value === "object")
			for (const [k, v] of Object.entries(value))
				walk(v, path ? `${path}.${k}` : k);
	};
	walk(program.output, "");
	for (const [i, wire] of program.nextSource.entries()) out[`next#${i}`] = wire;
	return out;
}

export function patchedProgram(
	machine: Machine,
	patches: readonly Site[],
): Program {
	const map = new Map(patches.map((s) => [s.op, s.patch]));
	return {
		...machine.program,
		circuit: cloneCircuit(machine.program.circuit, map),
	};
}
