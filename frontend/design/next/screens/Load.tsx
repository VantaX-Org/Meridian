"use client";

/**
 * The Load area: Prepare (target, check, files) and the existing migration screens as tabs. The tab is a path
 * segment under /load; step, target, run and objects are query so a reload or a shared link lands in the same place.
 */
import { useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, EmptyState, Tabs, Stepper, Skeleton, ErrorState, type StepItem } from "@/design/next/kit";
import { downloadBlankTemplate } from "@/lib/api/v2/migration";
import { pushSheet, sheetsOf, withSheets } from "@/lib/next/sheet";
import { useV2Session } from "@/lib/v2/hooks";
import { PairedTrio } from "../load/PairedTrio";
import { StaleNudge, Denied } from "../load/states";
import { V2Link } from "@/design/v2/parts";
import { Migration } from "@/design/v2/screens/Migration";
import { SystemCompare } from "@/design/v2/screens/SystemCompare";
import { LoadPlan } from "@/design/v2/screens/LoadPlan";
import { S4Readiness } from "@/design/v2/screens/S4Readiness";
import { FlightDeck } from "@/design/v2/screens/FlightDeck";
import { t } from "@/lib/v2/i18n";
import { useLoadRuns } from "@/lib/api/next/load";
import { ChooseTarget } from "../load/ChooseTarget";
import { Validate } from "../load/Validate";
import { Files } from "../load/Files";
import { History } from "../load/History";
import { LOAD_TABS, isStep, isTarget, loadTabLabel, type LoadTab, type Step } from "../load/tabs";
import "../load/load.css";

const ID = "nx-load";

export function Load({ tab }: { tab: LoadTab }) {
  const router = useRouter();
  const params = useSearchParams();
  const runs = useLoadRuns();
  const session = useV2Session();
  const openSheet = (kind: string, id: string) => router.push(`/load?${withSheets(params, pushSheet(sheetsOf(params), { kind, id }))}`, { scroll: false });

  const go = useCallback(
    (next: LoadTab, extra: Record<string, string | null> = {}) => {
      const q = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(extra)) if (v === null) q.delete(k); else q.set(k, v);
      const qs = q.toString();
      router.push(`/load${next === "prepare" ? "" : `/${next}`}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [params, router],
  );

  const target = isTarget(params.get("target")) ? (params.get("target") as "s4" | "sf" | "ecc" | "workbook") : "s4";
  const stepParam = params.get("step");
  const step: Step = isStep(stepParam) ? stepParam : "target";
  const list = runs.data ?? [];
  const run = list.find((r) => r.id === params.get("run")) ?? list[0] ?? null;
  const objsParam = params.get("objs");
  const objects = useMemo(() => {
    const all = run?.modules ?? [];
    if (objsParam === null) return all;
    return objsParam.split(",").filter((m) => all.includes(m));
  }, [objsParam, run]);

  const set = (extra: Record<string, string | null>) => go("prepare", extra);
  // A step past the first needs a run and objects; fall back to the first step when the link lacks them.
  const ready = !!run && objects.length > 0;
  useEffect(() => {
    if (tab === "prepare" && step !== "target" && !runs.isLoading && !ready) set({ step: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, step, ready, runs.isLoading]);

  const steps: StepItem[] = [
    { id: "target", label: t("Choose the target"), state: step === "target" ? "current" : "done" },
    { id: "validate", label: t("Check what fits"), state: step === "validate" ? "current" : step === "files" ? "done" : "future" },
    { id: "files", label: t("Load files"), state: step === "files" ? "current" : "future" },
  ];

  const prepare = () => {
    if (runs.isLoading) return <Skeleton lines={5} label={t("Loading the runs")} />;
    if (runs.isError) return <ErrorState sentence={t("The runs could not be loaded.")} error={runs.error} onRetry={() => void runs.refetch()} />;
    if (!session.can("export")) return <Denied right={t("export")} />;
    if (list.length === 0) return <div data-testid="load-empty"><EmptyState heading={t("No run to load from")}>{t("Run an analysis first. Its result is what the load files are built from.")}</EmptyState></div>;
    const failedRun = run && run.status === "failed";
    const newest = list[0];
    const mod = objects[0] ?? run?.modules[0] ?? "";
    return (
      <>
        {run && newest && newest.id !== run.id ? <StaleNudge newer={newest.id} onOpen={() => set({ run: newest.id, objs: null })} /> : null}
        {failedRun ? <div data-testid="load-failed"><ErrorState sentence={t("This run failed, so no files can be built from it. Pull again.")} onRetry={() => go("analysis")} /></div> : null}
        <div className="nx-ld-actions" data-testid="load-actions">
          <Button variant="primary" disabled={!run || Boolean(failedRun)} reason={t("Choose a run first.")} onClick={() => run && openSheet("load", run.id)}>{t("Open the load")}</Button>
          <Button variant="secondary" disabled={!mod} onClick={() => openSheet("templates", mod)}>{t("Migration templates")}</Button>
          <Button variant="secondary" icon="download" disabled={!mod} onClick={() => void downloadBlankTemplate(mod)}>{t("Download templates")}</Button>
        </div>
        <PairedTrio />
        <Stepper steps={steps} label={t("Steps")} onSelect={(id) => (id === "target" || ready) && set({ step: id })} />
        {step === "target" || !ready ? (
          <ChooseTarget
            runs={list}
            target={target}
            runId={run?.id ?? null}
            objects={objects}
            onTarget={(x) => set({ target: x })}
            onRun={(id) => set({ run: id, objs: null })}
            onObjects={(m) => set({ objs: m.join(",") })}
            onNext={() => set({ step: "validate", run: run?.id ?? null, objs: objects.join(",") })}
            onWorkbook={() => go("analysis")}
          />
        ) : step === "validate" ? (
          <Validate runId={run!.id} objects={objects} release={run!.target_release ?? "s4hana"} onBack={() => set({ step: "target" })} onBuild={() => set({ step: "files" })} />
        ) : (
          <Files runId={run!.id} objects={objects} onBack={() => set({ step: "validate" })} />
        )}
      </>
    );
  };

  const body = () => {
    switch (tab) {
      case "prepare": return prepare();
      case "analysis": return <Migration />;
      case "compare": return <SystemCompare />;
      case "plan": return <LoadPlan />;
      case "s4": return <S4Readiness />;
      case "go-live": return <FlightDeck />;
      case "waves": return (
        <section className="nx-ld-step" data-testid="load-waves">
          <h2>{t("Waves")}</h2>
          <p className="nx-ld-lede">{t("Waves group objects into the loads that go live together. They are planned on the landscape.")}</p>
          <V2Link className="nx-btn nx-btn-secondary" href="/?view=waves">{t("Open the waves")}</V2Link>
        </section>
      );
      case "history": return <History />;
    }
  };

  return (
    <div className="nx-load" data-testid="load-page">
      <h1 className="nx-load-h">{t("Load")}</h1>
      <div className="nx-load-tabs">
        <Tabs items={LOAD_TABS.map((id) => ({ id, label: loadTabLabel(id) }))} value={tab} onChange={(id) => go(id as LoadTab)} label={t("Load views")} idBase={ID} />
      </div>
      <section id={`${ID}-panel-${tab}`} role="tabpanel" aria-labelledby={`${ID}-tab-${tab}`} className="nx-load-panel" tabIndex={-1}>
        {body()}
      </section>
    </div>
  );
}
