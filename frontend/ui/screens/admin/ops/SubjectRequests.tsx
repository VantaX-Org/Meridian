"use client";

import { useState } from "react";
import { downloadSubjectExport, dryRunErasure, executeErasure, liftSuppression, searchSubject, subjectError, type SubjectErase, type SubjectSearch } from "@/lib/api/v2/subject-requests";
import { useSubjectRequests, useSuppressions } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Code, Confirm, DataTable, Field, Input, StatTile, useToast, EmptyState, ExportMenu } from "@/ui/kit";
import { Flow } from "@/ui/screens/flow";
import { Row, Sec, useAct, when } from "./shared";

export function SubjectRequests() {
  const ledger = useSubjectRequests();
  const supp = useSuppressions();
  const toast = useToast();
  const { run, busy } = useAct("subjectrequests");
  const [subject, setSubject] = useState("");
  const [found, setFound] = useState<SubjectSearch | null>(null);
  const [dry, setDry] = useState<SubjectErase | null>(null);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [ask, setAsk] = useState(false);
  const [lift, setLift] = useState<string | null>(null);
  const [liftReason, setLiftReason] = useState("");
  const rows = ledger.data ?? [];
  const items = supp.data?.items ?? [];
  const texts = supp.data?.field_texts ?? {};
  const fail = (e: unknown) => toast(subjectError(e, t("The request failed.")), "bad");

  return (
    <Sec title={t("Data subject requests")} stepper={<Flow label={t("Subject request")} at={dry ? 2 : found ? 1 : 0} steps={[t("Find a person"), t("Preview erasure"), t("Erase")]} />} scope="subject-requests" q={[ledger, supp]}
      context={t("{n} requests on record", { n: rows.length })}
      facts={[t("{n} requests on record.", { n: rows.length }), t("{n} erased keys are suppressed.", { n: supp.data?.active_keys ?? 0 })]}>
      <Card title={t("Find a person")} sub={t("The subject is sent in the request body and is never kept in a URL.")}>
        <Row>
          <Field label={t("Name, email or key")}><Input value={subject} onChange={(e) => { setSubject(e.target.value); setFound(null); setDry(null); }} /></Field>
          <Button variant="primary" disabled={busy || !subject.trim()} onClick={async () => { try { setFound(await searchSubject(subject.trim())); setDry(null); } catch (e) { fail(e); } }}>{t("Search")}</Button>
          <ExportMenu formats={[{ id: "json", label: t("Subject data"), hint: t("Everything held about this person") }]} personalData disabled={busy || !found} onExport={() => downloadSubjectExport(subject.trim())} />
          <Button variant="secondary" disabled={busy || !found} onClick={async () => { try { setDry(await dryRunErasure(subject.trim())); } catch (e) { fail(e); } }}>{t("Preview erasure")}</Button>
        </Row>
        {found && (
          <dl className="mx-tiles">
            <StatTile label={t("Matched rows")} value={String(found.total_rows)} note={found.full_key ? t("Full key") : t("Partial key")} />
            <StatTile label={t("Keys")} value={String(found.keys.length)} />
            <StatTile label={t("Extract files")} value={String(found.extracts.files)} note={found.extracts.complete ? t("Fully scanned") : t("Scan incomplete")} />
          </dl>
        )}
        {found && (
          <DataTable label={t("Rows by table")} rows={Object.entries(found.rows_by_table)} rowKey={([k]) => k} height={200}
            columns={[
              { key: "table", label: t("Table"), render: ([k]) => <Code code={k} /> },
              { key: "rows", label: t("Rows"), align: "end", render: ([, n]) => String(n) },
            ]} />
        )}
        {dry && (
          <Row>
            <Field label={t("Reason")} hint={t("Required. Recorded in the ledger.")}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <Button variant="primary" disabled={busy || !reason.trim()} onClick={() => setAsk(true)}>{t("Erase {n} rows", { n: dry.total_rows })}</Button>
          </Row>
        )}
      </Card>

      <Card title={t("Request ledger")}>
        {rows.length === 0 ? <EmptyState heading={t("No requests yet.")} body={t("A request appears here once a person submits one.")} /> : (
          <DataTable label={t("Request ledger")} rows={rows} rowKey={(r) => r.request_id} height={300}
            columns={[
              { key: "created_at", label: t("When"), render: (r) => when(r.created_at), sort: (r) => r.created_at },
              { key: "kind", label: t("Kind"), render: (r) => <Code code={r.kind} description={r.dry_run ? t("Preview only") : t("Executed")} /> },
              { key: "actor", label: t("By"), render: (r) => r.actor ?? "" },
              { key: "rows", label: t("Rows"), align: "end", render: (r) => String(Object.values(r.rows_by_table).reduce((a, b) => a + b, 0)) },
              { key: "status", label: t("Status"), render: (r) => r.status },
              { key: "reason", label: t("Reason"), render: (r) => r.reason ?? "" },
            ]} />
        )}
      </Card>

      <Card title={t("Suppressed keys")} sub={t("Erased keys that extraction drops. Only field names and counts are kept.")}>
        {items.length === 0 ? <EmptyState heading={t("No keys are suppressed.")} body={t("Suppress a key to keep it out of every run.")} /> : (
          <DataTable label={t("Suppressed keys")} rows={items} rowKey={(r) => r.request_id ?? r.created_at} height={260}
            columns={[
              { key: "fields", label: t("Key fields"), render: (r) => r.key_fields.map((f) => <Code key={f} code={f} description={texts[f]} />) },
              { key: "keys", label: t("Keys"), align: "end", render: (r) => String(r.active_keys) },
              { key: "dropped", label: t("Rows dropped"), align: "end", render: (r) => String(r.dropped) },
              { key: "created", label: t("Erased"), render: (r) => when(r.created_at) },
              { key: "act", label: t("Lift"), render: (r) => r.lifted_at ? t("Lifted {when}", { when: when(r.lifted_at) }) : r.request_id ? <Button variant="ghost" onClick={() => setLift(r.request_id)}>{t("Lift suppression")}</Button> : "" },
            ]} />
        )}
      </Card>

      <Confirm open={ask} danger title={t("Erase this person for good?")} confirmLabel={t("Erase")} cancelLabel={t("Cancel")}
        onCancel={() => { setAsk(false); setTyped(""); }}
        onConfirm={async () => {
          if (!dry) return;
          const r = await run(() => executeErasure(subject.trim(), dry.request_id, typed || subject.trim(), reason.trim()), t("Erasure done."));
          if (r) { setAsk(false); setDry(null); setFound(null); setSubject(""); setReason(""); setTyped(""); }
        }}>
        <p>{t("Type the subject again to confirm. This cannot be undone.")}</p>
        <Input aria-label={t("Confirm subject")} value={typed} onChange={(e) => setTyped(e.target.value)} />
      </Confirm>
      <Confirm open={lift !== null} title={t("Lift this suppression?")} confirmLabel={t("Lift")} cancelLabel={t("Cancel")}
        onCancel={() => { setLift(null); setLiftReason(""); }}
        onConfirm={async () => {
          if (!lift || !liftReason.trim()) return;
          const r = await run(() => liftSuppression(lift, liftReason.trim()), t("Suppression lifted."));
          if (r) { setLift(null); setLiftReason(""); }
        }}>
        <Field label={t("Reason")}><Input value={liftReason} onChange={(e) => setLiftReason(e.target.value)} /></Field>
      </Confirm>
    </Sec>
  );
}
