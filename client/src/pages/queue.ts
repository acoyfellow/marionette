import {
	createSourceTable,
	event,
	input,
	list,
	state,
	stateBit,
} from "handwired/src/runtime/cells.ts";
import {
	emitMinimum,
	emitRelu,
	emitSelect,
	type Wire,
} from "handwired/src/runtime/numeric-ui-core.ts";
import * as THREE from "three";
import { definePage } from "../kit";
import { box } from "../scene";
import { createTicker, DT, gates, wiresOf } from "../ticker";

export const QUEUE = {
	capacity: 30,
	consumers: 3,
	perConsumer: 4,
	high: 0.8,
	low: 0.4,
} as const;

export function buildQueue() {
	const table = createSourceTable();
	const cells = table.declare({
		dt: input([0, 0.1]),
		rate: input([0, 30]),
		toggle: list(QUEUE.consumers, () => event()),
		depth: state([0, QUEUE.capacity]),
		up: list(QUEUE.consumers, (i) => stateBit(i === 0 ? 1 : 1)),
		throttled: stateBit(0),
		rejected: state([0, 1e7]),
		done: state([0, 1e7]),
	});
	const circuit = table.createCircuit();
	const { all, not, above, below, either } = gates(circuit);
	const flip = (bit: Wire, toggle: Wire) =>
		circuit.affine([
			[bit, 1],
			[toggle, 1],
			[circuit.multiply(toggle, bit), -2],
		]);
	const ups = cells.up.map((bit, i) =>
		flip(bit, cells.toggle[i] ?? circuit.constant(0)),
	);
	const workers = circuit.affine(ups.map((bit) => [bit, 1] as const));
	const fill = circuit.affine([[cells.depth, 1 / QUEUE.capacity]]);
	const throttled = either(
		above(fill, QUEUE.high),
		all(cells.throttled, not(below(fill, QUEUE.low))),
	);
	const allowed = emitSelect(
		circuit,
		throttled,
		cells.rate,
		circuit.multiply(cells.rate, circuit.constant(0.25)),
	);
	const inflow = circuit.affine([[allowed, DT]]);
	const outflow = emitMinimum(
		circuit,
		circuit.affine([[workers, QUEUE.perConsumer * DT]]),
		circuit.affine([
			[cells.depth, 1],
			[inflow, 1],
		]),
	);
	const raw = circuit.affine([
		[cells.depth, 1],
		[inflow, 1],
		[outflow, -1],
	]);
	const overflow = emitRelu(
		circuit,
		circuit.affine([[raw, 1]], -QUEUE.capacity),
	);
	const depth = emitRelu(
		circuit,
		circuit.affine([
			[raw, 1],
			[overflow, -1],
		]),
	);
	const shed = circuit.affine([
		[cells.rate, DT],
		[inflow, -1],
		[overflow, 1],
	]);
	table.next(cells.depth, depth);
	cells.up.forEach((bit, i) => table.next(bit, ups[i] ?? circuit.constant(0)));
	table.next(cells.throttled, throttled);
	table.next(
		cells.rejected,
		circuit.affine([
			[cells.rejected, 1],
			[shed, 1],
		]),
	);
	table.next(
		cells.done,
		circuit.affine([
			[cells.done, 1],
			[outflow, 1],
		]),
	);
	const output = {
		depth,
		fill,
		throttled,
		ups,
		workers,
		rejected: cells.rejected,
		done: cells.done,
		overflow,
	};
	const layout = [
		{ label: "queue", wires: wiresOf({ d: cells.depth, t: cells.throttled }) },
		{ label: "workers", wires: wiresOf(cells.up) },
		{ label: "totals", wires: wiresOf({ r: cells.rejected, d: cells.done }) },
	];
	const events = Object.fromEntries(
		cells.toggle.map((bit, i) => [`toggle${i}`, bit]),
	) as Record<string, Wire>;
	return {
		...table.finish(),
		output,
		events,
		inputs: { rate: cells.rate },
		dt: cells.dt,
		layout,
	};
}

export const createQueue = () => createTicker(buildQueue());
type Frame = ReturnType<ReturnType<typeof createQueue>["step"]>;

export const queuePage = definePage({
	slug: "queue",
	title: "message queue",
	topic: "backpressure · hysteresis",
	lesson:
		"Producers fill the tank, workers drain it. Past 80% full, the queue tells producers to slow down, and it only lifts the limit once the tank is back under 40%. That gap stops it flapping on and off. Switch off workers and watch the pressure build.",
	eye: [0, 5, 10],
	make: createQueue,
	controls: [
		{
			kind: "slider",
			label: "producers",
			input: "rate",
			min: 0,
			max: 30,
			step: 1,
			initial: 10,
		},
		...Array.from({ length: QUEUE.consumers }, (_, i) => ({
			kind: "button" as const,
			label: `worker ${i + 1} on/off`,
			event: `toggle${i}`,
		})),
	],
	view: ({ scene }) => {
		const tank = new THREE.Mesh(
			new THREE.CylinderGeometry(1.4, 1.4, 4, 32, 1, true),
			new THREE.MeshStandardMaterial({
				color: 0x94a3b8,
				transparent: true,
				opacity: 0.18,
				side: THREE.DoubleSide,
			}),
		);
		tank.position.y = 2;
		scene.add(tank);
		const water = new THREE.Mesh(
			new THREE.CylinderGeometry(1.35, 1.35, 1, 32),
			new THREE.MeshStandardMaterial({ color: 0x71b8d8 }),
		);
		scene.add(water);
		const marks = [QUEUE.high, QUEUE.low].map((level, i) => {
			const ring = new THREE.Mesh(
				new THREE.TorusGeometry(1.45, 0.03, 8, 40),
				new THREE.MeshStandardMaterial({
					color: i === 0 ? 0xef4444 : 0x34d399,
				}),
			);
			ring.rotation.x = Math.PI / 2;
			ring.position.y = level * 4;
			scene.add(ring);
			return ring;
		});
		const valve = box(0.8, 0.5, 0.8, 0x34d399);
		valve.position.set(-3, 4.2, 0);
		scene.add(valve);
		const pumps = Array.from({ length: QUEUE.consumers }, (_, i) => {
			const pump = box(0.8, 0.8, 0.8, 0xf6821f);
			pump.position.set(2.6, 0.4, (i - 1) * 1.2);
			scene.add(pump);
			return pump;
		});
		void marks;
		return (frame: Frame) => {
			const level = Math.max(0.02, frame.fill * 4);
			water.scale.y = level;
			water.position.y = level / 2;
			(water.material as THREE.MeshStandardMaterial).color.setHex(
				frame.fill > QUEUE.high
					? 0xf43f5e
					: frame.fill > QUEUE.low
						? 0xfbbf24
						: 0x71b8d8,
			);
			(valve.material as THREE.MeshStandardMaterial).color.setHex(
				frame.throttled === 1 ? 0xef4444 : 0x34d399,
			);
			valve.scale.y = frame.throttled === 1 ? 0.4 : 1;
			pumps.forEach((pump, i) => {
				const on = frame.ups[i] === 1;
				(pump.material as THREE.MeshStandardMaterial).color.setHex(
					on ? 0xf6821f : 0x334155,
				);
				pump.rotation.y += on ? 0.08 : 0;
			});
			return `${Math.round(frame.fill * 100)}% full · ${frame.throttled === 1 ? "SLOW DOWN signal on" : "accepting"} · ${frame.workers} workers · rejected ${Math.round(frame.rejected)}`;
		};
	},
});
