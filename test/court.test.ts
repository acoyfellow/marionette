import { describe, expect, it } from "vitest";
import {
	divergence,
	firstDivergence,
	journals,
	judge,
	killsFor,
	MUTANTS,
	PROPERTIES,
	run,
	shrink,
	twistOf,
} from "../client/src/lab/court";
import { API } from "../client/src/lab/loop";
import { createGarage, REFERENCE } from "../client/src/pages/garage";

const pool = journals(7, 60);
const mutant = (id: string) => MUTANTS.find((m) => m.id === id) ?? MUTANTS[0]!;
const property = (id: string) =>
	PROPERTIES.find((p) => p.id === id) ?? PROPERTIES[0]!;

describe("mutant court", () => {
	it("reference twist is the shipped garage", () => {
		const a = createGarage();
		const b = createGarage(REFERENCE);
		a.press("remote");
		b.press("remote");
		for (let i = 0; i < 300; i += 1) expect(a.step()).toEqual(b.step());
	});

	it("every fair property passes on the reference door; the too-strict one is a false alarm", () => {
		const alarms = API.reference();
		expect(
			Object.entries(alarms)
				.filter(([, v]) => v)
				.map(([k]) => k),
		).toEqual(["strict-crush"]);
	});

	it("proves equivalent mutants by replay", () => {
		for (const id of ["order", "band", "twin"])
			expect(firstDivergence(twistOf(mutant(id)), pool)).toBeNull();
		expect(firstDivergence(twistOf(mutant("blind")), pool)).not.toBeNull();
	});

	it("leaves the speed mutant as a true survivor", () => {
		const row = API.row("fast");
		expect(row?.difference?.outputs.map((o) => o.field)).toEqual(["height"]);
		expect(
			PROPERTIES.filter((p) => p.id !== "strict-crush").every(
				(p) => !row?.kills[p.id],
			),
		).toBe(true);
	});

	it("shrinks a failing journal to a shorter one that still fails", () => {
		const kills = killsFor(mutant("blind"), property("no-crush"));
		const original = pool.find(kills)!;
		const { journal } = shrink(original, kills);
		expect(kills(journal)).toBe(true);
		expect(journal.events.length).toBeLessThan(original.events.length);
		expect(journal.length).toBeLessThan(original.length);
	});

	it("judge rejects claims on a behaving file and fixes that do not restore", () => {
		expect(
			judge(
				twistOf(mutant("twin")),
				{ suspect: "catLevel", fix: { catLevel: 0.5 }, note: "" },
				pool,
			).verdict,
		).toBe("rejected: file behaves");
		const wrong = judge(
			twistOf(mutant("blind")),
			{ suspect: "speed", fix: { speed: REFERENCE.speed }, note: "" },
			pool,
		);
		expect(wrong.verdict).toBe("rejected: fix does not restore");
		expect(wrong.difference?.frame).toBeGreaterThanOrEqual(0);
		expect(
			judge(
				twistOf(mutant("blind")),
				{ suspect: "catLevel", fix: { catLevel: 0.5 }, note: "" },
				pool,
			).verdict,
		).toBe("accepted");
	});

	it("divergence names the first frame and fields that differ", () => {
		const j = pool[0]!;
		const d = divergence(run(REFERENCE, j), run(twistOf(mutant("fast")), j));
		expect(d?.frame).toBeGreaterThan(0);
		expect(d?.outputs[0]?.field).toBe("height");
	});

	it("hinted hunter converges and never spends more attempts than blind on most bugs", () => {
		const live = MUTANTS.filter(
			(m) => !["order", "band", "twin"].includes(m.id),
		);
		const wins = live.filter(
			(m) => API.hunt(m.id, true).length <= API.hunt(m.id, false).length,
		);
		for (const m of live)
			expect(API.hunt(m.id, true).at(-1)?.verdict).toBe("accepted");
		expect(wins.length).toBeGreaterThanOrEqual(7);
	}, 60000);
});
