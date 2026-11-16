"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CostModel, DimensionScores, PlannerConfig } from "@/types/api";
import type { RetentionPolicy, RetentionPreviewItem, RetentionResponse, TenantPurgeRequest } from "@/lib/api/retention";
import type { ScoringConfig, ScoringResponse } from "@/lib/api/settings";
import * as api from "@/lib/api/v2/admin";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate, formatModuleName } from "@/lib/format";
import { refreshAdmin, useCostModel, usePurgeLog, useRetention, useScoring, useTenantSettings } from "@/lib/v2/admin-queries";
import { fixed } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { Button, Code, Confirm } from "../kit";
import { Block, Field, Kv, Loaded, NeedsPermission, Note, OutcomeNote, Page, Switch, useCan, useDone, useOutcome, useUnsaved } from "./tenant-kit";
import { LlmBlock, MaintenanceBlock, QualityThresholdsBlock, SandboxBlock } from "./tenant-blocks";
import { AppearanceBlock, ComplianceBlock } from "./tenant-enterprise";

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
function toPercent(f: DimensionScores): DimensionScores {
  const out = { ...f };
  DIMS.forEach((d) => (out[d] = Math.round(f[d] * 10000) / 100));
  const residue = Math.round((100 - DIMS.reduce((a, d) => a + out[d], 0)) * 100) / 100;
  const largest = DIMS.reduce((m, d) => (out[d] > out[m] ? d : m), DIMS[0]);
  out[largest] = Math.round((out[largest] + residue) * 100) / 100;
  return out;
}

const num = (s: string): number => (s.trim() === "" ? Number.NaN : Number(s));
const okNum = (s: string, min = 0, max = Number.POSITIVE_INFINITY): boolean => Number.isFinite(num(s)) && num(s) >= min && num(s) <= max;

function SaveButton({ pending, me, disabled, onClick, children, variant = "primary" }: { pending: string | null; me: string; disabled?: boolean; onClick: () => void; children: string; variant?: "primary" | "secondary" }) {
  return (
    <Button variant={variant} disabled={disabled || pending !== null} loading={pending === me} loadingLabel={t("Saving…")} onClick={onClick}>
      {children}
    </Button>
  );
}

/* Scoring */

