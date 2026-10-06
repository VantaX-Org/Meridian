"""A reporting line must end at the top, not loop: following ``field`` (the
parent pointer, e.g. EMPEMPLOYMENT.MANAGER_ID) from record to record by
``id_field`` (EMPEMPLOYMENT.USERID) must never come back to a record already
on the path. Every record on a loop fails (A reports to B, B reports to A; or
A reports to A). Parents outside the extract end the walk (orphans are
exists_check's job); records without a parent are out of scope.

Optional ``scope_field`` makes the walk per scope (a follow-up material chain is per plant:
MARC.WERKS), and ``max_depth`` also fails every record whose chain to the top has more than
that many links (a supersession chain of five hops is a maintenance problem, not a loop)."""

import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank


class HierarchyCheck(BaseCheck):
    check_class = "hierarchy_check"
    default_dimension = "consistency"

    def columns(self) -> list[str]:
        return [self.rule["id_field"], self.rule["field"]] + ([self.rule["scope_field"]] if self.rule.get("scope_field") else [])

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        ids = df[self.rule["id_field"]].astype("string").str.strip()
        parents = df[self.rule["field"]].astype("string").str.strip()
        population = ~is_blank(df[self.rule["id_field"]]) & ~is_blank(df[self.rule["field"]])
        if self.rule.get("scope_field"):
            scope = df[self.rule["scope_field"]].astype("string").str.strip().fillna("") + "|"
            ids, parents = scope + ids, scope + parents
        up = dict(zip(ids[population], parents[population]))
        in_loop: set[str] = set()
        done: set[str] = set()
        for start in up:
            path: dict[str, int] = {}
            node = start
            while node in up and node not in done and node not in path:
                path[node] = len(path)
                node = up[node]
            if node in path:
                in_loop.update(list(path)[path[node]:])
            done.update(path)
        failing = ids.isin(in_loop).fillna(False)
        too_deep = 0
        if self.rule.get("max_depth") is not None:
            limit = int(self.rule["max_depth"])
            depth: dict[str, int] = {}
            for start in up:
                n, node, seen = 0, start, set()
                while node in up and node not in seen and n <= limit:
                    seen.add(node)
                    node = up[node]
                    n += 1
                depth[start] = n
            deep = ids.map(depth).fillna(0) > limit
            too_deep = int((deep & ~failing & population).sum())
            failing = failing | deep
        return Evaluation(population, failing & population, {"records_in_loops": len(in_loop), "records_too_deep": too_deep})
