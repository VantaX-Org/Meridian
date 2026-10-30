"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AlertChannel, AlertChannelCreate, AlertDigest, AlertChannelKind, AlertReportPack } from "@/lib/api/notifications";
import type { FieldMapping } from "@/lib/api/field-mappings";
import * as api from "@/lib/api/v2/admin";
import { formatDate } from "@/lib/format";
import { auditSentence } from "@/lib/v2/audit-sentence";
import { useOpenItem } from "@/lib/v2/hooks";
import { refreshAdmin, useAuditEntry, useChannels, useMappings, useUsers } from "@/lib/v2/admin-queries";
import { Actions, Fact, Facts, InspectorFrame } from "../Inspector";
import { EmptyFrame, ErrorFrame, Mono, Skeleton } from "../parts";
import { Confirm, copyText, useCan, useDone } from "../admin/kit";
import { shownValue } from "../admin/data";
import { DIGEST_LABEL, KIND_LABEL, PACK_LABEL } from "../admin/notify";
import { ResultFrame, useOutcome } from "./shared";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";

/* ── Audit entry ── */

const pretty = (v: unknown): string => (v === null || v === undefined ? "" : JSON.stringify(v, null, 2));

export function AuditInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useAuditEntry(id);
  const users = useUsers({}, useCan()("manage_users"));
  const e = q.data;
  const actor = e ? (users.data?.users.find((u) => u.id === e.actor_user_id)?.name ?? e.actor_email ?? t("The system")) : "";
  return (
    <InspectorFrame title={e ? auditSentence(e) : t("Audit entry")} status={e ? formatDate(e.created_at, "datetime") : undefined} onClose={onClose}>
      {e ? (
        <>
          <Facts>
            <Fact label={t("Who")}>{actor}</Fact>
            <Fact label={t("Action")}>
              <Mono>{e.action}</Mono>
            </Fact>
            <Fact label={t("Result")}>{e.status_code >= 400 ? t("Refused, {status_code}", { status_code: e.status_code }) : t("Done, {status_code}", { status_code: e.status_code })}</Fact>
            <Fact label={t("Request")}>
              <Mono>{`${e.method} ${e.path}`}</Mono>
            </Fact>
            {e.entity_type ? (
              <Fact label={t("Object")}>
                {e.entity_type}
                {e.entity_id ? <> <Mono>{e.entity_id}</Mono></> : null}
              </Fact>
            ) : null}
            <Fact label={t("From")}>{[e.ip, e.user_agent].filter(Boolean).join(", ") || "—"}</Fact>
          </Facts>
          {e.before_json ? (
            <>
              <h3>{t("Before")}</h3>
              <pre className="m2-code" aria-label={t("Before")}>{pretty(e.before_json)}</pre>
            </>
          ) : null}
          {e.after_json ? (
            <>
              <h3>{t("After")}</h3>
              <pre className="m2-code" aria-label={t("After")}>{pretty(e.after_json)}</pre>
            </>
          ) : null}
          <Actions>
            <button type="button" className="m2-btn" onClick={() => void copyText(e.id)}>
              {t("Copy the entry id")}
            </button>
          </Actions>
          <p className="m2-prov">{t("Audit entries are permanent. They cannot be edited or removed from here.")}</p>
        </>
      ) : q.isLoading ? (
        <Skeleton width="100%" height={120} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The entry could not be read.")}</ErrorFrame>
      ) : (
        <EmptyFrame>{t("This entry is not among the most recent ones. Filter the log by date to find it.")}</EmptyFrame>
      )}
    </InspectorFrame>
  );
}

/* ── Alert channel ── */

const KINDS: AlertChannelKind[] = ["email", "slack", "teams", "webhook"];
const DIGESTS: AlertDigest[] = ["daily", "weekly", "off"];

