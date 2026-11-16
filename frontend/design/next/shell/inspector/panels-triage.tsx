"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { putEscalationChain, type EscalationStep } from "@/lib/api/v2/roles";
import { deleteSlaPolicy, getAssignable, getTriageSettings, putTriageSettings, type Digest, type SlaPolicy, type TriageSettings, type TriageSeverity } from "@/lib/api/v2/triage";
import { approvalKeys, useAssignable, useDigest, useSaveTriage, useSlaPolicies } from "@/lib/v2/approvals-queries";
import { failureText } from "@/lib/v2/errors";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { notFound, refreshRoles, useEscalationChain } from "@/lib/v2/roles-queries";
import { useWorkCan } from "@/lib/v2/work-actions";
import { V2Link } from "@/design/v2/parts";
import { Button, Code, Confirm, EmptyState, ErrorState, Skeleton } from "../../kit";
import { Actions, InspectorFrame, type BodyProps } from "./frame";
import { Dash, Result, type Outcome } from "./panels-kit";

const SEVERITIES: { key: TriageSeverity; label: () => string }[] = [
  { key: "critical", label: () => t("Critical") },
  { key: "high", label: () => t("High") },
  { key: "medium", label: () => t("Medium") },
  { key: "low", label: () => t("Low") },
];
const DIGESTS: { value: Digest; label: () => string }[] = [
  { value: "daily", label: () => t("Daily") },
  { value: "weekly", label: () => t("Weekly") },
  { value: "off", label: () => t("Off") },
];
const DAY = 1440;
const daysOf = (minutes: number): number => Math.round((minutes / DAY) * 10) / 10;
const sevLabel = (k: string) => SEVERITIES.find((s) => s.key === k)?.label() ?? k;

/** Whether the person may change the SLA policies: manage_triage, manage_settings or manage_rules (api/routes/triage.py). */
function useTriageCan(): boolean {
  const session = useV2Session();
  const wc = useWorkCan();
  return wc.mode !== "viewer" && (session.can("manage_triage") || session.can("manage_settings") || session.can("manage_rules"));
}

function Row({ label, htmlFor, children }: { label: ReactNode; htmlFor: string | null; children: ReactNode }) {
  return (
    <div className="nx-pn-row">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
      {children}
    </div>
  );
}

