import { describe, expect, it } from "vitest";
import {
	check,
	createPlus,
	LOUD_BUG,
	NO_BUG,
	pressTimes,
	randomTests,
	SNEAKY_BUG,
} from "../client/src/lab/plus";
import { identical, replayTicker } from "../client/src/ticker";

describe("+1 machine", () => {
	it("counts up by one", () =>
		expect(pressTimes(NO_BUG, 5)).toEqual([1, 2, 3, 4, 5]));
	it("loud bug adds two", () =>
		expect(pressTimes(LOUD_BUG, 3)).toEqual([2, 4, 6]));
	it("sneaky bug hides from a 3-press test", () => {
		expect(check(SNEAKY_BUG, 3)).toBeNull();
		expect(check(SNEAKY_BUG, 9)).toEqual({ press: 7, expected: 7, got: 8 });
	});
	it("random tests find it after some green tries and shrink to 7 presses", () => {
		const r = randomTests(SNEAKY_BUG, 100, 6);
		expect(r.tried.length).toBeGreaterThan(1);
		expect(r.shortest).toBe(7);
	});
	it("replays bit for bit", () => {
		const m = createPlus(SNEAKY_BUG);
		for (let i = 0; i < 9; i += 1) {
			m.press("press");
			m.step();
		}
		expect(
			identical(
				replayTicker(() => createPlus(SNEAKY_BUG), m.journal()),
				m.snapshot(),
			),
		).toBe(true);
	});
});
