"use client";

import { useState } from "react";
import { formatDate, labelOf } from "@/lib/format";
import { feedbackZAnomaly, updateZEntry, type ZRegistryEntry } from "@/lib/api/v2/sys";
import type { ZRegistryStatus } from "@/lib/api/z-objects";
import { useV2Session } from "@/lib/v2/hooks";
import { useRefreshV2, useZAnomalies, useZProfile, useZRegistry } from "@/lib/v2/sys-queries";
import { Fact, Facts, InspectorFrame } from "../Inspector";
import { Field, Gate } from "../forms";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton } from "../parts";
import { NewZRule } from "../screens/system/CustomObjects";
import { ResultFrame, useOutcome } from "./shared";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";

const STATUSES: { value: ZRegistryStatus; label: string }[] = [
  { value: "active", get label() { return t("Active"); } },
  { value: "dormant", get label() { return t("Dormant"); } },
  { value: "deprecated", get label() { return t("Deprecated"); } },
  { value: "under_review", get label() { return t("Under review"); } },
];

function Editor({ entry }: { entry: ZRegistryEntry }) {
  const { can } = useV2Session();
  const allowed = can("manage_rules");
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  const [owner, setOwner] = useState(entry.owner ?? "");
  const [purpose, setPurpose] = useState(entry.description ?? "");
  const [standard, setStandard] = useState(entry.standard_equivalent ?? "");
  const [status, setStatus] = useState<string>(entry.status);
  const [notes, setNotes] = useState(entry.notes ?? "");
  return (
    <form
      className="m2-form6"
      aria-label={t("Registry entry")}
      onSubmit={(e) => {
        e.preventDefault();
        if (!allowed) return;
        void run("save", async () => {
          await updateZEntry(entry.id, { owner, description: purpose, standard_equivalent: standard, status: status as ZRegistryStatus, notes });
          refresh();
          return { tone: "ok", title: t("{object_name} saved", { object_name: entry.object_name }) };
        });
      }}
    >
      <Field label={t("Owner")}>{(p) => <input {...p} disabled={!allowed} value={owner} onChange={(e) => setOwner(e.target.value)} />}</Field>
      <Field label={t("Purpose")}>{(p) => <input {...p} disabled={!allowed} value={purpose} onChange={(e) => setPurpose(e.target.value)} />}</Field>
      <Field label={t("Standard equivalent")} hint={t("The standard SAP field this one stands for, such as MARA-MATKL.")}>{(p) => <input {...p} disabled={!allowed} className="m2-mono" value={standard} onChange={(e) => setStandard(e.target.value)} />}</Field>
      <Field label={t("Status")}>
        {(p) => (
          <select {...p} disabled={!allowed} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t("Notes")}>{(p) => <textarea {...p} disabled={!allowed} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      {allowed ? (
        <div className="m2-acts">
          <button type="submit" className="m2-btn m2-strong" disabled={pending !== null}>{pending === "save" ? t("Saving…") : t("Save changes")}</button>
        </div>
      ) : (
        <Gate>{t("Editing the registry entry needs the manage rules permission.")}</Gate>
      )}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </form>
  );
}

function Body({ entry }: { entry: ZRegistryEntry }) {
  const profile = useZProfile(entry.id);
  const anomalies = useZAnomalies();
  const { can } = useV2Session();
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  const mine = (anomalies.data?.anomalies ?? []).filter((a) => a.object_name === entry.object_name);
  const decide = (id: string, verdict: "dismissed" | "confirmed") =>
    void run(`${verdict}:${id}`, async () => {
      await feedbackZAnomaly(id, verdict);
      refresh();
      return { tone: "ok", title: verdict === "dismissed" ? t("Marked as expected") : t("Marked to investigate") };
    });
  const p = profile.data;
  return (
    <>
      <Facts>
        <Fact label={t("Category")}>{labelOf(entry.category)}</Fact>
        <Fact label={t("Module")}>{labelOf(entry.module)}</Fact>
        <Fact label={t("Status")}>{labelOf(entry.status)}</Fact>
        <Fact label={t("Created")}>{entry.created_date ? formatDate(entry.created_date, "date") : <Dash />}</Fact>
        <Fact label={t("Last active")}>{entry.last_active_date ? formatDate(entry.last_active_date, "date") : <Dash />}</Fact>
        <Fact label={t("Transactions")}>{int(entry.transaction_count_total)}</Fact>
        <Fact label={t("Rules applied")}>{entry.rules_applied.length ? entry.rules_applied.join(", ") : t("None")}</Fact>
      </Facts>
      <h3>{t("Profile")}</h3>
      {profile.isLoading ? (
        <Skeleton width="100%" height={80} />
      ) : profile.isError ? (
        <p className="m2-rp m2-meta">{t("No profile is recorded for this object.")}</p>
      ) : p ? (
        <dl className="m2-facts" data-testid="z-profile">
          <Fact label={t("Data type")}>{p.data_type}</Fact>
          <Fact label={t("Distinct values")}>{int(p.cardinality)}</Fact>
          <Fact label={t("Empty")}>{`${(p.null_rate * 100).toFixed(1)}%`}</Fact>
          <Fact label={t("Users")}>{p.user_count}</Fact>
          <Fact label={t("Trend")}>{p.trend_direction ? labelOf(p.trend_direction) : <Dash />}</Fact>
        </dl>
      ) : null}
      <h3>{t("Anomalies")}</h3>
      {mine.length === 0 ? (
        <p className="m2-rp m2-meta">{t("No anomaly on this object in the latest analysis.")}</p>
      ) : (
        <ul className="m2-lk" aria-label={t("Anomalies of this object")}>
          {mine.map((a) => (
            <li key={a.id ?? a.anomaly_type}>
              <span>{`${labelOf(a.anomaly_type)}: ${a.description}`}</span>
              <span className="m2-meta">
                {a.status === "active" && a.id && can("ai_feedback") ? (
                  <span className="m2-rowacts">
                    <button type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => decide(a.id as string, "dismissed")}>{t("Expected")}</button>
                    <button type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => decide(a.id as string, "confirmed")}>{t("Investigate")}</button>
                  </span>
                ) : a.status === "dismissed" ? (
                  t("Expected")
                ) : a.status === "confirmed" ? (
                  t("To investigate")
                ) : (
                  labelOf(a.status)
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <h3>{t("Registry entry")}</h3>
      <Editor key={entry.id} entry={entry} />
      <h3>{t("Add a Z rule for this object")}</h3>
      <NewZRule objectId={entry.id} />
    </>
  );
}

/** `?open=zobject:<registry id>`: one custom Z object, its profile, anomalies, registry entry and the rule form. */
export function ZObjectInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useZRegistry();
  const entry = q.data?.entries.find((e) => e.id === id);
  return (
    <InspectorFrame title={entry ? <Mono>{entry.object_name}</Mono> : t("Custom object")} status={entry ? `${labelOf(entry.category)}, ${labelOf(entry.module)}` : t("Custom object")} onClose={onClose}>
      {q.isLoading ? <Skeleton width="100%" height={140} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("The registry could not be read.")}</ErrorFrame> : !entry ? <EmptyFrame>{t("This custom object is not in the registry. It may have been removed by a later detection.")}</EmptyFrame> : <Body entry={entry} />}
    </InspectorFrame>
  );
}
