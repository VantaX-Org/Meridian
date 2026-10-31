"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useV2Href } from "@/lib/v2/hooks";
import { useSystemObjectList } from "@/lib/v2/runs-queries";
import { usePolicyPacks } from "@/lib/v2/step10-queries";
import { applyPolicyPack, unapplyPolicyPack } from "@/lib/api/v2/step10";
import { createProfile } from "@/lib/api/v2/sys";
import { inviteUser } from "@/lib/api/v2/admin";
import { ROLE_NAMES } from "@/lib/v2/view-as";
import { PageTitle, V2Link } from "../../parts";
import { ConnectionForm } from "./ConnectionForm";
import { ScheduleFields, type ScheduleValue } from "./ScheduleFields";
import { cronError } from "@/lib/v2/cron";
import { t } from "@/lib/v2/i18n";

type Saved = { id: string; name: string };
const steps = () => [t("Connect SAP"), t("Connect SuccessFactors"), t("Choose objects"), t("Choose policy packs"), t("Schedule runs"), t("Invite people")];
const ROLES = ["data_steward", "data_owner", "analyst", "viewer"];
const num = (n: number) => n.toLocaleString();

/** `/s/new`: first-run setup. Connect SAP, optionally SuccessFactors, pick objects and policy packs, schedule runs, invite people. */
export function ConnectCanvas() {
  const router = useRouter();
  const v2 = useV2Href();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<number[]>([]);
  const [sap, setSap] = useState<Saved | null>(null);
  const [sf, setSf] = useState<Saved | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [sched, setSched] = useState<ScheduleValue>({ cron: "0 2 * * *", mode: "delta" });
  const [invites, setInvites] = useState<{ email: string; role: string }[]>([{ email: "", role: "data_steward" }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const objects = useSystemObjectList(sap?.id ?? "", !!sap);
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
  const appliedPacks = (packs.data?.packs ?? []).filter((p) => p.applied);
  const toggle = (o: string) => setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));

  async function saveSchedule() {
    if (!sap) return;
    setBusy(true);
    try {
      for (const o of chosen) await createProfile(sap.id, { system_id: sap.id, domain: o.object, tables: o.tables, schedule_cron: sched.cron, active: true, extraction_mode: sched.mode });
      advance();
    } catch (e) { fail(e); } finally { setBusy(false); }
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
    <button type="button" className="m2-btn m2-next" onClick={onClick} disabled={disabled || busy}>{label}</button>
  );

  return (
    <>
      <PageTitle>{t("Set up Meridian")}</PageTitle>
      <p className="m2-note">
        {t("Setup only reads from SAP. Nothing is written to SAP until an approved batch is sent.")} <V2Link href="/">{t("Back to the landscape")}</V2Link>
      </p>
      <div className="m2-setup">
        <nav aria-label={t("Setup steps")} className="m2-setup-rail">
          <ol>
            {STEPS.map((s, i) => (
              <li key={s}>
                <button type="button" className="m2-setup-step" aria-current={i === step ? "step" : undefined} disabled={i > step && !done.includes(i - 1)} onClick={() => setStep(i)}>
                  <span className="m2-setup-mark" aria-hidden="true">{done.includes(i) ? "✓" : ""}</span>
                  {s}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <section className="m2-setup-main" aria-live="polite">
          {finished ? (
            <>
              <h2>{t("Setup complete")}</h2>
              <p className="m2-note">{t("The first run starts on the schedule you set. Open the system to start it now.")}</p>
              {sap ? next(t("Open the system"), () => router.replace(v2(`/s/${sap.id}?open=system:${sap.id}`))) : null}
            </>
          ) : step === 0 ? (
            <>
              <h2>{STEPS[0]}</h2>
              <ConnectionForm onSaved={(s) => { setSap(s); advance(); }} />
            </>
          ) : step === 1 ? (
            <>
              <h2>{STEPS[1]}</h2>
              <p className="m2-note">{t("Optional. Choose SuccessFactors as the system type.")}</p>
              <ConnectionForm onSaved={(s) => { setSf(s); advance(); }} />
              <div className="m2-setup-acts">{next(t("Skip for now"), () => advance())}</div>
            </>
          ) : step === 2 ? (
            <>
              <h2>{STEPS[2]}</h2>
              {objects.isLoading ? <p className="m2-note">{t("Reading the objects the system offers")}</p> : null}
              <ul className="m2-setup-list">
                {list.map((o) => (
                  <li key={o.object}>
                    <button type="button" role="checkbox" aria-checked={picked.includes(o.object)} className="m2-setup-ck" onClick={() => toggle(o.object)}>
                      <span className="m2-setup-mark" aria-hidden="true">{picked.includes(o.object) ? "✓" : ""}</span>
                      <span>{o.object}</span>
                      <span className="m2-setup-meta">{num(o.tables.length)} {t("tables")}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="m2-setup-acts">{next(t("Continue"), () => advance(), picked.length === 0)}</div>
            </>
          ) : step === 3 ? (
            <>
              <h2>{STEPS[3]}</h2>
              <ul className="m2-setup-list">
                {(packs.data?.packs ?? []).map((p) => (
                  <li key={p.id}>
                    <button type="button" role="checkbox" aria-checked={p.applied} className="m2-setup-ck" onClick={() => togglePack(p.id, p.applied)}>
                      <span className="m2-setup-mark" aria-hidden="true">{p.applied ? "✓" : ""}</span>
                      <span>{p.name}</span>
                      <span className="m2-setup-meta">{p.authority}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="m2-setup-acts">{next(t("Continue"), () => advance())}</div>
            </>
          ) : step === 4 ? (
            <>
              <h2>{STEPS[4]}</h2>
              <ScheduleFields value={sched} onChange={setSched} disabled={busy} />
              <div className="m2-setup-acts">{next(t("Save schedule"), saveSchedule, !!cronError(sched.cron))}</div>
            </>
          ) : (
            <>
              <h2>{STEPS[5]}</h2>
              {invites.map((inv, i) => (
                <div key={i} className="m2-setup-inv">
                  <input type="email" aria-label={t("Email")} value={inv.email} onChange={(e) => setInvites((a) => a.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                  <select aria-label={t("Role")} value={inv.role} onChange={(e) => setInvites((a) => a.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_NAMES[r] ?? r}</option>)}
                  </select>
                </div>
              ))}
              <div className="m2-setup-acts">
                <button type="button" className="m2-btn" onClick={() => setInvites((a) => [...a, { email: "", role: "viewer" }])}>{t("Add another")}</button>
                {next(t("Finish setup"), sendInvites)}
              </div>
            </>
          )}
          {err ? <p role="alert" className="m2-setup-err">{err}</p> : null}
        </section>
        <aside className="m2-setup-prev" aria-label={t("What the first run will do")}>
          <h2>{t("What the first run will do")}</h2>
          <dl>
            <dt>{t("Systems")}</dt><dd>{num(+!!sap + +!!sf)}</dd>
            <dt>{t("Objects")}</dt><dd>{num(chosen.length)}</dd>
            <dt>{t("Tables")}</dt><dd>{num(tableCount)}</dd>
            <dt>{t("Policy packs applied")}</dt><dd>{num(appliedPacks.length)}</dd>
          </dl>
        </aside>
      </div>
    </>
  );
}
