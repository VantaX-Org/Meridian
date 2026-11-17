"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { draftTermWithAi, getGlossaryTermDetail, reviewTerm, updateTerm } from "@/lib/api/v2/mdm";
import { t } from "@/lib/v2/i18n";
import { Button, Code, DataTable, Field, Input, useToast } from "@/ui/kit";
import { Async, Empty, num, useRead, when } from "./shared";

/** One glossary term: wording, editing, AI draft, review and the rules that cite it. Used in the glossary pane and in the term sheet. */
export function TermDetail({ id }: { id: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useRead(["term", id], () => getGlossaryTermDetail(id));
  const [name, setName] = useState<string | null>(null);
  const [def, setDef] = useState<string | null>(null);
  const done = (msg: string) => { toast(msg, "good"); void qc.invalidateQueries({ queryKey: ["b7b"] }); };
  const fail = () => toast(t("The change could not be saved"), "bad");
  return (
    <Async q={q}>
      {(d) => (
        <div className="mx-col">
          <header><Code code={d.technical_name} description={d.business_name} /></header>
          <Field label={t("Business name")}><Input value={name ?? d.business_name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t("Business definition")}><Input value={def ?? d.business_definition ?? ""} onChange={(e) => setDef(e.target.value)} /></Field>
          <p className="mx-muted">{d.why_it_matters ?? ""}</p>
          <p className="mx-muted">{t("Status")}: {d.status}{d.ai_drafted ? ` (${t("AI drafted")})` : ""} {t("Last reviewed")}: {when(d.last_reviewed_at)}</p>
          <div className="mx-links">
            <Button variant="primary" onClick={() => void updateTerm(id, { business_name: name ?? undefined, business_definition: def ?? undefined }).then(() => done(t("Term saved")), fail)}>{t("Save")}</Button>
            <Button variant="secondary" onClick={() => void reviewTerm(id).then(() => done(t("Term reviewed")), fail)}>{t("Mark reviewed")}</Button>
            <Button variant="ghost" tone="aletheia" onClick={() => void draftTermWithAi(id).then((r) => { setDef(r.business_definition); toast(t("Draft ready, review it before saving"), "info"); }, fail)}>{t("Draft with AI")}</Button>
          </div>
          {d.linked_rules.length ? (
            <DataTable label={t("Rules that cite this term")} rows={d.linked_rules} rowKey={(r) => r.rule_id} height={200}
              columns={[
                { key: "r", label: t("Rule"), render: (r) => <Code code={r.rule_id} /> },
                { key: "p", label: t("Pass rate"), align: "end", render: (r) => (r.pass_rate === null ? t("n/a") : `${num(Math.round(r.pass_rate * 100))}%`) },
              ]} />
          ) : <Empty heading={t("No rules cite this term")} />}
        </div>
      )}
    </Async>
  );
}
