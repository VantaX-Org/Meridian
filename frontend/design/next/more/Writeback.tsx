"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate, labelOf } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { useV2Session } from "@/lib/v2/hooks";
import { useFixture } from "@/lib/api/v2/fixture";
import { v2Get, errorSentence } from "@/lib/api/v2/client";
import { describeField } from "@/lib/v2/sap-fields";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { createWriteback, useRequests, type FieldSupport, type RequestRow, type StructuredFix, type WritebackResult } from "@/lib/api/next/approvals";
import { V2Link } from "@/design/v2/parts";
import { Button, Chip, Confirm, DataTable, useToast, type Column } from "../kit";
import { QueryView } from "./states";

interface FindingRow { id: string; module: string; check_id: string; affected_count: number; details?: { message?: string }; record_fixes: unknown[] | null }

/** The fixes POST /writeback accepts (api/routes/writeback.py _structured): field, full record key and proposed value. */
export const structuredFixes = (fixes: unknown[] | null): StructuredFix[] =>
  (fixes ?? []).filter((f): f is StructuredFix => {
    const x = f as Partial<StructuredFix> | null;
    return !!x && !!x.auto_fix && !!x.record_key && !!x.field && x.proposed_value !== undefined && x.proposed_value !== null;
  });

const STATE_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = { approved: "good", pending: "warn", rejected: "bad", dry_run: "neutral" };
const fieldCell = (field: string) => (
  <span className="nx-cell-stack">
    <span className="nx-mono">{field}</span>
    <span className="nx-sub">{describeField(field) ?? t("No SAP description for this field")}</span>
  </span>
);
const show = (v: unknown): string => (v === null || v === undefined || v === "" ? t("Empty") : String(v));

/**
 * Send one finding's record fixes back to SAP (api/routes/writeback.py). Check with SAP is the dry run and saves
 * nothing; Send for approval files a pending request; only a second person executes it, from Approvals. The fixes sent
 * are the finding's own structured fixes, which the server checks again against the stored finding.
 */
