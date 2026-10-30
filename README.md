# marionette

Hard ideas you can poke. Each page is a tiny program wired by hand from sums, ReLUs, compares and selects. It has no `if` statements, and it replays bit for bit from its inputs alone.

Live: [marionette.customer0.dev](https://marionette.customer0.dev)

## What is here

| Page | What you touch |
|---|---|
| cubes, traffic light, pet | Drag, press, poke. Every value lives in one fixed circuit. |
| 25 machines | An elevator, a WAF, a pacemaker, a garage door and more. Each has its own lesson. |
| mutant court | Break the garage door on purpose. Random journals and properties hunt the bug. A shrinker finds the shortest replay. Scripted agents use the first divergence to fix it. |
| +1 · start here | One button, one number. Bug → test → random test → shrink → robot fix, in five steps. |

The cell panel on every page shows every value in the circuit. **replay from inputs only** rebuilds the state from the input journal and checks that every cell is identical.

## Findings in `spikes/arena`

Bugs were planted in the page circuits, and agents hunted them.

| Finding | Evidence |
|---|---|
| The test suite catches 65% of planted bugs: 100% of logic flips, 48% of number changes | `results.jsonl` |
| 29% of planted bugs change nothing visible in 3,600 random frames (equivalent mutants) | `verify.jsonl` |
| Raw model bug-claim precision is 40%. Replay grounding brings it to 100% with no real finds lost. | `rescore.json` |
| Feeding the first divergence back to the model lifts recall from 42% to 63% at 100% precision | `recall.jsonl` |

Grounding rule: a claim counts only if the file misbehaves AND the claimed fix restores the reference behaviour.

## Run

```sh
npm install
npm run dev
npx vitest run
npx playwright install chromium
node scripts/gate-pages.mjs http://localhost:5180
```

## Credits

Circuits run on [handwired](https://github.com/chenglou/handwired) by Cheng Lou (MIT), pinned in `package.json`. three.js draws.