function ScoringBlock({ s }: { s: ScoringResponse }) {
  const qc = useQueryClient();
  const done = useDone();
  const { outcome, pending, run } = useOutcome("set-scoring");
  const pct = toPercent(fractions(s.dimension_weights));
  const [w, setW] = useState<Record<string, string>>(() => Object.fromEntries(DIMS.map((d) => [d, String(pct[d])])));
  const [bands, setBands] = useState({ target: String(s.thresholds.target), warning: String(s.thresholds.warning), critical: String(s.thresholds.critical) });
  const [tol, setTol] = useState({ pct: String(s.critical_tolerance.pct ?? 0.1), rows: String(s.critical_tolerance.rows ?? 25) });
  const [sev, setSev] = useState(() => Object.fromEntries(Object.keys(s.severity_weights).map((k) => [k, { weight: String(s.severity_weights[k]), mult: String(s.severity_multipliers[k] ?? 1) }])));
  const wDirty = useUnsaved(w);
  const bDirty = useUnsaved(bands);
  const tDirty = useUnsaved([tol, sev]);
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
      done(t("{title}. They apply from the next analysis run", { title }), async () => {
        await api.putScoring({ ...before, ...restore });
        await refreshAdmin(qc, "settings");
      });
      return { tone: "ok", title, detail: t("Earlier runs keep the scoring they were scored under.") };
    });
  const bandKeys = ["target", "warning", "critical"] as const;
  return (
    <>
      <Block dirty={wDirty} title={t("Dimension weights")} hint={t("The score is each measured dimension times its weight. The weights must add up to 100.")}>
        <div className="nx-tn-form" data-cols="3">
          {DIMS.map((d) => (
            <Field key={d} label={t("{labelText} weight, percent", { labelText: labelText(d) })} error={okNum(w[d], 0, 100) ? null : t("0 to 100")}>
              <input className="nx-input" type="number" min={0} max={100} step={1} value={w[d]} onChange={(e) => setW({ ...w, [d]: e.target.value })} />
            </Field>
          ))}
        </div>
        <p className={weightsOk ? "nx-sub" : "nx-tn-bad"} role="status">
          {weightsOk ? t("The weights add up to 100.") : t("The weights add up to {sum}. Adjust them to 100 to save.", { sum: fixed(sum, 1) })}
        </p>
        <div className="nx-tn-actions">
          <SaveButton pending={pending} me="weights" disabled={!weightsOk} onClick={() => save("weights", t("Weights saved"), { dimension_weights: Object.fromEntries(DIMS.map((d) => [d, num(w[d])])) as unknown as DimensionScores }, { dimension_weights: s.dimension_weights })}>
            {t("Save weights")}
          </SaveButton>
          <Button variant="quiet" disabled={pending !== null} onClick={() => setW(Object.fromEntries(DIMS.map((d) => [d, String(toPercent(DAMA)[d])])))}>
            {t("Use the DAMA defaults")}
          </Button>
        </div>
      </Block>
      <Block dirty={bDirty} title={t("Score bands")} hint={t("At or above target is on target (go), at or above warning is at risk, below that is failing. Critical marks the line below which an object is failing badly.")}>
        <div className="nx-tn-form" data-cols="3">
          {bandKeys.map((k) => (
            <Field key={k} label={labelText(k)} error={okNum(bands[k], 0, 100) ? null : t("0 to 100")}>
              <input className="nx-input" type="number" min={0} max={100} step={1} value={bands[k]} onChange={(e) => setBands({ ...bands, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
        {!bandsOk ? (
          <p className="nx-tn-bad" role="alert">
            {t("Critical must not exceed warning, and warning must not exceed target.")}
          </p>
        ) : null}
        <div className="nx-tn-actions">
          <SaveButton pending={pending} me="bands" disabled={!bandsOk} onClick={() => save("bands", t("Score bands saved"), { thresholds: { target: num(bands.target), warning: num(bands.warning), critical: num(bands.critical) } }, { thresholds: s.thresholds })}>
            {t("Save bands")}
          </SaveButton>
          {s.defaults?.thresholds ? (
            <Button variant="quiet" disabled={pending !== null} onClick={() => setBands({ target: String(s.defaults.thresholds.target), warning: String(s.defaults.thresholds.warning), critical: String(s.defaults.thresholds.critical) })}>
              {t("Use the default bands")}
            </Button>
          ) : null}
        </div>
      </Block>
      <Block dirty={tDirty} title={t("Cap rule and tolerance")} hint={t("One critical rule failing beyond its tolerance holds that object at 85; two or more hold it at 70. The caps are fixed. The tolerance says how many failing records count as beyond.")}>
        <div className="nx-tn-form" data-cols="3">
          <Field label={t("Failing share, percent")} hint={t("At or above this share of the records checked.")} error={okNum(tol.pct, 0, 100) ? null : t("0 to 100")}>
            <input className="nx-input" type="number" min={0} max={100} step={0.05} value={tol.pct} onChange={(e) => setTol({ ...tol, pct: e.target.value })} />
          </Field>
          <Field label={t("Failing records")} hint={t("Or at or above this count, when it is the lower bar.")} error={okNum(tol.rows, 0) ? null : t("0 or more")}>
            <input className="nx-input" type="number" min={0} step={1} value={tol.rows} onChange={(e) => setTol({ ...tol, rows: e.target.value })} />
          </Field>
        </div>
        <div className="nx-tn-table-wrap">
          <table className="nx-table" aria-label={t("Severity weights")}>
            <thead>
              <tr>
                <th scope="col">{t("Severity")}</th>
                <th scope="col">{t("Rule weight")}</th>
                <th scope="col">{t("Failure multiplier")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(sev).map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{labelText(k)}</th>
                  <td>
                    <input className="nx-input" type="number" min={0} step={0.5} aria-label={t("{k} rule weight", { k: labelText(k) })} value={v.weight} onChange={(e) => setSev({ ...sev, [k]: { ...v, weight: e.target.value } })} />
                  </td>
                  <td>
                    <input className="nx-input" type="number" min={1} step={0.5} aria-label={t("{k} failure multiplier", { k: labelText(k) })} value={v.mult} onChange={(e) => setSev({ ...sev, [k]: { ...v, mult: e.target.value } })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="nx-tn-actions">
          <SaveButton
            pending={pending}
            me="tolerance"
            disabled={!tolOk || !sevOk}
            onClick={() =>
              save(
                "tolerance",
                t("Tolerance saved"),
                {
                  critical_tolerance: { pct: num(tol.pct), rows: num(tol.rows) },
                  severity_weights: Object.fromEntries(Object.entries(sev).map(([k, v]) => [k, num(v.weight)])),
                  severity_multipliers: Object.fromEntries(Object.entries(sev).map(([k, v]) => [k, num(v.mult)])),
                },
                { critical_tolerance: s.critical_tolerance, severity_weights: s.severity_weights, severity_multipliers: s.severity_multipliers },
              )
            }
          >
            {t("Save tolerance")}
          </SaveButton>
        </div>
      </Block>
      <OutcomeNote outcome={outcome} />
    </>
  );
}

/* Cost model */

function CostBlock({ model }: { model: CostModel }) {
  const qc = useQueryClient();
  const fixture = useFixture();
  const features = useQuery({ queryKey: ["v2", "admin", fixture, "settings", "cost-features"], queryFn: api.getCostFeatures, staleTime: 300_000, retry: false });
  const { outcome, pending, run } = useOutcome("set-cost");
  const [currency, setCurrency] = useState(model.currency ?? "");
  const [sub, setSub] = useState(model.subscription_monthly == null ? "" : String(model.subscription_monthly));
  const [sev, setSev] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(model.severity ?? {}).filter(([, v]) => !("field" in (v ?? {}))).map(([k, v]) => [k, String(v.per_record ?? 0)])));
  const [feat, setFeat] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(model.features ?? {}).map(([k, v]) => [k, String(v)])));
  const [impact, setImpact] = useState<Record<string, { unit: string; factor: string; mit: string }>>(() =>
    Object.fromEntries(Object.entries(model.impact ?? {}).map(([k, v]) => [k, { unit: String(v.unit_cost ?? 0), factor: String(v.factor ?? 1), mit: String(Math.round((v.mitigation ?? 0) * 1000) / 10) }])),
  );
  const [align, setAlign] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(model.config_alignment ?? {}).map(([k, v]) => [k, String(v)])));
  const [addFeature, setAddFeature] = useState("");
  const dirty = useUnsaved([currency, sub, sev, feat, impact, align]);
  const currencyOk = /^[A-Z]{3}$/.test(currency);
  const subOk = sub.trim() === "" || okNum(sub);
  const valid = currencyOk && subOk && Object.values(sev).every((v) => okNum(v)) && Object.values(feat).every((v) => okNum(v)) && Object.values(align).every((v) => okNum(v)) && Object.values(impact).every((v) => okNum(v.unit) && okNum(v.factor) && okNum(v.mit, 0, 100));
  const l1 = new Map((features.data ?? []).map((f) => [f.feature, f.l1]));
  const unpriced = (features.data ?? []).filter((f) => !(f.feature in feat));
  const impactLabel = (f: "unit" | "factor" | "mit") => (f === "unit" ? t("unit cost") : f === "factor" ? t("factor") : t("mitigation"));
  const save = () =>
    void run("cost", async () => {
      const next: CostModel = {
        ...model,
        currency,
        subscription_monthly: sub.trim() === "" ? null : num(sub),
        severity: { ...model.severity, ...Object.fromEntries(Object.entries(sev).map(([k, v]) => [k, { ...model.severity[k], per_record: num(v) }])) },
        features: Object.fromEntries(Object.entries(feat).map(([k, v]) => [k, num(v)])),
        impact: Object.fromEntries(Object.entries(impact).map(([k, v]) => [k, { ...model.impact?.[k], unit_cost: num(v.unit), factor: num(v.factor), mitigation: Math.round(num(v.mit) * 10) / 1000 }])),
        config_alignment: Object.fromEntries(Object.entries(align).map(([k, v]) => [k, num(v)])),
      } as CostModel;
      await api.putCostModel(next);
      await refreshAdmin(qc, "settings");
      return { tone: "ok", title: t("Cost model saved"), detail: t("It applies from the next analysis or re-analysis.") };
    });
  return (
    <Block dirty={dirty} title={t("Cost model and currency")} hint={t("What a defect costs, in one currency: every value at risk, ROI and planner figure is in it.")}>
      <div className="nx-tn-form" data-cols="3">
        <Field label={t("Currency")} hint={t("Three-letter ISO 4217 code, such as ZAR, EUR or USD.")} error={currencyOk ? null : t("Use three capital letters")}>
          <input className="nx-input" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </Field>
        <Field label={t("Monthly subscription")} hint={t("What the ROI divides by. Empty means no ROI multiple.")} error={subOk ? null : t("0 or more, or empty")}>
          <input className="nx-input" type="number" min={0} step="any" value={sub} onChange={(e) => setSub(e.target.value)} />
        </Field>
      </div>
      <h3 className="nx-tn-h3">{t("Cost of one blocked record, by severity")}</h3>
      <div className="nx-tn-form" data-cols="4">
        {Object.entries(sev).map(([k, v]) => (
          <Field key={k} label={t("{k} finding cost", { k: labelText(k) })}>
            <input className="nx-input" type="number" min={0} step="any" value={v} onChange={(e) => setSev({ ...sev, [k]: e.target.value })} />
          </Field>
        ))}
      </div>
      <h3 className="nx-tn-h3">{t("Value of one blocked record, by SAP feature")}</h3>
      <div className="nx-tn-table-wrap">
        <table className="nx-table" aria-label={t("Value per blocked record by SAP feature")}>
          <thead>
            <tr>
              <th scope="col">{t("SAP feature")}</th>
              <th scope="col">{t("Value per record")}</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {Object.keys(feat).length === 0 ? (
              <tr>
                <td colSpan={3} className="nx-sub">
                  {t("No feature has a value yet")}
                </td>
              </tr>
            ) : (
              Object.keys(feat)
                .sort()
                .map((f) => (
                  <tr key={f}>
                    <td>
                      <Code code={f} text={l1.get(f) ?? undefined} />
                    </td>
                    <td>
                      <input className="nx-input" type="number" min={0} step="any" aria-label={t("{f} value per record", { f })} value={feat[f]} onChange={(e) => setFeat({ ...feat, [f]: e.target.value })} />
                    </td>
                    <td className="nx-tn-num">
                      <Button
                        variant="quiet"
                        size={32}
                        onClick={() => {
                          const n = { ...feat };
                          delete n[f];
                          setFeat(n);
                        }}
                      >
                        {t("Remove")}
                      </Button>
                    </td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
      {unpriced.length ? (
        <div className="nx-tn-inline">
          <Field label={t("Add a value for")}>
            <select className="nx-input" value={addFeature} onChange={(e) => setAddFeature(e.target.value)}>
              <option value="">{t("Pick an SAP feature")}</option>
              {unpriced.map((f) => (
                <option key={f.feature} value={f.feature}>
                  {f.l1 ? `${f.feature} ${f.l1}` : f.feature}
                </option>
              ))}
            </select>
          </Field>
          <Button
            variant="secondary"
            disabled={!addFeature}
            onClick={() => {
              setFeat({ ...feat, [addFeature]: "0" });
              setAddFeature("");
            }}
          >
            {t("Add")}
          </Button>
        </div>
      ) : null}
      {Object.keys(impact).length ? (
        <>
          <h3 className="nx-tn-h3">{t("Business-impact defects")}</h3>
          <div className="nx-tn-table-wrap">
            <table className="nx-table" aria-label={t("Business impact defects")}>
              <thead>
                <tr>
                  <th scope="col">{t("Defect")}</th>
                  <th scope="col">{t("Unit cost")}</th>
                  <th scope="col">{t("Factor")}</th>
                  <th scope="col">{t("Mitigation, percent")}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(impact).map(([k, v]) => (
                  <tr key={k}>
                    <th scope="row">{labelText(k)}</th>
                    {(["unit", "factor", "mit"] as const).map((f) => (
                      <td key={f}>
                        <input className="nx-input" type="number" min={0} max={f === "mit" ? 100 : undefined} step="any" aria-label={`${labelText(k)} ${impactLabel(f)}`} value={v[f]} onChange={(e) => setImpact({ ...impact, [k]: { ...v, [f]: e.target.value } })} />
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
          <h3 className="nx-tn-h3">{t("Configuration findings")}</h3>
          <div className="nx-tn-form" data-cols="3">
            {Object.entries(align).map(([k, v]) => (
              <Field key={k} label={t("{k}, per unit", { k: labelText(k) })}>
                <input className="nx-input" type="number" min={0} step="any" value={v} onChange={(e) => setAlign({ ...align, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
        </>
      ) : null}
      <OutcomeNote outcome={outcome} />
      <div className="nx-tn-actions">
        <SaveButton pending={pending} me="cost" disabled={!valid} onClick={save}>
          {t("Save cost model")}
        </SaveButton>
      </div>
    </Block>
  );
}

/* Planner */

function PlannerBlock({ initial, currency }: { initial: PlannerConfig; currency?: string }) {
  const qc = useQueryClient();
  const { outcome, pending, run } = useOutcome("set-planner");
  const [p, setP] = useState({
    minutes_per_record: String(initial.minutes_per_record),
    investigation_hours: String(initial.investigation_hours),
    exception_hours: String(initial.exception_hours),
    sprint_hours: String(initial.sprint_hours),
    cost_per_record: initial.cost_per_record == null ? "" : String(initial.cost_per_record),
  });
  const dirty = useUnsaved(p);
  const valid = okNum(p.minutes_per_record) && okNum(p.investigation_hours) && okNum(p.exception_hours) && okNum(p.sprint_hours, 1) && (p.cost_per_record.trim() === "" || okNum(p.cost_per_record));
  const input = (k: keyof typeof p, min = 0, placeholder?: string) => <input className="nx-input" type="number" min={min} step="any" placeholder={placeholder} value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} />;
  return (
    <Block dirty={dirty} title={t("Planner assumptions")} hint={t("The next-sprint planner ranks open work by severity-weighted records per hour. Money appears only when you state what one failing record costs you.")}>
      <div className="nx-tn-form" data-cols="3">
        <Field label={t("Minutes per record")}>{input("minutes_per_record")}</Field>
        <Field label={t("Hours per finding")}>{input("investigation_hours")}</Field>
        <Field label={t("Hours per exception")}>{input("exception_hours")}</Field>
        <Field label={t("Sprint capacity, hours")}>{input("sprint_hours", 1)}</Field>
        <Field label={currency ? t("Cost per failing record ({currency})", { currency }) : t("Cost per failing record")}>{input("cost_per_record", 0, t("Not set"))}</Field>
      </div>
      <OutcomeNote outcome={outcome} />
      <div className="nx-tn-actions">
        <SaveButton
          pending={pending}
          me="planner"
          disabled={!valid}
          onClick={() =>
            void run("planner", async () => {
              await api.savePlanner({
                ...initial,
                minutes_per_record: num(p.minutes_per_record),
                investigation_hours: num(p.investigation_hours),
                exception_hours: num(p.exception_hours),
                sprint_hours: num(p.sprint_hours),
                cost_per_record: p.cost_per_record.trim() === "" ? null : num(p.cost_per_record),
              });
              await refreshAdmin(qc, "settings");
              return { tone: "ok", title: t("Planner assumptions saved") };
            })
          }
        >
          {t("Save assumptions")}
        </SaveButton>
      </div>
    </Block>
  );
}

/* Retention */

const dayField = (v: number | null) => (v === null ? "" : String(v));
const daysOf = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const bytes = (n: number): string => (n >= 1e9 ? `${fixed(n / 1e9, 1)} GB` : n >= 1e6 ? `${fixed(n / 1e6, 1)} MB` : `${fixed(n / 1e3, 0)} kB`);
const rowsText = (r: Record<string, number | string[]>): string =>
  Object.entries(r)
    .map(([k, n]) => `${k}: ${Array.isArray(n) ? n.join(", ") : n}`)
    .join("; ");

function RetentionBlock({ data }: { data: RetentionResponse }) {
  const qc = useQueryClient();
  const done = useDone();
  const log = usePurgeLog();
  const { outcome, pending, run } = useOutcome("set-retention");
  const [f, setF] = useState({ versions: dayField(data.policy.versions_days), reports: dayField(data.policy.reports_days), audit: dayField(data.policy.audit_days), keep: String(data.policy.keep_latest_per_system), baseline: data.policy.keep_baseline });
  const [items, setItems] = useState<RetentionPreviewItem[] | null>(null);
  const [purging, setPurging] = useState<RetentionPreviewItem | null>(null);
  const dirty = useUnsaved(f);
  const days = (s: string) => s.trim() === "" || (Number.isInteger(Number(s)) && Number(s) >= 1);
  const valid = days(f.versions) && days(f.reports) && days(f.audit) && Number.isInteger(Number(f.keep)) && Number(f.keep) >= 0;
  const policy = (): RetentionPolicy => ({ versions_days: daysOf(f.versions), reports_days: daysOf(f.reports), audit_days: daysOf(f.audit), keep_baseline: f.baseline, keep_latest_per_system: Number(f.keep) });
  const e = data.enforcement;
  const dayInput = (k: "versions" | "reports" | "audit", label: string) => (
    <Field label={label} error={days(f[k]) ? null : t("A whole number of days")}>
      <input className="nx-input" type="number" min={1} value={f[k]} onChange={(ev) => setF({ ...f, [k]: ev.target.value })} />
    </Field>
  );
  return (
    <Block dirty={dirty} title={t("Retention")} hint={t("How long runs, reports and audit rows are kept. Archived runs past the limit are purged for good by the nightly task. Empty means for ever.")}>
      <div className="nx-tn-form" data-cols="4">
        {dayInput("versions", t("Keep runs, days"))}
        {dayInput("reports", t("Keep reports, days"))}
        {dayInput("audit", t("Keep audit rows, days"))}
        <Field label={t("Latest runs kept per system")}>
          <input className="nx-input" type="number" min={0} value={f.keep} onChange={(ev) => setF({ ...f, keep: ev.target.value })} />
        </Field>
      </div>
      <Switch checked={f.baseline} onChange={(v) => setF({ ...f, baseline: v })} label={t("Keep the baseline run")} />
      <p className="nx-sub">
        {e.enforced
          ? t("Purges run for real each night under this policy.")
          : t("Purges are in rehearsal: the nightly task only logs what it would delete{value}{value2}.", {
              value: e.dry_run_until ? t(" until {dry_run_until}", { dry_run_until: formatDate(e.dry_run_until) }) : "",
              value2: e.flag_enabled ? "" : t(", and deletion is switched off on this deployment"),
            })}
      </p>
      <OutcomeNote outcome={outcome} />
      <div className="nx-tn-actions">
        <SaveButton
          pending={pending}
          me="retention"
          disabled={!valid}
          onClick={() =>
            void run("retention", async () => {
              const prev = data.policy;
              await api.putRetention(policy());
              await refreshAdmin(qc, "settings");
              done(t("Retention policy saved"), async () => {
                await api.putRetention(prev);
                await refreshAdmin(qc, "settings");
              });
              return { tone: "ok", title: t("Retention policy saved"), detail: t("The rehearsal window restarts under the new policy.") };
            })
          }
        >
          {t("Save policy")}
        </SaveButton>
        <Button
          disabled={!valid || pending !== null}
          loading={pending === "preview"}
          loadingLabel={t("Checking…")}
          onClick={() =>
            void run("preview", async () => {
              const r = await api.previewRetentionDraft(policy());
              setItems(r);
              return { tone: "info", title: r.length ? t("{rCount} {rCount, plural, one {run} other {runs}} would be purged", { rCount: r.length }) : t("Nothing would be purged"), detail: t("Nothing is deleted by a preview.") };
            })
          }
        >
          {t("Preview what would be purged")}
        </Button>
      </div>
      {items && items.length ? (
        <div className="nx-tn-table-wrap" tabIndex={0}>
          <table className="nx-table" aria-label={t("Runs past the policy")}>
            <thead>
              <tr>
                <th scope="col">{t("Run")}</th>
                <th scope="col">{t("Started")}</th>
                <th scope="col">{t("Rows")}</th>
                <th scope="col" className="nx-tn-num">
                  {t("Storage")}
                </th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.version_id}>
                  <td>{i.label ?? t("Run of {value}", { value: i.run_at ? formatDate(i.run_at) : i.version_id.slice(0, 8) })}</td>
                  <td>{i.run_at ? formatDate(i.run_at, "datetime") : "—"}</td>
                  <td>{i.blocked_reason ?? rowsText(i.rows_by_table)}</td>
                  <td className="nx-tn-num">{bytes(i.bytes_freed)}</td>
                  <td className="nx-tn-num">
                    <Button variant="danger" size={32} disabled={!!i.blocked_reason} reason={i.blocked_reason ?? undefined} onClick={() => setPurging(i)}>
                      {t("Purge this run")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <h3 className="nx-tn-h3">{t("Purge log")}</h3>
      <Loaded q={log} what={t("The purge log")} rows={2}>
        {(entries) =>
          entries.length === 0 ? (
            <p className="nx-sub">{t("No purge yet. Rehearsals and purges appear here with the rows removed per table.")}</p>
          ) : (
            <div className="nx-tn-table-wrap" tabIndex={0}>
              <table className="nx-table" aria-label={t("Purge log")}>
                <thead>
                  <tr>
                    <th scope="col">{t("When")}</th>
                    <th scope="col">{t("What")}</th>
                    <th scope="col">{t("Mode")}</th>
                    <th scope="col">{t("Rows")}</th>
                    <th scope="col">{t("By")}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((p) => (
                    <tr key={p.id}>
                      <td>{formatDate(p.created_at, "datetime")}</td>
                      <td>{labelText(p.kind)}</td>
                      <td>{p.dry_run ? t("Rehearsal") : t("Deleted")}</td>
                      <td>{p.blocked_reason ?? rowsText(p.rows_by_table)}</td>
                      <td>{p.actor_email ?? t("Scheduler")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      <Confirm
        open={!!purging}
        title={t("Purge this run for good")}
        consequence={purging ? t("This deletes the run and its findings ({rowsText}). It cannot be undone.", { rowsText: rowsText(purging.rows_by_table) }) : ""}
        confirmLabel={t("Purge the run")}
        danger
        phrase={purging ? purging.label ?? purging.version_id : undefined}
        onCancel={() => setPurging(null)}
        onConfirm={() => {
          if (!purging || pending) return;
          const target = purging;
          void run("purge", async () => {
            const r = await api.purgeVersion(target.version_id, target.label ?? target.version_id);
            setPurging(null);
            setItems((cur) => (cur ?? []).filter((x) => x.version_id !== target.version_id));
            await refreshAdmin(qc, "settings");
            return r.blocked_reason ? { tone: "fail", title: t("The run was not purged"), detail: r.blocked_reason } : { tone: "ok", title: t("Run purged"), detail: bytes(r.bytes_freed) + t(" freed.") };
          });
        }}
      />
    </Block>
  );
}

/* Delete everything */

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
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const ready = req ? now >= Date.parse(req.executes_after) : false;
  return (
    <section className="nx-tn-block" aria-label={t("Delete all data")} data-testid="tenant-purge">
      <h2 className="nx-tn-h2">{t("Delete all data")}</h2>
      <p className="nx-sub">{t("Removes every run, report and audit row of this organisation, and its stored files, for good. A request issues a token that works after 24 hours, so a mistake can be caught. The purge log keeps the record of the deletion.")}</p>
      <OutcomeNote outcome={outcome} />
      {req ? (
        <>
          <p role="status">{ready ? t("The purge can run now.") : t("The purge can run after {executes_after}.", { executes_after: formatDate(req.executes_after, "datetime") })}</p>
          <div className="nx-tn-actions">
            <Button variant="danger" disabled={!ready || pending !== null} loading={pending === "run"} onClick={() => setAsk("run")}>
              {t("Purge now")}
            </Button>
            <Button variant="quiet" disabled={pending !== null} onClick={() => (saveRequest(null), setReq(null))}>
              {t("Forget this request")}
            </Button>
          </div>
        </>
      ) : (
        <div className="nx-tn-actions">
          <Button variant="danger" disabled={pending !== null} loading={pending === "request"} onClick={() => setAsk("request")}>
            {t("Request a purge")}
          </Button>
        </div>
      )}
      <Confirm
        open={ask === "request"}
        title={t("Request a purge of all data")}
        consequence={t("Nothing is deleted yet. This issues a token that works 24 hours from now.")}
        confirmLabel={t("Request purge")}
        danger
        phrase={PURGE_PHRASE}
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          if (pending) return;
          setAsk(null);
          void run("request", async () => {
            const r = await api.requestTenantPurge();
            saveRequest(r);
            setReq(r);
            return { tone: "info", title: t("Purge requested"), detail: t("It can run after {executes_after}.", { executes_after: formatDate(r.executes_after, "datetime") }) };
          });
        }}
      />
      <Confirm
        open={ask === "run" && !!req}
        title={t("Purge all data now")}
        consequence={t("Every run, report and audit row is deleted for good and a deletion certificate is saved.")}
        confirmLabel={t("Purge now")}
        danger
        phrase={PURGE_PHRASE}
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          if (pending || !req) return;
          const token = req.token;
          setAsk(null);
          void run("run", async () => {
            const name = await api.executeTenantPurge(token);
            saveRequest(null);
            setReq(null);
            return { tone: "ok", title: t("Data purged"), detail: t("The deletion certificate was saved as {name}.", { name }) };
          });
        }}
      />
    </section>
  );
}

/** Edit the tenant's display name and currency; only the changed keys are sent. */
function TenantProfileForm({ name: savedName, currency: savedCurrency }: { name: string; currency: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState(savedName);
  const [currency, setCurrency] = useState(savedCurrency);
  const { outcome, pending, run } = useOutcome("set-tenant");
  const nameOk = name.trim().length >= 1 && name.trim().length <= 200;
  const currencyOk = currency === "" || /^[A-Z]{3}$/.test(currency);
  const body: { name?: string; currency?: string } = {};
  if (name.trim() !== savedName) body.name = name.trim();
  if (currency !== "" && currency !== savedCurrency) body.currency = currency;
  const changed = Object.keys(body).length > 0;
  useUnsaved([name, currency]);
  return (
    <>
      <div className="nx-tn-form">
        <Field label={t("Tenant name")} error={nameOk ? null : t("Use 1 to 200 characters")}>
          <input className="nx-input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("Tenant currency")} hint={t("Three-letter ISO 4217 code, such as ZAR, EUR or USD.")} error={currencyOk ? null : t("Use three capital letters")}>
          <input className="nx-input" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </Field>
      </div>
      <OutcomeNote outcome={outcome} />
      <div className="nx-tn-actions">
        <SaveButton
          pending={pending}
          me="tenant"
          disabled={!changed || !nameOk || !currencyOk}
          onClick={() =>
            void run("tenant", async () => {
              await api.patchTenant(body);
              await refreshAdmin(qc, "settings");
              return { tone: "ok", title: t("Tenant saved") };
            })
          }
        >
          {t("Save the tenant")}
        </SaveButton>
      </div>
    </>
  );
}

/** Admin settings: the tenant, how it is scored and priced, and how long data is kept. */
export function SettingsSection() {
  const can = useCan();
  const write = can("manage_settings");
  const tenant = useTenantSettings();
  const scoring = useScoring();
  const cost = useCostModel();
  const retention = useRetention(write);
  return (
    <Page lead={t("This tenant at a glance, its appearance, how defects are scored and priced, how long data is kept, and where it lives.")}>
      {!write ? <Note>{t("These settings are read only for your role. Changing them needs the manage settings permission.")}</Note> : null}
      <Block title={t("Tenant")}>
        <Loaded q={tenant} what={t("The tenant")} rows={2}>
          {(d) => {
            const mods = d.licensed_modules ?? [];
            return (
              <Kv
                rows={[
                  [t("Name"), d.name],
                  [t("Currency"), d.currency ?? cost.data?.currency ?? "—"],
                  [
                    t("Licensed modules"),
                    t("{licensed_modulesCount} {licensed_modulesCount, plural, one {module} other {modules}}{value}", {
                      licensed_modulesCount: mods.length,
                      value: mods.length ? `: ${mods.slice(0, 4).map(formatModuleName).join(", ")}${mods.length > 4 ? t(" and more") : ""}` : "",
                    }),
                  ],
                ]}
              />
            );
          }}
        </Loaded>
        {write && tenant.data ? <TenantProfileForm key={`${tenant.data.name}|${tenant.data.currency ?? ""}`} name={tenant.data.name} currency={tenant.data.currency ?? ""} /> : null}
        <p className="nx-sub">{write ? t("Licensed modules come from the licence, set in Meridian HQ.") : t("The tenant name and licensed modules come from the licence, set in Meridian HQ.")}</p>
      </Block>
      <AppearanceBlock />
      <Loaded q={scoring} what={t("The scoring settings")} rows={3}>
        {(s) =>
          write ? (
            <ScoringBlock key={JSON.stringify([s.dimension_weights, s.thresholds, s.critical_tolerance, s.severity_weights, s.severity_multipliers])} s={s} />
          ) : (
            <Block title={t("Scoring")}>
              <Kv
                rows={[
                  [t("Bands"), t("target {target}, warning {warning}, critical {critical}", { target: s.thresholds.target, warning: s.thresholds.warning, critical: s.thresholds.critical })],
                  [t("Weights"), DIMS.map((d) => `${labelText(d)} ${toPercent(fractions(s.dimension_weights))[d]}`).join(", ")],
                  [t("Tolerance"), t("{pct}% or {rows} records", { pct: s.critical_tolerance.pct, rows: s.critical_tolerance.rows })],
                ]}
              />
            </Block>
          )
        }
      </Loaded>
      <QualityThresholdsBlock write={write} modules={tenant.data?.licensed_modules ?? []} />
      <div id="cost-model">
        <Loaded q={cost} what={t("The cost model")} rows={3}>
          {(m) =>
            write ? (
              <CostBlock key={JSON.stringify(m)} model={m} />
            ) : (
              <Block title={t("Cost model")}>
                <Kv rows={[[t("Currency"), m.currency]]} />
              </Block>
            )
          }
        </Loaded>
      </div>
      {write && tenant.data ? (
        <PlannerBlock
          key={JSON.stringify(tenant.data.planner_config)}
          initial={tenant.data.planner_config ?? { minutes_per_record: 3, investigation_hours: 1, cleaning_item_hours: 0.25, exception_hours: 2, sprint_hours: 40, cost_per_record: null, currency: "" }}
          currency={cost.data?.currency}
        />
      ) : null}
      {write ? (
        <Loaded q={retention} what={t("The retention policy")} rows={3}>
          {(r) => <RetentionBlock key={JSON.stringify(r.policy)} data={r} />}
        </Loaded>
      ) : (
        <NeedsPermission what={t("Retention")} permission="manage_settings" />
      )}
      <LlmBlock />
      <MaintenanceBlock />
      <SandboxBlock />
      <ComplianceBlock />
      {can("manage_system") && write ? <TenantPurge /> : null}
    </Page>
  );
}
