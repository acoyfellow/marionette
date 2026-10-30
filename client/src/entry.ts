import "./style.css";
import { mountCells } from "./cells";
import { mountHud } from "./hud";
import { mountPage } from "./kit";
import { mountCourt } from "./lab/court-page";
import { mountPlus } from "./lab/plus-page";
import { PAGES } from "./pages";
import { mountPet } from "./pet-page";
import { mountStage } from "./stage";
import { mountTraffic } from "./traffic-page";

const BUILT_IN = [
	{
		label: "cubes",
		topic: "dragging, picking, springs",
		lesson:
			"Drag the cubes. Picking, dragging and every spring is one fixed network of sums and ReLUs.",
	},
	{
		label: "traffic light",
		topic: "state machines",
		lesson:
			"A crossing that cycles on a timer. Press the blue button: it sets one bit, and the walk phase runs.",
	},
	{
		label: "pet",
		topic: "needs and moods",
		lesson:
			"Poke it, feed it, or leave it. Three meters drift, and comparisons pick its mood.",
	},
] as const;

const LAB = {
	label: "mutant court",
	topic: "every machine · break it, test it, fix it",
	lesson:
		"Pick any machine. Break one part of its circuit. Random inputs and tests hunt the change, a shrinker finds the shortest replay, and robots use the first difference as a clue to undo it. Some changes alter nothing at all.",
} as const;
const PLUS = {
	label: "+1 · start here",
	topic: "bugs · tests · random tests · robot",
	lesson: "One button. One number. Five steps.",
} as const;
const labels = [
	...BUILT_IN.map((page) => page.label),
	...PAGES.map((page) => page.title),
	LAB.label,
	PLUS.label,
];
const index = Math.max(
	1,
	Math.min(labels.length, Number(location.hash.slice(1)) || 1),
);
const element = (id: string) => document.getElementById(id) as HTMLElement;

const tabs = element("tabs");
const topics = [
	...BUILT_IN.map((page) => page.topic),
	...PAGES.map((page) => page.topic),
	LAB.topic,
	PLUS.topic,
];
labels.forEach((label, offset) => {
	const n = offset + 1;
	const link = document.createElement("a");
	link.href = `#${n}`;
	link.className = `flex items-baseline gap-3 rounded-md px-3 py-2 ${n === index ? "bg-[#f6821f]/15 text-white" : "text-slate-300 hover:bg-white/5"}`;
	if (n === index) link.setAttribute("aria-current", "page");
	const number = document.createElement("span");
	number.className = `w-6 shrink-0 text-right font-mono text-xs ${n === index ? "text-[#f6821f]" : "text-slate-500"}`;
	number.textContent = String(n);
	const text = document.createElement("span");
	text.className = "flex min-w-0 flex-col";
	const name = document.createElement("span");
	name.className = "text-sm font-medium";
	name.textContent = label;
	const topic = document.createElement("span");
	topic.className = "truncate font-mono text-[11px] text-slate-500";
	topic.textContent = topics[offset] ?? "";
	text.appendChild(name);
	text.appendChild(topic);
	link.appendChild(number);
	link.appendChild(text);
	tabs.appendChild(link);
});

const drawer = element("drawer");
const scrim = element("scrim");
const menu = element("menu");
const setDrawer = (open: boolean) => {
	drawer.classList.toggle("-translate-x-full", !open);
	scrim.classList.toggle("hidden", !open);
	menu.setAttribute("aria-expanded", String(open));
};
menu.addEventListener("click", () => setDrawer(true));
element("close").addEventListener("click", () => setDrawer(false));
scrim.addEventListener("click", () => setDrawer(false));
addEventListener(
	"keydown",
	(event) => event.key === "Escape" && setDrawer(false),
);
element("crumb").textContent =
	`${index} / ${labels.length} · ${labels[index - 1] ?? ""}`;
const step = (id: string, n: number) => {
	const link = element(id) as HTMLAnchorElement;
	if (n < 1 || n > labels.length) link.classList.add("invisible");
	else link.href = `#${n}`;
};
step("prev", index - 1);
step("next", index + 1);
const current = tabs.querySelector<HTMLElement>("[aria-current]");
if (current !== null)
	tabs.scrollTop = current.offsetTop - tabs.clientHeight / 2;
addEventListener("hashchange", () => location.reload());

const canvas = element("stage") as HTMLCanvasElement;
const ui = {
	canvas,
	title: element("title"),
	topic: element("topic"),
	lesson: element("lesson"),
	controls: element("controls"),
	cells: element("cells"),
	caption: element("caption"),
};
const page = PAGES[index - 1 - BUILT_IN.length];
const builtIn = BUILT_IN[index - 1];

if (index === labels.length) {
	element("hud").remove();
	ui.title.textContent = PLUS.label;
	ui.topic.textContent = PLUS.topic;
	ui.lesson.textContent = PLUS.lesson;
	element("info").classList.add(
		"lg:bottom-4",
		"lg:overflow-y-auto",
		"lg:w-[390px]",
	);
	mountPlus(ui);
} else if (index === labels.length - 1) {
	element("hud").remove();
	ui.title.textContent = LAB.label;
	ui.topic.textContent = LAB.topic;
	ui.lesson.textContent = LAB.lesson;
	element("info").classList.add(
		"lg:bottom-4",
		"lg:overflow-y-auto",
		"lg:w-[400px]",
	);
	ui.caption.classList.add("lg:left-[732px]", "lg:text-sm");
	mountCourt(PAGES, ui);
} else if (page !== undefined) {
	element("hud").remove();
	mountPage(page, ui);
} else if (builtIn !== undefined) {
	ui.title.textContent = builtIn.label;
	ui.topic.textContent = builtIn.topic;
	ui.lesson.textContent = builtIn.lesson;
	if (index === 2) {
		element("hud").remove();
		mountTraffic(canvas, ui.cells, ui.caption);
	} else if (index === 3) {
		element("hud").remove();
		mountPet(canvas, ui.cells, ui.caption);
	} else {
		ui.caption.remove();
		const stage = mountStage(canvas);
		mountHud(element("hud"), stage);
		mountCells(ui.cells, stage);
	}
}
