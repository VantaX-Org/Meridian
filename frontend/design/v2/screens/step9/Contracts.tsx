"use client";

import "../../step9.css";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createObjectContract, setEnforcement, type ContractThresholds, type ObjectContract } from "@/lib/api/v2/step9";
import { DIMENSIONS } from "@/lib/api/v2/types";
import { failureText } from "@/lib/v2/errors";
import { t, tn } from "@/lib/v2/i18n";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { breachWords, thresholdsFromDraft } from "@/lib/v2/step9";
import { refreshStep9, useObjectContracts } from "@/lib/v2/step9-queries";
import { VerdictMark } from "../../marks";
import { ErrorFrame, Skeleton, V2Link } from "../../parts";

interface Draft {
  min_score: string;
  max_critical: string;
  dims: Record<string, string>;
}

const draftOf = (t: ContractThresholds): Draft => ({
  min_score: t.min_score == null ? "" : String(t.min_score),
  max_critical: t.max_critical_breaches == null ? "" : String(t.max_critical_breaches),
  dims: Object.fromEntries(DIMENSIONS.map((d) => [d.key, t.dimensions?.[d.key] == null ? "" : String(t.dimensions[d.key])])),
});

/** The thresholds per object: the score, the critical rules over tolerance, and a floor per dimension. */
function ThresholdFields({ draft, set, disabled, idPrefix }: { draft: Draft; set: (d: Draft) => void; disabled: boolean; idPrefix: string }) {
  return (
    <div className="m2-ct-grid">
      <label htmlFor={`${idPrefix}-min`}>
        {t("Minimum score")}
        <input id={`${idPrefix}-min`} type="number" min={0} max={100} value={draft.min_score} disabled={disabled} onChange={(e) => set({ ...draft, min_score: e.target.value })} />
      </label>
      <label htmlFor={`${idPrefix}-crit`}>
        {t("Failing critical rules, at most")}
        <input id={`${idPrefix}-crit`} type="number" min={0} value={draft.max_critical} disabled={disabled} onChange={(e) => set({ ...draft, max_critical: e.target.value })} />
      </label>
      {DIMENSIONS.map((d) => (
        <label key={d.key} htmlFor={`${idPrefix}-${d.key}`}>
          {t("{dimension}, at least", { dimension: d.label })}
          <input id={`${idPrefix}-${d.key}`} type="number" min={0} max={100} value={draft.dims[d.key] ?? ""} disabled={disabled} onChange={(e) => set({ ...draft, dims: { ...draft.dims, [d.key]: e.target.value } })} />
        </label>
      ))}
    </div>
  );
}

