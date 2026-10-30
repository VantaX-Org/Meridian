"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { activateContract, createContract, reviseContract, updateContract, type Contract } from "@/lib/api/v2/roles";
import { formatDate } from "@/lib/format";
import { failureText } from "@/lib/v2/errors";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { notFound, refreshRoles, useContract, useContracts } from "@/lib/v2/roles-queries";
import { Actions, Fact, Facts, InspectorFrame } from "../Inspector";
import { VerdictMark } from "../marks";
import { Dash, Skeleton, V2Link } from "../parts";
import { CollabSections } from "./collab";
import "../roles.css";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";

/**
 * Data contracts for owners and approvers (step 6c, on the existing /contracts): `?open=contracts` lists them and
 * creates one; `?open=contract:<id>` is one contract with its compliance, breaches and versions, and the verbs its
 * status allows: edit and submit (manage_rules), approve (approve, never the author), revise into a new version.
 */

const STATUS: Record<string, string> = { get draft() { return t("Draft"); }, get pending_approval() { return t("Waiting for approval"); }, get active() { return t("Active"); }, get expired() { return t("Expired"); } };

function Compliance({ c }: { c: Contract }) {
  if (c.latest_compliant === null) return <Dash why={t("Not checked yet")} />;
  return (
    <span className="m2-v">
      <VerdictMark verdict={c.latest_compliant ? "go" : "no-go"} />
      {c.latest_compliant ? t("Met") : t("Breached")}
    </span>
  );
}

export function ContractsPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const { hrefFor, openItem } = useOpenItem();
  const q = useContracts();
  const [name, setName] = useState("");
  const [producer, setProducer] = useState("");
  const [consumer, setConsumer] = useState("");
  const [minScore, setMinScore] = useState("85");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canCreate = session.can("manage_rules") && !session.shared && !session.viewAs;
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await createContract({ name, producer, consumer, quality_contract: { module: producer, min_score: Number(minScore) } });
      setName("");
      await refreshRoles(qc, "contracts");
      openItem({ kind: "contract", id: r.id });
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <InspectorFrame title={t("Data contracts")} status={t("What each consumer is promised")} onClose={onClose}>
      {q.isError ? (
        <p className="m2-meta">{notFound(q.error) ? <Dash why={t("Contracts are not available on this server")} /> : t("The contracts could not be read.")}</p>
      ) : !q.data ? (
        <Skeleton width="80%" height={12} />
      ) : q.data.contracts.length === 0 ? (
        <p className="m2-meta">{t("No contract yet.")}</p>
      ) : (
        <ul className="m2-rows" data-testid="contracts-list">
          {q.data.contracts.map((c) => (
            <li key={c.id}>
              <V2Link href={hrefFor({ kind: "contract", id: c.id })}>{c.name}</V2Link>
              <span className="m2-meta">{t("{STATUS}, version {version}, {producer} to {consumer}", { STATUS: STATUS[c.status] ?? c.status, version: c.version, producer: moduleText(c.producer), consumer: c.consumer })}</span>
              <Compliance c={c} />
            </li>
          ))}
        </ul>
      )}
      <h3>{t("New contract")}</h3>
      {canCreate ? (
        <div className="m2-compose" data-testid="contract-form">
          <label className="m2-fld">
            <span className="m2-lbl">{t("Name")}</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </label>
          <label className="m2-fld">
            <span className="m2-lbl">{t("Producer (object)")}</span>
            <input type="text" value={producer} onChange={(e) => setProducer(e.target.value)} placeholder="material_master" />
          </label>
          <label className="m2-fld">
            <span className="m2-lbl">{t("Consumer")}</span>
            <input type="text" value={consumer} onChange={(e) => setConsumer(e.target.value)} placeholder={t("S/4HANA migration")} />
          </label>
          <label className="m2-fld">
            <span className="m2-lbl">{t("Minimum score")}</span>
            <input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(e.target.value)} />
          </label>
          <button type="button" className="m2-btn m2-sm" disabled={busy || !name.trim() || !producer.trim() || !consumer.trim()} onClick={() => void create()}>
            {t("Create a draft")}
          </button>
          {error ? (
            <span className="m2-err" role="alert">
              {error}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="m2-meta">{t("Creating a contract needs the manage rules permission.")}</p>
      )}
    </InspectorFrame>
  );
}

