"use client";

import { SandboxBlock } from "./sandbox";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CostModel, DimensionScores, PlannerConfig } from "@/types/api";
import type { RetentionPolicy, RetentionPreviewItem, RetentionResponse, TenantPurgeRequest } from "@/lib/api/retention";
import type { ScoringConfig, ScoringResponse } from "@/lib/api/settings";
import * as api from "@/lib/api/v2/admin";
import { formatDate, formatModuleName } from "@/lib/format";
import { refreshAdmin, useCostModel, usePurgeLog, useRetention, useScoring, useTenantSettings } from "@/lib/v2/admin-queries";
import { fixed } from "@/lib/v2/format";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { AdminPage, Block, Confirm, Fld, Kv, Loaded, NeedsPermission, Note, Sw, useCan, useDone } from "./kit";
import { AppearanceBlock, ComplianceBlock } from "./enterprise";
import { t as tr } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";

const DIMS = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"] as const;
const DAMA: DimensionScores = { completeness: 0.25, accuracy: 0.25, consistency: 0.2, timeliness: 0.1, uniqueness: 0.1, validity: 0.1 };

/** The API returns dimension weights normalised to 1. */
function fractions(stored: DimensionScores | null | undefined): DimensionScores {
  const total = stored ? DIMS.reduce((a, d) => a + (Number(stored[d]) || 0), 0) : 0;
  if (!stored || total <= 0) return DAMA;
  const out = { ...stored };
  DIMS.forEach((d) => (out[d] = (Number(stored[d]) || 0) / total));
  return out;
}

/** The PUT takes weights that sum to 100: each rounded to two places, the residue to the largest. */
export function toPercent(f: DimensionScores): DimensionScores {
  const out = { ...f };
  DIMS.forEach((d) => (out[d] = Math.round(f[d] * 10000) / 100));
  const residue = Math.round((100 - DIMS.reduce((a, d) => a + out[d], 0)) * 100) / 100;
  const largest = DIMS.reduce((m, d) => (out[d] > out[m] ? d : m), DIMS[0]);
  out[largest] = Math.round((out[largest] + residue) * 100) / 100;
  return out;
}

const num = (s: string): number => (s.trim() === "" ? Number.NaN : Number(s));
const okNum = (s: string, min = 0, max = Number.POSITIVE_INFINITY): boolean => Number.isFinite(num(s)) && num(s) >= min && num(s) <= max;

/* ── Scoring ── */

