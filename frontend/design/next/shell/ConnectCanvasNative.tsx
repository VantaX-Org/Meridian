"use client";

import { useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useV2Href, useV2Session } from "@/lib/v2/hooks";
import { useSystemObjectList } from "@/lib/v2/runs-queries";
import { usePolicyPacks } from "@/lib/v2/step10-queries";
import { applyPolicyPack, unapplyPolicyPack } from "@/lib/api/v2/step10";
import { createProfile } from "@/lib/api/v2/sys";
import { inviteUser } from "@/lib/api/v2/admin";
import { ROLE_NAMES } from "@/lib/v2/view-as";
import { cronError, CUSTOM, isPreset, MODES, PRESETS } from "@/lib/v2/cron";
import { V2Link } from "@/design/v2/parts";
import { Button, EmptyState, ErrorState, Skeleton } from "@/design/next/kit";
import { Icon } from "@/design/next/Icon";
import { Denied } from "@/design/next/more/states";
import { ConnectDetails } from "@/design/next/flows/ConnectDetails";
import { t } from "@/lib/v2/i18n";
import "./connect-native.css";

type Saved = { id: string; name: string };
type Schedule = { cron: string; mode: "full" | "delta" };
const steps = () => [t("Connect SAP"), t("Connect SuccessFactors"), t("Choose objects"), t("Choose policy packs"), t("Schedule runs"), t("Invite people")];
const ROLES = ["data_steward", "data_owner", "analyst", "viewer"];
const num = (n: number) => n.toLocaleString();
const Mark = ({ on }: { on: boolean }) => <span className="nx-cn-mark" aria-hidden="true">{on ? <Icon name="check" /> : null}</span>;

function Labelled({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (p: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode }) {
  const id = useId();
  const described = [hint ? `${id}-h` : "", error ? `${id}-e` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="nx-field">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": described, ...(error ? { "aria-invalid": true as const } : {}) })}
      {hint ? <span id={`${id}-h`} className="nx-note">{hint}</span> : null}
      {error ? <span id={`${id}-e`} className="nx-cd-err">{error}</span> : null}
    </div>
  );
}

/** A schedule's timetable and mode: a preset or a custom cron (checked as you type), and full or changes only. */
function ScheduleFields({ value, onChange, disabled }: { value: Schedule; onChange: (v: Schedule) => void; disabled?: boolean }) {
  const [custom, setCustom] = useState(() => !isPreset(value.cron));
  const error = custom && value.cron.trim() ? cronError(value.cron) : custom ? t("Enter five fields: minute, hour, day, month, weekday") : undefined;
  return (
    <>
      <Labelled label={t("Schedule")} hint={t("Times are UTC; a due run starts within 5 minutes.")}>
        {(p) => (
          <select {...p} className="nx-input" disabled={disabled} value={custom ? CUSTOM : value.cron}
            onChange={(e) => { if (e.target.value === CUSTOM) setCustom(true); else { setCustom(false); onChange({ ...value, cron: e.target.value }); } }}>
            {PRESETS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        )}
      </Labelled>
      {custom ? (
        <Labelled label={t("Cron expression")} error={error} hint={t("Minute hour day month weekday")}>
          {(p) => <input {...p} className="nx-input nx-cn-mono" disabled={disabled} value={value.cron} onChange={(e) => onChange({ ...value, cron: e.target.value })} placeholder="0 2 * * 1" />}
        </Labelled>
      ) : null}
      <Labelled label={t("Mode")} hint={t("Changes only reads the records SAP changed since the last download, with a full download at least once a week.")}>
        {(p) => (
          <select {...p} className="nx-input" disabled={disabled} value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value === "delta" ? "delta" : "full" })}>
            {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        )}
      </Labelled>
    </>
  );
}

function SavedLine({ name, onContinue }: { name: string; onContinue: () => void }) {
  return (
    <>
      <p className="nx-note" role="status" data-testid="setup-saved">{t("{name} is connected.", { name })}</p>
      <div className="nx-cn-acts"><Button variant="primary" onClick={onContinue}>{t("Continue")}</Button></div>
    </>
  );
}

