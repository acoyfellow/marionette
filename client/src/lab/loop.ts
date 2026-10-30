import {
	type Difference,
	type Journal,
	journals,
	judge,
	killsFor,
	MUTANTS,
	matrixRow,
	nextClaim,
	nextProperty,
	PROPERTIES,
	shrink,
	twistOf,
} from "./court";

export const POOL = { seed: 7, count: 60 } as const;
const pool = journals(POOL.seed, POOL.count);
const REFERENCE_MUTANT = {
	id: "reference",
	label: "reference",
	cell: "",
	twist: {},
	kind: "number" as const,
};
let referenceRow: ReturnType<typeof matrixRow> | null = null;
const falseAlarms = () =>
	(referenceRow ??= matrixRow(REFERENCE_MUTANT, pool)).kills;

export type Step = {
	readonly lane: "hinted" | "blind" | "writer";
	readonly attempt: number;
	readonly claim: string;
	readonly note: string;
	readonly verdict: string;
	readonly hint: Difference | null;
	readonly replays: number;
};

function hunter(mutantId: string, useHint: boolean): Step[] {
	const mutant = MUTANTS.find((m) => m.id === mutantId);
	if (!mutant) return [];
	const file = twistOf(mutant);
	const tried = new Set<string>();
	const steps: Step[] = [];
	let hint: Difference | null = null;
	let replays = 0;
	for (let attempt = 1; attempt <= 12; attempt += 1) {
		const claim = nextClaim(tried, hint, useHint);
		if (!claim) break;
		tried.add(claim.suspect);
		const ruling = judge(file, claim, pool);
		replays += 2;
		if (ruling.difference) hint = ruling.difference;
		steps.push({
			lane: useHint ? "hinted" : "blind",
			attempt,
			claim: `fix ${claim.suspect} → ${JSON.stringify(Object.values(claim.fix)[0])}`,
			note: claim.note,
			verdict: ruling.verdict,
			hint: useHint ? ruling.difference : null,
			replays,
		});
		if (ruling.verdict !== "rejected: fix does not restore") break;
	}
	return steps;
}

function writer(mutantId: string): Step[] {
	const mutant = MUTANTS.find((m) => m.id === mutantId);
	if (!mutant) return [];
	const row = matrixRow(mutant, pool);
	const tried = new Set<string>();
	const steps: Step[] = [];
	for (let attempt = 1; attempt <= PROPERTIES.length; attempt += 1) {
		const property = nextProperty(tried, row.difference);
		if (!property) break;
		tried.add(property.id);
		const kill = row.kills[property.id];
		const verdict =
			row.difference === null
				? "nothing to catch: equivalent"
				: falseAlarms()[property.id]
					? "rejected: also fails the real door"
					: kill
						? `killed in journal ${kill.journal}, frame ${kill.frame}`
						: "survived";
		steps.push({
			lane: "writer",
			attempt,
			claim: `assert “${property.label}”`,
			note: row.difference
				? `hint: ${row.difference.outputs.map((o) => o.field).join("+")} differs at frame ${row.difference.frame}`
				: "no difference found",
			verdict,
			hint: row.difference,
			replays: attempt * POOL.count,
		});
		if (verdict.startsWith("killed") || row.difference === null) break;
	}
	return steps;
}

export const API = {
	reference: () => falseAlarms(),
	row: (id: string) => {
		const mutant = MUTANTS.find((m) => m.id === id);
		return mutant ? matrixRow(mutant, pool) : null;
	},
	shrink: (mutantId: string | null, propertyId: string, journal: number) => {
		const mutant = MUTANTS.find((m) => m.id === mutantId) ?? REFERENCE_MUTANT;
		const property = PROPERTIES.find((p) => p.id === propertyId);
		if (!property) return null;
		const original = pool[journal] as Journal;
		const started = performance.now();
		const result = shrink(original, killsFor(mutant, property));
		return { original, ...result, ms: performance.now() - started };
	},
	journal: (index: number) => pool[index] ?? null,
	hunt: (mutantId: string, useHint: boolean) => hunter(mutantId, useHint),
	write: (mutantId: string) => writer(mutantId),
} as const;

export type Api = typeof API;