function ScoringBlock({ s }: { s: ScoringResponse }) {
  const qc = useQueryClient();
  const done = useDone();
  const { outcome, pending, run } = useOutcome("set-scoring");
  const pct = toPercent(fractions(s.dimension_weights));
  const [w, setW] = useState<Record<string, string>>(() => Object.fromEntries(DIMS.map((d) => [d, String(pct[d])])));
  const [bands, setBands] = useState({ target: String(s.thresholds.target), warning: String(s.thresholds.warning), critical: String(s.thresholds.critical) });
  const [tol, setTol] = useState({ pct: String(s.critical_tolerance.pct ?? 0.1), rows: String(s.critical_tolerance.rows ?? 25) });
  const [sev, setSev] = useState(() => Object.fromEntries(Object.keys(s.severity_weights).map((k) => [k, { weight: String(s.severity_weights[k]), mult: String(s.severity_multipliers[k] ?? 1) }])));
  const sum = Math.round(DIMS.reduce((a, d) => a + (num(w[d]) || 0), 0) * 100) / 100;
  const weightsOk = DIMS.every((d) => okNum(w[d], 0, 100)) && Math.abs(sum - 100) < 0.01;
  const bandsOk = [bands.target, bands.warning, bands.critical].every((v) => okNum(v, 0, 100)) && num(bands.critical) <= num(bands.warning) && num(bands.warning) <= num(bands.target);
  const tolOk = okNum(tol.pct, 0, 100) && okNum(tol.rows, 0);
  const sevOk = Object.values(sev).every((v) => okNum(v.weight, 0.0001) && okNum(v.mult, 1));
  const before: ScoringConfig = { dimension_weights: s.dimension_weights, module_weights: s.module_weights, thresholds: s.thresholds, severity_weights: s.severity_weights, severity_multipliers: s.severity_multipliers, critical_tolerance: s.critical_tolerance };
  const save = (key: string, title: string, patch: Partial<ScoringConfig>, restore: Partial<ScoringConfig>) =>
    void run(key, async () => {
      await api.putScoring({ ...before, ...patch });
      await refreshAdmin(qc, "settings");
      done(tr("{title}. They apply from the next analysis run", { title }), async () => {
        await api.putScoring({ ...before, ...restore });
        await refreshAdmin(qc, "settings");
      });
      return { tone: "ok", title, detail: tr("Earlier runs keep the scoring they were scored under.") };
    });
  return (
    <>
      <Block title={tr("Dimension weights")} hint={tr("The score is each measured dimension times its weight. The weights must add up to 100.")}>
        <div className="m2-fgrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          {DIMS.map((d) => (
            <Fld key={d} label={tr("{labelText} weight, percent", { labelText: labelText(d) })} error={okNum(w[d], 0, 100) ? null : tr("0 to 100")}>
              <input type="number" min={0} max={100} step={1} value={w[d]} onChange={(e) => setW({ ...w, [d]: e.target.value })} />
            </Fld>
          ))}
        </div>
        <p className="m2-prov" role="status">{weightsOk ? tr("The weights add up to 100.") : tr("The weights add up to {sum}. Adjust them to 100 to save.", { sum: fixed(sum, 1) })}</p>
        <div className="m2-adm-acts" style={{ marginTop: 8 }}>
          <button type="button" className="m2-btn" disabled={!weightsOk || pending !== null} onClick={() => save("weights", tr("Weights saved"), { dimension_weights: Object.fromEntries(DIMS.map((d) => [d, num(w[d])])) as unknown as DimensionScores }, { dimension_weights: s.dimension_weights })}>
            {pending === "weights" ? tr("Saving…") : tr("Save weights")}
          </button>
          <button type="button" className="m2-btn m2-ghost" onClick={() => setW(Object.fromEntries(DIMS.map((d) => [d, String(toPercent(DAMA)[d])])))}>
            {tr("Use the DAMA defaults")}
          </button>
        </div>
      </Block>
      <Block title={tr("Score bands")} hint={tr("At or above target is on target (go), at or above warning is at risk, below that is failing. Critical marks the line below which an object is failing badly.")}>
        <div className="m2-fgrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          {(["target", "warning", "critical"] as const).map((k) => (
            <Fld key={k} label={labelText(k)}>
              <input type="number" min={0} max={100} value={bands[k]} onChange={(e) => setBands({ ...bands, [k]: e.target.value })} />
            </Fld>
          ))}
        </div>
        {!bandsOk ? <p className="m2-prov" role="alert">{tr("Critical must not exceed warning, and warning must not exceed target.")}</p> : null}
        <div className="m2-adm-acts" style={{ marginTop: 8 }}>
          <button type="button" className="m2-btn" disabled={!bandsOk || pending !== null} onClick={() => save("bands", tr("Score bands saved"), { thresholds: { target: num(bands.target), warning: num(bands.warning), critical: num(bands.critical) } }, { thresholds: s.thresholds })}>
            {pending === "bands" ? tr("Saving…") : tr("Save bands")}
          </button>
          <button type="button" className="m2-btn m2-ghost" onClick={() => setBands({ target: String(s.defaults.thresholds.target), warning: String(s.defaults.thresholds.warning), critical: String(s.defaults.thresholds.critical) })}>
            {tr("Use the default bands")}
          </button>
        </div>
      </Block>
      <Block title={tr("Cap rule and tolerance")} hint={tr("One critical rule failing beyond its tolerance holds that object at 85; two or more hold it at 70. The caps are fixed. The tolerance says how many failing records count as beyond.")}>
        <div className="m2-fgrid">
          <Fld label={tr("Failing share, percent")} hint={tr("At or above this share of the records checked.")} error={okNum(tol.pct, 0, 100) ? null : tr("0 to 100")}>
            <input type="number" min={0} max={100} step={0.05} value={tol.pct} onChange={(e) => setTol({ ...tol, pct: e.target.value })} />
          </Fld>
          <Fld label={tr("Failing records")} hint={tr("Or at or above this count, when it is the lower bar.")} error={okNum(tol.rows, 0) ? null : tr("0 or more")}>
            <input type="number" min={0} step={1} value={tol.rows} onChange={(e) => setTol({ ...tol, rows: e.target.value })} />
          </Fld>
        </div>
        <div className="m2-frame" tabIndex={0} style={{ marginTop: 12, maxWidth: 520 }}>
          <table className="m2-tbl" aria-label={tr("Severity weights")}>
            <thead>
              <tr>
                <th scope="col">{tr("Severity")}</th>
                <th scope="col">{tr("Rule weight")}</th>
                <th scope="col">{tr("Failure multiplier")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(sev).map((k) => (
                <tr key={k}>
                  <th scope="row">{labelText(k)}</th>
                  <td>
                    <input className="m2-inp" type="number" min={0} step={0.5} aria-label={tr("{k} rule weight", { k: labelText(k) })} value={sev[k].weight} onChange={(e) => setSev({ ...sev, [k]: { ...sev[k], weight: e.target.value } })} />
                  </td>
                  <td>
                    <input className="m2-inp" type="number" min={1} step={0.5} aria-label={tr("{k} failure multiplier", { k: labelText(k) })} value={sev[k].mult} onChange={(e) => setSev({ ...sev, [k]: { ...sev[k], mult: e.target.value } })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="m2-adm-acts" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="m2-btn"
            disabled={!tolOk || !sevOk || pending !== null}
            onClick={() =>
              save(
                "tolerance",
                tr("Tolerance saved"),
                { critical_tolerance: { pct: num(tol.pct), rows: num(tol.rows) }, severity_weights: Object.fromEntries(Object.entries(sev).map(([k, v]) => [k, num(v.weight)])), severity_multipliers: Object.fromEntries(Object.entries(sev).map(([k, v]) => [k, num(v.mult)])) },
                { critical_tolerance: s.critical_tolerance, severity_weights: s.severity_weights, severity_multipliers: s.severity_multipliers },
              )
            }
          >
            {pending === "tolerance" ? tr("Saving…") : tr("Save tolerance")}
          </button>
        </div>
      </Block>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </>
  );
}

/* ── Cost model and planner ── */

function CostBlock({ model }: { model: CostModel }) {
  const qc = useQueryClient();
  const fixture = useFixture();
  const features = useQuery({ queryKey: ["v2", "admin", fixture, "settings", "cost-features"], queryFn: api.getCostFeatures, staleTime: 300_000, retry: false });
  const { outcome, pending, run } = useOutcome("set-cost");
  const [currency, setCurrency] = useState(model.currency ?? "");
  const [sub, setSub] = useState(model.subscription_monthly != null ? String(model.subscription_monthly) : "");
  const [sev, setSev] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(model.severity ?? {}).filter(([, v]) => !v.field).map(([k, v]) => [k, String(v.per_record ?? 0)])));
  const [feat, setFeat] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(model.features ?? {}).map(([k, v]) => [k, String(v)])));
  const [impact, setImpact] = useState(() => Object.fromEntries(Object.entries(model.impact ?? {}).map(([k, c]) => [k, { unit: String(c.unit_cost ?? 0), factor: String(c.factor ?? 1), mit: String(Math.round((c.mitigation ?? 0) * 1000) / 10) }])));
  const [align, setAlign] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(model.config_alignment ?? {}).map(([k, v]) => [k, String(v)])));
  const [addFeature, setAddFeature] = useState("");
  const valid =
    /^[A-Z]{3}$/.test(currency) &&
    (sub.trim() === "" || okNum(sub)) &&
    Object.values(sev).every((v) => okNum(v)) &&
    Object.values(feat).every((v) => okNum(v)) &&
    Object.values(impact).every((c) => okNum(c.unit) && okNum(c.factor) && okNum(c.mit, 0, 100)) &&
    Object.values(align).every((v) => okNum(v));
  const unpriced = (features.data ?? []).map((f) => f.feature).filter((f) => !(f in feat));
  const save = () =>
    void run("cost", async () => {
      const next: CostModel = {
        ...model,
        currency,
        subscription_monthly: sub.trim() === "" ? null : num(sub),
        severity: { ...model.severity, ...Object.fromEntries(Object.entries(sev).map(([k, v]) => [k, { ...model.severity[k], per_record: num(v) }])) },
        features: Object.fromEntries(Object.entries(feat).map(([k, v]) => [k, num(v)])),
        impact: Object.fromEntries(Object.entries(impact).map(([k, c]) => [k, { unit_cost: num(c.unit), factor: num(c.factor), mitigation: Math.round(num(c.mit) * 10) / 1000 }])),
        config_alignment: Object.fromEntries(Object.entries(align).map(([k, v]) => [k, num(v)])),
      };
      await api.putCostModel(next);
      await refreshAdmin(qc, "settings");
      return { tone: "ok", title: tr("Cost model saved"), detail: tr("It applies from the next analysis or re-analysis.") };
    });
  return (
    <Block title={tr("Cost model and currency")} hint={tr("What a defect costs, in one currency: every value at risk, ROI and planner figure is in it.")}>
      <div className="m2-fgrid">
        <Fld label={tr("Currency")} hint={tr("Three-letter ISO 4217 code, such as ZAR, EUR or USD.")} error={/^[A-Z]{3}$/.test(currency) ? null : tr("Use three capital letters")}>
          <input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </Fld>
        <Fld label={tr("Monthly subscription")} hint={tr("What the ROI divides by. Empty means no ROI multiple.")} error={sub.trim() === "" || okNum(sub) ? null : tr("0 or more, or empty")}>
          <input type="number" min={0} value={sub} onChange={(e) => setSub(e.target.value)} />
        </Fld>
      </div>
      <h3 className="m2-h2" style={{ margin: "16px 0 4px" }}>{tr("Cost of one blocked record, by severity")}</h3>
      <div className="m2-fgrid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        {Object.keys(sev).map((k) => (
          <Fld key={k} label={tr("{k} finding cost", { k: labelText(k) })}>
            <input type="number" min={0} value={sev[k]} onChange={(e) => setSev({ ...sev, [k]: e.target.value })} />
          </Fld>
        ))}
      </div>
      <h3 className="m2-h2" style={{ margin: "16px 0 4px" }}>{tr("Value of one blocked record, by SAP feature")}</h3>
      <div className="m2-frame" tabIndex={0} style={{ maxWidth: 520 }}>
        <table className="m2-tbl" aria-label={tr("Value per blocked record by SAP feature")}>
          <thead>
            <tr>
              <th scope="col">{tr("SAP feature")}</th>
              <th scope="col">{tr("Value per record")}</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {Object.keys(feat).length === 0 ? (
              <tr>
                <td colSpan={3} className="m2-meta">{tr("No feature has a value yet")}</td>
              </tr>
            ) : (
              Object.keys(feat).sort().map((f) => (
                <tr key={f}>
                  <th scope="row">{f}</th>
                  <td>
                    <input className="m2-inp" type="number" min={0} aria-label={tr("{f} value per record", { f })} value={feat[f]} onChange={(e) => setFeat({ ...feat, [f]: e.target.value })} />
                  </td>
                  <td className="m2-r">
                    <button type="button" className="m2-btn m2-sm m2-ghost" onClick={() => setFeat(Object.fromEntries(Object.entries(feat).filter(([k]) => k !== f)))}>
                      {tr("Remove")}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {unpriced.length ? (
        <div className="m2-fbar" style={{ marginTop: 8 }}>
          <Fld label={tr("Add a value for")}>
            <select value={addFeature} onChange={(e) => setAddFeature(e.target.value)}>
              <option value="">{tr("Pick an SAP feature")}</option>
              {unpriced.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Fld>
          <button type="button" className="m2-btn" disabled={!addFeature} onClick={() => (setFeat({ ...feat, [addFeature]: "0" }), setAddFeature(""))}>
            {tr("Add")}
          </button>
        </div>
      ) : null}
      {Object.keys(impact).length ? (
        <>
          <h3 className="m2-h2" style={{ margin: "16px 0 4px" }}>{tr("Business-impact defects")}</h3>
          <div className="m2-frame" tabIndex={0}>
            <table className="m2-tbl" aria-label={tr("Business impact defects")}>
              <thead>
                <tr>
                  <th scope="col">{tr("Defect")}</th>
                  <th scope="col">{tr("Unit cost")}</th>
                  <th scope="col">{tr("Factor")}</th>
                  <th scope="col">{tr("Mitigation, percent")}</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(impact).map((k) => (
                  <tr key={k}>
                    <th scope="row">{labelText(k)}</th>
                    {(["unit", "factor", "mit"] as const).map((f) => (
                      <td key={f}>
                        <input className="m2-inp" type="number" min={0} aria-label={`${labelText(k)} ${f === "unit" ? tr("unit cost") : f === "factor" ? "factor" : "mitigation"}`} value={impact[k][f]} onChange={(e) => setImpact({ ...impact, [k]: { ...impact[k], [f]: e.target.value } })} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {Object.keys(align).length ? (
        <>
          <h3 className="m2-h2" style={{ margin: "16px 0 4px" }}>{tr("Configuration findings")}</h3>
          <div className="m2-fgrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            {Object.keys(align).map((k) => (
              <Fld key={k} label={tr("{k}, per unit", { k: labelText(k) })}>
                <input type="number" min={0} value={align[k]} onChange={(e) => setAlign({ ...align, [k]: e.target.value })} />
              </Fld>
            ))}
          </div>
        </>
      ) : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div className="m2-adm-acts">
        <button type="button" className="m2-btn" disabled={!valid || pending !== null} onClick={save}>
          {pending === "cost" ? tr("Saving…") : tr("Save cost model")}
        </button>
      </div>
    </Block>
  );
}

function PlannerBlock({ initial, currency }: { initial: PlannerConfig; currency: string | undefined }) {
  const qc = useQueryClient();
  const { outcome, pending, run } = useOutcome("set-planner");
  const [p, setP] = useState<Record<string, string>>(() => ({
    minutes_per_record: String(initial.minutes_per_record),
    investigation_hours: String(initial.investigation_hours),
    exception_hours: String(initial.exception_hours),
    sprint_hours: String(initial.sprint_hours),
    cost_per_record: initial.cost_per_record == null ? "" : String(initial.cost_per_record),
  }));
  const valid = ["minutes_per_record", "investigation_hours", "exception_hours"].every((k) => okNum(p[k])) && okNum(p.sprint_hours, 1) && (p.cost_per_record === "" || okNum(p.cost_per_record));
  const field = (k: string, label: string, min = 0) => (
    <Fld label={label}>
      <input type="number" min={min} step="any" value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} />
    </Fld>
  );
  return (
    <Block title={tr("Planner assumptions")} hint={tr("The next-sprint planner ranks open work by severity-weighted records per hour. Money appears only when you state what one failing record costs you.")}>
      <div className="m2-fgrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        {field("minutes_per_record", tr("Minutes per record"))}
        {field("investigation_hours", tr("Hours per finding"))}
        {field("exception_hours", tr("Hours per exception"))}
        {field("sprint_hours", tr("Sprint capacity, hours"), 1)}
        <Fld label={currency ? tr("Cost per failing record ({currency})", { currency }) : tr("Cost per failing record")}>
          <input type="number" min={0} value={p.cost_per_record} placeholder={tr("Not set")} onChange={(e) => setP({ ...p, cost_per_record: e.target.value })} />
        </Fld>
      </div>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div className="m2-adm-acts">
        <button
          type="button"
          className="m2-btn"
          disabled={!valid || pending !== null}
          onClick={() =>
            void run("planner", async () => {
              await api.savePlanner({ ...initial, minutes_per_record: num(p.minutes_per_record), investigation_hours: num(p.investigation_hours), exception_hours: num(p.exception_hours), sprint_hours: num(p.sprint_hours), cost_per_record: p.cost_per_record === "" ? null : num(p.cost_per_record) });
              await refreshAdmin(qc, "settings");
              return { tone: "ok", title: tr("Planner assumptions saved") };
            })
          }
        >
          {pending === "planner" ? tr("Saving…") : tr("Save assumptions")}
        </button>
      </div>
    </Block>
  );
}

/* ── Retention ── */

const dayField = (v: number | null) => (v === null ? "" : String(v));
const daysOf = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const bytes = (n: number): string => (n >= 1e9 ? `${fixed(n / 1e9, 1)} GB` : n >= 1e6 ? `${fixed(n / 1e6, 1)} MB` : `${fixed(n / 1e3, 0)} kB`);
const rowsText = (r: Record<string, number | string[]>): string => Object.entries(r).map(([t, n]) => `${t}: ${Array.isArray(n) ? n.join(", ") : n}`).join("; ");

function RetentionBlock({ data }: { data: RetentionResponse }) {
  const qc = useQueryClient();
  const done = useDone();
  const log = usePurgeLog();
  const { outcome, pending, run } = useOutcome("set-retention");
  const [f, setF] = useState({ versions: dayField(data.policy.versions_days), reports: dayField(data.policy.reports_days), audit: dayField(data.policy.audit_days), keep: String(data.policy.keep_latest_per_system), baseline: data.policy.keep_baseline });
  const [items, setItems] = useState<RetentionPreviewItem[] | null>(null);
  const [purging, setPurging] = useState<RetentionPreviewItem | null>(null);
  const days = (s: string) => s.trim() === "" || (Number.isInteger(Number(s)) && Number(s) >= 1);
  const valid = days(f.versions) && days(f.reports) && days(f.audit) && Number.isInteger(Number(f.keep)) && Number(f.keep) >= 0;
  const policy = (): RetentionPolicy => ({ versions_days: daysOf(f.versions), reports_days: daysOf(f.reports), audit_days: daysOf(f.audit), keep_baseline: f.baseline, keep_latest_per_system: Number(f.keep) });
  const e = data.enforcement;
  return (
    <Block title={tr("Retention")} hint={tr("How long runs, reports and audit rows are kept. Archived runs past the limit are purged for good by the nightly task. Empty means for ever.")}>
      <div className="m2-fgrid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        <Fld label={tr("Keep runs, days")} error={days(f.versions) ? null : tr("A whole number of days")}>
          <input type="number" min={1} value={f.versions} onChange={(ev) => setF({ ...f, versions: ev.target.value })} />
        </Fld>
        <Fld label={tr("Keep reports, days")} error={days(f.reports) ? null : tr("A whole number of days")}>
          <input type="number" min={1} value={f.reports} onChange={(ev) => setF({ ...f, reports: ev.target.value })} />
        </Fld>
        <Fld label={tr("Keep audit rows, days")} error={days(f.audit) ? null : tr("A whole number of days")}>
          <input type="number" min={1} value={f.audit} onChange={(ev) => setF({ ...f, audit: ev.target.value })} />
        </Fld>
        <Fld label={tr("Latest runs kept per system")}>
          <input type="number" min={0} value={f.keep} onChange={(ev) => setF({ ...f, keep: ev.target.value })} />
        </Fld>
      </div>
      <div style={{ marginTop: 12 }}>
        <Sw checked={f.baseline} onChange={(v) => setF({ ...f, baseline: v })} label={tr("Keep the baseline run")} />
      </div>
      <p className="m2-prov">{e.enforced ? tr("Purges run for real each night under this policy.") : tr("Purges are in rehearsal: the nightly task only logs what it would delete{value}{value2}.", { value: e.dry_run_until ? tr(" until {dry_run_until}", { dry_run_until: formatDate(e.dry_run_until) }) : "", value2: e.flag_enabled ? "" : tr(", and deletion is switched off on this deployment") })}</p>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div className="m2-adm-acts">
        <button
          type="button"
          className="m2-btn"
          disabled={!valid || pending !== null}
          onClick={() =>
            void run("retention", async () => {
              const prev = data.policy;
              await api.putRetention(policy());
              await refreshAdmin(qc, "settings");
              done(tr("Retention policy saved"), async () => {
                await api.putRetention(prev);
                await refreshAdmin(qc, "settings");
              });
              return { tone: "ok", title: tr("Retention policy saved"), detail: tr("The rehearsal window restarts under the new policy.") };
            })
          }
        >
          {pending === "retention" ? tr("Saving…") : tr("Save policy")}
        </button>
        <button
          type="button"
          className="m2-btn"
          disabled={!valid || pending !== null}
          onClick={() =>
            void run("preview", async () => {
              const r = await api.previewRetentionDraft(policy());
              setItems(r);
              return { tone: "info", title: r.length ? tr("{rCount} {rCount, plural, one {run} other {runs}} would be purged", { rCount: r.length }) : tr("Nothing would be purged"), detail: tr("Nothing is deleted by a preview.") };
            })
          }
        >
          {pending === "preview" ? tr("Checking…") : tr("Preview what would be purged")}
        </button>
      </div>
      {items && items.length ? (
        <div className="m2-frame" tabIndex={0} style={{ marginTop: 12 }}>
          <table className="m2-tbl" aria-label={tr("Runs past the policy")}>
            <thead>
              <tr>
                <th scope="col">{tr("Run")}</th>
                <th scope="col">{tr("Started")}</th>
                <th scope="col">{tr("Rows")}</th>
                <th scope="col" className="m2-r">{tr("Storage")}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.version_id}>
                  <td>{i.label ?? tr("Run of {value}", { value: i.run_at ? formatDate(i.run_at) : i.version_id.slice(0, 8) })}</td>
                  <td>{i.run_at ? formatDate(i.run_at, "datetime") : "—"}</td>
                  <td style={{ whiteSpace: "normal" }}>{i.blocked_reason ?? rowsText(i.rows_by_table)}</td>
                  <td className="m2-r">{bytes(i.bytes_freed)}</td>
                  <td className="m2-r">
                    <button type="button" className="m2-btn m2-sm m2-crit" disabled={!!i.blocked_reason} onClick={() => setPurging(i)}>
                      {tr("Purge this run")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <h3 className="m2-h2" style={{ margin: "16px 0 4px" }}>{tr("Purge log")}</h3>
      <Loaded q={log} what={tr("The purge log")} rows={2}>
        {(entries) =>
          entries.length === 0 ? (
            <p className="m2-prov">{tr("No purge yet. Rehearsals and purges appear here with the rows removed per table.")}</p>
          ) : (
            <div className="m2-frame" tabIndex={0}>
              <table className="m2-tbl" aria-label={tr("Purge log")}>
                <thead>
                  <tr>
                    <th scope="col">{tr("When")}</th>
                    <th scope="col">{tr("What")}</th>
                    <th scope="col">{tr("Mode")}</th>
                    <th scope="col">{tr("Rows")}</th>
                    <th scope="col">{tr("By")}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((p) => (
                    <tr key={p.id}>
                      <td>{formatDate(p.created_at, "datetime")}</td>
                      <td>{labelText(p.kind)}</td>
                      <td>{p.dry_run ? tr("Rehearsal") : tr("Deleted")}</td>
                      <td style={{ whiteSpace: "normal" }}>{p.blocked_reason ?? rowsText(p.rows_by_table)}</td>
                      <td>{p.actor_email ?? tr("Scheduler")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      {purging ? (
        <Confirm
          title={tr("Purge this run for good")}
          body={tr("This deletes the run and its findings ({rowsText}). It cannot be undone.", { rowsText: rowsText(purging.rows_by_table) })}
          confirm={tr("Purge the run")}
          danger
          phrase={purging.label ?? purging.version_id}
          pending={pending === "purge"}
          onCancel={() => setPurging(null)}
          onConfirm={() =>
            void run("purge", async () => {
              const r = await api.purgeVersion(purging.version_id, purging.label ?? purging.version_id);
              setPurging(null);
              setItems((cur) => (cur ?? []).filter((x) => x.version_id !== purging.version_id));
              await refreshAdmin(qc, "settings");
              return r.blocked_reason ? { tone: "fail", title: tr("The run was not purged"), detail: r.blocked_reason } : { tone: "ok", title: tr("Run purged"), detail: bytes(r.bytes_freed) + " freed." };
            })
          }
        />
      ) : null}
    </Block>
  );
}

/* ── Delete everything ── */

// i18n-ignore: the phrase is typed back and compared, so it is the same in every language.
const PURGE_PHRASE = "purge all data";
const STORE = "meridian:tenant-purge";
function loadRequest(): TenantPurgeRequest | null {
  try {
    const raw = window.localStorage.getItem(STORE);
    const v = raw ? (JSON.parse(raw) as Partial<TenantPurgeRequest>) : null;
    return v && typeof v.token === "string" && typeof v.executes_after === "string" ? { token: v.token, executes_after: v.executes_after } : null;
  } catch {
    return null;
  }
}
function saveRequest(v: TenantPurgeRequest | null): void {
  try {
    if (v) window.localStorage.setItem(STORE, JSON.stringify(v));
    else window.localStorage.removeItem(STORE);
  } catch {
    /* storage blocked: the request still shows for this visit */
  }
}

function TenantPurge() {
  const { outcome, pending, run } = useOutcome();
  const [req, setReq] = useState<TenantPurgeRequest | null>(() => (typeof window === "undefined" ? null : loadRequest()));
  const [ask, setAsk] = useState<"request" | "run" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const ready = req ? now >= Date.parse(req.executes_after) : false;
  return (
    <section className="m2-adm-blk m2-danger" aria-label={tr("Delete all data")} data-testid="tenant-purge">
      <h2>{tr("Delete all data")}</h2>
      <p>{tr("Removes every run, report and audit row of this organisation, and its stored files, for good. A request issues a token that works after 24 hours, so a mistake can be caught. The purge log keeps the record of the deletion.")}</p>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {req ? (
        <>
          <p>{ready ? tr("The purge can run now.") : tr("The purge can run after {executes_after}.", { executes_after: formatDate(req.executes_after, "datetime") })}</p>
          <div className="m2-adm-acts" style={{ marginTop: 0 }}>
            <button type="button" className="m2-btn m2-crit" disabled={!ready} onClick={() => setAsk("run")}>
              {tr("Purge now")}
            </button>
            <button type="button" className="m2-btn m2-ghost" onClick={() => (saveRequest(null), setReq(null))}>
              {tr("Forget this request")}
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="m2-btn m2-crit" onClick={() => setAsk("request")}>
          {tr("Request a purge")}
        </button>
      )}
      {ask === "request" ? (
        <Confirm
          title={tr("Request a purge of all data")}
          body={tr("Nothing is deleted yet. This issues a token that works 24 hours from now.")}
          confirm={tr("Request purge")}
          cancel={tr("Keep my data")}
          danger
          phrase={PURGE_PHRASE}
          pending={pending === "request"}
          onCancel={() => setAsk(null)}
          onConfirm={() =>
            void run("request", async () => {
              const r = await api.requestTenantPurge();
              saveRequest(r);
              setReq(r);
              setAsk(null);
              return { tone: "info", title: tr("Purge requested"), detail: tr("It can run after {executes_after}.", { executes_after: formatDate(r.executes_after, "datetime") }) };
            })
          }
        />
      ) : null}
      {ask === "run" && req ? (
        <Confirm
          title={tr("Purge all data now")}
          body={tr("Every run, report and audit row is deleted for good and a deletion certificate is saved.")}
          confirm={tr("Purge now")}
          cancel={tr("Keep my data")}
          danger
          phrase={PURGE_PHRASE}
          pending={pending === "run"}
          onCancel={() => setAsk(null)}
          onConfirm={() =>
            void run("run", async () => {
              const name = await api.executeTenantPurge(req.token);
              saveRequest(null);
              setReq(null);
              setAsk(null);
              return { tone: "ok", title: tr("Data purged"), detail: tr("The deletion certificate was saved as {name}.", { name }) };
            })
          }
        />
      ) : null}
    </section>
  );
}

/** Admin › Settings: the tenant, how it is scored and priced, and how long data is kept. */
export function SettingsSection() {
  const can = useCan();
  const write = can("manage_settings");
  const tenant = useTenantSettings();
  const scoring = useScoring();
  const cost = useCostModel();
  const retention = useRetention(write);
  return (
    <AdminPage title={tr("Settings")} lead={tr("This tenant at a glance, its appearance, how defects are scored and priced, how long data is kept, and where it lives.")}>
      {!write ? <Note>{tr("These settings are read only for your role. Changing them needs the manage settings permission.")}</Note> : null}
      <Block title={tr("Tenant")}>
        <Loaded q={tenant} what={tr("The tenant")} rows={2}>
          {(t) => (
            <Kv
              rows={[
                [tr("Name"), t.name],
                [tr("Currency"), cost.data?.currency ?? "—"],
                [tr("Licensed modules"), tr("{licensed_modulesCount} {licensed_modulesCount, plural, one {module} other {modules}}{value}", { licensed_modulesCount: (t.licensed_modules ?? []).length, value: (t.licensed_modules ?? []).length ? `: ${(t.licensed_modules ?? []).slice(0, 4).map(formatModuleName).join(", ")}${(t.licensed_modules ?? []).length > 4 ? tr(" and more") : ""}` : "" })],
              ]}
            />
          )}
        </Loaded>
        <p className="m2-prov">{tr("The tenant name and licensed modules come from the licence, set in Meridian HQ.")}</p>
      </Block>
      <AppearanceBlock />
      <Loaded q={scoring} what={tr("The scoring settings")} rows={3}>
        {(s) => (write ? <ScoringBlock key={JSON.stringify(s.dimension_weights) + JSON.stringify(s.thresholds) + JSON.stringify(s.critical_tolerance)} s={s} /> : (
          <Block title={tr("Scoring")}>
            <Kv rows={[[tr("Bands"), tr("target {target}, warning {warning}, critical {critical}", { target: s.thresholds.target, warning: s.thresholds.warning, critical: s.thresholds.critical })], [tr("Weights"), DIMS.map((d) => `${labelText(d)} ${toPercent(fractions(s.dimension_weights))[d]}`).join(", ")], [tr("Tolerance"), tr("{pct}% or {rows} records", { pct: s.critical_tolerance.pct, rows: s.critical_tolerance.rows })]]} />
          </Block>
        ))}
      </Loaded>
      <Loaded q={cost} what={tr("The cost model")} rows={3}>
        {(m) => (write ? <CostBlock key={JSON.stringify(m)} model={m} /> : <Block title={tr("Cost model")}><Kv rows={[[tr("Currency"), m.currency]]} /></Block>)}
      </Loaded>
      {write && tenant.data ? <PlannerBlock key={JSON.stringify(tenant.data.planner_config)} initial={tenant.data.planner_config ?? { minutes_per_record: 3, investigation_hours: 1, cleaning_item_hours: 0.25, exception_hours: 2, sprint_hours: 40, cost_per_record: null, currency: "" }} currency={cost.data?.currency} /> : null}
      {write ? (
        <Loaded q={retention} what={tr("The retention policy")} rows={3}>
          {(r) => <RetentionBlock key={JSON.stringify(r.policy)} data={r} />}
        </Loaded>
      ) : (
        <NeedsPermission what={tr("Retention")} permission="manage_settings" />
      )}
      <SandboxBlock />
      <ComplianceBlock />
      {can("manage_system") && write ? <TenantPurge /> : null}
    </AdminPage>
  );
}