/** First-run setup in the connect sheet: connect SAP (cloud) and SuccessFactors, pick objects and policy packs, schedule runs, invite people. */
export function ConnectCanvasNative() {
  const router = useRouter();
  const v2 = useV2Href();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<number[]>([]);
  const [sap, setSap] = useState<Saved | null>(null);
  const [sf, setSf] = useState<Saved | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [sched, setSched] = useState<Schedule>({ cron: "0 2 * * *", mode: "delta" });
  const [invites, setInvites] = useState<{ email: string; role: string }[]>([{ email: "", role: "data_steward" }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  // Per object: true once its schedule is saved, else the reason it failed. A retry sends only the rest.
  const [saved, setSaved] = useState<Record<string, true | string>>({});
  const { can } = useV2Session();
  const main = sap ?? sf;
  const objects = useSystemObjectList(main?.id ?? "", !!main);
  const packs = usePolicyPacks(step >= 3);

  const STEPS = steps();
  const advance = (to?: number) => {
    setDone((d) => (d.includes(step) ? d : [...d, step]));
    setErr(null);
    setStep(to ?? step + 1);
  };
  const fail = (e: unknown) => setErr(e instanceof Error ? e.message : t("Something went wrong. Try again."));
  const list = objects.data?.objects ?? [];
  const chosen = list.filter((o) => picked.includes(o.object));
  const tableCount = chosen.reduce((n, o) => n + o.tables.length, 0);
  const packList = packs.data?.packs ?? [];
  const appliedPacks = packList.filter((p) => p.applied);
  const toggle = (o: string) => setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));

  async function saveSchedule() {
    if (!main) return;
    setBusy(true);
    try {
      const todo = chosen.filter((o) => saved[o.object] !== true);
      const res = await Promise.allSettled(todo.map((o) => createProfile(main.id, { system_id: main.id, domain: o.object, tables: o.tables, schedule_cron: sched.cron, active: true, extraction_mode: sched.mode })));
      const after = { ...saved };
      res.forEach((r, i) => { after[todo[i].object] = r.status === "fulfilled" ? true : r.reason instanceof Error ? r.reason.message : t("Something went wrong. Try again."); });
      setSaved(after);
      const failed = todo.filter((o) => after[o.object] !== true).length;
      if (failed === 0) advance();
      else setErr(t("{failed} of {total} schedules could not be saved. Save again to retry only those.", { failed, total: chosen.length }));
    } finally { setBusy(false); }
  }
  async function sendInvites() {
    setBusy(true);
    try {
      for (const i of invites.filter((x) => x.email.trim())) await inviteUser({ email: i.email.trim(), grants: [{ role_key: i.role }] });
      setDone((d) => [...d, step]);
      setFinished(true);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function togglePack(id: string, applied: boolean) {
    try { await (applied ? unapplyPolicyPack(id) : applyPolicyPack(id)); await packs.refetch(); } catch (e) { fail(e); }
  }
  const next = (label: string, onClick: () => void, disabled?: boolean) => (
    <Button variant="primary" onClick={onClick} disabled={disabled || busy} loading={busy}>{label}</Button>
  );

  if (!can("manage_systems")) {
    return (
      <div className="nx-cn">
        <h2>{t("Set up Meridian")}</h2>
        <Denied what={t("Connecting a system")} />
      </div>
    );
  }

  let body: ReactNode;
  if (finished) {
    body = (
      <>
        <h2>{t("Setup complete")}</h2>
        <p className="nx-note">{t("The first run starts on the schedule you set. Open the system to start it now.")}</p>
        {main ? next(t("Open the system"), () => router.replace(v2(`/s/${main.id}?open=system:${main.id}`))) : null}
      </>
    );
  } else if (step === 0) {
    body = (
      <>
        <h2>{STEPS[0]}</h2>
        {sap ? <SavedLine name={sap.name} onContinue={() => advance()} /> : (
          <>
            <ConnectDetails initialType="ecc" onSaved={(s) => { setSap(s); advance(); }} />
            <div className="nx-cn-acts"><Button variant="secondary" onClick={() => advance()}>{t("I only use SuccessFactors")}</Button></div>
          </>
        )}
      </>
    );
  } else if (step === 1) {
    body = (
      <>
        <h2>{STEPS[1]}</h2>
        <p className="nx-note">{sap ? t("Optional. The form is set to SuccessFactors.") : t("The form is set to SuccessFactors.")}</p>
        {sf ? <SavedLine name={sf.name} onContinue={() => advance()} /> : (
          <>
            <ConnectDetails initialType="successfactors" onSaved={(s) => { setSf(s); advance(); }} />
            {sap ? <div className="nx-cn-acts">{next(t("Skip for now"), () => advance())}</div> : null}
          </>
        )}
      </>
    );
  } else if (step === 2) {
    body = (
      <>
        <h2>{STEPS[2]}</h2>
        {!main ? (
          <EmptyState heading={t("Connect a system first, then choose its objects.")} action={<Button variant="secondary" onClick={() => setStep(0)}>{t("Back to the connect step")}</Button>} />
        ) : objects.isError ? (
          <ErrorState sentence={t("The objects of this system could not be read.")} error={objects.error} onRetry={() => void objects.refetch()} />
        ) : objects.isLoading ? (
          <Skeleton lines={4} label={t("Reading the objects the system offers")} />
        ) : list.length === 0 ? (
          <EmptyState heading={t("This system offers no objects to choose yet. You can add them later from the system.")} />
        ) : null}
        <ul className="nx-cn-list">
          {list.map((o) => (
            <li key={o.object}>
              <button type="button" role="checkbox" aria-checked={picked.includes(o.object)} className="nx-cn-ck" disabled={o.licensed === false} onClick={() => toggle(o.object)}>
                <Mark on={picked.includes(o.object)} />
                <span className="nx-cn-name">{o.object}</span>
                <span className="nx-cn-meta">{o.licensed === false ? t("Not in your licence") : `${num(o.tables.length)} ${t("tables")}`}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="nx-cn-acts">
          {next(t("Continue"), () => advance(), picked.length === 0)}
          {main && !objects.isLoading && list.length === 0 ? <Button variant="secondary" onClick={() => advance(5)}>{t("Skip to invitations")}</Button> : null}
        </div>
      </>
    );
  } else if (step === 3) {
    body = (
      <>
        <h2>{STEPS[3]}</h2>
        {packs.isError ? (
          <ErrorState sentence={t("The policy packs could not be read.")} error={packs.error} onRetry={() => void packs.refetch()} />
        ) : packs.isLoading ? (
          <Skeleton lines={3} />
        ) : packList.length === 0 ? (
          <EmptyState heading={t("No policy pack is available. You can continue without one.")} />
        ) : null}
        <ul className="nx-cn-list">
          {packList.map((p) => (
            <li key={p.id}>
              <button type="button" role="checkbox" aria-checked={p.applied} className="nx-cn-ck" onClick={() => void togglePack(p.id, p.applied)}>
                <Mark on={p.applied} />
                <span className="nx-cn-name">{p.name}</span>
                <span className="nx-cn-meta">{p.authority}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="nx-cn-acts">{next(t("Continue"), () => advance())}</div>
      </>
    );
  } else if (step === 4) {
    body = (
      <>
        <h2>{STEPS[4]}</h2>
        <ScheduleFields value={sched} onChange={setSched} disabled={busy} />
        {Object.keys(saved).length > 0 ? (
          <ul className="nx-cn-list" aria-label={t("Schedules")}>
            {chosen.map((o) => (
              <li key={o.object} data-testid={`setup-sched-${o.object}`} className="nx-cn-ck">
                <span className="nx-cn-name">{o.object}</span>
                <span className="nx-cn-meta">{saved[o.object] === true ? t("Saved") : saved[o.object] ?? t("Not saved yet")}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="nx-cn-acts">{next(t("Save schedule"), () => void saveSchedule(), !!cronError(sched.cron))}</div>
      </>
    );
  } else {
    body = (
      <>
        <h2>{STEPS[5]}</h2>
        {!can("manage_users") ? (
          <>
            <p className="nx-note">{t("Inviting people needs the manage users permission. An administrator can invite them later.")}</p>
            <div className="nx-cn-acts">{next(t("Finish setup"), () => { setDone((d) => [...d, step]); setFinished(true); })}</div>
          </>
        ) : (
          <>
            {invites.map((inv, i) => (
              <div key={i} className="nx-cn-inv">
                <input type="email" className="nx-input" aria-label={t("Email")} value={inv.email} onChange={(e) => setInvites((a) => a.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                <select className="nx-input" aria-label={t("Role")} value={inv.role} onChange={(e) => setInvites((a) => a.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_NAMES[r] ?? r}</option>)}
                </select>
              </div>
            ))}
            <div className="nx-cn-acts">
              <Button variant="secondary" onClick={() => setInvites((a) => [...a, { email: "", role: "viewer" }])}>{t("Add another")}</Button>
              {next(t("Finish setup"), () => void sendInvites())}
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <div className="nx-cn">
      <h2>{t("Set up Meridian")}</h2>
      <p className="nx-note">
        {t("Setup only reads from SAP. Nothing is written to SAP until an approved batch is sent.")} <V2Link href="/">{t("Back to the landscape")}</V2Link>
      </p>
      <div className="nx-cn-grid">
        <nav aria-label={t("Setup steps")} className="nx-cn-rail">
          <ol>
            {STEPS.map((s, i) => (
              <li key={s}>
                <button type="button" className="nx-cn-step" aria-current={i === step ? "step" : undefined} disabled={i > step && !done.includes(i - 1)} onClick={() => setStep(i)}>
                  <Mark on={done.includes(i)} />
                  {s}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <section className="nx-cn-main" aria-live="polite">
          {body}
          {err ? <p role="alert" className="nx-cd-err">{err}</p> : null}
        </section>
        <aside className="nx-cn-prev" aria-label={t("What the first run will do")}>
          <h3>{t("What the first run will do")}</h3>
          <dl>
            <dt>{t("Systems")}</dt><dd>{num(+!!sap + +!!sf)}</dd>
            <dt>{t("Objects")}</dt><dd>{num(chosen.length)}</dd>
            <dt>{t("Tables")}</dt><dd>{num(tableCount)}</dd>
            <dt>{t("Policy packs applied")}</dt><dd>{num(appliedPacks.length)}</dd>
          </dl>
        </aside>
      </div>
    </div>
  );
}
