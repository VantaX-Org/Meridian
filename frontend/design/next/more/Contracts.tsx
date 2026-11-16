"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { activateContract, createContract, reviseContract, updateContract, type Contract } from "@/lib/api/v2/roles";
import { getContractBreaches, getContractCompliance, type ContractComplianceRow } from "@/lib/api/v2/step9";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { failureText } from "@/lib/v2/errors";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { notFound, refreshRoles, useContract, useContracts } from "@/lib/v2/roles-queries";
import { Button, Chip, DataTable, Sheet, type Column, useToast } from "../kit";
import type { SheetCtx } from "../shell/SheetHost";
import { Collab } from "./Collab";
import { QueryView, useSubmitGuard } from "./states";
import "./journey.css";

/**
 * Data contracts in the new interface (GET/POST /contracts, GET /contracts/{id}/detail, PUT /contracts/{id},
 * PUT /contracts/{id}/activate, POST /contracts/{id}/revise, GET /contracts/{id}/breaches and /compliance).
 * Sheet kinds: "contracts" lists and creates; "contract" is one contract with its checks, versions and comments.
 */

const STATUS: Record<string, string> = { get draft() { return t("Draft"); }, get pending_approval() { return t("Waiting for approval"); }, get active() { return t("Active"); }, get expired() { return t("Expired"); } };

function Compliance({ c }: { c: Contract }) {
  if (c.latest_compliant === null) return <Chip tone="neutral">{t("Not checked yet")}</Chip>;
  return <Chip tone={c.latest_compliant ? "good" : "bad"}>{c.latest_compliant ? t("Met") : t("Breached")}</Chip>;
}

export function ContractsSheet({ ctx }: { ctx: SheetCtx }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const toast = useToast();
  const q = useContracts();
  const [name, setName] = useState("");
  const [producer, setProducer] = useState("");
  const [consumer, setConsumer] = useState("");
  const [minScore, setMinScore] = useState("85");
  const { busy, run } = useSubmitGuard();
  const canCreate = session.can("manage_rules") && !session.shared && !session.viewAs;
  const ready = name.trim() && producer.trim() && consumer.trim();
  const create = () =>
    run(async () => {
      try {
        const r = await createContract({ name: name.trim(), producer: producer.trim(), consumer: consumer.trim(), quality_contract: { module: producer.trim(), min_score: Number(minScore) } });
        setName("");
        await refreshRoles(qc, "contracts");
        ctx.open({ kind: "contract", id: r.id });
      } catch (e) {
        toast({ text: failureText(e), tone: "bad" });
      }
    });
  const rows = q.data?.contracts ?? [];
  return (
    <Sheet open onClose={ctx.close} title={t("Data contracts")} meta={t("What each consumer is promised")} size="large" under={ctx.under} dirty={Boolean(name || producer || consumer)}
      secondary={<Button variant="secondary" onClick={ctx.close}>{t("Done")}</Button>}>
      <div className="nx-form">
        <QueryView loading={q.isPending} error={q.isError ? (notFound(q.error) ? t("Contracts are not available on this server") : t("The contracts could not be read.")) : null} onRetry={() => void q.refetch()} empty={rows.length === 0} emptyHeading={t("No contract yet.")} label={t("Data contracts")}>
          <ul className="nx-pick" data-testid="contracts-list">
            {rows.map((c) => (
              <li key={c.id} className="nx-row">
                <div className="nx-row-main">
                  <Button variant="quiet" size={32} onClick={() => ctx.open({ kind: "contract", id: c.id })}>{c.name}</Button>
                  <div className="nx-sub">{t("{STATUS}, version {version}, {producer} to {consumer}", { STATUS: STATUS[c.status] ?? c.status, version: c.version, producer: moduleText(c.producer), consumer: c.consumer })}</div>
                </div>
                <Compliance c={c} />
              </li>
            ))}
          </ul>
        </QueryView>
        <h3 className="nx-jh">{t("New contract")}</h3>
        {canCreate ? (
          <div className="nx-form" data-testid="contract-form">
            <label className="nx-field">{t("Name")}<input className="nx-input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} /></label>
            <label className="nx-field">{t("Producer (object)")}<input className="nx-input" value={producer} placeholder="material_master" onChange={(e) => setProducer(e.target.value)} /></label>
            <label className="nx-field">{t("Consumer")}<input className="nx-input" value={consumer} placeholder={t("S/4HANA migration")} onChange={(e) => setConsumer(e.target.value)} /></label>
            <label className="nx-field">{t("Minimum score")}<input className="nx-input" type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(e.target.value)} /></label>
            <div className="nx-row"><Button variant="primary" loading={busy} disabled={!ready} onClick={() => void create()}>{t("Create a draft")}</Button></div>
          </div>
        ) : (
          <p className="nx-note">{t("Creating a contract needs the manage rules permission.")}</p>
        )}
      </div>
    </Sheet>
  );
}