function OneContract({ c, canEdit }: { c: ObjectContract; canEdit: boolean }) {
  const qc = useQueryClient();
  const { hrefFor } = useOpenItem();
  const [draft, setDraft] = useState<Draft>(draftOf(c.thresholds));
  const [enforce, setEnforce] = useState(c.enforce);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const parsed = thresholdsFromDraft(draft);
  const dirty = enforce !== c.enforce || JSON.stringify(draft) !== JSON.stringify(draftOf(c.thresholds));
  const save = async () => {
    if (!parsed) return;
    setBusy(true);
    setSaid(null);
    try {
      await setEnforcement(c.contract_id, { enforce, thresholds: parsed });
      await refreshStep9(qc, "contracts");
      setSaid({ ok: true, text: enforce ? t("Saved. While this contract is breached, no run of the object can be pinned as the baseline.") : t("Saved. Breaches are shown but nothing is held back.") });
    } catch (e) {
      setSaid({ ok: false, text: failureText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="m2-ct-one" data-testid="object-contract">
      <h3>
        <V2Link href={hrefFor({ kind: "contract", id: c.contract_id })}>{c.name}</V2Link>
        <span className="m2-meta">{t("for {consumer}", { consumer: c.consumer })}</span>
        <span className="m2-v">
          <VerdictMark verdict={c.breaches.length ? "no-go" : "go"} />
          {c.breaches.length ? t("{n} {n, plural, one {threshold} other {thresholds}} breached", { n: c.breaches.length }) : t("Met")}
        </span>
        <span className="m2-meta">{c.enforce ? t("Enforced") : t("Reported only")}</span>
      </h3>
      {c.breaches.length ? (
        <ul className="m2-cert-sig" aria-label={t("Breaches of {name}", { name: c.name })}>
          {c.breaches.map((b) => (
            <li key={b.metric}>{breachWords(b)}</li>
          ))}
        </ul>
      ) : null}
      <ThresholdFields draft={draft} set={setDraft} disabled={!canEdit} idPrefix={`ct-${c.contract_id}`} />
      <label className="m2-check" style={{ marginTop: "var(--m2-s2)" }}>
        <input type="checkbox" checked={enforce} disabled={!canEdit} onChange={(e) => setEnforce(e.target.checked)} />
        {t("Enforce: while breached, no run of this object can be pinned as the baseline")}
      </label>
      {!parsed ? (
        <p className="m2-s9-err" role="alert">
          {t("Each threshold is a number from 0 to 100, or empty for none.")}
        </p>
      ) : null}
      {canEdit ? (
        <div className="m2-cert-acts">
          <button type="button" className="m2-btn m2-sm m2-strong" disabled={!dirty || !parsed || busy} onClick={() => void save()}>
            {busy ? t("Saving…") : t("Save thresholds")}
          </button>
        </div>
      ) : null}
      {said ? (
        <p className={said.ok ? "m2-prov" : "m2-s9-err"} role={said.ok ? "status" : "alert"}>
          {said.text}
        </p>
      ) : null}
    </div>
  );
}

function NewContract({ module, label }: { module: string; label: string }) {
  const qc = useQueryClient();
  const { hrefFor } = useOpenItem();
  const [name, setName] = useState("");
  const [consumer, setConsumer] = useState("");
  const [draft, setDraft] = useState<Draft>(draftOf({ min_score: 85, max_critical_breaches: 0 }));
  const [enforce, setEnforce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parsed = thresholdsFromDraft(draft);
  const create = async () => {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createObjectContract({ name: name.trim(), module, consumer: consumer.trim(), enforce, thresholds: parsed });
      await refreshStep9(qc, "contracts");
      setMade(r.id);
      setName("");
      setConsumer("");
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="m2-ct-one" data-testid="new-contract">
      <h3>{t("New contract for {label}", { label })}</h3>
      <div className="m2-ct-grid">
        <label htmlFor="nc-name">
          {t("Name")}
          <input id="nc-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </label>
        <label htmlFor="nc-consumer">
          {t("Consumer")}
          <input id="nc-consumer" value={consumer} maxLength={200} placeholder={t("S/4HANA migration")} onChange={(e) => setConsumer(e.target.value)} />
        </label>
      </div>
      <ThresholdFields draft={draft} set={setDraft} disabled={false} idPrefix="nc" />
      <label className="m2-check" style={{ marginTop: "var(--m2-s2)" }}>
        <input type="checkbox" checked={enforce} onChange={(e) => setEnforce(e.target.checked)} />
        {t("Enforce once it is active")}
      </label>
      <div className="m2-cert-acts">
        <button type="button" className="m2-btn m2-sm" disabled={!name.trim() || !consumer.trim() || !parsed || busy} onClick={() => void create()}>
          {busy ? t("Creating…") : t("Create a draft contract")}
        </button>
      </div>
      {made ? (
        <p className="m2-prov" role="status">
          {tn("Created as a draft. It counts once an approver activates it: {link}.", { link: <V2Link href={hrefFor({ kind: "contract", id: made })}>{t("open the contract")}</V2Link> })}
        </p>
      ) : null}
      {error ? (
        <p className="m2-s9-err" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The Object canvas's data contracts: what the active contracts promise for this object, their breaches, and the editor. */
export function ObjectContractsBlock({ module, label, run }: { module: string; label: string; run: string | null }) {
  const session = useV2Session();
  const q = useObjectContracts(module, run);
  const canEdit = session.can("manage_rules") && !session.shared && !session.viewAs;
  const n = q.data?.breached ?? 0;
  const enforced = q.data?.enforced_breached ?? 0;
  return (
    <details className="m2-ct" data-testid="object-contracts">
      <summary>
        {q.data ? (enforced ? t("Data contracts: {active} active, {n} breached, {enforced} enforced", { active: q.data.contracts.length, n, enforced }) : t("Data contracts: {active} active, {n} breached", { active: q.data.contracts.length, n })) : t("Data contracts")}
      </summary>
      {q.isPending ? (
        <Skeleton width="100%" height={60} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The data contracts of this object could not be read.")}</ErrorFrame>
      ) : (
        <>
          {q.data.contracts.length === 0 ? <p className="m2-prov">{t("No active data contract covers {label}. A contract promises a consumer a minimum score and dimension floors; enforced, it stops a breached run from becoming the baseline.", { label })}</p> : null}
          {q.data.contracts.map((c) => (
            <OneContract key={`${c.contract_id}:${JSON.stringify(c.thresholds)}:${c.enforce}`} c={c} canEdit={canEdit} />
          ))}
          {canEdit ? <NewContract module={module} label={label} /> : <p className="m2-prov">{t("Changing thresholds and enforcement needs the manage rules permission.")}</p>}
        </>
      )}
    </details>
  );
}
