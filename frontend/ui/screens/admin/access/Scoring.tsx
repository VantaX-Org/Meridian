"use client";

import { useState } from "react";
import { Button, Card, Code, DataTable, EmptyState, Field, Input, Select, type Column } from "@/ui/kit";
import { Frame, Num, useAct, useCan, useSectionChat, useSync } from "../common";
import { useQualityThresholds, useScoring } from "@/lib/v2/admin-queries";
import { deleteQualityThreshold, putQualityThreshold, putScoring, type QualityBands } from "@/lib/api/v2/admin";
import type { ScoringConfig } from "@/lib/api/settings";
import { labelText, moduleText } from "@/lib/v2/labels";
import { t } from "@/lib/v2/i18n";

type Band = QualityBands & { key: string; module: string; dimension: string; own: boolean };

const sum = (o: object) => (Object.values(o) as number[]).reduce((a, b) => a + b, 0);

export function Scoring() {
  const sc = useScoring();
  const qt = useQualityThresholds();
  const can = useCan();
  const edit = can("manage_settings");
  const { run, busy } = useAct();
  const [cfg, setCfg] = useState<ScoringConfig | null>(null);
  const [mod, setMod] = useState("*");
  const [dim, setDim] = useState("");
  const [bands, setBands] = useState<QualityBands>({ target: 90, warning: 75, critical: 60 });

  useSync(sc.data, (d) => { const { defaults: _d, ...c } = d; void _d; setCfg(c); });

  const dims = qt.data?.dimensions ?? [];
  const rows: Band[] = qt.data
    ? [
        ...dims.map((d) => ({ ...(qt.data.tenant[d] ?? qt.data.fallback), key: `*/${d}`, module: "*", dimension: d, own: true })),
        ...Object.entries(qt.data.modules).flatMap(([m, ds]) => Object.entries(ds).map(([d, b]) => ({ ...b, key: `${m}/${d}`, module: m, dimension: d, own: true }))),
      ]
    : [];

  useSectionChat("scoring", t("Scoring"), cfg ? [
    t("Scores are held to a target of {target}, a warning at {warning} and critical at {critical}.", { ...cfg.thresholds }),
    t("The dimension weights add up to {n}.", { n: sum(cfg.dimension_weights).toFixed(2) }),
    t("{n} quality bands are set.", { n: rows.length }),
  ] : [], [t("What score counts as on target?"), t("Which dimension weighs most?")]);

  const setW = (group: "dimension_weights" | "severity_weights" | "severity_multipliers" | "critical_tolerance", k: string, v: number) =>
    setCfg((c) => (c ? { ...c, [group]: { ...c[group], [k]: v } } : c));
  const setT = (k: keyof ScoringConfig["thresholds"], v: number) => setCfg((c) => (c ? { ...c, thresholds: { ...c.thresholds, [k]: v } } : c));

  const cols: Column<Band>[] = [
    { key: "module", label: t("Module"), sort: (r) => r.module, render: (r) => (r.module === "*" ? t("Tenant default") : <Code code={r.module} description={moduleText(r.module)} />) },
    { key: "dimension", label: t("Dimension"), sort: (r) => r.dimension, render: (r) => <Code code={r.dimension} description={labelText(r.dimension)} /> },
    { key: "target", label: t("Target"), align: "end", sort: (r) => r.target, render: (r) => r.target },
    { key: "warning", label: t("Warning"), align: "end", sort: (r) => r.warning, render: (r) => r.warning },
    { key: "critical", label: t("Critical"), align: "end", sort: (r) => r.critical, render: (r) => r.critical },
    { key: "act", label: t("Action"), render: (r) => edit ? (
      <span className="mx-links">
        <Button variant="ghost" onClick={() => { setMod(r.module); setDim(r.dimension); setBands({ target: r.target, warning: r.warning, critical: r.critical }); }}>{t("Edit")}</Button>
        {r.module !== "*" && <Button variant="ghost" onClick={() => void run(() => deleteQualityThreshold(r.module, r.dimension), t("Override removed."), ["settings"])}>{t("Remove")}</Button>}
      </span>
    ) : null },
  ];

  const modules = ["*", ...Object.keys(qt.data?.modules ?? {})];
  return (
    <Frame slug="scoring" title={t("Scoring")} lead={t("How dimension scores combine, where the bands sit, and per-module overrides.")} loading={sc.isLoading || qt.isLoading} error={sc.isError || qt.isError}>
      {!cfg ? <EmptyState heading={t("No scoring configuration is available")} /> : (
        <>
          <Card title={t("Dimension weights")} sub={t("Weights add up to {n}. The score divides by the sum.", { n: sum(cfg.dimension_weights).toFixed(2) })}>
            <form className="mx-col" onSubmit={(e) => { e.preventDefault(); void run(() => putScoring(cfg), t("Scoring saved."), ["settings"]); }}>
              {Object.keys(cfg.dimension_weights).map((d) => (
                <Num key={d} label={labelText(d)} value={cfg.dimension_weights[d as keyof typeof cfg.dimension_weights]} step={0.05} max={1} onChange={(v) => setW("dimension_weights", d, v)} />
              ))}
              <Num label={t("Target score")} value={cfg.thresholds.target} max={100} onChange={(v) => setT("target", v)} />
              <Num label={t("Warning score")} value={cfg.thresholds.warning} max={100} onChange={(v) => setT("warning", v)} />
              <Num label={t("Critical score")} value={cfg.thresholds.critical} max={100} onChange={(v) => setT("critical", v)} />
              {Object.keys(cfg.severity_weights).map((s) => (
                <Num key={`w${s}`} label={t("Weight of {severity} findings", { severity: labelText(s).toLowerCase() })} value={cfg.severity_weights[s]} step={0.5} onChange={(v) => setW("severity_weights", s, v)} />
              ))}
              {Object.keys(cfg.severity_multipliers).map((s) => (
                <Num key={`m${s}`} label={t("Penalty multiplier for {severity} findings", { severity: labelText(s).toLowerCase() })} value={cfg.severity_multipliers[s]} step={0.5} onChange={(v) => setW("severity_multipliers", s, v)} />
              ))}
              {Object.keys(cfg.critical_tolerance).map((k) => (
                <Num key={`c${k}`} label={k === "pct" ? t("Critical tolerance as a share of rows") : t("Critical tolerance in rows")} value={cfg.critical_tolerance[k]} step={k === "pct" ? 0.05 : 1} onChange={(v) => setW("critical_tolerance", k, v)} />
              ))}
              {edit && (
                <div className="mx-links">
                  <Button variant="primary" type="submit" disabled={busy}>{t("Save")}</Button>
                  <Button variant="secondary" type="button" onClick={() => { const { defaults, ...c } = sc.data!; setCfg(c as ScoringConfig); void defaults; }}>{t("Use the defaults")}</Button>
                </div>
              )}
            </form>
          </Card>
          <Card title={t("Quality bands")} sub={t("Target, warning and critical per dimension. A module row overrides the tenant default.")}>
            <DataTable<Band> label={t("Quality bands")} columns={cols} rows={rows} rowKey={(r) => r.key} height={320} />
            {edit && (
              <form className="mx-col" onSubmit={(e) => { e.preventDefault(); if (dim) void run(() => putQualityThreshold({ module: mod, dimension: dim, ...bands }), t("Bands saved."), ["settings"]); }}>
                <Field label={t("Module")} hint={t("Use * for the tenant default.")}>
                  <Input list="mx-band-modules" value={mod} onChange={(e) => setMod(e.target.value.trim() || "*")} />
                </Field>
                <datalist id="mx-band-modules">{modules.map((m) => <option key={m} value={m} />)}</datalist>
                <Field label={t("Dimension")}>
                  <Select value={dim} onChange={(e) => setDim(e.target.value)} options={[{ value: "", label: t("Choose a dimension") }, ...dims.map((d) => ({ value: d, label: labelText(d) }))]} />
                </Field>
                <Num label={t("Target")} value={bands.target} max={100} onChange={(v) => setBands({ ...bands, target: v })} />
                <Num label={t("Warning")} value={bands.warning} max={100} onChange={(v) => setBands({ ...bands, warning: v })} />
                <Num label={t("Critical")} value={bands.critical} max={100} onChange={(v) => setBands({ ...bands, critical: v })} />
                <div className="mx-links"><Button variant="primary" type="submit" disabled={busy || !dim}>{t("Save bands")}</Button></div>
              </form>
            )}
          </Card>
        </>
      )}
    </Frame>
  );
}
