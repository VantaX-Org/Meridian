"""A reporting line must end at the top, not loop: following ``field`` (the
parent pointer, e.g. EMPEMPLOYMENT.MANAGER_ID) from record to record by
``id_field`` (EMPEMPLOYMENT.USERID) must never come back to a record already
on the path. Every record on a loop fails (A reports to B, B reports to A; or
A reports to A). Parents outside the extract end the walk (orphans are
exists_check's job); records without a parent are out of scope."""

import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank


class HierarchyCheck(BaseCheck):
    check_class = "hierarchy_check"
    default_dimension = "consistency"

    def columns(self) -> list[str]:
        return [self.rule["id_field"], self.rule["field"]]

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        ids = df[self.rule["id_field"]].astype("string").str.strip()
        parents = df[self.rule["field"]].astype("string").str.strip()
        population = ~is_blank(df[self.rule["id_field"]]) & ~is_blank(df[self.rule["field"]])
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
        return Evaluation(population, ids.isin(in_loop).fillna(False), {"records_in_loops": len(in_loop)})
