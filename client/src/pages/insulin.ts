import {
	createSourceTable,
	event,
	input,
	state,
} from "handwired/src/runtime/cells.ts";
import {
	emitMaximum,
	emitMinimum,
	emitRelu,
	emitSelect,
} from "handwired/src/runtime/numeric-ui-core.ts";
import * as THREE from "three";
import { definePage } from "../kit";
import { box } from "../scene";
import { createTicker, DT, gates, wiresOf } from "../ticker";

export const BODY = { target: 110, low: 70, high: 180, timeScale: 20 } as const;

export function buildInsulin() {
	const table = createSourceTable();
	const cells = table.declare({
		meal: event(),
		run: event(),
		dt: input([0, 0.1]),
		glucose: state([20, 400], { initial: 140 }),
		previous: state([20, 400], { initial: 140 }),
		gut: state([0, 200]),
		active: state([0, 20]),
		exercise: state([0, 1]),
		lowTime: state([0, 1e6]),
		highTime: state([0, 1e6]),
	});
	const circuit = table.createCircuit();
	const { above, below } = gates(circuit);
	const c = (k: number) => circuit.constant(k);
	const minute = BODY.timeScale * DT;
	const gut = emitMinimum(
		circuit,
		c(200),
		circuit.affine([
			[cells.gut, 1 - 0.02 * minute],
			[cells.meal, 60],
		]),
	);
	const absorbed = circuit.affine([[cells.gut, 0.02 * minute]]);
	const trend = circuit.affine([
		[cells.glucose, 1],
		[cells.previous, -1],
	]);
	const predicted = circuit.affine([
		[cells.glucose, 1],
		[trend, 30 / minute],
	]);
	const want = emitRelu(
		circuit,
		circuit.affine([[predicted, 0.004]], -BODY.target * 0.004),
	);
	const suspend = below(predicted, BODY.low + 10);
	const dose = emitSelect(
		circuit,
		suspend,
		emitMinimum(circuit, want, c(0.5)),
		c(0),
	);
	const active = circuit.affine([
		[cells.active, 1 - 0.03 * minute],
		[dose, minute],
	]);
	const exercise = emitSelect(
		circuit,
		cells.run,
		circuit.affine([[cells.exercise, 1 - 0.01 * minute]]),
		c(1),
	);
	const burn = circuit.affine([
		[active, 0.6 * minute],
		[exercise, 1.2 * minute],
	]);
	const glucose = emitMaximum(
		circuit,
		c(25),
		circuit.affine(
			[
				[cells.glucose, 1],
				[absorbed, 3],
				[burn, -1],
			],
			0.5 * minute,
		),
	);
	table.next(cells.glucose, glucose);
	table.next(cells.previous, cells.glucose);
	table.next(cells.gut, gut);
	table.next(cells.active, active);
	table.next(cells.exercise, exercise);
	table.next(
		cells.lowTime,
		circuit.affine([
			[cells.lowTime, 1],
			[below(glucose, BODY.low), 1],
		]),
	);
	table.next(
		cells.highTime,
		circuit.affine([
			[cells.highTime, 1],
			[above(glucose, BODY.high), 1],
		]),
	);
	const output = {
		glucose,
		trend,
		predicted,
		dose,
		active,
		exercise,
		gut,
		suspend,
		lowTime: cells.lowTime,
		highTime: cells.highTime,
	};
	const layout = [
		{ label: "blood", wires: wiresOf({ g: cells.glucose, p: cells.previous }) },
		{
			label: "body",
			wires: wiresOf({ g: cells.gut, a: cells.active, e: cells.exercise }),
		},
		{
			label: "time out",
			wires: wiresOf({ l: cells.lowTime, h: cells.highTime }),
		},
	];
	return {
		...table.finish(),
		output,
		events: { meal: cells.meal, run: cells.run },
		dt: cells.dt,
		layout,
	};
}

export const createInsulin = () => createTicker(buildInsulin());
type Frame = ReturnType<ReturnType<typeof createInsulin>["step"]>;

export const insulinPage = definePage({
	slug: "insulin",
	title: "insulin pump",
	topic: "predictive control · safety limits",
	lesson:
		"An artificial pancreas looks ahead: it guesses where sugar will be in 30 minutes from where it is and which way it is moving. A meal makes it dose early. A run makes sugar fall, so it stops dosing before you go low, not after. Green is the safe band.",
	eye: [0, 3, 9],
	make: createInsulin,
	controls: [
		{ kind: "button", label: "eat a meal 🍝", event: "meal" },
		{ kind: "button", label: "go for a run 🏃", event: "run" },
	],
	view: ({ scene, aim }) => {
		aim(0, 2.6, 0);
		const band = box(10, (BODY.high - BODY.low) / 50, 0.05, 0x0f3d24);
		band.position.set(0, (BODY.low + BODY.high) / 2 / 50, -0.2);
		scene.add(band);
		const dots = Array.from({ length: 90 }, () => {
			const dot = new THREE.Mesh(
				new THREE.SphereGeometry(0.07, 8, 6),
				new THREE.MeshStandardMaterial({ color: 0xf6821f }),
			);
			dot.visible = false;
			scene.add(dot);
			return dot;
		});
		let next = 0;
		let tick = 0;
		const guess = new THREE.Line(
			new THREE.BufferGeometry(),
			new THREE.LineBasicMaterial({ color: 0x71b8d8 }),
		);
		scene.add(guess);
		const pump = box(0.8, 0.5, 0.3, 0x94a3b8);
		pump.position.set(4.3, 0.4, 0.4);
		scene.add(pump);
		let x = -5;
		return (frame: Frame) => {
			x += DT * 0.5;
			if (x > 4) x = -5;
			const y = frame.glucose / 50;
			tick += 1;
			if (tick % 6 === 0) {
				const dot = dots[next % dots.length];
				next += 1;
				if (dot !== undefined) {
					dot.visible = true;
					dot.position.set(x, y, 0);
					(dot.material as THREE.MeshStandardMaterial).color.setHex(
						y * 50 < BODY.low || y * 50 > BODY.high ? 0xef4444 : 0xf6821f,
					);
				}
			}
			guess.geometry.setFromPoints([
				new THREE.Vector3(x, y, 0),
				new THREE.Vector3(x + 0.8, Math.max(0.4, frame.predicted / 50), 0),
			]);
			(pump.material as THREE.MeshStandardMaterial).emissive.setRGB(
				frame.dose * 1.5,
				frame.dose * 0.8,
				0,
			);
			const state =
				frame.suspend === 1
					? "SUSPENDED: low ahead"
					: frame.dose > 0.05
						? "dosing"
						: "waiting";
			const arrow = frame.trend > 0.05 ? "↑" : frame.trend < -0.05 ? "↓" : "→";
			return `sugar ${Math.round(frame.glucose)} ${arrow} · in 30 min ≈ ${Math.round(frame.predicted)} · pump ${state}`;
		};
	},
});