function NewChannel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { openItem } = useOpenItem();
  const [kind, setKind] = useState<AlertChannelKind>("email");
  const [target, setTarget] = useState("");
  const [secret, setSecret] = useState("");
  const [digest, setDigest] = useState<AlertDigest>("daily");
  const [pack, setPack] = useState<AlertReportPack>("off");
  const [immediate, setImmediate] = useState(true);
  const { outcome, pending, run } = useOutcome();
  const [made, setMade] = useState<string | null>(null);
  const targetOk = kind === "email" ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target.trim()) : /^https:\/\//i.test(target.trim());
  const secretOk = kind !== "webhook" || secret === "" || (secret.length >= 16 && secret.length <= 256);
  const reachable = digest !== "off" || immediate;
  return (
    <InspectorFrame title={t("Add a channel")} status={t("New channel")} onClose={onClose}>
      <div className="m2-aform">
        <label>
          {t("Type")}
          <select value={kind} onChange={(e) => setKind(e.target.value as AlertChannelKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {kind === "email" ? t("Address") : t("URL")}
          <input type={kind === "email" ? "email" : "url"} value={target} onChange={(e) => setTarget(e.target.value)} placeholder={kind === "email" ? t("dq-team@company.com") : t("https://")} />
        </label>
        {kind === "webhook" ? (
          <label>
            {t("Signing secret (16 to 256 characters)")}
            <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" />
          </label>
        ) : null}
        <label>
          {t("Digest")}
          <select value={digest} onChange={(e) => setDigest(e.target.value as AlertDigest)}>
            {DIGESTS.map((d) => (
              <option key={d} value={d}>
                {DIGEST_LABEL[d]}
              </option>
            ))}
          </select>
        </label>
        {kind === "email" ? (
          <label>
            {t("Board pack")}
            <select value={pack} onChange={(e) => setPack(e.target.value as AlertReportPack)}>
              {(Object.keys(PACK_LABEL) as AlertReportPack[]).map((p) => (
                <option key={p} value={p}>
                  {PACK_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="m2-sw" style={{ display: "flex", gap: 8 }}>
          <input type="checkbox" checked={immediate} onChange={(e) => setImmediate(e.target.checked)} />
          {t("Send new critical findings at once")}
        </label>
      </div>
      {!reachable ? <p className="m2-prov" role="alert">{t("Choose a digest or immediate delivery, or the channel never fires.")}</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Actions>
        <button
          type="button"
          className="m2-btn m2-next"
          disabled={!targetOk || !secretOk || !reachable || pending !== null || made !== null}
          onClick={() =>
            void run("add", async () => {
              const body: AlertChannelCreate = { kind, target: target.trim(), digest, immediate_critical: immediate, ...(kind === "email" && pack !== "off" ? { report_pack: pack } : {}), ...(kind === "webhook" && secret ? { secret } : {}) };
              const c = await api.createChannel(body);
              await refreshAdmin(qc, "channels");
              setMade(c.id);
              return { tone: "ok", title: t("Channel added") };
            })
          }
        >
          {pending === "add" ? t("Adding…") : t("Add the channel")}
        </button>
        {made ? (
          <button type="button" className="m2-btn" onClick={() => openItem({ kind: "channel", id: made })}>
            {t("Open the channel")}
          </button>
        ) : null}
      </Actions>
    </InspectorFrame>
  );
}

function ChannelBody({ c }: { c: AlertChannel }) {
  const qc = useQueryClient();
  const { close } = useOpenItem();
  const done = useDone();
  const edit = useCan()("manage_settings");
  const [digest, setDigest] = useState(c.digest);
  const [pack, setPack] = useState<AlertReportPack>(c.report_pack ?? "off");
  const [immediate, setImmediate] = useState(c.immediate_critical);
  const [enabled, setEnabled] = useState(c.enabled);
  const [ask, setAsk] = useState(false);
  const { outcome, pending, run } = useOutcome();
  const dirty = digest !== c.digest || pack !== (c.report_pack ?? "off") || immediate !== c.immediate_critical || enabled !== c.enabled;
  return (
    <>
      <Facts>
        <Fact label={t("Type")}>{KIND_LABEL[c.kind]}</Fact>
        <Fact label={t("Sends to")}>{c.target}</Fact>
        <Fact label={t("Added")}>{formatDate(c.created_at)}</Fact>
        {c.kind === "webhook" ? <Fact label={t("Signing secret")}>{c.has_secret ? t("Stored") : t("None")}</Fact> : null}
      </Facts>
      <h3>{t("Settings")}</h3>
      <div className="m2-aform">
        <label>
          {t("Digest")}
          <select value={digest} disabled={!edit} onChange={(e) => setDigest(e.target.value as AlertDigest)}>
            {DIGESTS.map((d) => (
              <option key={d} value={d}>
                {DIGEST_LABEL[d]}
              </option>
            ))}
          </select>
        </label>
        {c.kind === "email" ? (
          <label>
            {t("Board pack")}
            <select value={pack} disabled={!edit} onChange={(e) => setPack(e.target.value as AlertReportPack)}>
              {(Object.keys(PACK_LABEL) as AlertReportPack[]).map((p) => (
                <option key={p} value={p}>
                  {PACK_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="m2-sw" style={{ display: "flex", gap: 8 }}>
          <input type="checkbox" checked={immediate} disabled={!edit} onChange={(e) => setImmediate(e.target.checked)} />
          {t("Send new critical findings at once")}
        </label>
        <label className="m2-sw" style={{ display: "flex", gap: 8 }}>
          <input type="checkbox" checked={enabled} disabled={!edit} onChange={(e) => setEnabled(e.target.checked)} />
          {t("Channel is on")}
        </label>
      </div>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Actions>
        <button
          type="button"
          className="m2-btn m2-strong"
          disabled={!edit || !dirty || pending !== null}
          onClick={() =>
            void run("save", async () => {
              const prev = { digest: c.digest, immediate_critical: c.immediate_critical, enabled: c.enabled, ...(c.kind === "email" ? { report_pack: c.report_pack ?? "off" } : {}) };
              await api.updateChannel(c.id, { digest, immediate_critical: immediate, enabled, ...(c.kind === "email" ? { report_pack: pack } : {}) });
              await refreshAdmin(qc, "channels");
              done(t("Channel saved"), async () => {
                await api.updateChannel(c.id, prev);
                await refreshAdmin(qc, "channels");
              });
              return { tone: "ok", title: t("Channel saved") };
            })
          }
        >
          {pending === "save" ? t("Saving…") : t("Save")}
        </button>
        <button
          type="button"
          className="m2-btn"
          disabled={!edit || pending !== null}
          onClick={() =>
            void run("test", async () => {
              const r = await api.testChannel(c.id);
              return r.delivered ? { tone: "ok", title: t("Test message delivered") } : { tone: "fail", title: t("The channel did not accept the test message"), detail: t("Check the address, and that the channel is on.") };
            })
          }
        >
          {pending === "test" ? t("Sending…") : t("Send a test message")}
        </button>
        <button type="button" className="m2-btn m2-crit" disabled={!edit || pending !== null} onClick={() => setAsk(true)}>
          {t("Remove the channel")}
        </button>
      </Actions>
      {ask ? (
        <Confirm
          title={t("Remove the {KIND_LABEL} channel", { KIND_LABEL: KIND_LABEL[c.kind] })}
          body={t("{target} stops receiving alerts and digests at once.", { target: c.target })}
          confirm={t("Remove the channel")}
          cancel={t("Keep the channel")}
          danger
          pending={pending === "remove"}
          onCancel={() => setAsk(false)}
          onConfirm={() =>
            void run("remove", async () => {
              await api.deleteChannel(c.id);
              await refreshAdmin(qc, "channels");
              setAsk(false);
              close();
              return { tone: "ok", title: t("Channel removed") };
            })
          }
        />
      ) : null}
    </>
  );
}

export function ChannelInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useChannels(id !== "new");
  if (id === "new") return <NewChannel onClose={onClose} />;
  const c = q.data?.find((x) => x.id === id);
  return (
    <InspectorFrame title={c ? `${KIND_LABEL[c.kind]}: ${c.target}` : t("Channel")} status={c ? (c.enabled ? t("On") : t("Off")) : undefined} onClose={onClose}>
      {c ? <ChannelBody key={c.id} c={c} /> : q.isLoading ? <Skeleton width="100%" height={120} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("The channel could not be read.")}</ErrorFrame> : <EmptyFrame>{t("This channel does not exist.")}</EmptyFrame>}
    </InspectorFrame>
  );
}

/* ── Field mapping ── */

function MappingBody({ m, selfService }: { m: FieldMapping; selfService: boolean }) {
  const qc = useQueryClient();
  const done = useDone();
  const edit = useCan()("manage_field_mappings") && selfService;
  const [col, setCol] = useState(shownValue(m, "customer_field"));
  const [label, setLabel] = useState(shownValue(m, "customer_label"));
  const [notes, setNotes] = useState(m.notes ?? "");
  const { outcome, pending, run } = useOutcome(`mapping:${m.id}`);
  const dirty = col.trim() !== shownValue(m, "customer_field") || label.trim() !== shownValue(m, "customer_label") || notes.trim() !== (m.notes ?? "");
  const write = (body: Parameters<typeof api.updateFieldMapping>[1], title: string) =>
    void run("save", async () => {
      const prev = { customer_field: shownValue(m, "customer_field"), customer_label: shownValue(m, "customer_label"), notes: m.notes ?? "", is_mapped: m.is_mapped };
      await api.updateFieldMapping(m.id, body);
      await refreshAdmin(qc, "mappings");
      done(`${title}: ${m.standard_field}`, async () => {
        await api.updateFieldMapping(m.id, prev);
        await refreshAdmin(qc, "mappings");
      });
      return { tone: "ok", title };
    });
  return (
    <>
      <Facts>
        <Fact label={t("Object")}>{moduleText(m.module)}</Fact>
        <Fact label={t("Standard field")}>
          <Mono>{m.standard_field}</Mono>
        </Fact>
        <Fact label={t("Meaning")}>{m.standard_label ?? "—"}</Fact>
        <Fact label={t("Type")}>
          <Mono>{m.data_type}</Mono>
        </Fact>
        <Fact label={t("State")}>{m.is_mapped ? t("Mapped") : t("Not mapped: the standard column is read")}</Fact>
        <Fact label={t("Changed")}>{formatDate(m.updated_at, "datetime")}</Fact>
      </Facts>
      <h3>{t("Your column")}</h3>
      <div className="m2-aform">
        <label>
          {t("Column header in your file")}
          <input value={col} disabled={!edit} onChange={(e) => setCol(e.target.value)} placeholder={t("Default {standard_field}", { standard_field: m.standard_field })} />
        </label>
        <label>
          {t("Label")}
          <input value={label} disabled={!edit} onChange={(e) => setLabel(e.target.value)} placeholder={m.standard_label ?? ""} />
        </label>
        <label>
          {t("Notes")}
          <input value={notes} disabled={!edit} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Actions>
        <button type="button" className="m2-btn m2-strong" disabled={!edit || !dirty || pending !== null} onClick={() => write({ customer_field: col.trim(), customer_label: label.trim(), notes: notes.trim(), is_mapped: col.trim() !== "" }, t("Mapping saved"))}>
          {pending === "save" ? t("Saving…") : t("Save the mapping")}
        </button>
        <button type="button" className="m2-btn" disabled={!edit || (!m.is_mapped && !m.customer_field && !m.notes) || pending !== null} onClick={() => (setCol(""), setLabel(""), setNotes(""), write({ customer_field: "", customer_label: "", notes: "", is_mapped: false }, t("Mapping cleared")))}>
          {t("Clear the mapping")}
        </button>
      </Actions>
      {!edit ? <p className="m2-prov">{t("Editing mappings needs the manage field mappings permission and a licence with self-service mapping.")}</p> : null}
    </>
  );
}

export function MappingInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useMappings({});
  const m = q.data?.mappings.find((x) => x.id === id);
  return (
    <InspectorFrame title={m ? m.standard_field : t("Field mapping")} status={m ? moduleText(m.module) : undefined} onClose={onClose}>
      {m ? <MappingBody key={`${m.id}|${m.updated_at}`} m={m} selfService={q.data?.self_service_enabled ?? true} /> : q.isLoading ? <Skeleton width="100%" height={120} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("The mapping could not be read.")}</ErrorFrame> : <EmptyFrame>{t("This field is not in the mapping list.")}</EmptyFrame>}
    </InspectorFrame>
  );
}
