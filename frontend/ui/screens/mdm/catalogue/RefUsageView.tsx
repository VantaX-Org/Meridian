"use client";

import { getRefUsage, type RefCode, type RefOrphan, type RefUsageField } from "@/lib/api/v2/reference-data";
import { t } from "@/lib/v2/i18n";
import { BarList, Code, DataTable, StatTile } from "@/ui/kit";
import { Async, Empty, num, useRead, when } from "./shared";

const share = (a: number, b: number): string => (b ? `${Math.round((a / b) * 100)}%` : t("n/a"));

function note(f: RefUsageField): string {
  if (!f.profiled) return t("Not profiled");
  if (f.masked) return f.mask_reason ?? t("Masked");
  if (f.truncated) return t("Counts are a lower bound");
  return f.sampled ? t("Sampled") : "";
}

/** How the records use one code list, read from the stored field profiles of its target fields. */
export function RefUsageView({ systemId, listId, source }: { systemId: string; listId: string; source: readonly RefCode[] }) {
  const q = useRead(["ref-usage", systemId, listId], () => getRefUsage(systemId, listId));
  const text = new Map(source.map((c) => [c.code.split("/").pop() ?? c.code, c.text ?? undefined]));
  return (
    <Async q={q}>
      {(u) => !u.version_id ? <Empty heading={t("No analysis run has profiled these fields")} /> : (
        <div className="mx-col">
          <div className="mx-split">
            <StatTile label={t("Codes used")} value={`${num(u.used)} / ${num(u.codes)}`} />
            <StatTile label={t("Filled values that are valid codes")} value={u.covered_share === null || u.covered_share === undefined ? t("n/a") : `${u.covered_at_least ? ">= " : ""}${Math.round(u.covered_share * 100)}%`} />
            <StatTile label={t("Profiled on")} value={when(u.run_at)} />
          </div>
          <BarList label={t("Valid share by field")} max={100}
            items={u.fields.filter((f) => f.profiled && f.filled).map((f) => ({ id: f.field, label: f.field, value: Math.round((f.covered / f.filled) * 100), display: share(f.covered, f.filled), sev: f.orphan_rows ? "high" : undefined }))} />
          <DataTable<RefUsageField> label={t("Target fields")} rows={u.fields} rowKey={(f) => f.field} height={220}
            columns={[
              { key: "f", label: t("Field"), sort: (f) => f.field, render: (f) => <Code code={f.field} /> },
              { key: "r", label: t("Rows"), align: "end", sort: (f) => f.rows, render: (f) => num(f.rows) },
              { key: "fi", label: t("Filled"), align: "end", sort: (f) => f.filled, render: (f) => num(f.filled) },
              { key: "c", label: t("Valid"), align: "end", sort: (f) => f.covered, render: (f) => num(f.covered) },
              { key: "o", label: t("Not in the list"), align: "end", sort: (f) => f.orphan_rows, render: (f) => num(f.orphan_rows) },
              { key: "n", label: t("Note"), render: note },
            ]} />
          {u.orphans.length ? (
            <DataTable<RefOrphan> label={t("Values not in the list")} rows={u.orphans} rowKey={(o) => o.value} height={220}
              columns={[
                { key: "v", label: t("Value"), sort: (o) => o.value, render: (o) => <Code code={o.value} /> },
                { key: "n", label: t("Records"), align: "end", sort: (o) => o.count, render: (o) => num(o.count) },
                { key: "f", label: t("Fields"), render: (o) => o.fields.join(", ") },
              ]} />
          ) : <Empty heading={t("Every filled value is a valid code")} />}
          {!u.orphans_complete ? <p className="mx-muted">{t("The profiles list only the most common values, so more values may sit outside the list.")}</p> : null}
          {u.unused.length ? (
            <DataTable<string> label={u.unused_certain ? t("Codes never used") : t("Codes not seen in the profiles")} rows={u.unused} rowKey={(c) => c} height={220}
              columns={[{ key: "c", label: t("Code"), sort: (c) => c, render: (c) => <Code code={c} description={text.get(c)} /> }]} />
          ) : null}
        </div>
      )}
    </Async>
  );
}
