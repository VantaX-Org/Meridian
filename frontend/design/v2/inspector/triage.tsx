"use client";

import "../approvals.css";
import { useMemo, useState } from "react";
import { errorSentence } from "@/lib/api/v2/client";
import type { Digest, SlaPolicy, TriageSeverity } from "@/lib/api/v2/triage";
import { useDigest, useSaveTriage, useSlaPolicies } from "@/lib/v2/approvals-queries";
import { useV2Session } from "@/lib/v2/hooks";
import { useWorkCan } from "@/lib/v2/work-actions";
import { InspectorFrame } from "../Inspector";
import { EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { ResultFrame, type Outcome } from "./shared";

const SEVERITIES: { key: TriageSeverity; label: string }[] = [
  { key: "critical", label: "Critical" },
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
];
const DIGESTS: { value: Digest; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "off", label: "Off" },
];
const DAY = 1440;

/** Minutes as days, with one decimal at most ("3", "0.5"). */
export const daysOf = (minutes: number): number => Math.round((minutes / DAY) * 10) / 10;

/** Whether the person may change the SLA policies: manage_triage, manage_settings or manage_rules (api/routes/triage.py). */
export function useTriageCan(): boolean {
  const session = useV2Session();
  const wc = useWorkCan();
  return wc.mode !== "viewer" && (session.can("manage_triage") || session.can("manage_settings") || session.can("manage_rules"));
}

function Body() {
  const sla = useSlaPolicies();
  const prefs = useDigest();
  const save = useSaveTriage();
  const canEdit = useTriageCan();
  const [days, setDays] = useState<Partial<Record<TriageSeverity, string>>>({});
  const [digest, setDigest] = useState<Digest | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const tenantWide = useMemo(() => (sla.data ?? []).filter((p) => p.module == null), [sla.data]);
  const byKey = useMemo(() => new Map(tenantWide.map((p) => [p.severity, p] as const)), [tenantWide]);
  const stored = prefs.data?.notifications?.digest ?? "off";
  const shownDigest = digest ?? stored;

  const parsed = (k: TriageSeverity): number | null => {
    const raw = days[k];
    if (raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 && n <= 365 ? n : Number.NaN;
  };
  const invalid = SEVERITIES.some((s) => Number.isNaN(parsed(s.key)));
  const changed: SlaPolicy[] = SEVERITIES.flatMap((s) => {
    const p = byKey.get(s.key);
    const n = parsed(s.key);
    return p && n != null && !Number.isNaN(n) && Math.round(n * DAY) !== p.resolve_minutes ? [{ ...p, resolve_minutes: Math.round(n * DAY) }] : [];
  });
  const digestChanged = digest !== null && digest !== stored;
  const dirty = changed.length > 0 || digestChanged;

  if (sla.isLoading || prefs.isLoading) return <Skeleton width="100%" height={200} />;
  if (sla.isError) return <ErrorFrame onRetry={() => void sla.refetch()}>The SLA policies could not be read.</ErrorFrame>;
  if (tenantWide.length === 0) return <EmptyFrame>No SLA policy is set. Records use the built-in defaults.</EmptyFrame>;

  const onSave = () => {
    setOutcome(null);
    save.mutate(
      { policies: changed, digest: digestChanged ? digest : null },
      {
        onSuccess: () => {
          setDays({});
          setDigest(null);
          setOutcome({ tone: "ok", title: "Saved", detail: "New SLA days apply to records that start their clock from now on." });
        },
        onError: (e) => setOutcome({ tone: "fail", title: "It did not go through", detail: errorSentence(e, "The settings could not be saved.") }),
      },
    );
  };

  return (
    <>
      <h3>SLA days to resolve</h3>
      <div className="m2-form" role="group" aria-label="SLA days per severity">
        {SEVERITIES.map((s) => {
          const p = byKey.get(s.key);
          const id = `triage-${s.key}`;
          const shown = days[s.key] ?? (p ? String(daysOf(p.resolve_minutes)) : "");
          return (
            <FormRow key={s.key} label={s.label} htmlFor={canEdit ? id : null}>
              {canEdit ? (
                <>
                  <input id={id} className="m2-num" inputMode="decimal" value={shown} onChange={(e) => setDays((d) => ({ ...d, [s.key]: e.target.value }))} aria-invalid={Number.isNaN(parsed(s.key)) ? "true" : undefined} />
                  <span className="m2-unit">days</span>
                </>
              ) : (
                <span>{p ? `${daysOf(p.resolve_minutes)} ${daysOf(p.resolve_minutes) === 1 ? "day" : "days"}` : "—"}</span>
              )}
            </FormRow>
          );
        })}
        {p0(tenantWide)?.is_default ? <p className="m2-hint">Severities without a policy of their own use the built-in default.</p> : null}
      </div>

      <h3>Escalation</h3>
      <div className="m2-form">
        <span className="m2-fl">Escalate after</span>
        <span className="m2-fv">The SLA days above</span>
        <p className="m2-hint">A record that passes its SLA is escalated to the team lead, else the fallback owner. There is no separate escalation delay to set.</p>
      </div>

      <h3>Digest</h3>
      <div className="m2-form">
        <label htmlFor="triage-digest">Your digest</label>
        <span className="m2-fv">
          {prefs.isError ? (
            <span className="m2-meta">Not read</span>
          ) : (
            <select id="triage-digest" className="m2-sel" value={shownDigest} onChange={(e) => setDigest(e.target.value as Digest)}>
              {DIGESTS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
        </span>
        <p className="m2-hint">The summary of your open work and approvals, sent to you.</p>
      </div>

      <div className="m2-acts" style={{ marginTop: 16 }}>
        <button type="button" className="m2-btn m2-strong" disabled={!dirty || invalid || save.isPending || (!canEdit && changed.length > 0)} onClick={onSave}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {dirty ? (
          <button
            type="button"
            className="m2-btn"
            onClick={() => {
              setDays({});
              setDigest(null);
            }}
          >
            Discard
          </button>
        ) : null}
      </div>
      {invalid ? <p className="m2-prov">Days must be a number between 0 and 365.</p> : null}
      {!canEdit ? <p className="m2-prov">Changing SLA days needs the manage triage permission, which your role does not hold. You can still choose your own digest.</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </>
  );
}

const p0 = (rows: readonly SlaPolicy[]): SlaPolicy | undefined => rows.find((r) => r.is_default);

function FormRow({ label, htmlFor, children }: { label: string; htmlFor: string | null; children: React.ReactNode }) {
  return (
    <>
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="m2-fl">{label}</span>}
      <span className="m2-fv">{children}</span>
    </>
  );
}

/** `?open=triage`: the tenant's SLA days per severity, what escalation does, and the digest. Read-only without the permission. */
export function TriagePanel({ onClose }: { onClose: () => void }) {
  return (
    <InspectorFrame title="Triage and SLA" status="Tenant settings" onClose={onClose}>
      <Body />
    </InspectorFrame>
  );
}
