"use client";

/** Run analysis: choose the system, choose objects, choose the target and templates, start. Reads from the system, then scores. */
import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { ErrorState, NxLink, Skeleton, StepFlow, type FlowStep } from "@/design/next/kit";
import { buildChoice, previewLine } from "@/design/v2/admin/ExtractTargetStep";
import { startExtraction } from "@/lib/api/v2/admin";
import type { ExtractTargetChoice } from "@/lib/api/v2/extract-target";
import { useFixture } from "@/lib/api/v2/fixture";
import { getTemplates } from "@/lib/api/v2/migration";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { useSystemsExtended } from "@/lib/v2/runs-queries";

type Start = (system: string, objects: string[], target?: ExtractTargetChoice) => Promise<unknown>;

export function AnalysisFlow({ systems, objects, start = (s, o, target) => startExtraction(s, o, true, {}, false, target), onDone }: {
  systems: { id: string; name: string }[]; objects: string[]; start?: Start; onDone?: () => void;
}) {
  const [sys, setSys] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [targetSys, setTargetSys] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const target = useTarget(sys, picked, targetSys, picks);
  const steps: FlowStep[] = [
    { id: "system", label: t("System"), blocked: sys ? undefined : t("Choose a system."),
      body: <div role="radiogroup" aria-label={t("System")}>{systems.map((s) => <label key={s.id} className="nx-field"><span><input type="radio" name="sys" checked={sys === s.id} onChange={() => { setSys(s.id); setTargetSys(null); }} /> {s.name}</span></label>)}</div> },
    { id: "objects", label: t("Objects"), blocked: picked.length ? undefined : t("Choose at least one object."),
      body: <ul className="nx-checks">{objects.map((o) => <li key={o}><label><input type="checkbox" checked={picked.includes(o)} onChange={(e) => setPicked(e.target.checked ? [...picked, o] : picked.filter((x) => x !== o))} /> {labelText(o)}</label></li>)}</ul> },
    { id: "target", label: t("Target"), body: <TargetBody target={target} onSystem={setTargetSys} onPick={(m, id) => setPicks((p) => ({ ...p, [m]: id }))} /> },
    { id: "start", label: t("Start"), next: { label: t("Start analysis"), run: () => start(sys, picked, target.choice) },
      body: <><p>{t("Meridian reads {n} objects from the system and scores them.", { n: picked.length })}</p><p className="nx-reason" data-testid="extract-target-preview">{previewLine(target.rows)}</p></> },
  ];
  return <StepFlow steps={steps} label={t("Run analysis")} onFinish={onDone} />;
}

/** The target system (paired unless changed) and, per object, the template to fill (newest unless changed, or none). */
function useTarget(system: string, modules: string[], sys: string | null, picks: Record<string, string>) {
  const fixture = useFixture();
  const systems = useSystemsExtended();
  const all = systems.data ?? [];
  const paired = all.find((s) => s.id === system)?.target_system_id ?? null;
  const options = all.filter((s) => s.id !== system && (s.role === "target" || s.id === paired));
  const chosen = sys ?? paired ?? "";
  const tpls = useQueries({
    queries: modules.map((m) => ({ queryKey: ["v2", "extract-target-templates", fixture, m], queryFn: () => getTemplates(m), retry: false, staleTime: 30_000 })),
  });
  const rows = modules.map((m, i) => {
    const q = tpls[i];
    const list = [...(q?.data?.templates ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const pick = m in picks ? picks[m]! : list[0]?.id ?? "";
    return { module: m, list, loading: !!q?.isLoading, error: q?.isError ? q.error : null, retry: () => void q?.refetch(), picked: pick, name: list.find((x) => x.id === pick)?.name ?? null };
  });
  return { systems, paired, options, chosen, rows, choice: buildChoice(paired, chosen || null, picks, modules) };
}

function TargetBody({ target, onSystem, onPick }: { target: ReturnType<typeof useTarget>; onSystem: (id: string) => void; onPick: (module: string, id: string) => void }) {
  const { systems, paired, options, chosen, rows } = target;
  if (systems.isLoading) return <Skeleton lines={2} label={t("Reading systems")} />;
  if (systems.isError) return <ErrorState error={systems.error} fallback={t("Could not read the systems.")} onRetry={() => void systems.refetch()} />;
  return (
    <div data-testid="extract-target-step">
      <label className="nx-field">
        <span>{t("Target system")}</span>
        <select className="nx-input" value={chosen} onChange={(e) => onSystem(e.target.value)} data-testid="extract-target-system">
          {!chosen ? <option value="">{t("No target system")}</option> : null}
          {options.map((s) => <option key={s.id} value={s.id}>{`${s.name} (${s.role === "target" ? t("target system") : t("source system")}${s.id === paired ? t(", paired") : ""})`}</option>)}
        </select>
        <span className="nx-reason">{t("The system the extracted data is being prepared for. Defaults to the one paired with this system.")}</span>
      </label>
      {!paired && options.length === 0 ? <p className="nx-reason" data-testid="extract-target-nopair">{t("No target system is paired with this system. Pair one under Systems to prepare data for it.")}</p> : null}
      <ul className="nx-checks" aria-label={t("Target templates")}>
        {rows.map((r) => (
          <li key={r.module}>
            {r.loading ? <Skeleton lines={1} label={t("Reading templates…")} />
              : r.error ? <ErrorState error={r.error} fallback={t("Could not read the templates for {object}.", { object: labelText(r.module) })} onRetry={r.retry} />
              : r.list.length === 0 ? (
                <span className="nx-reason" data-testid={`extract-target-none-${r.module}`}>{labelText(r.module)}: {t("No template uploaded yet.")} <NxLink href="/migration">{t("Upload a template")}</NxLink></span>
              ) : (
                <label className="nx-field">
                  <span>{t("Template for {object}", { object: labelText(r.module) })}</span>
                  <select className="nx-input" value={r.picked} onChange={(e) => onPick(r.module, e.target.value)} data-testid={`extract-target-tpl-${r.module}`}>
                    <option value="">{t("None")}</option>
                    {r.list.map((x) => <option key={x.id} value={x.id}>{`${x.name}, ${t("version {v}", { v: x.version })}`}</option>)}
                  </select>
                </label>
              )}
          </li>
        ))}
      </ul>
    </div>
  );
}
