import { createGarage, garagePage, type Twist } from "../pages/garage";
import { mountTickerPanel } from "../panel";
import { loop, makeScene } from "../scene";
import type { Ticker } from "../ticker";
import {
	type Journal,
	MUTANTS,
	type Mutant,
	PROPERTIES,
	type Row,
	twistOf,
} from "./court";
import type { Api, Step } from "./loop";

type Call = <K extends keyof Api>(
	name: K,
	...args: Parameters<Api[K]>
) => Promise<ReturnType<Api[K]>>;

function connect(): Call {
	const worker = new Worker(new URL("./worker.ts", import.meta.url), {
		type: "module",
	});
	const waiting = new Map<number, (value: unknown) => void>();
	let next = 0;
	worker.addEventListener(
		"message",
		(event: MessageEvent<{ id: number; result: unknown }>) => {
			waiting.get(event.data.id)?.(event.data.result);
			waiting.delete(event.data.id);
		},
	);
	return (name, ...args) =>
		new Promise((resolve) => {
			next += 1;
			waiting.set(next, resolve as (value: unknown) => void);
			worker.postMessage({ id: next, name, args });
		});
}

const el = <K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className = "",
	text = "",
) => {
	const node = document.createElement(tag);
	node.className = className;
	node.textContent = text;
	return node;
};

const add = (parent: Node, ...children: Node[]) => {
	for (const child of children) parent.appendChild(child);
};

const CHIP = "rounded-md border px-2 py-1 font-mono text-[11px] text-left";
const BUTTON =
	"rounded-md border border-white/15 bg-white/5 px-3 py-2 font-mono text-xs text-slate-100 hover:border-[#f6821f] disabled:opacity-40";

type Frame = ReturnType<ReturnType<typeof createGarage>["step"]>;
type Player = {
	twist: Twist;
	journal: Journal | null;
	frame: number;
	cat: number;
	label: string;
};

