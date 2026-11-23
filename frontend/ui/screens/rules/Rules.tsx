"use client";

import "./rules.css";
import { useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { formatModuleName } from "@/lib/format";
import { exportRulesBulk, importRulesBulk, type BulkResult } from "@/lib/api/v2/roles";
import type { Rule } from "@/lib/api/rules";
import { Button, Card, Chip, DataTable, EmptyState, ErrorState, FieldChip, PageHeader, Search, Select, SeverityPill, Skeleton, StatTile, useAletheia, useAletheiaScope, useSheet, useToast, type Column } from "@/ui/kit";
import type { Severity } from "@/ui/kit/SeverityStrip";
import { compactCount, pct, ruleCheck, SEVERITIES, sevLabel } from "./format";
import { useAct, useRuleLibrary } from "./queries";
import { CoverageView, DraftsView, FixDraftsView, LearnedView, PacksView } from "./RulesViews";

const VIEWS = ["library", "drafts", "learned", "coverage", "packs", "fix-drafts"] as const;
type View = (typeof VIEWS)[number];
const viewLabel = (v: View) => (v === "library" ? t("Library") : v === "drafts" ? t("Drafts") : v === "learned" ? t("Learned") : v === "coverage" ? t("Coverage") : v === "packs" ? t("Policy packs") : t("Fix drafts"));

/** The rule library and everything around it: authoring, learned rules, coverage, packs, fix drafts. Journey J5 step one. */
export function Rules() {
  useInterfaceLang();
  const fx = useFixture();
  const chat = useAletheia();
  const sheet = useSheet();
  const toast = useToast();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const raw = params.get("view");
  const view: View = (VIEWS as readonly string[]).includes(raw ?? "") ? (raw as View) : "library";
  const lib = useRuleLibrary();
  const rules = lib.data?.rules ?? [];
  const modules = [...new Set(rules.map((r) => r.module))].sort();
  const href = (p: string) => withFixture(p, fx);
  const [q, setQ] = useState("");
  const [sev, setSev] = useState<string | null>(null);
  const [module, setModule] = useState("");
  const [bulk, setBulk] = useState<{ format: "yaml" | "xlsx"; content: string; result: BulkResult } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const go = (v: View) => { const p = new URLSearchParams(params.toString()); if (v === "library") p.delete("view"); else p.set("view", v); const s = p.toString(); router.replace(s ? `${path}?${s}` : path); };

  useAletheiaScope({
    key: "rules",
    label: t("Asking about the rule library"),
    suggestions: [t("Which rules fail the most records?"), t("Which objects have the fewest rules?")],
    answer: (prompt) => {
      const worst = [...rules].filter((r) => r.last_affected_count).sort((a, b) => (b.last_affected_count ?? 0) - (a.last_affected_count ?? 0)).slice(0, 3);
      if (prompt === t("Which objects have the fewest rules?")) {
        const by = modules.map((m) => ({ m, n: rules.filter((r) => r.module === m).length })).sort((a, b) => a.n - b.n).slice(0, 3);
        return { text: by.map((x) => t("{module} has {n} rules", { module: formatModuleName(x.m), n: x.n })).join(". "), evidence: by.map((x) => formatModuleName(x.m)), actions: [{ id: "cov", label: t("Open coverage"), onClick: () => { go("coverage"); chat.setOpen(false); } }] };
      }
      return { text: worst.map((r) => `${ruleCheck(r)}: ${compactCount(r.last_affected_count ?? 0)}`).join(", ") || t("No rule has run yet."), evidence: worst.map((r) => r.name), actions: [{ id: "lib", label: t("Open the library"), onClick: () => { go("library"); chat.setOpen(false); } }] };
    },
  });

  const shown = rules.filter((r) => (!q || `${ruleCheck(r)} ${r.name} ${r.description}`.toLowerCase().includes(q.toLowerCase())) && (!sev || r.severity === sev) && (!module || r.module === module));
  const cols: Column<Rule>[] = [
    { key: "rule", label: t("Rule"), render: (r) => <FieldChip code={ruleCheck(r)} description={r.name.slice(ruleCheck(r).length).replace(/^\s*:\s*/, "")} />, sort: (r) => ruleCheck(r) },
    { key: "mod", label: t("Object"), render: (r) => formatModuleName(r.module), sort: (r) => r.module },
    { key: "sev", label: t("Severity"), render: (r) => <SeverityPill sev={r.severity as Severity} label={sevLabel(r.severity)} />, sort: (r) => SEVERITIES.indexOf(r.severity as (typeof SEVERITIES)[number]) },
    { key: "on", label: t("State"), render: (r) => (r.enabled ? t("On") : t("Off")), sort: (r) => Number(r.enabled) },
    { key: "pass", label: t("Pass rate"), render: (r) => pct(r.last_pass_rate), sort: (r) => r.last_pass_rate ?? -1, align: "end" },
    { key: "fail", label: t("Records failing"), render: (r) => (r.last_affected_count == null ? t("n/a") : compactCount(r.last_affected_count)), sort: (r) => r.last_affected_count ?? -1, align: "end" },
  ];

  const doExport = useAct((f: "yaml" | "xlsx") => exportRulesBulk(f), () => t("Rules exported"));
  const pick = async (f: File | undefined) => {
    if (!f) return;
    const format = f.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "yaml";
    const content = format === "xlsx" ? btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer()))) : await f.text();
    try { setBulk({ format, content, result: await importRulesBulk(format, content, true) }); } catch (e) { toast(e instanceof Error ? e.message : t("The change did not go through"), "bad"); }
  };
  const doImport = useAct(async () => { if (bulk) { await importRulesBulk(bulk.format, bulk.content, false); setBulk(null); } }, () => t("Rules imported"));

  const enabled = rules.filter((r) => r.enabled).length;
  const failing = rules.reduce((n, r) => n + (r.last_affected_count ?? 0), 0);

  return (
    <div className="mx-col">
      <PageHeader
        title={t("Rules")}
        context={t("Every check Meridian runs, and the tools to write, tune and switch them on.")}
        actions={
          <>
            <Button variant="secondary" href={href("/rules/dry-run")}>{t("Write a rule")}</Button>
            <Button variant="secondary" href={href("/rules/promotion")}>{t("Rule promotion")}</Button>
            <Button variant="secondary" href={href("/admin/scoring")}>{t("Scoring weights and thresholds")}</Button>
            <Button variant="secondary" disabled={doExport.isPending} onClick={() => doExport.mutate("yaml")}>{t("Export YAML")}</Button>
            <Button variant="secondary" disabled={doExport.isPending} onClick={() => doExport.mutate("xlsx")}>{t("Export Excel")}</Button>
            <Button variant="secondary" onClick={() => file.current?.click()}>{t("Import rules")}</Button>
            <Button variant="primary" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
          </>
        }
      />
      <input ref={file} type="file" accept=".yaml,.yml,.xlsx" hidden aria-label={t("Rule file to import")} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      {bulk ? (
        <Card title={t("Import check")} sub={t("{valid} of {total} rules are valid", { valid: bulk.result.valid, total: bulk.result.total })} action={<Button variant="ghost" onClick={() => setBulk(null)}>{t("Cancel")}</Button>}>
          <ul className="mx-rules-list" aria-label={t("Import rows")}>
            {bulk.result.rows.filter((r) => !r.ok).map((r) => <li key={r.row} className="mx-rules-item"><span>{t("Row {n}", { n: r.row })}</span><span className="mx-muted">{r.errors.join(", ")}</span></li>)}
          </ul>
          <Button variant="primary" disabled={!bulk.result.valid || doImport.isPending} onClick={() => doImport.mutate(undefined)}>{t("Import {n} rules", { n: bulk.result.valid })}</Button>
        </Card>
      ) : null}

      <div className="mx-rules-row" role="group" aria-label={t("Rule views")}>
        {VIEWS.map((v) => <Chip key={v} selected={v === view} onClick={() => go(v)}>{viewLabel(v)}</Chip>)}
      </div>

      {view === "drafts" ? <DraftsView /> : null}
      {view === "learned" ? <LearnedView modules={modules} /> : null}
      {view === "coverage" ? <CoverageView modules={modules} /> : null}
      {view === "packs" ? <PacksView /> : null}
      {view === "fix-drafts" ? <FixDraftsView fixture={fx} /> : null}
      {view === "library" ? (
        lib.isLoading ? <Skeleton lines={6} label={t("Loading the rules")} />
        : lib.isError ? <ErrorState heading={t("The rules could not be loaded")} retryLabel={t("Try again")} onRetry={() => void lib.refetch()} />
        : (
          <>
            <dl className="mx-tiles">
              <StatTile label={t("Rules")} value={compactCount(rules.length)} />
              <StatTile label={t("Switched on")} value={compactCount(enabled)} bar={rules.length ? enabled / rules.length : 0} />
              <StatTile label={t("Objects covered")} value={compactCount(modules.length)} />
              <StatTile label={t("Records failing")} value={compactCount(failing)} />
            </dl>
            <div className="mx-rules-row">
              <Search value={q} onChange={setQ} label={t("Search rules")} clearLabel={t("Clear search")} placeholder={t("Search by rule, field or text")} />
              <Select aria-label={t("Object")} value={module} onChange={(e) => setModule(e.target.value)} options={[{ value: "", label: t("All objects") }, ...modules.map((m) => ({ value: m, label: formatModuleName(m) }))]} />
              <Chip selected={sev === null} onClick={() => setSev(null)}>{t("All severities")}</Chip>
              {SEVERITIES.map((s) => <Chip key={s} selected={sev === s} onClick={() => setSev(sev === s ? null : s)} count={rules.filter((r) => r.severity === s).length}>{sevLabel(s)}</Chip>)}
            </div>
            {shown.length ? (
              <DataTable columns={cols} rows={shown} rowKey={(r) => r.id} label={t("Rule library")} height={520} selected={null} onSelect={(r) => sheet.open("library-rule", { id: r.id })} />
            ) : <EmptyState heading={t("No rule matches")} body={t("Clear the search or the severity to see every rule.")} />}
            <p className="mx-muted">{t("Pick a rule for its summary; open it for the fix, history and failing records.")}</p>
          </>
        )
      ) : null}
    </div>
  );
}
