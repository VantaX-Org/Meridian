"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { decideMapping, getRefList, getRefLists, proposeMapping, suggestMapping, type RefListSummary, type RefMapping, type RefSuggestion } from "@/lib/api/v2/reference-data";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Code, DataTable, DetailPanel, Field, Input, Select, Split, useToast } from "@/ui/kit";
import { Async, Empty, Head, num, useRead, useScreenScope, useSystemPick } from "./shared";

const statusText = (s: string) => (s === "confirmed" ? t("Approved") : s === "rejected" ? t("Rejected") : t("Proposed"));

function ListDetail({ systemId, list }: { systemId: string; list: RefListSummary }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useRead(["ref-list", systemId, list.id], () => getRefList(systemId, list.id));
  const [tab, setTab] = useState("mappings");
  const [field, setField] = useState("");
  const [src, setSrc] = useState("");
  const [tgt, setTgt] = useState("");
  const [sug, setSug] = useState<RefSuggestion | null | undefined>(undefined);
  const refresh = () => qc.invalidateQueries({ queryKey: ["b7b"] });
  const targetField = field || list.target_fields[0] || "";
  const suggest = async () => {
    try { setSug((await suggestMapping(systemId, list.id, src)).suggestion); } catch { toast(t("Aletheia could not suggest a code"), "bad"); }
  };
  const propose = async () => {
    try {
      await proposeMapping({ system_id: systemId, list_id: list.id, target_field: targetField, source_code: src, target_code: tgt });
      toast(t("Mapping proposed"), "good"); setSrc(""); setTgt(""); setSug(undefined); await refresh();
    } catch { toast(t("The mapping could not be proposed"), "bad"); }
  };
  const decide = async (m: RefMapping, d: "approve" | "reject") => {
    try { await decideMapping(m.id, d, ""); toast(d === "approve" ? t("Mapping approved") : t("Mapping rejected"), "good"); await refresh(); }
    catch { toast(t("A different user must decide this mapping"), "bad"); }
  };
  return (
    <DetailPanel idBase="ref" label={list.table} tabsLabel={t("Reference list views")}
      header={<><Code code={list.table} description={list.module} /> <span className="mx-muted">{num(list.source_codes)} {t("source codes")}, {num(list.target_codes)} {t("target codes")}</span></>}
      tabs={[{ id: "mappings", label: t("Mappings") }, { id: "source", label: t("Source codes") }, { id: "target", label: t("Target codes") }]}
      value={tab} onChange={setTab}>
      <Async q={q}>
        {(d) => tab === "source" || tab === "target" ? (
          <DataTable label={tab === "source" ? t("Source codes") : t("Target codes")} rows={tab === "source" ? d.source : d.target} rowKey={(c) => c.code} height={380}
            columns={[{ key: "code", label: t("Code"), sort: (c) => c.code, render: (c) => <Code code={c.code} description={c.text ?? undefined} /> }]} />
        ) : (
          <>
            <Card title={t("Propose a mapping")} sub={t("A mapping takes effect when a different user approves it")}>
              <Field label={t("Target field")}>
                <Select value={targetField} onChange={(e) => setField(e.target.value)} options={list.target_fields.map((f) => ({ value: f, label: f }))} />
              </Field>
              <Field label={t("Source code")}><Input value={src} onChange={(e) => setSrc(e.target.value)} list={`ref-src-${list.id}`} /></Field>
              <datalist id={`ref-src-${list.id}`}>{d.source.map((c) => <option key={c.code} value={c.code}>{c.text ?? ""}</option>)}</datalist>
              <Field label={t("Target code")}><Input value={tgt} onChange={(e) => setTgt(e.target.value)} list={`ref-tgt-${list.id}`} /></Field>
              <datalist id={`ref-tgt-${list.id}`}>{d.target.map((c) => <option key={c.code} value={c.code}>{c.text ?? ""}</option>)}</datalist>
              <Button variant="ghost" tone="aletheia" disabled={!src} onClick={() => void suggest()}>{t("Suggest with Aletheia")}</Button>
              <Button variant="primary" disabled={!src || !tgt} onClick={() => void propose()}>{t("Propose")}</Button>
              {sug === null ? <p className="mx-muted">{t("No suggestion could be proven for this code")}</p> : null}
              {sug ? (
                <p>
                  <Code code={sug.target_code} description={sug.target_text ?? undefined} /> {Math.round(sug.confidence * 100)}%. {sug.reasoning}
                  <Button variant="ghost" onClick={() => setTgt(sug.target_code)}>{t("Use this code")}</Button>
                </p>
              ) : null}
            </Card>
            {d.mappings.length ? (
              <DataTable<RefMapping> label={t("Mappings")} rows={d.mappings} rowKey={(m) => m.id} height={320}
                columns={[
                  { key: "src", label: t("Source"), sort: (m) => m.source_code, render: (m) => <Code code={m.source_code} description={m.source_text ?? undefined} /> },
                  { key: "tgt", label: t("Target"), sort: (m) => m.target_code, render: (m) => <Code code={m.target_code} description={m.target_text ?? undefined} /> },
                  { key: "f", label: t("Field"), render: (m) => <Code code={m.target_field} /> },
                  { key: "st", label: t("Status"), sort: (m) => m.status, render: (m) => statusText(m.status) },
                  { key: "do", label: t("Decision"), render: (m) => (m.status === "proposed" ? (
                    <><Button variant="ghost" onClick={() => void decide(m, "approve")}>{t("Approve")}</Button><Button variant="ghost" onClick={() => void decide(m, "reject")}>{t("Reject")}</Button></>
                  ) : (m.decided_by ?? "")) },
                ]} />
            ) : <Empty heading={t("No mappings yet")} />}
          </>
        )}
      </Async>
    </DetailPanel>
  );
}

