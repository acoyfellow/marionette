import {
	createSourceTable,
	event,
	input,
	state,
} from "handwired/src/runtime/cells.ts";
import { emitSelect } from "handwired/src/runtime/numeric-ui-core.ts";
import { createTicker, gates, wiresOf } from "../ticker";

export type Bug = { readonly step: number; readonly onPress: number };
export const NO_BUG: Bug = { step: 1, onPress: 0 };
export const LOUD_BUG: Bug = { step: 2, onPress: 0 };
export const SNEAKY_BUG: Bug = { step: 2, onPress: 7 };

export function buildPlus(bug: Bug = NO_BUG) {
	const table = createSourceTable();
	const cells = table.declare({
		press: event(),
		dt: input([0, 0.1]),
		count: state([0, 1e6]),
		presses: state([0, 1e6]),
	});
	const circuit = table.createCircuit();
	const { is, all } = gates(circuit);
	const thisPress = circuit.affine([[cells.presses, 1]], 1);
	const buggy =
		bug.onPress === 0
			? cells.press
			: all(cells.press, is(thisPress, bug.onPress));
	const step = emitSelect(
		circuit,
		buggy,
		circuit.constant(1),
		circuit.constant(bug.step),
	);
	const added = emitSelect(
		circuit,
		cells.press,
		cells.count,
		circuit.affine([
			[cells.count, 1],
			[step, 1],
		]),
	);
	table.next(cells.count, added);
	table.next(
		cells.presses,
		circuit.affine([
			[cells.presses, 1],
			[cells.press, 1],
		]),
	);
	return {
		...table.finish(),
		output: { count: added, presses: cells.presses },
		events: { press: cells.press },
		dt: cells.dt,
		layout: [
			{ label: "number", wires: wiresOf({ c: cells.count, p: cells.presses }) },
		],
	};
}

export const createPlus = (bug: Bug = NO_BUG) => createTicker(buildPlus(bug));

export function pressTimes(bug: Bug, times: number): number[] {
	const machine = createPlus(bug);
	const seen: number[] = [];
	for (let i = 0; i < times; i += 1) {
		machine.press("press");
		seen.push(machine.step().count);
	}
	return seen;
}

export type Failure = {
	readonly press: number;
	readonly expected: number;
	readonly got: number;
};

export function check(bug: Bug, times: number): Failure | null {
	const seen = pressTimes(bug, times);
	const index = seen.findIndex((value, i) => value !== i + 1);
	return index < 0
		? null
		: { press: index + 1, expected: index + 1, got: seen[index] ?? Number.NaN };
}

export function randomTests(
	bug: Bug,
	tries: number,
	seed = 1,
): { tried: number[]; failure: Failure | null; shortest: number | null } {
	let s = seed;
	const tried: number[] = [];
	for (let t = 0; t < tries; t += 1) {
		s = (s * 1664525 + 1013904223) >>> 0;
		const times = 1 + ((s >>> 16) % 20);
		tried.push(times);
		const failure = check(bug, times);
		if (failure) {
			let shortest = times;
			while (shortest > 1 && check(bug, shortest - 1)) shortest -= 1;
			return { tried, failure, shortest };
		}
	}
	return { tried, failure: null, shortest: null };
}