export function mountLab(ui: {
	canvas: HTMLCanvasElement;
	cells: HTMLElement;
	caption: HTMLElement;
	controls: HTMLElement;
	lesson: HTMLElement;
}) {
	const call = connect();
	const scene = makeScene(ui.canvas, [5, 3, 7]);
	const player: Player = {
		twist: twistOf(null),
		journal: null,
		frame: 0,
		cat: 0,
		label: "live · reference door",
	};
	let ticker = createGarage(player.twist) as Ticker<Frame, "remote">;
	const holder = { ticker };
	const proxy = new Proxy({} as Ticker<Frame, "remote">, {
		get: (_, key) => holder.ticker[key as keyof Ticker<Frame, "remote">],
	});
	const draw = garagePage.view(scene, proxy as never) as (
		frame: Frame,
	) => string;
	const panelHost = el("div", "flex flex-col gap-2");
	ui.cells.appendChild(panelHost);
	let panelView = mountTickerPanel(
		panelHost,
		proxy,
		() => createGarage(player.twist) as never,
		"the door you see runs the selected mutant",
	);

	const reset = (twist: Twist, journal: Journal | null, label: string) => {
		player.twist = twist;
		player.journal = journal;
		player.frame = 0;
		player.cat = 0;
		player.label = label;
		ticker = createGarage(twist) as Ticker<Frame, "remote">;
		holder.ticker = ticker;
		panelHost.replaceChildren();
		panelView = mountTickerPanel(
			panelHost,
			proxy,
			() => createGarage(player.twist) as never,
			"the door you see runs the selected mutant",
		);
	};

	const live = el("div", "flex flex-wrap gap-2");
	const remote = el("button", BUTTON, "remote ⏏");
	remote.type = "button";
	remote.addEventListener("click", () => ticker.press("remote"));
	const cat = el("button", BUTTON, "cat 🐈");
	cat.type = "button";
	cat.addEventListener("click", () => {
		player.cat = 1 - player.cat;
	});
	add(live, remote, cat);
	ui.controls.appendChild(live);

	const tabs = el("div", "mt-2 flex gap-1 font-mono text-[11px]");
	const body = el("div", "flex flex-col gap-2");
	add(ui.controls, tabs, body);
	ui.controls.className = "mt-1 flex flex-col gap-2";

	const state = {
		mutant: null as Mutant | null,
		properties: new Set(
			PROPERTIES.map((p) => p.id).filter((id) => id !== "strict-crush"),
		),
		rows: new Map<string, Row>(),
		falseAlarms: {} as Record<string, unknown>,
	};

	const views: Record<string, () => void> = {};
	const show = (name: string) => {
		for (const button of tabs.querySelectorAll("button"))
			button.classList.toggle("bg-[#f6821f]", button.dataset.tab === name);
		for (const button of tabs.querySelectorAll("button"))
			button.classList.toggle("text-black", button.dataset.tab === name);
		body.replaceChildren();
		views[name]?.();
	};
	for (const [name, label] of [
		["court", "1 · cat court"],
		["tournament", "2 · tournament"],
		["duel", "3 · two heads"],
	] as const) {
		const button = el(
			"button",
			"rounded-md border border-white/15 px-2 py-1 text-slate-200",
			label,
		);
		button.type = "button";
		button.dataset.tab = name;
		button.addEventListener("click", () => show(name));
		tabs.appendChild(button);
	}

	const replay = async (
		mutant: Mutant | null,
		propertyId: string,
		journalIndex: number,
		out: HTMLElement,
	) => {
		out.textContent = "shrinking…";
		const result = await call(
			"shrink",
			mutant?.id ?? null,
			propertyId,
			journalIndex,
		);
		if (!result) return;
		out.textContent = `shrunk ${result.original.events.length} events / ${result.original.length} frames → ${result.journal.events.length} events / ${result.journal.length} frames in ${result.tries} replays (${result.ms.toFixed(0)} ms). Playing on the door.`;
		const steps = el(
			"ol",
			"mt-1 list-decimal pl-5 font-mono text-[11px] text-slate-300",
		);
		for (const e of result.journal.events)
			steps.appendChild(
				el(
					"li",
					"",
					`frame ${e.frame}: ${e.kind === "remote" ? "press remote" : "cat toggles"}`,
				),
			);
		out.appendChild(steps);
		reset(
			twistOf(mutant),
			result.journal,
			`replay · ${mutant?.label ?? "reference"} · shortest failing journal`,
		);
	};

	const mutantPicker = (onPick: (m: Mutant | null) => void) => {
		const grid = el("div", "grid grid-cols-1 gap-1 sm:grid-cols-2");
		const options: (Mutant | null)[] = [null, ...MUTANTS];
		for (const mutant of options) {
			const row = mutant ? state.rows.get(mutant.id) : undefined;
			const killed =
				row &&
				PROPERTIES.some(
					(p) =>
						state.properties.has(p.id) &&
						row.kills[p.id] &&
						!state.falseAlarms[p.id],
				);
			const equivalent = row && row.difference === null;
			const tone = !mutant
				? "border-sky-400/40 text-sky-200"
				: !row
					? "border-white/10 text-slate-300"
					: equivalent
						? "border-slate-500/40 text-slate-400"
						: killed
							? "border-rose-400/50 text-rose-200"
							: "border-amber-300 text-amber-200 shadow-[0_0_12px_#f59e0b]";
			const chip = el(
				"button",
				`${CHIP} ${tone} ${state.mutant === mutant ? "bg-white/10" : ""}`,
				mutant
					? `${mutant.cell}: ${mutant.label}${row ? (equivalent ? " · equivalent" : killed ? " · killed" : " · SURVIVOR") : ""}`
					: "reference door (no mutant)",
			);
			chip.type = "button";
			chip.dataset.mutant = mutant?.id ?? "reference";
			chip.addEventListener("click", () => onPick(mutant));
			grid.appendChild(chip);
		}
		return grid;
	};

	const ensureRows = async (status: HTMLElement) => {
		if (Object.keys(state.falseAlarms).length === 0)
			state.falseAlarms = Object.fromEntries(
				Object.entries(await call("reference")).filter(([, v]) => v),
			);
		for (const mutant of MUTANTS) {
			if (state.rows.has(mutant.id)) continue;
			status.textContent = `fuzzing ${mutant.label}: 60 journals × 600 frames…`;
			const row = await call("row", mutant.id);
			if (row) state.rows.set(mutant.id, row);
		}
		status.textContent = "";
	};

	views.court = () => {
		body.appendChild(
			el(
				"p",
				"text-xs text-slate-300",
				"Pick a mutant. The door now runs it, so press the remote and drop the cat. Then let 60 random journals put it on trial. On a kill, the shrinker cuts the journal to the shortest one that still fails and replays it on the door.",
			),
		);
		const status = el("p", "font-mono text-[11px] text-slate-400");
		const verdict = el(
			"div",
			"rounded-md border border-white/10 p-2 text-xs text-slate-200",
		);
		const picker = el("div");
		const render = () => picker.replaceChildren(mutantPicker(pick));
		const pick = async (mutant: Mutant | null) => {
			state.mutant = mutant;
			reset(
				twistOf(mutant),
				null,
				`live · ${mutant?.label ?? "reference door"}`,
			);
			render();
			verdict.textContent = "on trial…";
			const row = mutant
				? (state.rows.get(mutant.id) ?? (await call("row", mutant.id)))
				: null;
			if (mutant && row) state.rows.set(mutant.id, row);
			render();
			verdict.replaceChildren();
			if (!mutant) {
				verdict.textContent =
					"Reference door. Every fair property passes. Try the too-strict property in the tournament: it fails here too, so it is a bad test.";
				return;
			}
			if (!row) return;
			const kill = PROPERTIES.find(
				(p) => row.kills[p.id] && !state.falseAlarms[p.id],
			);
			if (row.difference === null) {
				verdict.appendChild(
					el(
						"p",
						"text-slate-300",
						"Survives every property, but it is an EQUIVALENT mutant. Replay: all 60 journals × 600 frames give output identical to the reference door, bit for bit. It changed code, not behaviour. No test can kill it, and none should.",
					),
				);
				return;
			}
			const d = row.difference;
			verdict.appendChild(
				el(
					"p",
					"font-mono text-[11px] text-sky-200",
					`first divergence: journal ${d.journal}, frame ${d.frame}: ${d.outputs.map((o) => `${o.field} expected ${o.expected.toFixed(3)} got ${o.actual.toFixed(3)}`).join("; ")}`,
				),
			);
			if (!kill) {
				verdict.appendChild(
					el(
						"p",
						"text-amber-200",
						"SURVIVOR. The behaviour differs (see above), but no property notices. This is a gap in your spec, not a mistake by the mutant. Go to the tournament and find a property that kills it, or see that none exists yet.",
					),
				);
				return;
			}
			const v = row.kills[kill.id];
			verdict.appendChild(
				el(
					"p",
					"text-rose-200",
					`KILLED by “${kill.label}” in journal ${v?.journal}, frame ${v?.frame}.`,
				),
			);
			const out = el("div", "text-[11px] text-slate-300");
			verdict.appendChild(out);
			await replay(mutant, kill.id, v?.journal ?? 0, out);
		};
		render();
		add(body, status, picker, verdict);
		void ensureRows(status).then(render);
	};

	views.tournament = () => {
		body.appendChild(
			el(
				"p",
				"text-xs text-slate-300",
				"Toggle properties. The score counts only mutants that change behaviour, because equivalent mutants cannot be killed. A property that fails on the real door is a false alarm and scores nothing.",
			),
		);
		const status = el("p", "font-mono text-[11px] text-slate-400");
		const meter = el("div", "rounded-md border border-white/10 p-2");
		const props = el("div", "flex flex-col gap-1");
		const grid = el("div", "overflow-x-auto");
		const render = () => {
			const live = MUTANTS.filter((m) => state.rows.get(m.id)?.difference);
			const killed = live.filter((m) =>
				PROPERTIES.some(
					(p) =>
						state.properties.has(p.id) &&
						!state.falseAlarms[p.id] &&
						state.rows.get(m.id)?.kills[p.id],
				),
			);
			const equivalents = MUTANTS.filter(
				(m) => state.rows.get(m.id) && !state.rows.get(m.id)?.difference,
			).length;
			const pct = live.length
				? Math.round((100 * killed.length) / live.length)
				: 0;
			meter.replaceChildren(
				el(
					"p",
					"font-mono text-sm text-white",
					`mutation score ${killed.length}/${live.length} = ${pct}%`,
				),
				el(
					"p",
					"font-mono text-[11px] text-slate-400",
					`${equivalents} equivalent (proved by replay, excluded) · ${MUTANTS.length - state.rows.size} not yet fuzzed`,
				),
			);
			const bar = el("div", "mt-1 h-2 rounded bg-white/10");
			const fill = el("div", "h-2 rounded bg-[#f6821f] transition-all");
			fill.style.width = `${pct}%`;
			bar.appendChild(fill);
			meter.appendChild(bar);
			props.replaceChildren();
			for (const p of PROPERTIES) {
				const kills = live.filter(
					(m) => state.rows.get(m.id)?.kills[p.id],
				).length;
				const alarm = Boolean(state.falseAlarms[p.id]);
				const label = el(
					"label",
					`flex items-start gap-2 text-xs ${alarm ? "text-rose-300" : "text-slate-200"}`,
				);
				const box = document.createElement("input");
				box.type = "checkbox";
				box.checked = state.properties.has(p.id);
				box.dataset.property = p.id;
				box.className = "mt-0.5 accent-[#f6821f]";
				box.addEventListener("change", () => {
					if (box.checked) state.properties.add(p.id);
					else state.properties.delete(p.id);
					render();
				});
				add(
					label,
					box,
					el(
						"span",
						"",
						`${p.label} · ${alarm ? "FALSE ALARM: fails the real door" : `kills ${kills}`}`,
					),
				);
				if (alarm) {
					const why = el("button", "ml-auto shrink-0 underline", "why?");
					why.type = "button";
					const out = el("div", "text-[11px] text-slate-300");
					why.addEventListener(
						"click",
						() =>
							void replay(
								null,
								p.id,
								(state.falseAlarms[p.id] as { journal: number }).journal,
								out,
							),
					);
					label.appendChild(why);
					add(props, label, out);
				} else props.appendChild(label);
			}
			const table = el("table", "font-mono text-[10px] text-slate-300");
			const head = el("tr");
			head.appendChild(el("th", "pr-2 text-left", "mutant ↓ / property →"));
			PROPERTIES.forEach((_, i) =>
				head.appendChild(el("th", "px-1", `P${i + 1}`)),
			);
			table.appendChild(head);
			for (const m of MUTANTS) {
				const row = state.rows.get(m.id);
				const tr = el("tr");
				tr.appendChild(
					el(
						"td",
						`pr-2 ${row && !row.difference ? "text-slate-500" : ""}`,
						m.id,
					),
				);
				for (const p of PROPERTIES) {
					const hit = row?.kills[p.id];
					const cell = el(
						"td",
						`px-1 text-center ${!row ? "" : !row.difference ? "text-slate-600" : hit && !state.falseAlarms[p.id] ? "text-rose-300" : "text-slate-600"}`,
						!row ? "…" : !row.difference ? "≡" : hit ? "✕" : "·",
					);
					tr.appendChild(cell);
				}
				table.appendChild(tr);
			}
			grid.replaceChildren(
				table,
				el(
					"p",
					"font-mono text-[10px] text-slate-500",
					"✕ kill · · survives · ≡ equivalent mutant",
				),
			);
		};
		render();
		add(body, status, meter, props, grid);
		void ensureRows(status).then(render);
	};

	views.duel = () => {
		body.appendChild(
			el(
				"p",
				"text-xs text-slate-300",
				"One planted bug, three agents. Two hunters claim a fix. The circuit replays each claim: the file must misbehave AND the fix must restore the reference door, or the claim is rejected. One hunter gets the first divergence back as a hint, one does not. The third agent writes properties instead of fixes. Scripted agents, not a model: the loop is real, the guesses are rule based.",
			),
		);
		const out = el("div", "flex flex-col gap-2");
		const picker = el("div");
		const lane = (title: string, steps: Step[]) => {
			const box = el("div", "rounded-md border border-white/10 p-2");
			const last = steps.at(-1);
			box.appendChild(
				el(
					"p",
					"font-mono text-[11px] text-white",
					`${title}: ${steps.length} attempt${steps.length === 1 ? "" : "s"} · ${last?.replays ?? 0} replays · ${last?.verdict ?? ""}`,
				),
			);
			const list = el("ol", "mt-1 flex flex-col gap-1");
			for (const step of steps) {
				const ok =
					step.verdict.startsWith("accepted") ||
					step.verdict.startsWith("killed");
				const li = el(
					"li",
					`font-mono text-[10px] ${ok ? "text-emerald-300" : "text-slate-300"}`,
				);
				li.appendChild(el("div", "", `#${step.attempt} claim → ${step.claim}`));
				li.appendChild(el("div", "pl-3 text-slate-500", `why: ${step.note}`));
				li.appendChild(
					el(
						"div",
						`pl-3 ${ok ? "" : "text-rose-300"}`,
						`circuit → ${step.verdict}`,
					),
				);
				if (step.hint && step.lane === "hinted" && !ok)
					li.appendChild(
						el(
							"div",
							"pl-3 text-sky-300",
							`↩ hint: frame ${step.hint.frame}, ${step.hint.outputs.map((o) => `${o.field} ${o.expected.toFixed(2)}≠${o.actual.toFixed(2)}`).join(", ")}`,
						),
					);
				list.appendChild(li);
			}
			box.appendChild(list);
			return box;
		};
		const pick = async (mutant: Mutant | null) => {
			if (!mutant) return;
			state.mutant = mutant;
			reset(twistOf(mutant), null, `live · planted: ${mutant.label}`);
			picker.replaceChildren(mutantPicker(pick));
			out.replaceChildren(
				el("p", "font-mono text-[11px] text-slate-400", "agents running…"),
			);
			const [hinted, blind, writer] = await Promise.all([
				call("hunt", mutant.id, true),
				call("hunt", mutant.id, false),
				call("write", mutant.id),
			]);
			out.replaceChildren(
				lane("hunter + hint", hinted),
				lane("hunter, blind", blind),
				lane("property writer", writer),
			);
		};
		picker.appendChild(mutantPicker(pick));
		add(body, picker, out);
	};

	show("court");

	loop(() => {
		if (player.journal) {
			if (player.frame >= player.journal.length) {
				reset(player.twist, player.journal, player.label);
			}
			for (const e of player.journal.events) {
				if (e.frame !== player.frame) continue;
				if (e.kind === "remote") ticker.press("remote");
				else player.cat = 1 - player.cat;
			}
			player.frame += 1;
		}
		ticker.set("blocked", player.cat);
		const text = draw(ticker.step());
		ui.caption.textContent = `${text} · ${player.journal ? `replay ${player.frame}/${player.journal.length}` : "live"}`;
		panelView();
		scene.renderer.render(scene.scene, scene.camera);
	});
}
