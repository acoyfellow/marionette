import json

rows = [json.loads(l) for l in open('spikes/arena/verify.jsonl') if '"DONE"' not in l]
report = {}
for model in ('sonnet', 'haiku'):
    mine = [r for r in rows if r['model'] == model]
    for r in mine:
        r['clean'] = '#clean' in r['task']
        r['visible'] = not r['clean'] and not r['equivalentMutant']
        r['grounded2'] = r['claimed'] and r['visible'] and r['grounded']
    visible = [r for r in mine if r['visible']]
    claimed = [r for r in mine if r['claimed']]
    found = [r for r in claimed if r['verdict'] == 'found']
    kept = [r for r in claimed if r['grounded2']]
    report[model] = {
        'tasks': len(mine),
        'visible_bugs': len(visible),
        'invisible_bugs': sum(1 for r in mine if not r['clean'] and r['equivalentMutant']),
        'claims': len(claimed),
        'raw_precision': f"{len(found)}/{len(claimed)}",
        'grounded_claims': len(kept),
        'grounded_by_verdict': {v: sum(1 for r in kept if r['verdict'] == v) for v in ('found', 'wrong-line', 'false-alarm')},
        'false_alarms_rejected': f"{sum(1 for r in claimed if r['verdict'] == 'false-alarm' and not r['grounded2'])}/{sum(1 for r in claimed if r['verdict'] == 'false-alarm')}",
        'recall_raw_visible': f"{sum(1 for r in found if r['visible'])}/{len(visible)}",
        'recall_grounded_visible': f"{sum(1 for r in kept)}/{len(visible)}",
        'found_on_invisible': sum(1 for r in found if not r['visible']),
    }
json.dump(report, open('spikes/arena/rescore.json', 'w'), indent=1)
print(json.dumps(report, indent=1))