function SlaBody() {
  const sla = useSlaPolicies();
  const prefs = useDigest();
  const save = useSaveTriage();
  const canEdit = useTriageCan();
  const fx = useFixture();
  const qc = useQueryClient();
  const [days, setDays] = useState<Partial<Record<TriageSeverity, string>>>({});
  const [digest, setDigest] = useState<Digest | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [asking, setAsking] = useState<{ id: string; what: string; override: boolean } | null>(null);
  const reset = useMutation({
    mutationFn: (id: string) => deleteSlaPolicy(id),
    onSuccess: () => {
      setDays({});
      setOutcome({ tone: "ok", title: t("Saved"), detail: t("The policy was removed. The default applies from now on.") });
      return qc.invalidateQueries({ queryKey: approvalKeys.sla(fx) });
    },
    onError: (e) => setOutcome({ tone: "fail", title: t("It did not go through"), detail: errorSentence(e, t("The policy could not be removed.")) }),
  });

  const tenantWide = useMemo(() => (sla.data ?? []).filter((p) => p.module == null), [sla.data]);
  const overrides = useMemo(() => (sla.data ?? []).filter((p) => p.module != null && p.id), [sla.data]);
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

  if (sla.isLoading || prefs.isLoading) return <Skeleton lines={5} label={t("Triage and SLA")} />;
  if (sla.isError) return <ErrorState sentence={t("The SLA policies could not be read.")} error={sla.error} onRetry={() => void sla.refetch()} />;
  if (tenantWide.length === 0) return <EmptyState heading={t("No SLA policy is set. Records use the built-in defaults.")} />;

  const onSave = () => {
    setOutcome(null);
    save.mutate(
      { policies: changed, digest: digestChanged ? digest : null },
      {
        onSuccess: () => {
          setDays({});
          setDigest(null);
          setOutcome({ tone: "ok", title: t("Saved"), detail: t("New SLA days apply to records that start their clock from now on.") });
        },
        onError: (e) => setOutcome({ tone: "fail", title: t("It did not go through"), detail: errorSentence(e, t("The settings could not be saved.")) }),
      },
    );
  };

  return (
    <>
      <p className="nx-pn-note">
        {t("These settings set the clocks of the triage queue.")} <V2Link href="/work/triage">{t("Open the triage queue")}</V2Link>
      </p>
      <section className="nx-ib-sec">
        <h3>{t("SLA days to resolve")}</h3>
        <div className="nx-pn-form" role="group" aria-label={t("SLA days per severity")}>
          {SEVERITIES.map((s) => {
            const p = byKey.get(s.key);
            const id = `triage-${s.key}`;
            const shown = days[s.key] ?? (p ? String(daysOf(p.resolve_minutes)) : "");
            return (
              <Row key={s.key} label={s.label()} htmlFor={canEdit ? id : null}>
                {canEdit ? (
                  <>
                    <input id={id} type="text" inputMode="decimal" value={shown} onChange={(e) => setDays((d) => ({ ...d, [s.key]: e.target.value }))} aria-invalid={Number.isNaN(parsed(s.key)) ? "true" : undefined} />
                    <span className="nx-pn-meta">{t("days")}</span>
                    {p?.id && !p.is_default ? (
                      <Button variant="quiet" size={32} disabled={reset.isPending} onClick={() => setAsking({ id: p.id as string, what: s.label(), override: false })} aria-label={t("Use the default for {sev}", { sev: s.label() })}>
                        {t("Use default")}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <span>{p ? t("{daysOf} {daysOf, plural, one {day} other {days}}", { daysOf: daysOf(p.resolve_minutes) }) : "—"}</span>
                )}
              </Row>
            );
          })}
          {tenantWide.find((r) => r.is_default) ? <p className="nx-pn-meta">{t("Severities without a policy of their own use the built-in default.")}</p> : null}
        </div>
      </section>
      {overrides.length ? (
        <section className="nx-ib-sec">
          <h3>{t("Module overrides")}</h3>
          <div className="nx-pn-form" role="group" aria-label={t("SLA days per module")}>
            {overrides.map((p) => (
              <Row
                key={p.id}
                htmlFor={null}
                label={
                  <>
                    <Code code={p.module as string} text={moduleText(p.module as string)} />, {sevLabel(p.severity)}
                  </>
                }
              >
                <span>{t("{daysOf} {daysOf, plural, one {day} other {days}}", { daysOf: daysOf(p.resolve_minutes) })}</span>
                {canEdit ? (
                  <Button variant="quiet" size={32} disabled={reset.isPending} onClick={() => setAsking({ id: p.id as string, what: `${moduleText(p.module as string)}, ${sevLabel(p.severity)}`, override: true })}>
                    {t("Remove")}
                  </Button>
                ) : null}
              </Row>
            ))}
          </div>
        </section>
      ) : null}
      <Confirm
        open={Boolean(asking)}
        title={asking?.override ? t("Remove") : t("Use default")}
        consequence={asking ? t("The SLA policy for {what} is removed. Records that start their clock from now on use the default days.", { what: asking.what }) : ""}
        confirmLabel={asking?.override ? t("Remove") : t("Use default")}
        danger
        onConfirm={() => {
          if (asking) reset.mutate(asking.id);
          setAsking(null);
        }}
        onCancel={() => setAsking(null)}
      />

      <WorkingHours />

      <section className="nx-ib-sec">
        <h3>{t("Escalation")}</h3>
        <Row label={t("Escalate after")} htmlFor={null}>
          <span>{t("The SLA days above")}</span>
        </Row>
        <p className="nx-pn-meta">{t("A record that passes its SLA is escalated to the team lead, else the fallback owner. The chain below adds later levels.")}</p>
      </section>
      <EscalationChain />

      <section className="nx-ib-sec">
        <h3>{t("Digest")}</h3>
        <div className="nx-pn-form">
          <label className="nx-pn-fld" htmlFor="triage-digest">
            <span>{t("Your digest")}</span>
          </label>
          {prefs.isError ? (
            <span className="nx-pn-meta">{t("Not read")}</span>
          ) : (
            <select id="triage-digest" value={shownDigest} onChange={(e) => setDigest(e.target.value as Digest)}>
              {DIGESTS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label()}
                </option>
              ))}
            </select>
          )}
          <p className="nx-pn-meta">{t("The summary of your open work and approvals, sent to you.")}</p>
        </div>
      </section>

      <Actions>
        <Button variant="primary" size={32} loading={save.isPending} loadingLabel={t("Saving…")} disabled={!dirty || invalid || (!canEdit && changed.length > 0)} onClick={onSave}>
          {t("Save")}
        </Button>
        {dirty ? (
          <Button
            variant="secondary"
            size={32}
            onClick={() => {
              setDays({});
              setDigest(null);
            }}
          >
            {t("Discard")}
          </Button>
        ) : null}
      </Actions>
      {invalid ? <p className="nx-pn-err">{t("Days must be a number between 0 and 365.")}</p> : null}
      {!canEdit ? <p className="nx-pn-meta">{t("Changing SLA days needs the manage triage permission, which your role does not hold. You can still choose your own digest.")}</p> : null}
      <Result outcome={outcome} />
    </>
  );
}

