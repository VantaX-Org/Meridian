"use client";

import { useState } from "react";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import type { LoadObject } from "@/lib/api/v2/load-plan";
import { Card, DataTable, DetailPanel, EmptyState, FieldChip, PageHeader, Sheet, StatTile, useAletheiaScope, useStacked } from "@/ui/kit";
import { AskButton, Gate, Verdict, humanize } from "./common";
import { useLoadPlan } from "./hooks";

/** The order to load objects in, with the reason for each wait: the check tables the fields point at. */
export function Plan() {
  useInterfaceLang();
  const q = useLoadPlan();
  const stacked = useStacked();
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState("why");
  const plan = q.data;
  const objects = [...(plan?.objects ?? [])].sort((a, b) => a.step - b.step);
  const cur = objects.find((o) => o.module === sel) ?? null;
  const edges = plan?.edges ?? [];

  useAletheiaScope({
    key: "load/plan",
    label: t("Asking about the load order"),
    suggestions: [t("Why does this object wait?")],
    answer: () => {
      const o = cur ?? objects.find((x) => x.blocked_by.length);
      return o
        ? { text: t("{o} waits for {w}.", { o: o.module, w: o.blocked_by.join(", ") || t("nothing") }), evidence: [] }
        : { text: t("No object waits for another."), evidence: [] };
    },
  });

  const detail = cur ? (
    <DetailPanel
      idBase="plan"
      label={t("Object detail")}
      header={<FieldChip code={cur.module} description={cur.label || humanize(cur.module)} />}
      tabsLabel={t("Object detail")}
      value={tab}
      onChange={setTab}
      tabs={[{ id: "why", label: t("Why this order") }, { id: "pre", label: t("Prerequisites"), badge: String(cur.prerequisites.length) }]}
    >
      {tab === "why" ? (
        <>
          <p><Verdict v={cur.status} /></p>
          {cur.blocked_by.length ? <p>{t("Waits for")} {cur.blocked_by.map((b) => <FieldChip key={b} code={b} description={humanize(b)} />)}</p> : <p className="mx-muted">{t("Waits for nothing.")}</p>}
          {edges.filter((e) => e.after === cur.module).map((e) => (
            <Card key={e.before} title={`${e.before} ${humanize(e.before)}`} sub={e.kind === "required" ? t("Required") : t("Reference")}>
              {e.deferred ? <p className="mx-muted">{t("Deferred: load it after this object.")}</p> : null}
              <ul aria-label={t("Evidence")}>
                {e.evidence.map((ev) => (
                  <li key={ev.field}><FieldChip code={ev.field} description={ev.text} /> {t("checks against")} <FieldChip code={ev.check_table} description={ev.check_table_text} />{ev.reason ? <span className="mx-muted"> {ev.reason}</span> : null}</li>
                ))}
              </ul>
            </Card>
          ))}
        </>
      ) : cur.prerequisites.length ? (
        <ul aria-label={t("Prerequisites")}>
          {cur.prerequisites.map((p) => <li key={p.table}><FieldChip code={p.table} description={p.text} /> <span className="mx-muted">{p.kind === "configuration" ? t("Configuration") : p.kind === "master_data" ? t("Master data") : t("Unclassified")}</span> {p.fields.map((f) => <FieldChip key={f} code={f} description={f} />)}</li>)}
        </ul>
      ) : <EmptyState heading={t("No prerequisite")} />}
    </DetailPanel>
  ) : <EmptyState heading={t("Choose an object")} body={t("Its reasons and prerequisites appear here.")} />;

  const pick = (o: LoadObject) => { setSel(o.module); setTab("why"); };

  return (
    <>
      <PageHeader title={t("Load order")} context={t("Load an object only after the objects its fields point at.")} actions={<AskButton />} />
      <div className="mx-col">
      <dl className="mx-tiles">
        <StatTile label={t("Objects")} value={String(objects.length)} />
        <StatTile label={t("Steps")} value={String(plan?.steps ?? 0)} />
        <StatTile label={t("Dependencies")} value={String(edges.length)} />
        <StatTile label={t("Unknown objects")} value={String(plan?.unknown.length ?? 0)} />
      </dl>
      <div className="mx-split">
        <div className="mx-col">
          <Card title={t("Objects in load order")}>
            <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the load order")}>
              {objects.length ? (
                <DataTable
                  label={t("Objects in load order")}
                  rows={objects}
                  rowKey={(o) => o.module}
                  selected={sel ?? undefined}
                  onSelect={pick}
                  columns={[
                    { key: "step", label: t("Step"), align: "end", sort: (o) => o.step, render: (o) => o.step },
                    { key: "m", label: t("Object"), sort: (o) => o.module, render: (o) => <FieldChip code={o.module} description={o.label || humanize(o.module)} /> },
                    { key: "g", label: t("Loads with"), render: (o) => (o.group.length > 1 ? o.group.filter((g) => g !== o.module).map(humanize).join(", ") : t("Alone")) },
                    { key: "s", label: t("Status"), render: (o) => <Verdict v={o.status} /> },
                    { key: "b", label: t("Waits for"), render: (o) => o.blocked_by.map(humanize).join(", ") },
                  ]}
                />
              ) : <EmptyState heading={t("No load order yet")} />}
            </Gate>
          </Card>
        </div>
        {stacked ? <Sheet open={cur !== null} onClose={() => setSel(null)} label={t("Object detail")} closeLabel={t("Close")}>{detail}</Sheet> : <div className="mx-col">{detail}</div>}
      </div>
      </div>
    </>
  );
}
