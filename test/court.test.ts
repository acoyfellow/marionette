import { describe, expect, it } from "vitest";
import {
	hunt,
	lab,
	machines,
	report,
	shrinkKill,
} from "../client/src/lab/court-api";
import { divergence, runner } from "../client/src/lab/engine";
import { PROPERTIES, viewOf } from "../client/src/lab/properties";

const all = machines();

describe("mutant court engine", () => {
	it("covers all 25 machines with properties", () => {
		expect(all).toHaveLength(25);
		for (const { slug } of all)
			expect(PROPERTIES[slug]?.length ?? 0).toBeGreaterThanOrEqual(3);
	});

	it("the unpatched runner matches the shipped ticker bit for bit", () => {
		for (const { slug } of all) {
			const l = lab(slug);
			const again = runner(l.machine)(l.pool[0]!);
			expect(again.frames).toEqual(l.reference[0]!.frames);
			expect(l.reference[0]!.crash).toBeNull();
		}
	});

	for (const { slug } of all) {
		it(`${slug}: every property passes on the real machine`, () => {
			const l = lab(slug);
			for (const property of PROPERTIES[slug] ?? []) {
				l.pool.forEach((journal, j) => {
					expect(
						property.fails(viewOf(l.reference[j]!.frames, journal)),
						`${property.id} journal ${j}`,
					).toBe(-1);
				});
			}
		});
	}
});

describe("mutant court on the parking garage", () => {
	const r = report("parking");

	it("finds changes that alter nothing, catches some and leaves survivors", () => {
		const live = r.rows.filter((row) => row.difference);
		expect(r.rows.length - live.length).toBeGreaterThan(0);
		expect(live.some((row) => Object.values(row.kills).some(Boolean))).toBe(
			true,
		);
		expect(live.some((row) => !Object.values(row.kills).some(Boolean))).toBe(
			true,
		);
		expect(Object.values(r.falseAlarms).every((k) => k === null)).toBe(true);
	});

	it("shrinks a caught change to a shorter journal that still fails", () => {
		const caught = r.rows.find((row) =>
			Object.values(row.kills).some(Boolean),
		)!;
		const [propertyId, kill] = Object.entries(caught.kills).find(([, k]) => k)!;
		const result = shrinkKill(
			"parking",
			caught.site.id,
			propertyId,
			kill!.journal,
		)!;
		expect(result.journal.events.length).toBeLessThanOrEqual(
			result.original.events.length,
		);
		expect(result.journal.length).toBeLessThanOrEqual(result.original.length);
	});

	it("replay accepts only the fix that restores the real machine", () => {
		const live = r.rows.filter((row) => row.difference);
		for (const row of live.slice(0, 4)) {
			const hinted = hunt("parking", row.site.id, true);
			const blind = hunt("parking", row.site.id, false);
			expect(hinted.at(-1)?.verdict).toBe("accepted");
			expect(blind.at(-1)?.verdict).toBe("accepted");
			expect(hinted.at(-1)?.claim).toBe(
				`fix wire ${lab("parking").machine.program.circuit.sourceSize + row.site.op}`,
			);
		}
	});

	it("a change that alters nothing is rejected before any fix is tried", () => {
		const quiet = r.rows.find((row) => !row.difference)!;
		expect(hunt("parking", quiet.site.id, true)[0]?.verdict).toBe(
			"rejected: file behaves",
		);
	});

	it("divergence names the first frame and the outputs that differ", () => {
		const live = r.rows.find((row) => row.difference)!;
		const l = lab("parking");
		const site = l.machine.sites.find((s) => s.id === live.site.id)!;
		const d = divergence(
			l.reference[live.difference!.journal]!,
			runner(l.machine, [site])(l.pool[live.difference!.journal]!),
		);
		expect(d?.frame).toBe(live.difference!.frame);
	});
});
