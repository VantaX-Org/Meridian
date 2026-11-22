"use client";

import { useState } from "react";
import { displayKey } from "@/lib/v2/work";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { createDataRequest, getDataRequest, getRequestFindings, listDataRequests, submitDataRequest, type RequestItem, type RequestSummary } from "@/lib/api/v2/data-requests";
import { getAssignable } from "@/lib/api/v2/triage";
import { useWorkSummary } from "@/lib/v2/work-queries";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { Button, Card, DataTable, EmptyState, ErrorState, Field, FieldChip, Input, PageHeader, Select, Sheet, Skeleton, Tabs, Toggle, useAletheia, useAletheiaScope, useStacked } from "@/ui/kit";
import { ObjChip } from "./ObjChip";
import { day, useDo } from "./shared";

const STATE = (s: string) => ({ open: t("Open"), submitted: t("Submitted"), approved: t("Approved"), rejected: t("Rejected") })[s] ?? s;

function Answer({ id }: { id: string }) {
  const fx = useFixture();
  const run = useDo();
  const [vals, setVals] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ["v2", "data-request", fx, id], queryFn: () => getDataRequest(id), retry: false });
  if (q.isLoading) return <Skeleton lines={5} label={t("Loading the request")} />;
  if (q.isError || !q.data) return <ErrorState heading={t("The request could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  const items = q.data.items;
  const send = async () => {
    const values = Object.entries(vals).filter(([, v]) => v.trim()).map(([item_id, value]) => ({ item_id, value }));
    const r = await run(() => submitDataRequest(id, values), (x) => t("{n} answers sent.", { n: x.submitted }));
    if (r?.errors.length) setVals({});
  };
  return (
    <>
      <p className="mx-muted">{q.data.note}</p>
      <DataTable label={t("Request items")} rows={items} rowKey={(i: RequestItem) => i.id} height={320}
        columns={[
          { key: "r", label: t("Record"), render: (i) => displayKey(i.record_key), sort: (i) => i.record_key },
          { key: "f", label: t("Field"), render: (i) => <FieldChip code={i.field} description={i.field_label ?? undefined} /> },
          { key: "c", label: t("Now"), render: (i) => i.current_value ?? "" },
          { key: "s", label: t("State"), render: (i) => STATE(i.state), sort: (i) => i.state },
          {
            key: "n", label: t("Your answer"),
            render: (i) => (i.state === "open" || i.state === "rejected"
              ? <Input aria-label={t("Answer for {r}", { r: i.record_key })} maxLength={i.max_length ?? undefined} value={vals[i.id] ?? ""} onChange={(e) => setVals({ ...vals, [i.id]: e.target.value })} />
              : i.new_value ?? ""),
          },
        ]} />
      <Button variant="primary" disabled={!Object.values(vals).some((v) => v.trim())} onClick={() => void send()}>{t("Send answers")}</Button>
    </>
  );
}

function Create({ onDone }: { onDone: () => void }) {
  const fx = useFixture();
  const run = useDo();
  const sum = useWorkSummary();
  const [module, setModule] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const mods = (sum.data?.objects ?? []).map((o) => o.module);
  const people = useQuery({ queryKey: ["v2", "triage-people", fx], queryFn: getAssignable, retry: false });
  const found = useQuery({ queryKey: ["v2", "request-findings", fx, module], queryFn: () => getRequestFindings(module), enabled: !!module, retry: false });
  const flip = (c: string) => setPicked((p) => { const n = new Set(p); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  return (
    <Card title={t("Ask someone to supply data")} sub={t("They get a list of records and fill in the missing values.")}>
      <Field label={t("Object")}><Select value={module} onChange={(e) => { setModule(e.target.value); setPicked(new Set()); }} options={[{ value: "", label: t("Pick an object") }, ...mods.map((m) => ({ value: m, label: m }))]} /></Field>
      {module ? (
        found.isLoading ? <Skeleton lines={3} label={t("Loading the rules")} /> : (
          <div role="group" aria-label={t("Rules to ask about")}>
            {(found.data?.findings ?? []).map((f) => <Toggle key={f.check_id} label={`${f.check_id} ${f.field_label ?? f.field} (${f.failing})`} checked={picked.has(f.check_id)} onChange={() => flip(f.check_id)} />)}
          </div>
        )
      ) : null}
      <Field label={t("Ask")}><Select value={owner} onChange={(e) => setOwner(e.target.value)} options={[{ value: "", label: t("Pick a person") }, ...(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} /></Field>
      <Field label={t("Due")}><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      <Field label={t("Note")}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Button variant="primary" disabled={!module || !owner || !due || !picked.size}
        onClick={() => void run(() => createDataRequest({ module, check_ids: [...picked], owner_id: owner, due_date: due, note }), () => t("Request sent.")).then((r) => { if (r) onDone(); })}>{t("Send request")}</Button>
    </Card>
  );
}

/** Data requests: ask people to supply missing values, and answer the ones asked of you. */
export function DataRequests() {
  useInterfaceLang();
  const fx = useFixture();
  const chat = useAletheia();
  const stacked = useStacked();
  const [tab, setTab] = useState("mine");
  const [pick, setPick] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["v2", "data-requests", fx, tab], queryFn: () => listDataRequests(tab === "mine"), retry: false, enabled: tab !== "new" });
  const rows = q.data ?? [];

  useAletheiaScope({
    key: "requests", label: t("Asking about data requests"), suggestions: [t("Which requests are open?")],
    answer: () => ({ text: t("{n} requests are open.", { n: rows.filter((r) => r.status === "open").length }), evidence: rows.slice(0, 3).map((r) => r.note), actions: [] }),
  });

  const detail = pick ? <Answer id={pick} /> : <EmptyState heading={t("Pick a request")} body={t("Its records show here, ready to answer.")} />;
  return (
    <>
      <PageHeader title={t("Data requests")} context={t("Ask for values only a person knows")}
        actions={<Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>} />
      <Tabs idBase="mx-req" label={t("Request views")} value={tab} onChange={(v) => { setTab(v); setPick(null); }}
        items={[{ id: "mine", label: t("Asked of me") }, { id: "all", label: t("All requests") }, { id: "new", label: t("New request") }]} />
      <div id={`mx-req-panel-${tab}`} role="tabpanel" aria-labelledby={`mx-req-tab-${tab}`}>
        {tab === "new" ? <Create onDone={() => setTab("all")} /> : (
          <div className="mx-split">
            <div className="mx-col">
              <Card title={t("Requests")} sub={t("{n} in total", { n: rows.length })}>
                {q.isLoading ? <Skeleton lines={5} label={t("Loading requests")} /> : q.isError ? <ErrorState heading={t("Requests could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} /> : !rows.length ? <EmptyState heading={t("No requests here")} /> : (
                  <DataTable label={t("Requests")} rows={rows} rowKey={(r: RequestSummary) => r.id} selected={pick} onSelect={(r) => setPick(r.id)}
                    columns={[
                      { key: "o", label: t("Object"), render: (r) => <ObjChip code={r.module} />, sort: (r) => r.module },
                      { key: "w", label: t("Asked of"), render: (r) => r.owner_name ?? r.owner_id },
                      { key: "d", label: t("Due"), render: (r) => day(r.due_date), sort: (r) => r.due_date },
                      { key: "p", label: t("Open"), render: (r) => `${r.open} / ${r.total}`, sort: (r) => r.open, align: "end" },
                      { key: "s", label: t("Status"), render: (r) => STATE(r.status), sort: (r) => r.status },
                    ]} />
                )}
              </Card>
            </div>
            {stacked ? <Sheet open={!!pick} onClose={() => setPick(null)} label={t("Request")} closeLabel={t("Close")}>{detail}</Sheet> : <div className="mx-col">{detail}</div>}
          </div>
        )}
      </div>
    </>
  );
}
