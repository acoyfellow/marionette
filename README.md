# marionette

Hard ideas you can poke. Each page is a tiny program wired by hand from sums, ReLUs, compares and selects. It has no `if` statements, and it replays bit for bit from its inputs alone.

Live: [marionette.customer0.dev](https://marionette.customer0.dev)

## What is here

| Page | What you touch |
|---|---|
| cubes, traffic light, pet | Drag, press, poke. Every value lives in one fixed circuit. |
| 25 machines | An elevator, a WAF, a pacemaker, a garage door and more. Each has its own lesson. |
| mutant court | Pick any of the 25 machines and break one part of its compiled circuit. Random inputs and tests hunt the change. A shrinker finds the shortest replay. Two scripted robots try to undo it, one with the first difference as a clue. |
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

Across all 25 machines (`court-25.json`, 516 sampled circuit changes): the tests catch 28% of the changes that alter behaviour, and 28% of changes alter nothing. The robot with clues solved 194 of 198 hunts in 1,238 guesses. The robot without clues solved 179 in 2,645 guesses. Clues won on 23 of 25 machines.

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