export function ContractInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const { hrefFor } = useOpenItem();
  const q = useContract(id);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [desc, setDesc] = useState<string | null>(null);
  const live = !session.shared && !session.viewAs;
  const act = async (fn: () => Promise<unknown>, said: string) => {
    setError(null);
    setNote(null);
    try {
      await fn();
      setNote(said);
      await refreshRoles(qc, "contracts");
    } catch (e) {
      setError(failureText(e));
    }
  };
  const c = q.data?.contract;
  const status = c ? t("{STATUS}, version {version}", { STATUS: STATUS[c.status] ?? c.status, version: c.version }) : t("Data contract");
  return (
    <InspectorFrame title={c?.name ?? t("Data contract")} status={status} onClose={onClose}>
      {q.isError ? (
        <p className="m2-meta">{notFound(q.error) ? t("This contract does not exist.") : t("The contract could not be read.")}</p>
      ) : !q.data || !c ? (
        <Skeleton width="80%" height={12} />
      ) : (
        <>
          <Facts>
            <Fact label={t("Producer")}>
              {moduleText(c.producer)}
            </Fact>
            <Fact label={t("Consumer")}>{c.consumer}</Fact>
            <Fact label={t("Promise")}>{c.quality_contract && typeof c.quality_contract.min_score === "number" ? t("Score at {min_score} or more", { min_score: c.quality_contract.min_score }) : <Dash why={t("No quality promise")} />}</Fact>
            <Fact label={t("Compliance")}>
              <Compliance c={c} />
            </Fact>
            <Fact label={t("Checked")}>{c.last_checked ? t("{last_checked}, {checks} checks in all", { last_checked: formatDate(c.last_checked, "date"), checks: q.data.checks }) : <Dash why={t("Not checked yet")} />}</Fact>
          </Facts>
          {live ? (
            <Actions>
              {(c.status === "draft" || c.status === "pending_approval") && session.can("manage_rules") ? (
                <>
                  <label className="m2-fld m2-wide">
                    <span className="m2-lbl">{t("Description")}</span>
                    <input type="text" value={desc ?? c.description ?? ""} onChange={(e) => setDesc(e.target.value)} />
                  </label>
                  <button type="button" className="m2-btn" disabled={desc === null} onClick={() => void act(() => updateContract(c.id, { description: desc ?? "" }), "Saved.")}>
                    {t("Save")}
                  </button>
                </>
              ) : null}
              {c.status === "draft" && session.can("manage_rules") ? (
                <button type="button" className="m2-btn" onClick={() => void act(() => updateContract(c.id, { status: "pending_approval" }), t("Sent for approval."))}>
                  {t("Submit for approval")}
                </button>
              ) : null}
              {c.status === "pending_approval" && session.can("approve") ? (
                <button type="button" className="m2-btn m2-strong" disabled={c.created_by === session.id} title={c.created_by === session.id ? t("Four eyes: you wrote it") : undefined} onClick={() => void act(() => activateContract(c.id), t("Approved: the contract is active."))}>
                  {t("Approve")}
                </button>
              ) : null}
              {c.status === "active" && session.can("manage_rules") ? (
                <button type="button" className="m2-btn" onClick={() => void act(() => reviseContract(c.id), t("Version {count} opened as a draft.", { count: c.version + 1 }))}>
                  {t("Revise as a new version")}
                </button>
              ) : null}
              {error ? (
                <span className="m2-err" role="alert">
                  {error}
                </span>
              ) : null}
              {note ? <span role="status">{note}</span> : null}
            </Actions>
          ) : null}
          <h3>{t("Breaches")}</h3>
          {q.data.breaches.length === 0 ? (
            <p className="m2-meta">{t("No check has failed.")}</p>
          ) : (
            <ul className="m2-rows" data-testid="contract-breaches">
              {q.data.breaches.map((b, i) => (
                <li key={`${b.recorded_at}-${i}`}>
                  <span className="m2-meta">{formatDate(b.recorded_at, "date")}</span>
                  <span>{Array.isArray(b.violations) ? t("{violationsCount} {violationsCount, plural, one {promise} other {promises}} not met", { violationsCount: b.violations.length }) : t("Not met")}</span>
                  {b.version_id ? <V2Link href={`/run/${encodeURIComponent(b.version_id)}`}>{t("Open the run")}</V2Link> : null}
                </li>
              ))}
            </ul>
          )}
          <h3>{t("Versions")}</h3>
          <ul className="m2-rows" data-testid="contract-versions">
            <li>
              <span className="m2-meta">{t("Version {version}", { version: c.version })}</span>
              <span>{t("Live, {STATUS}", { STATUS: STATUS[c.status] ?? c.status })}</span>
            </li>
            {q.data.versions.map((v) => (
              <li key={v.version}>
                <span className="m2-meta">{t("Version {version}, {created_at}", { version: v.version, created_at: formatDate(v.created_at, "date") })}</span>
                <span>{v.note ?? t("Kept when the contract was revised")}</span>
              </li>
            ))}
          </ul>
          <CollabSections kind="contract" id={c.id} label={t("this contract")} />
          <p className="m2-meta">
            <V2Link href={hrefFor({ kind: "contracts", id: "" })}>{t("All contracts")}</V2Link>
          </p>
        </>
      )}
    </InspectorFrame>
  );
}
