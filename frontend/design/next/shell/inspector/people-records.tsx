"use client";

/** The audit entry and alert channel inspectors. */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AlertChannel, AlertChannelCreate, AlertChannelKind, AlertDigest, AlertReportPack } from "@/lib/api/notifications";
import * as api from "@/lib/api/v2/admin";
import { formatDate } from "@/lib/format";
import { auditSentence } from "@/lib/v2/audit-sentence";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { refreshAdmin, useAuditEntry, useChannels, useUsers } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { Button, Code, Confirm, EmptyState, ErrorState, Skeleton } from "../../kit";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { Note, OutcomeView, Sec, copyText, useDone, useOutcome } from "./people-shared";

/* ── Audit entry ── */

const pretty = (v: unknown): string => (v === null || v === undefined ? "" : JSON.stringify(v, null, 2));

export function AuditInspector({ id, onClose }: BodyProps) {
  const q = useAuditEntry(id);
  const { can } = useV2Session();
  const users = useUsers({}, can("manage_users"));
  const e = q.data;
  const actor = e ? (users.data?.users.find((u) => u.id === e.actor_user_id)?.name ?? e.actor_email ?? t("The system")) : "";
  return (
    <InspectorFrame title={e ? auditSentence(e) : t("Audit entry")} status={e ? formatDate(e.created_at, "datetime") : undefined} onClose={onClose}>
      {e ? (
        <>
          <Facts>
            <Fact label={t("Who")}>{actor}</Fact>
            <Fact label={t("Action")}>
              <Code code={e.action} />
            </Fact>
            <Fact label={t("Result")}>{e.status_code >= 400 ? t("Refused, {status_code}", { status_code: e.status_code }) : t("Done, {status_code}", { status_code: e.status_code })}</Fact>
            <Fact label={t("Request")}>
              <Code code={`${e.method} ${e.path}`} />
            </Fact>
            {e.entity_type ? (
              <Fact label={t("Object")}>
                {e.entity_type}
                {e.entity_id ? (
                  <>
                    {" "}
                    <Code code={e.entity_id} />
                  </>
                ) : null}
              </Fact>
            ) : null}
            <Fact label={t("From")}>{[e.ip, e.user_agent].filter(Boolean).join(", ") || "—"}</Fact>
          </Facts>
          {e.before_json ? (
            <Sec title={t("Before")}>
              <pre className="nx-pp-pre" aria-label={t("Before")}>
                {pretty(e.before_json)}
              </pre>
            </Sec>
          ) : null}
          {e.after_json ? (
            <Sec title={t("After")}>
              <pre className="nx-pp-pre" aria-label={t("After")}>
                {pretty(e.after_json)}
              </pre>
            </Sec>
          ) : null}
          <Actions>
            <Button onClick={() => void copyText(e.id)}>{t("Copy the entry id")}</Button>
          </Actions>
          <Note>{t("Audit entries are permanent. They cannot be edited or removed from here.")}</Note>
        </>
      ) : q.isLoading ? (
        <Skeleton lines={4} />
      ) : q.isError ? (
        <ErrorState sentence={t("The entry could not be read.")} onRetry={() => void q.refetch()} />
      ) : (
        <EmptyState heading={t("This entry is not among the most recent ones. Filter the log by date to find it.")} />
      )}
    </InspectorFrame>
  );
}

/* ── Alert channel ── */

const KINDS: AlertChannelKind[] = ["email", "slack", "teams", "webhook"];
const DIGESTS: AlertDigest[] = ["daily", "weekly", "off"];
const PACKS: AlertReportPack[] = ["off", "weekly", "monthly"];

const kindLabel = (k: AlertChannelKind): string => ({ email: t("Email"), slack: t("Slack"), teams: t("Microsoft Teams"), webhook: t("Webhook (signed)") })[k];
const digestLabel = (d: AlertDigest): string => ({ daily: t("Daily digest"), weekly: t("Weekly digest"), off: t("No digest") })[d];
const packLabel = (p: AlertReportPack): string => ({ off: t("Off"), weekly: t("Weekly"), monthly: t("Monthly") })[p];

function DigestField({ value, onChange, disabled }: { value: AlertDigest; onChange: (d: AlertDigest) => void; disabled?: boolean }) {
  return (
    <label className="nx-field">
      {t("Digest")}
      <select className="nx-input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as AlertDigest)}>
        {DIGESTS.map((d) => (
          <option key={d} value={d}>
            {digestLabel(d)}
          </option>
        ))}
      </select>
    </label>
  );
}

