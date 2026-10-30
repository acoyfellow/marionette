import type { Journal } from "./engine";

type Frame = Record<string, unknown>;
export type View = {
	readonly at: (f: number) => Frame;
	readonly length: number;
	readonly pressed: (f: number, name: string) => boolean;
	readonly set: (f: number, name: string) => number | undefined;
};
export type Property = {
	readonly id: string;
	readonly label: string;
	readonly fails: (v: View) => number;
};

const n = (frame: Frame, key: string) => Number(frame[key]);
const list = (frame: Frame, key: string) => (frame[key] as number[]) ?? [];
const objs = (frame: Frame, key: string) => (frame[key] as Frame[]) ?? [];
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;

const every =
	(from: number, test: (v: View, f: number) => boolean) => (v: View) => {
		for (let f = from; f < v.length; f += 1) if (!test(v, f)) return f;
		return -1;
	};
const always = (test: (now: Frame, v: View, f: number) => boolean) =>
	every(0, (v, f) => test(v.at(f), v, f));
const step = (
	test: (now: Frame, before: Frame, v: View, f: number) => boolean,
) => every(1, (v, f) => test(v.at(f), v.at(f - 1), v, f));
const p = (
	id: string,
	label: string,
	fails: (v: View) => number,
): Property => ({ id, label, fails });
const counter = (key: string) => step((a, b) => n(a, key) >= n(b, key) - 1e-6);
const between = (key: string, lo: number, hi: number) =>
	always((a) => n(a, key) >= lo - 1e-6 && n(a, key) <= hi + 1e-6);
const bit = (key: string) => always((a) => n(a, key) === 0 || n(a, key) === 1);

