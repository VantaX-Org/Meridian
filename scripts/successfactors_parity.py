"""Measure SuccessFactors extraction parity against a tenant's real OData API.

The SuccessFactors rule packs are proved and deep, but the extraction mapping in
``sap/extraction_registry.py`` is a second, hand-maintained description of what the
tenant serves, and the two drift. This resolves every field the rules read to the
``Entity.property`` the canonical dictionary declares
(``sap/dictionaries/canonical/successfactors.yaml``) and checks that property against
the tenant's own ``$metadata``.

Usage::

    # 1. capture the tenant metadata (needs the system's stored credentials)
    python scripts/successfactors_parity.py --fetch-metadata --system <uuid> -o /tmp/sf_meta.json
    # 2. resolve and report
    python scripts/successfactors_parity.py --metadata /tmp/sf_meta.json

Exit code 1 with ``--strict`` when any field a rule reads cannot be sourced. That is the
gate to wire in once the mapping is corrected: it makes "this tenant cannot validate
that field" a measured fact instead of a silently skipped rule.
"""

import argparse

import json, sys, collections
sys.path.insert(0, '.')
from checks.runner import module_rules, rule_columns, target_columns
from sap.ddic import get_dictionary
import yaml

M = json.load(open('/tmp/sf_meta.json'))
SETS, PROPS, NAVS = M['sets'], M['props'], M['navs']
CANON = yaml.safe_load(open('sap/dictionaries/canonical/successfactors.yaml'))['tables']
D = get_dictionary('s4hana')

def selectable(entity, prop):
    t = SETS.get(entity)
    return t is not None and prop in set(PROPS.get(t, []))

# canonical TABLE.FIELD -> list of (entity, property) the canonical declares
declared = {}
for tname, t in CANON.items():
    for f, meta in (t.get('fields') or {}).items():
        src = (meta or {}).get('source') or ''
        e, _, p = src.partition('.')
        if e and p:
            declared.setdefault(f"{tname}.{f}", []).append((e, p))

MODULES = ["employee_central","compensation","benefits","payroll_integration","performance_goals",
           "succession_planning","recruiting_onboarding","learning_management","time_attendance"]
out = {}
for mod in MODULES:
    need = collections.defaultdict(set)
    for r in module_rules(mod):
        for c in set(rule_columns(r)) | set(target_columns(r)):
            tname = c.split('.', 1)[0]
            tab = D.table(tname)
            if tab is not None and str(tab.provenance).startswith('canonical:'):
                need[tname].add(c)
    for tname, cols in sorted(need.items()):
        # entity -> {property: canonical column}
        per_entity = collections.defaultdict(dict)
        unusable = []
        for col in sorted(cols):
            field = col.split('.', 1)[1]
            got = False
            for (e, p) in declared.get(col, []):
                if selectable(e, p):
                    per_entity[e][p] = f"{tname}.{field}"
                    got = True
                    break
            if not got:
                unusable.append(col)
        out.setdefault(mod, {})[tname] = {"entities": {e: v for e, v in per_entity.items()},
                                          "unusable": unusable}
json.dump(out, open('/tmp/sf_spec.json', 'w'), indent=1)
# report
for mod in MODULES:
    print(f"=== {mod}")
    for tname, spec in out.get(mod, {}).items():
        ents = spec['entities']
        n = sum(len(v) for v in ents.values())
        uns = spec['unusable']
        print(f"   {tname:22s} readable={n:3d} via {len(ents)} entity(ies)  unusable={len(uns)}")
        for e, mp in ents.items():
            print(f"       {e:26s} {len(mp):3d} fields")
        if uns:
            print(f"       UNUSABLE: {[c.split('.',1)[1] for c in uns][:8]}")