function PackField({ value, onChange, disabled }: { value: AlertReportPack; onChange: (p: AlertReportPack) => void; disabled?: boolean }) {
  return (
    <label className="nx-field">
      {t("Board pack")}
      <select className="nx-input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as AlertReportPack)}>
        {PACKS.map((p) => (
          <option key={p} value={p}>
            {packLabel(p)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Check({ checked, onChange, disabled, children }: { checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; children: string }) {
  return (
    <label className="nx-pp-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

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
      <div className="nx-pp-form">
        <label className="nx-field">
          {t("Type")}
          <select className="nx-input" value={kind} onChange={(e) => setKind(e.target.value as AlertChannelKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="nx-field">
          {kind === "email" ? t("Address") : t("URL")}
          <input
            className="nx-input"
            type={kind === "email" ? "email" : "url"}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={kind === "email" ? t("dq-team@company.com") : t("https://")}
          />
        </label>
        {kind === "webhook" ? (
          <label className="nx-field">
            {t("Signing secret (16 to 256 characters)")}
            <input className="nx-input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" />
          </label>
        ) : null}
        <DigestField value={digest} onChange={setDigest} />
        {kind === "email" ? <PackField value={pack} onChange={setPack} /> : null}
        <Check checked={immediate} onChange={setImmediate}>
          {t("Send new critical findings at once")}
        </Check>
      </div>
      {!reachable ? <Note role="alert">{t("Choose a digest or immediate delivery, or the channel never fires.")}</Note> : null}
      {outcome ? <OutcomeView outcome={outcome} /> : null}
      <Actions>
        <Button
          variant="primary"
          disabled={!targetOk || !secretOk || !reachable || pending !== null || made !== null}
          loading={pending === "add"}
          loadingLabel={t("Adding…")}
          onClick={() =>
            void run("add", async () => {
              const body: AlertChannelCreate = {
                kind,
                target: target.trim(),
                digest,
                immediate_critical: immediate,
                ...(kind === "email" && pack !== "off" ? { report_pack: pack } : {}),
                ...(kind === "webhook" && secret ? { secret } : {}),
              };
              const c = await api.createChannel(body);
              await refreshAdmin(qc, "channels");
              setMade(c.id);
              return { tone: "ok", title: t("Channel added") };
            })
          }
        >
          {t("Add the channel")}
        </Button>
        {made ? <Button onClick={() => openItem({ kind: "channel", id: made })}>{t("Open the channel")}</Button> : null}
      </Actions>
    </InspectorFrame>
  );
}

function ChannelBody({ c }: { c: AlertChannel }) {
  const qc = useQueryClient();
  const { close } = useOpenItem();
  const { can } = useV2Session();
  const done = useDone();
  const edit = can("manage_settings");
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
        <Fact label={t("Type")}>{kindLabel(c.kind)}</Fact>
        <Fact label={t("Sends to")}>{c.target}</Fact>
        <Fact label={t("Added")}>{formatDate(c.created_at)}</Fact>
        {c.kind === "webhook" ? <Fact label={t("Signing secret")}>{c.has_secret ? t("Stored") : t("None")}</Fact> : null}
      </Facts>
      <Sec title={t("Settings")}>
        <div className="nx-pp-form">
          <DigestField value={digest} onChange={setDigest} disabled={!edit} />
          {c.kind === "email" ? <PackField value={pack} onChange={setPack} disabled={!edit} /> : null}
          <Check checked={immediate} onChange={setImmediate} disabled={!edit}>
            {t("Send new critical findings at once")}
          </Check>
          <Check checked={enabled} onChange={setEnabled} disabled={!edit}>
            {t("Channel is on")}
          </Check>
        </div>
      </Sec>
      {outcome ? <OutcomeView outcome={outcome} /> : null}
      <Actions>
        <Button
          variant="primary"
          disabled={!edit || !dirty || pending !== null}
          loading={pending === "save"}
          loadingLabel={t("Saving…")}
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
          {t("Save")}
        </Button>
        <Button
          disabled={!edit || pending !== null}
          loading={pending === "test"}
          loadingLabel={t("Sending…")}
          onClick={() =>
            void run("test", async () => {
              const r = await api.testChannel(c.id);
              return r.delivered
                ? { tone: "ok", title: t("Test message delivered") }
                : { tone: "fail", title: t("The channel did not accept the test message"), detail: t("Check the address, and that the channel is on.") };
            })
          }
        >
          {t("Send a test message")}
        </Button>
        <Button variant="danger" disabled={!edit || pending !== null} onClick={() => setAsk(true)}>
          {t("Remove the channel")}
        </Button>
      </Actions>
      <Confirm
        open={ask}
        title={t("Remove the {KIND_LABEL} channel", { KIND_LABEL: kindLabel(c.kind) })}
        consequence={t("{target} stops receiving alerts and digests at once.", { target: c.target })}
        confirmLabel={t("Remove the channel")}
        danger
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
    </>
  );
}

export function ChannelInspector({ id, onClose }: BodyProps) {
  const q = useChannels(id !== "new");
  if (id === "new") return <NewChannel onClose={onClose} />;
  const c = q.data?.find((x) => x.id === id);
  return (
    <InspectorFrame title={c ? `${kindLabel(c.kind)}: ${c.target}` : t("Channel")} status={c ? (c.enabled ? t("On") : t("Off")) : undefined} onClose={onClose}>
      {c ? (
        <ChannelBody key={c.id} c={c} />
      ) : q.isLoading ? (
        <Skeleton lines={4} />
      ) : q.isError ? (
        <ErrorState sentence={t("The channel could not be read.")} onRetry={() => void q.refetch()} />
      ) : (
        <EmptyState heading={t("This channel does not exist.")} />
      )}
    </InspectorFrame>
  );
}
