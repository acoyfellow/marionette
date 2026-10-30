import type { AnyPage } from "../kit";
import { mountTickerPanel } from "../panel";
import { loop, makeScene } from "../scene";
import { createTicker, type Ticker } from "../ticker";
import "./builders";
import type { Report, Row, Step } from "./court-api";
import { type Journal, machineOf, patchedProgram } from "./engine";
import type { Api } from "./worker";

type Call = <K extends keyof Api>(
	name: K,
	...args: Parameters<Api[K]>
) => Promise<ReturnType<Api[K]>>;
type AnyTicker = Ticker<unknown, string>;

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
const BUTTON =
	"rounded-md border border-white/15 bg-white/5 px-3 py-2 font-mono text-xs text-slate-100 hover:border-[#f6821f]";
const CHIP = "rounded-md border px-2 py-1 text-left font-mono text-[11px]";

export type CourtUi = {
	canvas: HTMLCanvasElement;
	cells: HTMLElement;
	caption: HTMLElement;
	controls: HTMLElement;
	lesson: HTMLElement;
};

export function mountCourt(pages: readonly AnyPage[], ui: CourtUi) {
	const params = new URLSearchParams(location.search);
	const page =
		pages.find((p) => p.slug === params.get("m")) ??
		pages.find((p) => p.slug === "parking") ??
		(pages[0] as AnyPage);
	const machine = machineOf(page);
	const call = connect();
	const scene = makeScene(ui.canvas, page.eye);

	const player = {
		journal: null as Journal | null,
		frame: 0,
		label: "live · the real machine",
		siteId: null as string | null,
	};
	const make = () => {
		const site = machine.sites.find((s) => s.id === player.siteId);
		return createTicker(
			patchedProgram(machine, site ? [site] : []),
		) as unknown as AnyTicker;
	};
	const holder = { ticker: make() };
	const proxy = new Proxy({} as AnyTicker, {
		get: (_, key) => holder.ticker[key as keyof AnyTicker],
	});
	const draw = page.view(scene, proxy as never) as (frame: unknown) => string;
	const panelHost = el("div", "flex flex-col gap-2");
	ui.cells.appendChild(panelHost);
	let panel = mountTickerPanel(
		panelHost,
		proxy,
		make,
		"every cell of the circuit you are driving",
	);
	const sliders = new Map<string, HTMLInputElement>();
	const reset = (
		siteId: string | null,
		journal: Journal | null,
		label: string,
	) => {
		player.siteId = siteId;
		player.journal = journal;
		player.frame = 0;
		player.label = label;
		holder.ticker = make();
		for (const s of machine.sliders) {
			const input = sliders.get(s.input);
			if (input) input.value = String(s.initial);
			holder.ticker.set(s.input, s.initial);
		}
		panelHost.replaceChildren();
		panel = mountTickerPanel(
			panelHost,
			proxy,
			make,
			"every cell of the circuit you are driving",
		);
	};

	const picker = el(
		"select",
		"w-full rounded-md border border-white/15 bg-[#0b1118] px-2 py-2 font-mono text-xs text-white",
	);
	picker.setAttribute("aria-label", "machine");
	for (const p of pages) {
		const option = el("option", "", p.title);
		option.value = p.slug;
		option.selected = p.slug === page.slug;
		picker.appendChild(option);
	}
	picker.addEventListener("change", () => {
		const url = new URL(location.href);
		url.searchParams.set("m", picker.value);
		location.href = url.toString();
	});

	const controls = el("div", "flex flex-wrap gap-2");
	for (const control of page.controls) {
		if (control.kind === "button") {
			const b = el("button", BUTTON, control.label);
			b.type = "button";
			b.addEventListener("click", () => holder.ticker.press(control.event));
			controls.appendChild(b);
			continue;
		}
		const label = el(
			"label",
			"flex items-center gap-2 font-mono text-xs text-slate-200",
			control.label,
		);
		const range = document.createElement("input");
		range.type = "range";
		range.min = String(control.min);
		range.max = String(control.max);
		range.step = String(control.step);
		range.value = String(control.initial);
		range.className = "w-24 accent-[#f6821f]";
		range.addEventListener("input", () =>
			holder.ticker.set(control.input, Number(range.value)),
		);
		holder.ticker.set(control.input, control.initial);
		sliders.set(control.input, range);
		label.appendChild(range);
		controls.appendChild(label);
	}

	const tabs = el("div", "flex gap-1 font-mono text-[11px]");
	const body = el("div", "flex flex-col gap-2");
	ui.controls.className = "mt-1 flex flex-col gap-2";
	add(ui.controls, picker, controls, tabs, body);

	const state = {
		report: null as Report | null,
		selected: null as Row | null,
		picked: new Set<string>(),
	};
	const views: Record<string, () => void> = {};
	const show = (name: string) => {
		for (const b of tabs.querySelectorAll<HTMLElement>("button")) {
			const on = b.dataset.tab === name;
			b.classList.toggle("bg-[#f6821f]", on);
			b.classList.toggle("text-black", on);
		}
		body.replaceChildren();
		views[name]?.();
	};
	for (const [name, label] of [
		["court", "1 · break it"],
		["tournament", "2 · score the tests"],
		["duel", "3 · robots fix it"],
	] as const) {
		const b = el(
			"button",
			"flex-1 rounded-md border border-white/15 px-2 py-1 text-slate-200",
			label,
		);
		b.type = "button";
		b.dataset.tab = name;
		b.addEventListener("click", () => show(name));
		tabs.appendChild(b);
	}

	const status = el(
		"p",
		"font-mono text-[11px] text-slate-400",
		`fuzzing ${page.title}: 24 random journals × 480 frames per change…`,
	);
	const loaded = call("report", page.slug).then((r) => {
		state.report = r;
		for (const p of r.properties)
			if (!r.falseAlarms[p.id]) state.picked.add(p.id);
		status.textContent = "";
		return r;
	});

	const killedBy = (row: Row) =>
		(state.report?.properties ?? []).find(
			(p) =>
				state.picked.has(p.id) &&
				!state.report?.falseAlarms[p.id] &&
				row.kills[p.id],
		);
	const toneOf = (row: Row) =>
		!row.difference
			? "border-slate-600/50 text-slate-400"
			: killedBy(row)
				? "border-rose-400/50 text-rose-200"
				: "border-amber-300 text-amber-200 shadow-[0_0_10px_#f59e0b]";
	const tagOf = (row: Row) =>
		!row.difference ? "changes nothing" : killedBy(row) ? "caught" : "SURVIVOR";

	const chips = (
		onPick: (row: Row) => void,
		filter: (row: Row) => boolean = () => true,
	) => {
		const grid = el("div", "grid grid-cols-1 gap-1 sm:grid-cols-2");
		for (const row of state.report?.rows.filter(filter) ?? []) {
			const chip = el(
				"button",
				`${CHIP} ${toneOf(row)} ${state.selected?.site.id === row.site.id ? "bg-white/10" : ""}`,
				`${row.site.label} · ${tagOf(row)}`,
			);
			chip.type = "button";
			chip.dataset.site = row.site.id;
			chip.addEventListener("click", () => onPick(row));
			grid.appendChild(chip);
		}
		return grid;
	};

	const playShrunk = async (
		row: Row,
		propertyId: string,
		journal: number,
		out: HTMLElement,
	) => {
		out.textContent = "shrinking the failing journal…";
		const result = await call(
			"shrink",
			page.slug,
			row.site.id,
			propertyId,
			journal,
		);
		if (!result) return;
		out.replaceChildren(
			el(
				"p",
				"",
				`shrunk ${result.original.events.length} inputs over ${result.original.length} frames → ${result.journal.events.length} inputs over ${result.journal.length} frames, in ${result.tries} replays (${result.ms.toFixed(0)} ms). Playing it on the broken machine now:`,
			),
		);
		const list = el("ol", "mt-1 list-decimal pl-5");
		for (const e of result.journal.events)
			list.appendChild(
				el(
					"li",
					"",
					`frame ${e.frame}: ${e.value === undefined ? `press ${e.name}` : `set ${e.name} = ${e.value}`}`,
				),
			);
		if (result.journal.events.length === 0)
			list.appendChild(el("li", "", "no input at all: it breaks on its own"));
		out.appendChild(list);
		reset(row.site.id, result.journal, "replay · shortest failing journal");
	};

	views.court = () => {
		add(
			body,
			el(
				"p",
				"text-xs text-slate-300",
				"Each chip is one small change to this machine’s circuit: a compare stuck on yes or no, a choice stuck on one branch, or a number changed. Pick one. The machine above now runs the broken circuit, so poke it. Then read the verdict.",
			),
			status,
		);
		const grid = el("div");
		const verdict = el(
			"div",
			"flex flex-col gap-1 rounded-md border border-white/10 p-2 text-xs text-slate-200",
		);
		const render = () => grid.replaceChildren(chips(pick));
		const pick = async (row: Row) => {
			state.selected = row;
			reset(row.site.id, null, `live · broken: ${row.site.label}`);
			render();
			verdict.replaceChildren();
			if (!row.difference) {
				verdict.appendChild(
					el(
						"p",
						"text-slate-300",
						"This change does nothing you can see. 24 random journals × 480 frames give the same outputs as the real machine. Code changed, behaviour did not. No test can catch it, and none should.",
					),
				);
				return;
			}
			const d = row.difference;
			verdict.appendChild(
				el(
					"p",
					"font-mono text-[11px] text-sky-200",
					`first difference: journal ${d.journal}, frame ${d.frame}: ${d.outputs
						.slice(0, 3)
						.map((o) => `${o.field} should be ${o.expected}, got ${o.actual}`)
						.join("; ")}`,
				),
			);
			const killer = killedBy(row);
			if (!killer) {
				verdict.appendChild(
					el(
						"p",
						"text-amber-200",
						"SURVIVOR. The machine behaves differently, but none of the tests notices. That is a hole in the tests. Tab 2 shows which tests catch what.",
					),
				);
				return;
			}
			const kill = row.kills[killer.id];
			verdict.appendChild(
				el(
					"p",
					"text-rose-200",
					`CAUGHT by the test “${killer.label}” in journal ${kill?.journal}, frame ${kill?.frame}.`,
				),
			);
			const out = el("div", "font-mono text-[11px] text-slate-300");
			verdict.appendChild(out);
			await playShrunk(row, killer.id, kill?.journal ?? 0, out);
		};
		add(body, grid, verdict);
		void loaded.then(render);
	};

	views.tournament = () => {
		add(
			body,
			el(
				"p",
				"text-xs text-slate-300",
				"Turn tests on and off. The score counts only changes that alter behaviour. A test that fails on the real machine is a false alarm and scores nothing.",
			),
			status,
		);
		const meter = el("div", "rounded-md border border-white/10 p-2");
		const list = el("div", "flex flex-col gap-1");
		const table = el("div", "overflow-x-auto");
		const render = () => {
			const r = state.report;
			if (!r) return;
			const live = r.rows.filter((x) => x.difference);
			const killed = live.filter((x) => killedBy(x));
			const pct = live.length
				? Math.round((100 * killed.length) / live.length)
				: 0;
			const fill = el("div", "h-2 rounded bg-[#f6821f] transition-all");
			fill.style.width = `${pct}%`;
			const bar = el("div", "mt-1 h-2 rounded bg-white/10");
			bar.appendChild(fill);
			meter.replaceChildren(
				el(
					"p",
					"font-mono text-sm text-white",
					`test score ${killed.length}/${live.length} = ${pct}%`,
				),
				el(
					"p",
					"font-mono text-[11px] text-slate-400",
					`${r.rows.length - live.length} of ${r.rows.length} changes alter nothing (proved by replay, left out) · ${r.sites} possible changes, ${r.rows.length} sampled`,
				),
				bar,
			);
			list.replaceChildren();
			r.properties.forEach((p, i) => {
				const alarm = r.falseAlarms[p.id];
				const kills = live.filter((x) => x.kills[p.id]).length;
				const label = el(
					"label",
					`flex items-start gap-2 text-xs ${alarm ? "text-rose-300" : "text-slate-200"}`,
				);
				const box = document.createElement("input");
				box.type = "checkbox";
				box.checked = state.picked.has(p.id);
				box.dataset.property = p.id;
				box.className = "mt-0.5 accent-[#f6821f]";
				box.addEventListener("change", () => {
					if (box.checked) state.picked.add(p.id);
					else state.picked.delete(p.id);
					render();
				});
				add(
					label,
					box,
					el(
						"span",
						"",
						`T${i + 1} ${p.label} · ${alarm ? "FALSE ALARM" : `catches ${kills}`}`,
					),
				);
				list.appendChild(label);
			});
			const t = el("table", "font-mono text-[10px] text-slate-300");
			const head = el("tr");
			head.appendChild(el("th", "pr-2 text-left", "change ↓ test →"));
			r.properties.forEach((_, i) =>
				head.appendChild(el("th", "px-1", `T${i + 1}`)),
			);
			t.appendChild(head);
			for (const row of r.rows) {
				const tr = el("tr");
				tr.appendChild(
					el(
						"td",
						`max-w-[180px] truncate pr-2 ${row.difference ? "" : "text-slate-600"}`,
						row.site.label.replace(/ at wire \d+/, ""),
					),
				);
				for (const p of r.properties) {
					const hit = row.kills[p.id] && !r.falseAlarms[p.id];
					tr.appendChild(
						el(
							"td",
							`px-1 text-center ${!row.difference ? "text-slate-600" : hit ? "text-rose-300" : "text-slate-600"}`,
							!row.difference ? "≡" : hit ? "✕" : "·",
						),
					);
				}
				t.appendChild(tr);
			}
			table.replaceChildren(
				t,
				el(
					"p",
					"font-mono text-[10px] text-slate-500",
					"✕ caught · · missed · ≡ changes nothing",
				),
			);
		};
		add(body, meter, list, table);
		void loaded.then(render);
	};

	views.duel = () => {
		add(
			body,
			el(
				"p",
				"text-xs text-slate-300",
				"Pick a change that alters behaviour. Two scripted robots try to find and undo it. Each guess is checked by replay: it counts only if the machine then matches the real one exactly. One robot gets the first difference back as a clue and follows it through the circuit. The other guesses in a fixed order.",
			),
			status,
		);
		const grid = el("div");
		const out = el("div", "flex flex-col gap-2");
		const lane = (title: string, steps: Step[]) => {
			const box = el("div", "rounded-md border border-white/10 p-2");
			const last = steps.at(-1);
			box.appendChild(
				el(
					"p",
					"font-mono text-[11px] text-white",
					`${title}: ${steps.length} guess${steps.length === 1 ? "" : "es"} · ${last?.verdict ?? ""}`,
				),
			);
			const list = el("ol", "mt-1 flex flex-col gap-1");
			for (const s of steps.slice(-6)) {
				const ok = s.verdict === "accepted";
				const li = el(
					"li",
					`font-mono text-[10px] ${ok ? "text-emerald-300" : "text-slate-300"}`,
				);
				add(
					li,
					el("div", "", `#${s.attempt} ${s.claim}`),
					el("div", "pl-3 text-slate-500", s.why),
					el(
						"div",
						`pl-3 ${ok ? "" : "text-rose-300"}`,
						`replay → ${s.verdict}`,
					),
				);
				list.appendChild(li);
			}
			if (steps.length > 6)
				list.insertBefore(
					el(
						"li",
						"font-mono text-[10px] text-slate-500",
						`… ${steps.length - 6} earlier guesses`,
					),
					list.firstChild,
				);
			box.appendChild(list);
			return box;
		};
		const pick = async (row: Row) => {
			state.selected = row;
			reset(row.site.id, null, `live · broken: ${row.site.label}`);
			grid.replaceChildren(chips(pick, (x) => Boolean(x.difference)));
			out.replaceChildren(
				el("p", "font-mono text-[11px] text-slate-400", "robots working…"),
			);
			const [hinted, blind] = await Promise.all([
				call("hunt", page.slug, row.site.id, true, 40),
				call("hunt", page.slug, row.site.id, false, 40),
			]);
			out.replaceChildren(
				lane("robot with clues", hinted),
				lane("robot without clues", blind),
			);
		};
		add(body, grid, out);
		void loaded.then(() =>
			grid.replaceChildren(chips(pick, (x) => Boolean(x.difference))),
		);
	};

	show("court");

	loop(() => {
		const t = holder.ticker;
		if (player.journal) {
			if (player.frame >= player.journal.length + 60)
				reset(player.siteId, player.journal, player.label);
			for (const e of player.journal.events) {
				if (e.frame !== player.frame) continue;
				if (e.value === undefined) t.press(e.name);
				else t.set(e.name, e.value);
			}
			player.frame += 1;
		}
		let text = "";
		try {
			text = draw(t.step());
		} catch {
			text = "the broken circuit crashed: a value left its declared range";
			reset(player.siteId, player.journal, player.label);
		}
		ui.caption.textContent = `${text} · ${player.journal ? `replay ${Math.min(player.frame, player.journal.length)}/${player.journal.length}` : player.siteId ? "broken" : "real"}`;
		panel();
		scene.renderer.render(scene.scene, scene.camera);
	});
}