type Check = ContractComplianceRow;
const num = (v: number | null) => (v === null ? t("Not measured") : String(Math.round(Number(v))));
const CHECK_COLUMNS: Column<Check>[] = [
  { id: "at", get label() { return t("Checked"); }, cell: (r) => formatDate(r.recorded_at, "date") },
  { id: "co", get label() { return t("Completeness"); }, cell: (r) => num(r.completeness_actual), align: "end" },
  { id: "ac", get label() { return t("Accuracy"); }, cell: (r) => num(r.accuracy_actual), align: "end" },
  { id: "cs", get label() { return t("Consistency"); }, cell: (r) => num(r.consistency_actual), align: "end" },
  { id: "ti", get label() { return t("Timeliness"); }, cell: (r) => num(r.timeliness_actual), align: "end" },
  { id: "un", get label() { return t("Uniqueness"); }, cell: (r) => num(r.uniqueness_actual), align: "end" },
  { id: "va", get label() { return t("Validity"); }, cell: (r) => num(r.validity_actual), align: "end" },
  { id: "ok", get label() { return t("Result"); }, cell: (r) => <Chip tone={r.overall_compliant ? "good" : "bad"}>{r.overall_compliant ? t("Met") : t("Breached")}</Chip> },
];

function ContractChecks({ id, onRun }: { id: string; onRun: (runId: string) => void }) {
  const fx = useFixture();
  const br = useQuery({ queryKey: ["v2", "contract-breaches", fx, id], queryFn: () => getContractBreaches(id), retry: false });
  const co = useQuery({ queryKey: ["v2", "contract-compliance", fx, id], queryFn: () => getContractCompliance(id), retry: false });
  const line = (b: { metric: string; actual: number | null; threshold: number }) => t("{metric}: {actual} against {threshold}", { metric: b.metric, actual: b.actual ?? "-", threshold: b.threshold });
  const breaches = [...(br.data?.current ?? []).map((b) => ({ ...b, when: t("Now") })), ...(br.data?.history ?? []).map((b) => ({ ...b, when: b.run_at ? formatDate(b.run_at, "date") : t("No date") }))];
  return (
    <>
      <h3 className="nx-jh">{t("Thresholds breached")}</h3>
      {breaches.length ? (
        <ul className="nx-pick" data-testid="contract-threshold-breaches">
          {breaches.map((b, i) => (
            <li key={i} className="nx-row nx-row-wrap">
              <span className="nx-sub">{b.when}</span>
              <span className="nx-row-main">{line(b)}</span>
              {b.run_id ? <Button variant="quiet" size={32} onClick={() => onRun(b.run_id as string)}>{t("Open the run")}</Button> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="nx-sub">{br.isLoading ? t("Loading") : t("No threshold is breached.")}</p>
      )}
      <DataTable<Check> caption={t("Recent checks")} rows={co.data?.compliance_history ?? []} columns={CHECK_COLUMNS} rowKey={(r) => r.id} rowLabel={(r) => formatDate(r.recorded_at, "date")} loading={co.isLoading} empty={{ heading: t("Recent checks"), text: t("No check in the last 90 days.") }} />
    </>
  );
}

export function ContractSheet({ ctx }: { ctx: SheetCtx }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const toast = useToast();
  const q = useContract(ctx.id);
  const [desc, setDesc] = useState<string | null>(null);
  const { busy, run } = useSubmitGuard();
  const live = !session.shared && !session.viewAs;
  const act = (fn: () => Promise<unknown>, said: string) =>
    run(async () => {
      try {
        await fn();
        toast({ text: said, tone: "good" });
        setDesc(null);
        await refreshRoles(qc, "contracts");
      } catch (e) {
        toast({ text: failureText(e), tone: "bad" });
      }
    });
  const c = q.data?.contract;
  const editable = c && (c.status === "draft" || c.status === "pending_approval") && session.can("manage_rules");
  const mine = c?.created_by === session.id;
  return (
    <Sheet open onClose={ctx.close} title={c?.name ?? t("Data contract")} meta={c ? t("{STATUS}, version {version}", { STATUS: STATUS[c.status] ?? c.status, version: c.version }) : undefined} size="large" under={ctx.under} dirty={desc !== null}
      secondary={<Button variant="secondary" onClick={() => ctx.open({ kind: "contracts", id: "" })}>{t("All contracts")}</Button>}>
      <QueryView loading={q.isPending} error={q.isError ? (notFound(q.error) ? t("This contract does not exist.") : t("The contract could not be read.")) : null} onRetry={() => void q.refetch()} empty={false} emptyHeading="" label={t("Data contract")}>
        {c && q.data ? (
          <div className="nx-form">
            <dl className="nx-jfacts" data-testid="contract-facts">
              <dt className="nx-sub">{t("Producer")}</dt><dd>{moduleText(c.producer)}</dd>
              <dt className="nx-sub">{t("Consumer")}</dt><dd>{c.consumer}</dd>
              <dt className="nx-sub">{t("Promise")}</dt><dd>{c.quality_contract && typeof c.quality_contract.min_score === "number" ? t("Score at {min_score} or more", { min_score: c.quality_contract.min_score }) : t("No quality promise")}</dd>
              <dt className="nx-sub">{t("Compliance")}</dt><dd><Compliance c={c} /></dd>
              <dt className="nx-sub">{t("Checked")}</dt><dd>{c.last_checked ? t("{last_checked}, {checks} checks in all", { last_checked: formatDate(c.last_checked, "date"), checks: q.data.checks }) : t("Not checked yet")}</dd>
            </dl>
            {live ? (
              <div className="nx-form">
                {editable ? (
                  <div className="nx-row nx-row-wrap">
                    <label className="nx-field nx-row-main">{t("Description")}<input className="nx-input" value={desc ?? c.description ?? ""} onChange={(e) => setDesc(e.target.value)} /></label>
                    <Button disabled={desc === null} loading={busy} onClick={() => void act(() => updateContract(c.id, { description: desc ?? "" }), t("Saved."))}>{t("Save")}</Button>
                  </div>
                ) : null}
                <div className="nx-row nx-row-wrap">
                  {c.status === "draft" && session.can("manage_rules") ? <Button variant="primary" loading={busy} onClick={() => void act(() => updateContract(c.id, { status: "pending_approval" }), t("Sent for approval."))}>{t("Submit for approval")}</Button> : null}
                  {c.status === "pending_approval" && session.can("approve") ? <Button variant="primary" loading={busy} disabled={mine} reason={mine ? t("Four eyes: you wrote it") : undefined} onClick={() => void act(() => activateContract(c.id), t("Approved: the contract is active."))}>{t("Approve")}</Button> : null}
                  {c.status === "active" && session.can("manage_rules") ? <Button loading={busy} onClick={() => void act(() => reviseContract(c.id), t("Version {count} opened as a draft.", { count: c.version + 1 }))}>{t("Revise as a new version")}</Button> : null}
                </div>
              </div>
            ) : null}
            <h3 className="nx-jh">{t("Breaches")}</h3>
            {q.data.breaches.length === 0 ? (
              <p className="nx-sub">{t("No check has failed.")}</p>
            ) : (
              <ul className="nx-pick" data-testid="contract-breaches">
                {q.data.breaches.map((b, i) => (
                  <li key={`${b.recorded_at}-${i}`} className="nx-row nx-row-wrap">
                    <span className="nx-sub">{formatDate(b.recorded_at, "date")}</span>
                    <span className="nx-row-main">{Array.isArray(b.violations) ? t("{violationsCount} {violationsCount, plural, one {promise} other {promises}} not met", { violationsCount: b.violations.length }) : t("Not met")}</span>
                    {b.version_id ? <Button variant="quiet" size={32} onClick={() => ctx.open({ kind: "object-run", id: b.version_id as string })}>{t("Open the run")}</Button> : null}
                  </li>
                ))}
              </ul>
            )}
            <ContractChecks id={c.id} onRun={(runId) => ctx.open({ kind: "object-run", id: runId })} />
            <h3 className="nx-jh">{t("Versions")}</h3>
            <ul className="nx-pick" data-testid="contract-versions">
              <li className="nx-row"><span className="nx-sub">{t("Version {version}", { version: c.version })}</span><span className="nx-row-main">{t("Live, {STATUS}", { STATUS: STATUS[c.status] ?? c.status })}</span></li>
              {q.data.versions.map((v) => (
                <li key={v.version} className="nx-row"><span className="nx-sub">{t("Version {version}, {created_at}", { version: v.version, created_at: formatDate(v.created_at, "date") })}</span><span className="nx-row-main">{v.note ?? t("Kept when the contract was revised")}</span></li>
              ))}
            </ul>
            <Collab kind="contract" id={c.id} label={t("this contract")} />
          </div>
        ) : null}
      </QueryView>
    </Sheet>
  );
}