export function Writeback() {
  const session = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const fx = useFixture();
  const findings = useQuery({
    queryKey: ["v2", "wb-findings", fx],
    queryFn: () => v2Get<{ findings: FindingRow[] }>("/findings", { type: "rule", failing: true, limit: 200 }),
    staleTime: 30_000,
  });
  const systems = useSystemsExtended();
  const requests = useRequests();
  const [findingId, setFindingId] = useState("");
  const [systemId, setSystemId] = useState("");
  const [check, setCheck] = useState<WritebackResult | null>(null);
  const [asking, setAsking] = useState(false);
  const canApply = session.can("apply") && !session.shared && !session.viewAs;

  const fixable = useMemo(
    () => (findings.data?.findings ?? []).map((f) => ({ ...f, fixes: structuredFixes(f.record_fixes) })).filter((f) => f.fixes.length > 0),
    [findings.data],
  );
  const sap = useMemo(() => systems.data ?? [], [systems.data]);
  const finding = fixable.find((f) => f.id === findingId) ?? fixable[0];
  const system = sap.find((s) => s.id === systemId) ?? sap[0];
  const support = useMemo(() => new Map((check?.fields ?? []).map((s) => [`${s.record_key}|${s.field}`, s])), [check]);

  const send = useMutation({
    mutationFn: (dry: boolean) => createWriteback({ finding_id: finding!.id, record_fixes: finding!.fixes, system_id: system!.id, dry_run: dry }),
    onSuccess: (r, dry) => {
      if (dry) setCheck(r);
      else {
        setCheck(null);
        toast({ text: t("Sent for approval. A second person approves it in Approvals before anything changes in SAP."), tone: "good" });
      }
      void qc.invalidateQueries({ queryKey: ["v2", "wb-requests"] });
    },
    onError: (e) => toast({ text: errorSentence(e, t("The request could not be sent.")), tone: "bad" }),
  });

  const pick = (set: (v: string) => void) => (v: string) => { set(v); setCheck(null); };
  const blocked = !finding ? t("Pick a rule with fixes first.") : !system ? t("Connect an SAP system first.") : undefined;

  const fixCols: Column<StructuredFix>[] = [
    { id: "record", label: t("Record"), cell: (f) => <span className="nx-mono">{f.record_key}</span> },
    { id: "field", label: t("Field"), cell: (f) => fieldCell(f.field) },
    { id: "before", label: t("Now in SAP"), cell: (f) => show(f.invalid_value) },
    { id: "after", label: t("After the fix"), cell: (f) => <strong>{show(f.proposed_value)}</strong> },
    {
      id: "route", label: t("How it is sent"),
      cell: (f) => {
        const s: FieldSupport | undefined = support.get(`${f.record_key}|${f.field}`);
        if (!s) return <span className="nx-sub">{t("Check with SAP to see")}</span>;
        return s.supported
          ? <Chip tone="good">{t("By BAPI {bapi}", { bapi: s.bapi ?? "" })}</Chip>
          : <span className="nx-cell-stack"><Chip tone="warn">{t("By export file")}</Chip><span className="nx-sub">{s.reason ?? ""}</span></span>;
      },
    },
  ];
  const reqCols: Column<RequestRow>[] = [
    {
      id: "rule", label: t("Rule"),
      cell: (r) => <span className="nx-cell-stack"><span className="nx-mono">{r.check_id ?? ""}</span><span className="nx-sub">{r.rule_message ?? t("No rule text")}</span></span>,
    },
    { id: "module", label: t("Object"), cell: (r) => (r.module ? labelOf(r.module) : t("Unknown")) },
    { id: "state", label: t("State"), cell: (r) => <Chip tone={STATE_TONE[r.state] ?? "neutral"}>{labelOf(r.state)}</Chip> },
    { id: "by", label: t("Asked by"), cell: (r) => r.requested_by_name ?? t("Unknown") },
    { id: "decided", label: t("Decided by"), cell: (r) => r.approved_by_name ?? r.rejected_by_name ?? t("Not yet") },
    { id: "records", label: t("Records changed"), align: "end", cell: (r) => int(r.records_updated) },
    { id: "when", label: t("Asked"), cell: (r) => (r.created_at ? formatDate(r.created_at, "date") : t("Unknown")) },
  ];

  return (
    <div className="nx-body" data-testid="writeback-page">
      <p className="nx-sub">{t("Pick a failing rule and an SAP system. Check with SAP saves nothing. Sending files a request that a second person approves before SAP changes.")}</p>
      <QueryView loading={findings.isLoading || systems.isLoading} error={findings.error ?? systems.error} onRetry={() => { void findings.refetch(); void systems.refetch(); }} empty={fixable.length === 0} emptyHeading={t("No rule has fixes that can go back to SAP")} emptyText={t("Fixes appear here when a rule proposes an exact value for a record.")} label={t("Loading fixes")}>
        <div className="nx-row nx-wrap">
          <label className="nx-field">{t("Rule")}
            <select className="nx-input" value={finding?.id ?? ""} onChange={(e) => pick(setFindingId)(e.target.value)} data-testid="writeback-finding">
              {fixable.map((f) => <option key={f.id} value={f.id}>{`${f.check_id}: ${f.details?.message ?? labelOf(f.module)} (${int(f.fixes.length)})`}</option>)}
            </select>
          </label>
          <label className="nx-field">{t("SAP system")}
            <select className="nx-input" value={system?.id ?? ""} onChange={(e) => pick(setSystemId)(e.target.value)} data-testid="writeback-system">
              {sap.map((s) => <option key={s.id} value={s.id}>{`${s.name}${s.client ? ` (${t("client {c}", { c: s.client })})` : ""}`}</option>)}
            </select>
          </label>
        </div>
        {finding ? (
          <DataTable rows={finding.fixes} columns={fixCols} rowKey={(f) => `${f.record_key}|${f.field}`} rowLabel={(f) => f.record_key} caption={t("What changes in SAP")} />
        ) : null}
        {check ? (
          <div className="nx-cell-stack" data-testid="writeback-check">
            <p>{t("{bapi} of {n} fields go by BAPI; the rest go in the export file.", { bapi: int(check.fields.filter((f) => f.supported).length), n: int(check.fields.length) })}</p>
            {check.errors.map((e) => <p key={e} className="nx-sub">{e}</p>)}
          </div>
        ) : null}
        {canApply ? (
          <div className="nx-row nx-wrap">
            <Button variant="secondary" loading={send.isPending && send.variables === true} loadingLabel={t("Checking with SAP")} disabled={!!blocked} reason={blocked} onClick={() => send.mutate(true)} data-testid="writeback-dryrun">
              {t("Check with SAP")}
            </Button>
            <Button variant="primary" loading={send.isPending && send.variables === false} loadingLabel={t("Sending")} disabled={!!blocked || !check} reason={blocked ?? (!check ? t("Check with SAP first.") : undefined)} onClick={() => setAsking(true)} data-testid="writeback-send">
              {t("Send for approval")}
            </Button>
            <V2Link className="nx-btn nx-btn-quiet" href="/approvals">{t("Open Approvals")}</V2Link>
          </div>
        ) : (
          <p className="nx-sub">{t("Sending fixes to SAP needs the apply permission.")}</p>
        )}
      </QueryView>
      <h2 className="nx-h2">{t("Requests and results")}</h2>
      <DataTable rows={requests.data?.items ?? []} columns={reqCols} rowKey={(r) => r.id} rowLabel={(r) => r.check_id ?? r.id} caption={t("Requests and results")} loading={requests.isLoading} empty={{ heading: t("No write-back requests yet.") }} />
      <Confirm
        open={asking}
        title={t("Send for approval")}
        consequence={t("This asks a second person to write {n} fields to {system}. Nothing changes in SAP until they approve.", { n: int(finding?.fixes.length ?? 0), system: system?.name ?? "" })}
        confirmLabel={t("Send for approval")}
        onConfirm={() => { setAsking(false); send.mutate(false); }}
        onCancel={() => setAsking(false)}
      />
    </div>
  );
}
