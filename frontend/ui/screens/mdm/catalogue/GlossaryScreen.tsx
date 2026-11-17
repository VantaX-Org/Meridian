"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGlossary, getObjectOwners, populateGlossary } from "@/lib/api/v2/mdm";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Chip, Code, DataTable, Field, Search, Select, Split, useToast } from "@/ui/kit";
import { Async, Empty, Head, num, useRead, useScreenScope, when } from "./shared";
import { TermDetail } from "./TermDetail";

type Term = Awaited<ReturnType<typeof getGlossary>>["terms"][number];
const DOMAINS = ["material_master", "customer_master", "vendor_master"];

export function GlossaryScreen() {
  const [domain, setDomain] = useState("material_master");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const q = useRead(["glossary", domain, search], () => getGlossary(domain, search));
  const owners = useRead(["owners"], getObjectOwners);
  useScreenScope("glossary", t("Glossary"), [
    { prompt: t("Which terms are not reviewed yet?"), answer: () => {
      const todo = (q.data?.terms ?? []).filter((x) => !x.last_reviewed_at).slice(0, 5);
      return { text: todo.map((x) => x.business_name).join(", ") || t("n/a"), evidence: todo.map((x) => x.technical_name) };
    } },
  ]);
  const populate = () => void populateGlossary().then(
    (r) => { toast(`${r.created} ${t("terms created")}`, "good"); void qc.invalidateQueries({ queryKey: ["b7b"] }); },
    () => toast(t("The glossary could not be filled"), "bad"));
  const terms = (q.data?.terms ?? []).filter((x) => !status || x.status === status);
  const cur = sel ?? terms[0]?.id ?? null;
  return (
    <>
      <Head title={t("Glossary")} context={q.data ? `${num(q.data.total)} ${t("terms")}` : undefined} actions={<Button variant="secondary" onClick={populate}>{t("Fill from rule library")}</Button>} />
      <Split leftLabel={t("Terms")} rightLabel={t("Term detail")}
        left={
          <>
            <Field label={t("Object")}><Select value={domain} onChange={(e) => setDomain(e.target.value)} options={DOMAINS.map((d) => ({ value: d, label: d }))} /></Field>
            <Search value={search} onChange={setSearch} label={t("Search terms")} clearLabel={t("Clear search")} placeholder={t("Name or field")} />
            <div className="mx-links">
              {["", "draft", "approved"].map((s) => <Chip key={s} selected={status === s} onClick={() => setStatus(s)}>{s === "" ? t("All") : s === "draft" ? t("Draft") : t("Approved")}</Chip>)}
            </div>
            <Async q={q}>
              {() => (terms.length ? (
                <DataTable<Term> label={t("Terms")} rows={terms} rowKey={(x) => x.id} selected={cur} onSelect={(x) => setSel(x.id)} height={420}
                  columns={[
                    { key: "f", label: t("Field"), sort: (x) => x.technical_name, render: (x) => <Code code={x.technical_name} description={x.business_name} /> },
                    { key: "st", label: t("Status"), render: (x) => x.status },
                    { key: "rv", label: t("Reviewed"), render: (x) => when(x.last_reviewed_at) },
                    { key: "ru", label: t("Rules"), align: "end", sort: (x) => x.linked_rules_count, render: (x) => num(x.linked_rules_count) },
                  ]} />
              ) : <Empty heading={t("No terms yet")} body={t("Fill the glossary from the rule library.")} />)}
            </Async>
          </>
        }
        right={
          <>
            {cur ? <TermDetail id={cur} /> : <Empty heading={t("Pick a term")} />}
            <Card title={t("Owners")}>
              <Async q={owners} lines={2}>
                {(o) => (o.length ? (
                  <DataTable label={t("Owners")} rows={o} rowKey={(x) => `${x.kind}-${x.ref}`} height={120}
                    columns={[
                      { key: "o", label: t("Object"), render: (x) => <Code code={x.ref} /> },
                      { key: "ow", label: t("Owner"), render: (x) => x.owner_name ?? t("n/a") },
                      { key: "s", label: t("Steward"), render: (x) => x.steward_name ?? t("n/a") },
                    ]} />
                ) : <Empty heading={t("No owners set")} />)}
              </Async>
            </Card>
          </>
        } />
    </>
  );
}
