"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { applyPolicyPack, createDigest, deleteDigest, sendDigestNow, unapplyPolicyPack, updateDigest, type Digest, type DigestBody, type DigestChannel, type DigestDelivery, type PolicyPack, type PolicyRuleEvidence } from "@/lib/api/v2/step10";
import { formatDate } from "@/lib/format";
import { useChannels, useUsers, useWaves } from "@/lib/v2/admin-queries";
import { cronError, CUSTOM, describeCron, isPreset, PRESETS } from "@/lib/v2/cron";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { useRunList } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { audienceWords, CHANNEL_WORD, deliveryTone, deliveryWord, emailOk, emailsFrom, passRateText, zoneOk } from "@/lib/v2/step10";
import { refreshStep10, useDigestDeliveries, useDigestHtml, useDigestNumbers, useDigests, usePolicyEvidence, usePolicyPacks } from "@/lib/v2/step10-queries";
import { ROLE_NAMES } from "@/lib/v2/view-as";
import { SeverityMark, type SeverityKey } from "@/design/v2/marks";
import { V2Link } from "@/design/v2/parts";
import { Button, Chip, Code, Confirm, DataTable, EmptyState, ErrorState, SegmentedControl, Sheet, Skeleton, StatCard, type Column } from "../../kit";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { Dash, Field, NeedsPermission, Result, useOutcome } from "./reports-kit";

const sev = (s: string | null | undefined): SeverityKey => (s === "critical" || s === "high" || s === "medium" || s === "low" ? s : "info");

// policy pack

/** Applied or not, with who and when, in words. */
function appliedWords(p: PolicyPack): string {
  if (p.applied) return p.applied_at ? t("Applied {when} by {who}", { when: formatDate(p.applied_at, "date"), who: p.applied_by ?? "—" }) : t("Applied");
  return p.unapplied_at ? t("Not applied since {when}", { when: formatDate(p.unapplied_at, "date") }) : t("Not applied");
}

function Coverage({ p }: { p: PolicyPack }) {
  const c = p.coverage;
  const rows: [string, number][] = [
    [t("Fields classified"), c.fields_classified],
    [t("Rules evidencing"), c.rules_evidencing],
    [t("Rules measured"), c.rules_measured],
    [t("Failing records"), c.failing_records],
    [t("Classes breached"), c.classes_breached],
  ];
  return (
    <div className="nx-rp-stats" data-testid="pack-coverage">
      {rows.map(([k, v]) => (
        <StatCard key={k} label={k} value={v} format={int} />
      ))}
    </div>
  );
}

/** Apply and unapply, with manage_rules. Unapplying asks first: the breaches it counted stop counting at once. */
function PackActions({ p }: { p: PolicyPack }) {
  const qc = useQueryClient();
  const can = useV2Session().can("manage_rules");
  const [confirming, setConfirming] = useState(false);
  const { outcome, pending, run } = useOutcome(`pack-insp:${p.id}`);
  if (!can) return <p className="nx-rp-sub">{t("Applying or removing a pack needs the manage rules permission.")}</p>;
  const apply = () =>
    void run("apply", async () => {
      const r = await applyPolicyPack(p.id);
      await refreshStep10(qc, "packs");
      return { tone: "ok", title: t("{name} applied", { name: p.name }), detail: t("{n} {n, plural, one {class} other {classes}} now count as policy breaches when one of their critical rules fails.", { n: r.classes ?? p.classes.length }) };
    });
  return (
    <>
      <Actions>
        {p.applied ? (
          <Button disabled={pending !== null} onClick={() => setConfirming(true)}>
            {t("Remove the pack")}
          </Button>
        ) : (
          <Button variant="primary" loading={pending === "apply"} loadingLabel={t("Applying…")} disabled={pending !== null} onClick={apply}>
            {t("Apply the pack")}
          </Button>
        )}
      </Actions>
      <Result outcome={outcome} />
      <Confirm
        open={confirming}
        title={t("Remove {name}", { name: p.name })}
        consequence={t("Its classes stop counting as policy breaches on the landscape and the receipt. The rules keep running; you can apply the pack again at any time.")}
        confirmLabel={t("Remove the pack")}
        blocked={pending === "unapply" ? t("Working…") : undefined}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          void run("unapply", async () => {
            await unapplyPolicyPack(p.id);
            await refreshStep10(qc, "packs");
            setConfirming(false);
            return { tone: "ok", title: t("{name} removed", { name: p.name }) };
          })
        }
      />
    </>
  );
}