const WEEKDAYS: { n: number; label: () => string }[] = [
  { n: 1, label: () => t("Mon") },
  { n: 2, label: () => t("Tue") },
  { n: 3, label: () => t("Wed") },
  { n: 4, label: () => t("Thu") },
  { n: 5, label: () => t("Fri") },
  { n: 6, label: () => t("Sat") },
  { n: 7, label: () => t("Sun") },
];
const hm = (v: string): string => v.slice(0, 5);
const hms = (v: string): string => (v.length === 5 ? `${v}:00` : v);

/** The business calendar SLA clocks run on: timezone, work days and hours, holidays and the fallback owner. */
function WorkingHours() {
  const fx = useFixture();
  const qc = useQueryClient();
  const session = useV2Session();
  const canEdit = session.can("manage_settings");
  const key = ["v2", "triage-settings", fx];
  const q = useQuery({ queryKey: key, queryFn: getTriageSettings, retry: false });
  const users = useQuery({ queryKey: ["v2", "assignable", fx], queryFn: getAssignable, enabled: canEdit });
  const [draft, setDraft] = useState<(TriageSettings & { holidaysText: string }) | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const save = useMutation({
    mutationFn: (s: TriageSettings) => putTriageSettings(s),
    onSuccess: (s) => {
      qc.setQueryData(key, s);
      setDraft(null);
      setOutcome({ tone: "ok", title: t("Saved"), detail: t("SLA clocks use the new working hours from now on.") });
    },
    onError: (e) => setOutcome({ tone: "fail", title: t("It did not go through"), detail: errorSentence(e, t("The working hours could not be saved.")) }),
  });

  if (q.isLoading) return <Skeleton lines={4} label={t("Working hours")} />;
  if (q.isError || !q.data) return <ErrorState sentence={t("The working hours could not be read.")} error={q.error} onRetry={() => void q.refetch()} />;
  const cur = draft ?? { ...q.data, holidaysText: q.data.holidays.join("\n") };
  const set = (patch: Partial<typeof cur>) => setDraft({ ...cur, ...patch });
  const holidays = cur.holidaysText.split(/\s+/).filter(Boolean);
  const badHoliday = holidays.some((h) => !/^\d{4}-\d{2}-\d{2}$/.test(h));
  const invalid = !cur.timezone.trim() || cur.work_days.length === 0 || hm(cur.work_start) >= hm(cur.work_end) || badHoliday || holidays.length > 400;
  const dis = !canEdit;

  return (
    <section className="nx-ib-sec">
      <h3>{t("Working hours")}</h3>
      <div className="nx-pn-form" role="group" aria-label={t("Working hours")}>
        <label className="nx-pn-fld">
          <span>{t("Timezone")}</span>
          <input id="triage-tz" type="text" value={cur.timezone} disabled={dis} onChange={(e) => set({ timezone: e.target.value })} />
        </label>
        <fieldset className="nx-pn-set">
          <legend>{t("Work days")}</legend>
          <div className="nx-pn-row">
            {WEEKDAYS.map((d) => (
              <label key={d.n} className="nx-pn-opt">
                <input
                  type="checkbox"
                  disabled={dis}
                  checked={cur.work_days.includes(d.n)}
                  onChange={(e) => set({ work_days: e.target.checked ? [...cur.work_days, d.n].sort() : cur.work_days.filter((x) => x !== d.n) })}
                />
                <span>{d.label()}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="nx-pn-fld">
          <span>{t("Day starts")}</span>
          <input id="triage-start" type="time" disabled={dis} value={hm(cur.work_start)} onChange={(e) => set({ work_start: hms(e.target.value) })} />
        </label>
        <label className="nx-pn-fld">
          <span>{t("Day ends")}</span>
          <input id="triage-end" type="time" disabled={dis} value={hm(cur.work_end)} onChange={(e) => set({ work_end: hms(e.target.value) })} />
        </label>
        <label className="nx-pn-fld">
          <span>{t("Holidays")}</span>
          <textarea id="triage-hol" rows={3} disabled={dis} value={cur.holidaysText} onChange={(e) => set({ holidaysText: e.target.value })} aria-invalid={badHoliday ? "true" : undefined} />
        </label>
        <p className="nx-pn-meta">{t("One date per line, as YYYY-MM-DD. The SLA clock stops on these days.")}</p>
        <label className="nx-pn-fld">
          <span>{t("Fallback owner")}</span>
          {canEdit ? (
            <select id="triage-fallback" value={cur.fallback_user_id ?? ""} onChange={(e) => set({ fallback_user_id: e.target.value || null })}>
              <option value="">{t("None")}</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          ) : (
            <span>{cur.fallback_user_id ? cur.fallback_user_id : "—"}</span>
          )}
        </label>
      </div>
      {canEdit ? (
        <span>
          <Button
            variant="secondary"
            size={32}
            loading={save.isPending}
            loadingLabel={t("Saving…")}
            disabled={!draft || invalid}
            onClick={() => {
              setOutcome(null);
              save.mutate({ timezone: cur.timezone.trim(), work_days: cur.work_days, work_start: cur.work_start, work_end: cur.work_end, holidays, fallback_user_id: cur.fallback_user_id });
            }}
          >
            {t("Save working hours")}
          </Button>
        </span>
      ) : (
        <p className="nx-pn-meta">{t("Changing working hours needs the manage settings permission.")}</p>
      )}
      {draft && invalid ? <p className="nx-pn-err">{t("Pick at least one work day, a start before the end, and dates as YYYY-MM-DD.")}</p> : null}
      <Result outcome={outcome} />
    </section>
  );
}

const TARGET: Record<EscalationStep["target"], () => string> = { team_lead: () => t("The team lead"), fallback: () => t("The fallback owner"), user: () => t("A person") };

/** The levels after the first escalation: hours past due and who hears. Same as the v2 EscalationChainEditor. */
function EscalationChain() {
  const qc = useQueryClient();
  const session = useV2Session();
  const q = useEscalationChain();
  const people = useAssignable(true);
  const [steps, setSteps] = useState<EscalationStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const canEdit = (session.can("manage_triage") || session.can("manage_settings") || session.can("manage_rules")) && !session.shared && !session.viewAs;
  const list = steps ?? q.data?.steps ?? [];
  const set = (i: number, patch: Partial<EscalationStep>) => setSteps(list.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      await putEscalationChain(list.map((s, i) => ({ ...s, level: i + 1, user_id: s.target === "user" ? s.user_id : null })));
      setSteps(null);
      setSaved(true);
      await refreshRoles(qc, "chain");
    } catch (e) {
      setError(failureText(e));
    }
  };
  return (
    <section className="nx-ib-sec" aria-label={t("Escalation chain")} data-testid="escalation-chain">
      <h3>{t("Escalation chain")}</h3>
      <p className="nx-pn-meta">{t("After a breach the assignee and the team lead hear first. Each level below notifies once more when a task stays past due that long.")}</p>
      {q.isError ? (
        notFound(q.error) ? (
          <Dash why={t("The escalation chain is not available on this server yet")} />
        ) : (
          <ErrorState sentence={t("The chain could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
        )
      ) : !q.data ? (
        <Skeleton lines={2} label={t("Escalation chain")} />
      ) : (
        <>
          {list.length === 0 ? <p className="nx-pn-meta">{t("No further levels.")}</p> : null}
          <ol className="nx-ib-list">
            {list.map((s, i) => (
              <li key={i} className="nx-ib-row" data-testid="escalation-level">
                <span className="nx-pn-meta">{t("Level {count}", { count: i + 1 })}</span>
                {canEdit ? (
                  <span className="nx-pn-row nx-pn-form">
                    <label className="nx-pn-row">
                      <span className="nx-pn-meta">{t("Hours past due")}</span>
                      <input type="number" min={0} value={Math.round(s.after_minutes / 60)} onChange={(e) => set(i, { after_minutes: Math.max(0, Number(e.target.value)) * 60 })} aria-label={t("Level {count}: hours past due", { count: i + 1 })} />
                    </label>
                    <select value={s.target} onChange={(e) => set(i, { target: e.target.value as EscalationStep["target"] })} aria-label={t("Level {count}: who hears", { count: i + 1 })}>
                      {(Object.keys(TARGET) as EscalationStep["target"][]).map((v) => (
                        <option key={v} value={v}>
                          {TARGET[v]()}
                        </option>
                      ))}
                    </select>
                    {s.target === "user" ? (
                      <select value={s.user_id ?? ""} onChange={(e) => set(i, { user_id: e.target.value || null })} aria-label={t("Level {count}: person", { count: i + 1 })}>
                        <option value="">{t("Choose")}</option>
                        {(people.data ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <button type="button" className="nx-pn-linkbtn" onClick={() => setSteps(list.filter((_, n) => n !== i))}>
                      {t("Remove")}
                    </button>
                  </span>
                ) : (
                  <span>{t("{value} hours past due: {value2}", { value: Math.round(s.after_minutes / 60), value2: s.target === "user" ? (s.user_name ?? t("a person")) : TARGET[s.target]().toLowerCase() })}</span>
                )}
              </li>
            ))}
          </ol>
          {canEdit ? (
            <span className="nx-pn-row">
              <Button
                variant="secondary"
                size={32}
                disabled={list.length >= 5}
                onClick={() => setSteps([...list, { level: list.length + 1, after_minutes: (list[list.length - 1]?.after_minutes ?? 0) + 480, target: "fallback", user_id: null }])}
              >
                {t("Add a level")}
              </Button>
              <Button variant="primary" size={32} disabled={steps === null} onClick={() => void save()}>
                {t("Save the chain")}
              </Button>
            </span>
          ) : (
            <p className="nx-pn-meta">{t("Changing the chain needs the manage triage permission.")}</p>
          )}
          {error ? (
            <p className="nx-pn-err" role="alert">
              {error}
            </p>
          ) : null}
          {saved ? <p role="status">{t("Saved. It applies from the next SLA sweep.")}</p> : null}
        </>
      )}
    </section>
  );
}

/** `?open=triage`: the tenant's SLA days per severity, working hours, escalation and the digest. Read-only without the permission. */
export function TriageBody({ onClose }: BodyProps) {
  return (
    <InspectorFrame title={t("Triage and SLA")} status={t("Tenant settings")} onClose={onClose}>
      <SlaBody />
    </InspectorFrame>
  );
}
