import { mountTickerPanel } from "../panel";
import {
	type Bug,
	check,
	createPlus,
	LOUD_BUG,
	NO_BUG,
	randomTests,
	SNEAKY_BUG,
} from "./plus";

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

const BIG =
	"rounded-xl border-2 px-5 py-3 font-mono text-base font-bold disabled:opacity-30";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function mountPlus(ui: {
	canvas: HTMLCanvasElement;
	cells: HTMLElement;
	caption: HTMLElement;
	controls: HTMLElement;
}) {
	ui.caption.remove();
	const stage = el(
		"div",
		"flex h-[58svh] w-full flex-col items-center justify-center gap-4 pt-12 lg:fixed lg:inset-y-0 lg:left-[720px] lg:right-[320px] lg:h-full lg:w-auto",
	);
	ui.canvas.replaceWith(stage);
	const number = el(
		"div",
		"font-mono text-[9rem] font-bold leading-none text-white transition-colors",
		"0",
	);
	number.dataset.number = "";
	const press = el(
		"button",
		`${BIG} border-[#f6821f] bg-[#f6821f] text-black active:scale-95`,
		"+1",
	);
	press.type = "button";
	press.dataset.press = "";
	const note = el("p", "h-6 font-mono text-sm text-slate-400", "press it");
	add(stage, number, press, note);

	let bug: Bug = NO_BUG;
	let machine = createPlus(bug);
	const holder = { machine };
	const proxy = new Proxy({} as typeof machine, {
		get: (_, key) => holder.machine[key as keyof typeof machine],
	});
	const panelHost = el("div", "flex flex-col gap-2");
	ui.cells.appendChild(panelHost);
	let panel = mountTickerPanel(
		panelHost,
		proxy,
		() => createPlus(bug),
		"the real circuit behind the number",
	);
	const restart = (next: Bug) => {
		bug = next;
		machine = createPlus(bug);
		holder.machine = machine;
		machine.step();
		panelHost.replaceChildren();
		panel = mountTickerPanel(
			panelHost,
			proxy,
			() => createPlus(bug),
			"the real circuit behind the number",
		);
		number.textContent = "0";
		number.className = number.className.replace(
			/text-rose-500|text-white/,
			"text-white",
		);
	};
	machine.step();
	let presses = 0;
	press.addEventListener("click", () => {
		machine.press("press");
		const { count } = machine.step();
		presses += 1;
		const wrong = count !== presses;
		number.textContent = String(count);
		number.classList.toggle("text-rose-500", wrong);
		number.classList.toggle("text-white", !wrong);
		note.textContent = wrong
			? `press ${presses}: should be ${presses}!`
			: `press ${presses}`;
		panel();
	});
	const resetCount = (next: Bug) => {
		presses = 0;
		restart(next);
		note.textContent = "press it";
		panel();
	};

	const steps = el("ol", "mt-1 flex flex-col gap-3");
	ui.controls.className = "mt-1 flex flex-col gap-2";
	ui.controls.appendChild(steps);

	const step = (n: number, title: string) => {
		const li = el(
			"li",
			"flex flex-col gap-2 rounded-lg border border-white/10 p-3 opacity-40 transition-opacity",
		);
		li.dataset.step = String(n);
		add(li, el("p", "text-sm font-semibold text-white", `${n}. ${title}`));
		const out = el(
			"div",
			"flex flex-col gap-1 font-mono text-xs text-slate-300",
		);
		li.appendChild(out);
		steps.appendChild(li);
		return { li, out };
	};
	const open = (s: { li: HTMLElement }) => s.li.classList.remove("opacity-40");
	const button = (label: string, onClick: () => void | Promise<void>) => {
		const b = el(
			"button",
			"self-start rounded-md border border-white/20 bg-white/5 px-3 py-2 font-mono text-xs text-white hover:border-[#f6821f]",
			label,
		);
		b.type = "button";
		b.addEventListener("click", () => void onClick());
		return b;
	};
	const line = (out: HTMLElement, text: string, tone = "") => {
		const p = el("p", tone, text);
		out.appendChild(p);
		return p;
	};
	const learned = (out: HTMLElement, text: string) =>
		line(
			out,
			text,
			"mt-1 rounded bg-[#f6821f]/15 px-2 py-1 font-sans text-sm text-[#f6821f]",
		);

	const s1 = step(1, "Press +1 a few times.");
	const s2 = step(2, "Break it.");
	const s3 = step(3, "Test it.");
	const s4 = step(4, "A sneaky bug.");
	const s5 = step(5, "Robot, fix it.");
	open(s1);
	line(s1.out, "The number goes up by one. That is the whole machine.");
	s1.out.appendChild(button("ok, next →", () => open(s2)));

	s2.out.appendChild(
		button("break it", () => {
			resetCount(LOUD_BUG);
			line(s2.out, "Done. Now press +1 again.");
			const watch = () => {
				if (presses < 2) return;
				press.removeEventListener("click", watch);
				learned(s2.out, "It adds 2. That is a bug.");
				open(s3);
			};
			press.addEventListener("click", watch);
		}),
	);

	s3.out.appendChild(
		button("test: press 3 times, expect 1, 2, 3", async () => {
			resetCount(bug);
			for (let i = 1; i <= 3; i += 1) {
				await wait(350);
				press.click();
				const ok = Number(number.textContent) === i;
				line(
					s3.out,
					`press ${i}: expect ${i}, got ${number.textContent} ${ok ? "✓" : "✗"}`,
					ok ? "text-emerald-300" : "text-rose-300",
				);
				if (!ok) break;
			}
			learned(
				s3.out,
				"A test presses for you and checks every answer. It caught the bug.",
			);
			open(s4);
		}),
	);

	s4.out.appendChild(
		button("add a sneaky bug", async () => {
			resetCount(SNEAKY_BUG);
			line(s4.out, "Run the same test again:");
			for (let i = 1; i <= 3; i += 1) {
				await wait(300);
				press.click();
				line(
					s4.out,
					`press ${i}: expect ${i}, got ${number.textContent} ✓`,
					"text-emerald-300",
				);
			}
			line(s4.out, "All green. But is it fixed?", "text-amber-200");
			s4.out.appendChild(
				button("test 100 times, random number of presses", async () => {
					const result = randomTests(bug, 100, 6);
					for (const [i, times] of result.tried.entries()) {
						const failed = i === result.tried.length - 1 && result.failure;
						line(
							s4.out,
							`try ${i + 1}: press ${times} times ${failed ? "✗" : "✓"}`,
							failed ? "text-rose-300" : "text-emerald-300",
						);
						await wait(180);
					}
					if (!result.failure) return;
					line(
						s4.out,
						`press ${result.failure.press}: expect ${result.failure.expected}, got ${result.failure.got}`,
						"text-rose-300",
					);
					line(
						s4.out,
						`shortest way to break it: press ${result.shortest} times. Watch:`,
					);
					resetCount(bug);
					for (let i = 0; i < (result.shortest ?? 0); i += 1) {
						await wait(300);
						press.click();
					}
					learned(
						s4.out,
						"Random tests try what you did not think of. Then they shrink the failure to the shortest one.",
					);
					open(s5);
				}),
			);
		}),
	);

	s5.out.appendChild(
		button("robot, fix it", async () => {
			const guesses = [3, 7];
			for (const guess of guesses) {
				line(
					s5.out,
					`🤖 “I think press ${guess} is wrong. I fix it.”`,
					"text-sky-200",
				);
				await wait(500);
				const fixed = guess === SNEAKY_BUG.onPress;
				const failure = check(fixed ? NO_BUG : bug, 20);
				if (failure) {
					line(
						s5.out,
						`machine replays 20 presses: still wrong at press ${failure.press}: expect ${failure.expected}, got ${failure.got}. ✗`,
						"text-rose-300",
					);
					line(
						s5.out,
						"↩ the machine sends that back to the robot",
						"text-slate-500",
					);
				} else {
					line(
						s5.out,
						"machine replays 20 presses: all correct ✓",
						"text-emerald-300",
					);
					resetCount(NO_BUG);
					for (let i = 0; i < 8; i += 1) {
						await wait(150);
						press.click();
					}
				}
				await wait(700);
			}
			learned(
				s5.out,
				"The robot guesses. The machine checks by replaying. A wrong guess gets a clue back, and the next guess uses it.",
			);
		}),
	);

	addEventListener("click", () => panel());
}