/** The evidence of a pack per class, for the current state or one run: authority, fields, and each rule's numbers. */
function Evidence({ id }: { id: string }) {
  const [run, setRun] = useState<string>("");
  const runs = useRunList();
  const q = usePolicyEvidence(id, run || null);
  const { hrefFor } = useOpenItem();
  const columns: Column<PolicyRuleEvidence>[] = [
    {
      id: "rule",
      label: t("Rule"),
      cell: (r) => (
        <V2Link href={hrefFor({ kind: "rule", id: r.check_id })}>
          <Code code={r.check_id} text={r.name ?? undefined} />
        </V2Link>
      ),
    },
    {
      id: "severity",
      label: t("Severity"),
      cell: (r) =>
        r.measured ? (
          <span className="nx-rp-row">
            <SeverityMark severity={sev(r.severity)} />
            {r.severity ?? "—"}
          </span>
        ) : (
          <Dash why={t("Not measured: no run of this tenant evaluated the rule")} />
        ),
    },
    { id: "rate", label: t("Pass rate"), align: "end", cell: (r) => passRateText(r.pass_rate) ?? <Dash why={t("Not measured")} /> },
    { id: "failing", label: t("Failing"), align: "end", cell: (r) => (r.measured ? t("{failing} of {total}", { failing: int(r.failing_records), total: int(r.total_records) }) : <Dash why={t("Not measured")} />) },
  ];
  return (
    <>
      <h3 className="nx-rp-h">{t("Evidence")}</h3>
      <Field label={t("Evidence of")} hint={t("The current state reads every object at its latest run; a run reads that run only.")}>
        <select className="nx-input" value={run} onChange={(e) => setRun(e.target.value)}>
          <option value="">{t("The current state")}</option>
          {(runs.data?.versions ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {t("Run {run_at}", { run_at: formatDate(v.run_at, "datetime") })}
            </option>
          ))}
        </select>
      </Field>
      {q.isPending ? (
        <Skeleton lines={4} />
      ) : q.isError ? (
        <ErrorState sentence={t("The evidence could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.classes.length === 0 ? (
        <EmptyState heading={t("No rule measured")} />
      ) : (
        <ul className="nx-rp-classes" data-testid="pack-classes">
          {q.data.classes.map((c) => (
            <li key={c.id} className="nx-card" data-testid={`class-${c.id}`}>
              <div className="nx-rp-row">
                <strong>{c.label}</strong>
                <Chip tone={c.breached ? "bad" : c.rules_measured > 0 ? "good" : "neutral"}>{c.breached ? t("Breached") : c.rules_measured > 0 ? t("Evidenced") : t("No rule measured")}</Chip>
              </div>
              <span className="nx-rp-sub">{c.authority}</span>
              <p className="nx-rp-sub">{t("{measured} of {count} rules measured, pass rate {rate}, {failing} failing records", { measured: c.rules_measured, count: c.rules_count, rate: passRateText(c.pass_rate) ?? "—", failing: int(c.failing_records) })}</p>
              <div className="nx-rp-wrap" aria-label={t("Fields of {label}", { label: c.label })}>
                {c.fields.map((f) => (
                  <Code key={f} code={f} />
                ))}
              </div>
              {c.rules.length ? (
                <DataTable rows={c.rules} columns={columns} rowKey={(r) => r.check_id} rowLabel={(r) => r.name || r.check_id} caption={t("Rules evidencing {label}", { label: c.label })} density="compact" />
              ) : (
                <p className="nx-rp-sub">{t("No catalogue rule checks these fields yet: the class is listed so the gap is visible.")}</p>
              )}
              {c.failing_records > 0 ? (
                <p>
                  <V2Link href={`/work?policy=${encodeURIComponent(`${id}:${c.id}`)}&filter=open`}>{t("Open the failing records in Work")}</V2Link>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** `?open=policypack:<id>`: one pack, its state, coverage, apply or remove, and its classes with their evidence. */
export function PolicyPackInspector({ id, onClose }: BodyProps) {
  const q = usePolicyPacks();
  const p = q.data?.packs.find((x) => x.id === id);
  return (
    <InspectorFrame title={p?.name ?? t("Policy pack")} status={p ? (p.applied ? t("Applied") : t("Not applied")) : undefined} onClose={onClose}>
      {p ? (
        <>
          <Facts>
            <Fact label={t("Authority")}>{p.authority}</Fact>
            <Fact label={t("State")}>{appliedWords(p)}</Fact>
            <Fact label={t("Classes")}>{int(p.classes.length)}</Fact>
          </Facts>
          <p className="nx-rp-sub">{p.description}</p>
          <Coverage p={p} />
          <PackActions p={p} />
          <Evidence id={p.id} />
        </>
      ) : q.isPending ? (
        <Skeleton lines={4} />
      ) : q.isError ? (
        <ErrorState sentence={t("The policy pack could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <EmptyState heading={t("There is no policy pack called {id}.", { id })} />
      )}
    </InspectorFrame>
  );
}

// digest

const ROLE_KEYS = ["programme_lead", "data_steward", "data_owner", "analyst", "sap_basis", "platform_admin", "auditor", "viewer", "process_analyst"];
const CHANNELS: DigestChannel[] = ["email", "alert_channel", "webhook"];

interface Draft {
  name: string;
  audience: "role" | "wave";
  role: string;
  wave_id: string;
  cron: string;
  custom: boolean;
  timezone: string;
  channel: DigestChannel;
  recipients: string;
  users: string[];
  alert_channel_id: string;
  attach_pdf: boolean;
  enabled: boolean;
}

const draftOf = (d: Digest | null): Draft => ({
  name: d?.name ?? "",
  audience: d?.audience ?? "role",
  role: d?.role ?? "programme_lead",
  wave_id: d?.wave_id ?? "",
  cron: d?.cron ?? "0 7 * * 1",
  custom: d ? !isPreset(d.cron) : true,
  timezone: d?.timezone ?? "UTC",
  channel: d?.channel ?? "email",
  recipients: (d?.recipients ?? []).join("\n"),
  users: d?.recipient_user_ids ?? [],
  alert_channel_id: d?.alert_channel_id ?? "",
  attach_pdf: d?.attach_pdf ?? true,
  enabled: d?.enabled ?? true,
});

function bodyOf(x: Draft): DigestBody {
  return {
    name: x.name.trim(),
    audience: x.audience,
    role: x.audience === "role" ? x.role : null,
    wave_id: x.audience === "wave" ? x.wave_id || null : null,
    cron: x.cron.trim(),
    timezone: x.timezone.trim(),
    channel: x.channel,
    recipients: x.channel === "email" ? emailsFrom(x.recipients) : [],
    recipient_user_ids: x.channel === "email" ? x.users : [],
    alert_channel_id: x.channel === "alert_channel" ? x.alert_channel_id || null : null,
    attach_pdf: x.attach_pdf,
    enabled: x.enabled,
  };
}

type Problems = Partial<Record<"name" | "cron" | "timezone" | "target" | "channel" | "recipients", string>>;

/** What is wrong with a draft, field by field; empty when it can be sent. */
function problems(x: Draft): Problems {
  const out: Problems = {};
  if (!x.name.trim()) out.name = t("Give the digest a name.");
  const ce = cronError(x.cron);
  if (ce) out.cron = ce;
  if (!zoneOk(x.timezone)) out.timezone = t("An IANA time zone, such as Africa/Johannesburg or Europe/Berlin.");
  if (x.audience === "wave" && !x.wave_id) out.target = t("Choose the wave.");
  if (x.channel === "alert_channel" && !x.alert_channel_id) out.channel = t("Choose the alert channel.");
  const bad = emailsFrom(x.recipients).filter((e) => !emailOk(e));
  if (x.channel === "email" && bad.length) out.recipients = t("Not an email address: {list}", { list: bad.join(", ") });
  else if (x.channel === "email" && x.audience === "wave" && !emailsFrom(x.recipients).length && !x.users.length) out.recipients = t("A wave digest by email needs at least one recipient.");
  return out;
}

/** The form of a digest, new or existing: who it is for, when, where it goes and to whom. */
function DigestForm({ initial, onSaved }: { initial: Digest | null; onSaved: (d: Digest) => void }) {
  const qc = useQueryClient();
  const waves = useWaves();
  const channels = useChannels();
  const users = useUsers();
  const [x, setX] = useState<Draft>(() => draftOf(initial));
  const { outcome, pending, run } = useOutcome(initial ? `digest-form:${initial.id}` : "digest-form:new");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setX((cur) => ({ ...cur, [k]: v }));
  const errs = problems(x);
  const ok = Object.keys(errs).length === 0;
  const people = (users.data?.users ?? []).filter((u) => u.is_active);
  const save = () =>
    void run("save", async () => {
      const body = bodyOf(x);
      let saved: Digest;
      if (initial) {
        const before = bodyOf(draftOf(initial));
        const changed = Object.fromEntries(Object.entries(body).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k as keyof DigestBody]))) as Partial<DigestBody>;
        if (Object.keys(changed).length === 0) return { tone: "info", title: t("Nothing to save") };
        saved = await updateDigest(initial.id, changed);
      } else saved = await createDigest(body);
      await refreshStep10(qc, "digests");
      onSaved(saved);
      return { tone: "ok", title: initial ? t("Digest saved") : t("Digest added"), detail: saved.next_run_at ? t("Next send {when}.", { when: formatDate(saved.next_run_at, "datetime") }) : t("Paused: it is not sent until it is turned on.") };
    });
  return (
    <div className="nx-rp-form" data-testid="digest-form">
      <Field label={t("Name")} error={x.name ? errs.name : undefined}>
        <input className="nx-input" value={x.name} maxLength={200} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <SegmentedControl
        label={t("For")}
        items={[
          { value: "role", label: t("A role") },
          { value: "wave", label: t("A migration wave") },
        ]}
        value={x.audience}
        onChange={(v) => set("audience", v === "wave" ? "wave" : "role")}
      />
      {x.audience === "role" ? (
        <Field label={t("Role")} hint={t("Without recipients, an email digest goes to every active user holding the role.")}>
          <select className="nx-input" value={x.role} onChange={(e) => set("role", e.target.value)}>
            {ROLE_KEYS.map((r) => (
              <option key={r} value={r}>
                {ROLE_NAMES[r] ?? r}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label={t("Wave")} error={errs.target}>
          <select className="nx-input" value={x.wave_id} onChange={(e) => set("wave_id", e.target.value)}>
            <option value="">{t("Choose the wave")}</option>
            {(waves.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={t("Cadence")} hint={x.custom ? undefined : describeCron(x.cron)}>
        <select className="nx-input" value={x.custom ? CUSTOM : x.cron} onChange={(e) => (e.target.value === CUSTOM ? set("custom", true) : setX((cur) => ({ ...cur, custom: false, cron: e.target.value })))}>
          {PRESETS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      {x.custom ? (
        <Field label={t("Cron expression")} error={errs.cron} hint={errs.cron ? undefined : t("Minute hour day month weekday, in the time zone below.")}>
          <input className="nx-input nx-rp-mono" value={x.cron} onChange={(e) => set("cron", e.target.value)} placeholder="0 7 * * 1" />
        </Field>
      ) : null}
      <Field label={t("Time zone")} error={errs.timezone}>
        <input className="nx-input" value={x.timezone} maxLength={64} onChange={(e) => set("timezone", e.target.value)} placeholder="Africa/Johannesburg" />
      </Field>
      <Field label={t("Channel")} error={errs.channel}>
        <select className="nx-input" value={x.channel} onChange={(e) => set("channel", e.target.value as DigestChannel)}>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {CHANNEL_WORD[c]}
            </option>
          ))}
        </select>
      </Field>
      {x.channel === "alert_channel" ? (
        <Field label={t("Alert channel")}>
          <select className="nx-input" value={x.alert_channel_id} onChange={(e) => set("alert_channel_id", e.target.value)}>
            <option value="">{t("Choose the alert channel")}</option>
            {(channels.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {`${c.kind}: ${c.target}`}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {x.channel === "webhook" ? <p className="nx-rp-sub">{t("Posted as the digest.sent event to every active webhook that subscribes to it, under Administration, Webhooks. The event carries the numbers only.")}</p> : null}
      {x.channel === "email" ? (
        <>
          <Field label={t("Email addresses")} error={errs.recipients} hint={errs.recipients ? undefined : t("One per line or separated by commas.")}>
            <textarea className="nx-input" rows={3} value={x.recipients} onChange={(e) => set("recipients", e.target.value)} />
          </Field>
          <fieldset className="nx-rp-set">
            <legend className="nx-rp-h">{t("People")}</legend>
            {users.isPending ? (
              <Skeleton lines={2} />
            ) : people.length === 0 ? (
              <p className="nx-rp-sub">{t("No active user to choose.")}</p>
            ) : (
              <ul className="nx-rp-pick" aria-label={t("People to send to")}>
                {people.map((u) => (
                  <li key={u.id}>
                    <label>
                      <input type="checkbox" className="nx-check" checked={x.users.includes(u.id)} onChange={() => set("users", x.users.includes(u.id) ? x.users.filter((y) => y !== u.id) : [...x.users, u.id])} />
                      <span>{u.name || u.email}</span>
                      <span className="nx-rp-sub">{u.email}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        </>
      ) : null}
      <label className="nx-rp-switch">
        <input type="checkbox" className="nx-check" checked={x.attach_pdf} disabled={x.channel === "webhook"} onChange={(e) => set("attach_pdf", e.target.checked)} />
        {t("Attach the digest as a PDF")}
      </label>
      <label className="nx-rp-switch">
        <input type="checkbox" className="nx-check" checked={x.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        {t("Send on its schedule")}
      </label>
      <Result outcome={outcome} />
      <Actions>
        <Button variant="primary" loading={pending === "save"} loadingLabel={t("Saving…")} disabled={!ok || pending !== null} onClick={save}>
          {initial ? t("Save changes") : t("Add the digest")}
        </Button>
      </Actions>
    </div>
  );
}

/** The digest as its email reads now, in a sandboxed frame, or the numbers it is rendered from. */
function PreviewSheet({ d, open, onClose }: { d: Digest; open: boolean; onClose: () => void }) {
  const [view, setView] = useState<"email" | "numbers">("email");
  const htmlQ = useDigestHtml(d.id, open && view === "email");
  const num = useDigestNumbers(d.id, open && view === "numbers");
  return (
    <Sheet open={open} onClose={onClose} title={t("Preview of {name}", { name: d.name })} meta={t("As it would be sent now. Nothing is sent from here.")} size="large" secondary={<Button onClick={onClose}>{t("Close")}</Button>}>
      <SegmentedControl
        label={t("Show")}
        items={[
          { value: "email", label: t("The email") },
          { value: "numbers", label: t("The numbers") },
        ]}
        value={view}
        onChange={(v) => setView(v === "numbers" ? "numbers" : "email")}
      />
      {view === "email" ? (
        htmlQ.isPending ? (
          <Skeleton lines={8} />
        ) : htmlQ.isError ? (
          <ErrorState sentence={t("The preview could not be read.")} error={htmlQ.error} onRetry={() => void htmlQ.refetch()} />
        ) : (
          <iframe className="nx-rp-frame" title={t("Email preview of {name}", { name: d.name })} sandbox="" srcDoc={htmlQ.data} data-testid="digest-iframe" />
        )
      ) : num.isPending ? (
        <Skeleton lines={8} />
      ) : num.isError ? (
        <ErrorState sentence={t("The numbers could not be read.")} error={num.error} onRetry={() => void num.refetch()} />
      ) : (
        <div className="nx-rp-form" data-testid="digest-numbers">
          <p>{num.data.landscape.text}</p>
          <Facts>
            <Fact label={t("Objects")}>{int(num.data.landscape.objects)}</Fact>
            <Fact label={t("Held under 85")}>{int(num.data.landscape.held_under_85)}</Fact>
            <Fact label={t("Approvals waiting")}>{int(num.data.approvals_waiting)}</Fact>
            <Fact label={t("SLA breaches")}>{int(num.data.sla_breaches)}</Fact>
            <Fact label={t("Value at risk")}>{num.data.value_at_risk.total == null ? <Dash why={t("Not priced: no cost model")} /> : `${num.data.currency} ${int(num.data.value_at_risk.total)}`}</Fact>
            <Fact label={t("Waves")}>{num.data.waves.length ? num.data.waves.map((w) => `${w.name}: ${w.gate_open ? t("gate open") : t("gate closed")}`).join("; ") : "—"}</Fact>
          </Facts>
          {num.data.score_moves.length ? (
            <DataTable
              rows={num.data.score_moves}
              rowKey={(m) => `${m.system}:${m.module}`}
              rowLabel={(m) => `${m.system}, ${m.module}`}
              caption={t("Score moves")}
              density="compact"
              columns={[
                { id: "object", label: t("Object"), cell: (m) => `${m.system}, ${m.module}` },
                { id: "before", label: t("Before"), align: "end", cell: (m) => m.before.toFixed(1) },
                { id: "after", label: t("After"), align: "end", cell: (m) => m.after.toFixed(1) },
                { id: "change", label: t("Change"), align: "end", cell: (m) => `${m.delta > 0 ? "+" : ""}${m.delta.toFixed(1)}` },
              ]}
            />
          ) : null}
          <p className="nx-rp-sub">{t("Built {when}", { when: formatDate(num.data.generated_at, "datetime") })}</p>
        </div>
      )}
    </Sheet>
  );
}

const TONE = { go: "good", "at-risk": "warn", "no-go": "bad" } as const;

function DeliveryLog({ d }: { d: Digest }) {
  const q = useDigestDeliveries(d.id);
  const columns: Column<DigestDelivery>[] = [
    {
      id: "when",
      label: t("When"),
      cell: (x) => (
        <>
          {formatDate(x.finished_at ?? x.created_at, "datetime")}
          {x.manual ? <span className="nx-rp-sub">{` ${t("sent by hand")}`}</span> : null}
        </>
      ),
    },
    {
      id: "state",
      label: t("State"),
      cell: (x) => {
        const tone = deliveryTone(x.status);
        return <Chip tone={tone ? TONE[tone] : "neutral"}>{deliveryWord(x.status)}</Chip>;
      },
    },
    { id: "delivered", label: t("Delivered"), align: "end", cell: (x) => int(x.delivered) },
    { id: "failed", label: t("Failed"), align: "end", cell: (x) => int(x.failed) },
    { id: "why", label: t("Why"), cell: (x) => (x.reason === "sandbox" ? t("Sandbox mode: nothing leaves the deployment") : (x.reason ?? <Dash why={t("No note")} />)) },
  ];
  return (
    <>
      <h3 className="nx-rp-h">{t("Delivery log")}</h3>
      {q.isPending ? (
        <Skeleton lines={3} />
      ) : q.isError ? (
        <ErrorState sentence={t("The delivery log could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.deliveries.length === 0 ? (
        <EmptyState heading={t("Nothing has been sent yet. Send it now, or wait for its next slot.")} />
      ) : (
        <div data-testid="digest-deliveries">
          <DataTable rows={q.data.deliveries} columns={columns} rowKey={(x) => x.id} rowLabel={(x) => formatDate(x.finished_at ?? x.created_at, "datetime")} caption={t("Deliveries of {name}", { name: d.name })} density="compact" />
        </div>
      )}
    </>
  );
}

function DigestBodyView({ d, onClose }: { d: Digest; onClose: () => void }) {
  const qc = useQueryClient();
  const waves = useWaves();
  const users = useUsers();
  const [preview, setPreview] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const { outcome, pending, run } = useOutcome(`digest:${d.id}`);
  const waveName = (id: string) => waves.data?.find((w) => w.id === id)?.name ?? null;
  const names = d.recipient_user_ids.map((id) => users.data?.users.find((u) => u.id === id)?.name ?? id);
  const recipients = [...d.recipients, ...names];
  const send = () =>
    void run("send", async () => {
      const r = await sendDigestNow(d.id);
      await refreshStep10(qc, "digests");
      if (r.status === "skipped") return { tone: "info", title: t("Held back"), detail: r.reason === "sandbox" ? t("Sandbox mode is on: nothing leaves the deployment. The delivery is logged as held back.") : (r.reason ?? undefined) };
      return { tone: r.status === "sent" ? "ok" : "fail", title: r.status === "sent" ? t("Digest sent") : t("Digest not sent"), detail: [t("{delivered} delivered, {failed} failed.", { delivered: r.delivered, failed: r.failed }), r.reason].filter(Boolean).join(" ") };
    });
  const toggle = () =>
    void run("enabled", async () => {
      await updateDigest(d.id, { enabled: !d.enabled });
      await refreshStep10(qc, "digests");
      return { tone: "ok", title: d.enabled ? t("Digest paused") : t("Digest turned on") };
    });
  return (
    <>
      <Facts>
        <Fact label={t("For")}>{audienceWords(d, (r) => ROLE_NAMES[r] ?? r, waveName)}</Fact>
        <Fact label={t("Cadence")}>{t("{cadence}, {zone}", { cadence: describeCron(d.cron), zone: d.timezone })}</Fact>
        <Fact label={t("Channel")}>{CHANNEL_WORD[d.channel] ?? d.channel}</Fact>
        <Fact label={t("Recipients")}>
          {d.channel !== "email" ? (
            <Dash why={t("This channel has no recipients of its own")} />
          ) : recipients.length ? (
            <span className="nx-rp-recips">
              {recipients.map((r) => (
                <span key={r}>{r}</span>
              ))}
            </span>
          ) : d.audience === "role" ? (
            t("Every active user holding the role")
          ) : (
            <Dash why={t("No recipient")} />
          )}
        </Fact>
        <Fact label={t("PDF")}>{d.attach_pdf ? t("Attached") : t("Not attached")}</Fact>
        <Fact label={t("State")}>
          <Chip tone={d.enabled ? "good" : "neutral"}>{d.enabled ? t("On") : t("Paused")}</Chip>
        </Fact>
        <Fact label={t("Last sent")}>{d.last_sent_at ? formatDate(d.last_sent_at, "datetime") : t("Never")}</Fact>
        <Fact label={t("Next send")}>{d.next_run_at ? formatDate(d.next_run_at, "datetime") : <Dash why={d.enabled ? t("Not scheduled") : t("Paused")} />}</Fact>
      </Facts>
      <Result outcome={outcome} />
      <Actions>
        <Button variant="primary" loading={pending === "send"} loadingLabel={t("Sending…")} disabled={pending !== null} onClick={send}>
          {t("Send now")}
        </Button>
        <Button onClick={() => setPreview(true)}>{t("Preview")}</Button>
        <Button disabled={pending !== null} onClick={toggle}>
          {d.enabled ? t("Pause") : t("Turn on")}
        </Button>
        <Button aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
          {t("Edit")}
        </Button>
        <Button variant="danger" onClick={() => setRemoving(true)}>
          {t("Delete")}
        </Button>
      </Actions>
      {editing ? <DigestForm key={d.updated_at} initial={d} onSaved={() => setEditing(false)} /> : null}
      <DeliveryLog d={d} />
      <PreviewSheet d={d} open={preview} onClose={() => setPreview(false)} />
      <Confirm
        open={removing}
        title={t("Delete {name}", { name: d.name })}
        consequence={t("It is not sent again and its delivery log goes with it.")}
        confirmLabel={t("Delete the digest")}
        danger
        blocked={pending === "delete" ? t("Working…") : undefined}
        onCancel={() => setRemoving(false)}
        onConfirm={() =>
          void run("delete", async () => {
            await deleteDigest(d.id);
            await refreshStep10(qc, "digests");
            setRemoving(false);
            onClose();
            return { tone: "ok", title: t("Digest deleted") };
          })
        }
      />
    </>
  );
}

/** `?open=digest:<id>`: one digest, Send now, Preview, its edits and its delivery log. `digest:new` adds one. */
export function DigestInspector({ id, onClose }: BodyProps) {
  const session = useV2Session();
  const allowed = session.can("manage_settings") || session.can("manage_digests");
  const q = useDigests(allowed && id !== "new");
  const { openItem } = useOpenItem();
  if (!allowed) {
    return (
      <InspectorFrame title={t("Digest")} onClose={onClose}>
        <NeedsPermission what={t("Managing digests")} permission="manage_settings" />
      </InspectorFrame>
    );
  }
  if (id === "new") {
    return (
      <InspectorFrame title={t("Add a digest")} status={t("By role or by wave")} onClose={onClose}>
        <DigestForm initial={null} onSaved={(d) => openItem({ kind: "digest", id: d.id })} />
      </InspectorFrame>
    );
  }
  const d = q.data?.digests.find((x) => x.id === id);
  return (
    <InspectorFrame title={d?.name ?? t("Digest")} status={d ? (d.enabled ? t("On") : t("Paused")) : undefined} onClose={onClose}>
      {d ? (
        <DigestBodyView d={d} onClose={onClose} />
      ) : q.isPending ? (
        <Skeleton lines={4} />
      ) : q.isError ? (
        <ErrorState sentence={t("The digest could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <EmptyState heading={t("This digest does not exist. It may have been deleted.")} />
      )}
    </InspectorFrame>
  );
}