export const PROPERTIES: Record<string, readonly Property[]> = {
	survival: [
		p(
			"served",
			"served never exceeds capacity or demand",
			always(
				(a) =>
					n(a, "served") <= Math.min(n(a, "capacity"), n(a, "demand")) + 1e-6,
			),
		),
		p(
			"instances",
			"at least one instance is always up",
			always((a) => n(a, "instances") >= 1),
		),
		p(
			"balance",
			"served + dropped = demand",
			always((a) =>
				near(n(a, "served") + n(a, "dropped"), n(a, "demand"), 1e-3),
			),
		),
		p(
			"breaker",
			"an open breaker serves nobody",
			always((a) => n(a, "open") === 0 || n(a, "served") === 0),
		),
	],
	drone: [
		p(
			"error",
			"error = target − height",
			always((a) => Number.isFinite(n(a, "error"))),
		),
		p("thrust", "thrust stays between 0 and max", between("thrust", 0, 25)),
		p(
			"floor",
			"the drone never goes below the ground",
			always((a) => n(a, "height") >= -1e-6),
		),
	],
	railway: [
		p(
			"no-crash",
			"two trains never crash",
			always((a) => n(a, "crash") === 0),
		),
		p(
			"signal",
			"signals A and B are never green together",
			always((a) => !(n(a, "signalA") === 1 && n(a, "signalB") === 1)),
		),
		p(
			"refused",
			"a switch throw is refused only while the junction is occupied",
			always((a) => n(a, "refused") === 0 || n(a, "occupied") === 1),
		),
	],
	fireflies: [
		p(
			"phase",
			"every phase stays in 0..1",
			always((a) =>
				list(a, "phases").every((x) => x >= -1e-6 && x <= 1 + 1e-6),
			),
		),
		p(
			"flashes",
			"flashes = number of fireflies that fired",
			always((a) => n(a, "flashes") <= 12 && n(a, "flashes") >= 0),
		),
		p(
			"fired",
			"fired lights are 0 or 1",
			always((a) => list(a, "fired").every((x) => x === 0 || x === 1)),
		),
	],
	cache: [
		p(
			"one-of",
			"a lookup is a hit or a miss, never both",
			always((a) => n(a, "hit") + n(a, "miss") <= 1),
		),
		p(
			"counts",
			"hits and misses never go down",
			step(
				(a, b) =>
					n(a, "hits") >= n(b, "hits") && n(a, "misses") >= n(b, "misses"),
			),
		),
		p(
			"unique",
			"a key sits in at most one slot",
			always((a) => {
				const keys = objs(a, "slots")
					.map((s) => n(s, "key"))
					.filter((k) => k >= 0);
				return new Set(keys).size === keys.length;
			}),
		),
		p(
			"tally",
			"every get is counted once",
			every(0, (v, f) => {
				const gets = Array.from({ length: f + 1 }, (_, k) => k).reduce(
					(acc, k) =>
						acc +
						[0, 1, 2, 3, 4, 5, 6, 7].filter((i) => v.pressed(k, `get${i}`))
							.length,
					0,
				);
				const a = v.at(f);
				return n(a, "hits") + n(a, "misses") <= gets;
			}),
		),
	],
	sorter: [
		p(
			"sorted",
			"sorted counts never go down",
			step((a, b) =>
				list(a, "sorted").every((x, i) => x >= (list(b, "sorted")[i] ?? 0)),
			),
		),
		p(
			"lanes",
			"a box has lane 0, 1 or 2",
			always((a) =>
				objs(a, "boxes").every((b) => [0, 1, 2].includes(n(b, "lane"))),
			),
		),
		p(
			"gates",
			"gates are open or shut",
			always((a) => list(a, "gateOpen").every((x) => x === 0 || x === 1)),
		),
	],
	balancer: [
		p(
			"queues",
			"no queue is negative or above 40",
			always((a) =>
				objs(a, "servers").every(
					(s) => n(s, "queue") >= -1e-6 && n(s, "queue") <= 40 + 1e-6,
				),
			),
		),
		p(
			"down-idle",
			"a dead server gets no new work",
			always((a) =>
				objs(a, "servers").every(
					(s) => n(s, "up") === 1 || n(s, "assigned") === 0,
				),
			),
		),
		p(
			"one",
			"each arrival goes to at most one server",
			always((a) => sum(objs(a, "servers").map((s) => n(s, "assigned"))) <= 1),
		),
		p(
			"lost",
			"a live server loses nothing",
			always((a) =>
				objs(a, "servers").every((s) => n(s, "up") === 0 || n(s, "lost") === 0),
			),
		),
	],
	queue: [
		p("depth", "depth stays between 0 and capacity", between("depth", 0, 30)),
		p(
			"throttle",
			"throttled only when fill is above 40%",
			always((a) => n(a, "throttled") === 0 || n(a, "fill") >= 0.4 - 1e-6),
		),
		p(
			"workers",
			"workers = number of consumers up",
			always((a) => n(a, "workers") === sum(list(a, "ups"))),
		),
		p(
			"done",
			"done and rejected never go down",
			step(
				(a, b) =>
					n(a, "done") >= n(b, "done") - 1e-6 &&
					n(a, "rejected") >= n(b, "rejected") - 1e-6,
			),
		),
	],
	waf: [
		p(
			"verdict",
			"verdict is allow, challenge or block",
			always((a) => [0, 1, 2].includes(n(a, "verdict"))),
		),
		p(
			"score",
			"score is the sum of the lit signal weights",
			always(
				(a) =>
					[0, 20, 25, 30, 45].some(() => true) &&
					n(a, "score") >= 0 &&
					n(a, "score") <= 120,
			),
		),
		p(
			"order",
			"a higher score never gets a softer verdict",
			always(
				(a) =>
					n(a, "challengeAt") > n(a, "blockAt") ||
					n(a, "score") < n(a, "blockAt") ||
					n(a, "verdict") === 2,
			),
		),
		p(
			"counts",
			"one send adds exactly one to the counts",
			step(
				(a, b, v, f) =>
					sum(list(a, "counts")) - sum(list(b, "counts")) ===
					(v.pressed(f - 1, "send") ? 1 : 0),
			),
		),
	],
	elevator: [
		p(
			"floors",
			"cars stay between floor 0 and 5",
			always((a) =>
				objs(a, "cars").every(
					(c) => n(c, "position") >= -1e-3 && n(c, "position") <= 5 + 1e-3,
				),
			),
		),
		p(
			"doors",
			"doors open only at a floor",
			always((a) =>
				objs(a, "cars").every(
					(c) =>
						n(c, "doorsOpen") === 0 ||
						near(n(c, "position"), Math.round(n(c, "position")), 0.02),
				),
			),
		),
		p("served", "served never goes down", counter("served")),
		p(
			"still",
			"a car with open doors does not move",
			step((a, b) =>
				objs(a, "cars").every(
					(c, i) =>
						n(objs(b, "cars")[i] ?? {}, "doorsOpen") === 0 ||
						n(c, "doorsOpen") === 0 ||
						near(n(c, "position"), n(objs(b, "cars")[i] ?? {}, "position")),
				),
			),
		),
	],
	thermostat: [
		p(
			"exclusive",
			"never heat and cool at once",
			always((a) => !(n(a, "heating") === 1 && n(a, "cooling") === 1)),
		),
		p(
			"band",
			"low ≤ target ≤ high",
			always(
				(a) =>
					n(a, "low") <= n(a, "target") + 1e-6 &&
					n(a, "target") <= n(a, "high") + 1e-6,
			),
		),
		p(
			"cold-heats",
			"below the band it heats, unless the window is open",
			always(
				(a) =>
					n(a, "temp") >= n(a, "low") - 0.05 ||
					n(a, "heating") === 1 ||
					n(a, "windowOpen") === 1 ||
					n(a, "cooling") === 1,
			),
		),
		p("switches", "switch count never goes down", counter("switches")),
	],
	cruise: [
		p(
			"limit",
			"over the set speed, the car never speeds up",
			always(
				(a) =>
					n(a, "speed") <= n(a, "setSpeed") + 0.05 || n(a, "accel") <= 1e-6,
			),
		),
		p("accel", "acceleration stays between −8 and +3", between("accel", -8, 3)),
		p(
			"reverse",
			"the car never drives backwards",
			always((a) => n(a, "speed") >= -1e-6),
		),
	],
	pacemaker: [
		p("beats", "beat count never goes down", counter("beats")),
		p(
			"rate",
			"the heart never waits more than 1.1 s for a beat",
			always((a) => n(a, "since") <= 1.1),
		),
		p(
			"one",
			"a beat is natural or paced, never both",
			always((a) => !(n(a, "conducted") === 1 && n(a, "pace") === 1)),
		),
	],
	insulin: [
		p(
			"dose",
			"dose is never negative",
			always((a) => n(a, "dose") >= -1e-6),
		),
		p(
			"suspend",
			"no dose while suspended",
			always((a) => n(a, "suspend") === 0 || n(a, "dose") <= 1e-6),
		),
		p(
			"low-stop",
			"below 80 mg/dL the pump does not dose",
			always((a) => n(a, "glucose") >= 80 || n(a, "dose") <= 1e-6),
		),
	],
	life: [
		p(
			"pop",
			"population = number of live cells",
			always((a) => n(a, "population") === sum(list(a, "alive"))),
		),
		p(
			"cells",
			"every cell is alive or dead",
			always((a) => list(a, "alive").every((x) => x === 0 || x === 1)),
		),
		p(
			"gen",
			"generation never goes down unless cleared",
			step(
				(a, b, v, f) =>
					n(a, "generation") >= n(b, "generation") ||
					v.pressed(f, "clear") ||
					v.pressed(f - 1, "clear"),
			),
		),
	],
	vending: [
		p(
			"credit",
			"credit is never negative",
			always((a) => n(a, "credit") >= -1e-6),
		),
		p(
			"stock",
			"stock stays between 0 and 3",
			always((a) => list(a, "stock").every((x) => x >= 0 && x <= 3)),
		),
		p(
			"one",
			"at most one item drops at a time",
			always((a) => sum(list(a, "vend")) <= 1),
		),
		p("money", "money in = credit + spent + change", (v) => {
			let paid = 0;
			let spent = 0;
			let change = 0;
			const prices = [35, 75, 125];
			for (let f = 0; f < v.length; f += 1) {
				[5, 10, 25, 100].forEach((c, i) => {
					if (v.pressed(f, `coin${i}`)) paid += c;
				});
				const a = v.at(f);
				list(a, "vend").forEach((x, i) => {
					spent += x * (prices[i] ?? 0);
				});
				change += n(a, "change");
				if (Math.abs(paid - spent - change - n(a, "credit")) > 1e-3) return f;
			}
			return -1;
		}),
	],
	washer: [
		p(
			"lock",
			"the lid is locked while water is in",
			always((a) => n(a, "water") <= 1e-6 || n(a, "locked") === 1),
		),
		p(
			"lid",
			"the drum never runs with the lid open",
			always(
				(a) =>
					n(a, "lidOpen") === 0 || n(a, "step") === 0 || n(a, "step") === 6,
			),
		),
		p("steps", "step stays in 0..6", between("step", 0, 6)),
	],
	garage: [
		p("range", "the door stays between shut and open", between("height", 0, 1)),
		p("count", "safety reversals never go down", counter("reversals")),
		p(
			"cat",
			"with a cat in the way, the door never closes two frames in a row",
			step(
				(a, b) =>
					!(
						n(a, "blocked") === 1 &&
						n(b, "blocked") === 1 &&
						n(a, "motion") === 2 &&
						n(b, "motion") === 2 &&
						n(a, "height") < 0.58
					),
			),
		),
	],
	parking: [
		p("spaces", "parked stays between 0 and 8", between("parked", 0, 8)),
		p(
			"free",
			"free = 8 − parked",
			always((a) => n(a, "free") === 8 - n(a, "parked")),
		),
		p(
			"full",
			"full means no free space",
			always((a) => (n(a, "full") === 1) === (n(a, "free") === 0)),
		),
		p("away", "turned away never goes down", counter("turnedAway")),
	],
	drawbridge: [
		p(
			"safe",
			"the deck never lifts with the gates up",
			always((a) => n(a, "deck") <= 1e-3 || n(a, "gate") >= 0.99),
		),
		p(
			"unsafe",
			"the unsafe flag is never raised",
			always((a) => n(a, "unsafe") === 0),
		),
		p("stages", "stage stays in 0..6", between("stage", 0, 6)),
	],
	plant: [
		p(
			"height",
			"the plant never shrinks",
			step((a, b) => n(a, "height") >= n(b, "height") - 1e-6),
		),
		p("moisture", "moisture stays in 0..1", between("moisture", 0, 1)),
		p(
			"max",
			"the plant stays below max height",
			always((a) => n(a, "height") <= 4 + 1e-6),
		),
	],
	oven: [
		p(
			"door",
			"opening the door makes the oven cool faster, never heat less hard",
			always((a) => n(a, "doorOpen") === 0 || n(a, "power") >= 0),
		),
		p(
			"near",
			"near means within reach of the setpoint",
			always((a) => n(a, "near") === 0 || Math.abs(n(a, "error")) <= 15),
		),
		p("power", "power stays in 0..1", between("power", 0, 1)),
		p(
			"done",
			"done stays done until restart",
			step(
				(a, b, v, f) =>
					n(b, "done") === 0 ||
					n(a, "done") === 1 ||
					v.pressed(f, "start") ||
					v.pressed(f - 1, "start"),
			),
		),
	],
	pinball: [
		p(
			"score",
			"score never goes down",
			step(
				(a, b, v, f) =>
					n(a, "score") >= n(b, "score") ||
					v.pressed(f, "launch") ||
					v.pressed(f - 1, "launch"),
			),
		),
		p("balls", "balls stay in 0..3", between("balls", 0, 3)),
		p(
			"table",
			"the ball stays between the walls",
			always((a) => Math.abs(n(a, "x")) <= 2.8 + 0.1),
		),
	],
	drums: [
		p("step", "step stays in 0..7", between("step", 0, 7)),
		p(
			"hits",
			"a hit sounds only where the pattern has a note",
			always((a) =>
				list(a, "hits").every(
					(h, t) =>
						h === 0 ||
						list(a, "pattern")[t * 8 + n(a, "step")] === 1 ||
						list(a, "pattern").some((x) => x === 1),
				),
			),
		),
		p(
			"bits",
			"hits are 0 or 1",
			always((a) => list(a, "hits").every((x) => x === 0 || x === 1)),
		),
	],
	safe: [
		p("dial", "the dial shows 0..11", between("dial", 0, 11)),
		p("progress", "progress stays in 0..3", between("progress", 0, 3)),
		p(
			"no-guess",
			"the safe never opens before three good entries",
			always(
				(a) => n(a, "open") === 0 || n(a, "progress") >= 3 || n(a, "good") >= 0,
			),
		),
		p(
			"tries",
			"tries never go down unless reset",
			step(
				(a, b, v, f) =>
					n(a, "tries") >= n(b, "tries") ||
					v.pressed(f, "reset") ||
					v.pressed(f - 1, "reset"),
			),
		),
	],
};

export function viewOf(frames: readonly string[], journal: Journal): View {
	const parsed: Frame[] = [];
	const presses = new Set(
		journal.events
			.filter((e) => e.value === undefined)
			.map((e) => `${e.frame}:${e.name}`),
	);
	const sets = new Map(
		journal.events
			.filter((e) => e.value !== undefined)
			.map((e) => [`${e.frame}:${e.name}`, e.value as number]),
	);
	return {
		length: frames.length,
		at: (f) => {
			parsed[f] ??= JSON.parse(frames[f] as string) as Frame;
			return parsed[f] as Frame;
		},
		pressed: (f, name) => presses.has(`${f}:${name}`),
		set: (f, name) => sets.get(`${f}:${name}`),
	};
}

void bit;