export function ReferenceScreen() {
  const sys = useSystemPick();
  const lists = useRead(["ref-lists", sys.id], () => getRefLists(sys.id), !!sys.id);
  const [sel, setSel] = useState<string>("");
  const rows = lists.data?.lists ?? [];
  const cur = rows.find((l) => l.id === sel) ?? rows[0];
  useScreenScope("reference", t("Reference data"), [
    { prompt: t("Which lists have open codes?"), answer: () => ({ text: rows.filter((l) => l.coverage.open > 0).map((l) => `${l.table}: ${l.coverage.open}`).join(", ") || t("None") }) },
  ]);
  return (
    <>
      <Head title={t("Reference data")} context={lists.data ? `${lists.data.target_label}, ${num(rows.length)} ${t("lists")}` : undefined} />
      <Split leftLabel={t("Code lists")} rightLabel={t("List detail")}
        left={
          <>
            {sys.control}
            <Async q={lists}>
              {() => rows.length ? (
                <DataTable<RefListSummary> label={t("Code lists")} rows={rows} rowKey={(l) => l.id} height={460} selected={cur?.id} onSelect={(l) => setSel(l.id)}
                  columns={[
                    { key: "t", label: t("Table"), sort: (l) => l.table, render: (l) => <Code code={l.table} description={l.module} /> },
                    { key: "s", label: t("Codes"), align: "end", sort: (l) => l.source_codes, render: (l) => num(l.source_codes) },
                    { key: "o", label: t("Open"), align: "end", sort: (l) => l.coverage.open, render: (l) => num(l.coverage.open) },
                    { key: "p", label: t("Proposed"), align: "end", render: (l) => num(l.coverage.proposed) },
                  ]} />
              ) : <Empty heading={t("No code lists")} />}
            </Async>
          </>
        }
        right={cur ? <ListDetail key={cur.id + sys.id} systemId={sys.id} list={cur} /> : <Empty heading={t("Pick a code list")} />} />
    </>
  );
}
