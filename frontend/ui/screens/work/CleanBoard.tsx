"use client";

/**
 * The top of the Clean route: one clean cycle of one object, from the pull to the new score. Every figure is read from
 * an existing endpoint; where none exists the section says so or leaves the figure out (see the report of this change).
 */
import { isAnalysed } from "@/lib/v2/run-label";
import "./clean.css";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { getCleaningMetrics } from "@/lib/api/v2/cleaning";
import { downloadCleaningWorkbook, uploadCleaned } from "@/lib/api/v2/roundtrip";
import { checkWorkbook, checkSentence, flagReason, type UploadChecks } from "@/lib/api/v2/upload-checks";
import { postAcceptAll } from "@/lib/api/v2/work";
import { useRunsInfinite } from "@/lib/api/next/runs";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { useLandscape, useReceipt } from "@/lib/v2/queries";
import { systemForModule } from "@/lib/v2/score";
import { useWorkGroups } from "@/lib/v2/work-queries";
import { Button, Card, Chip, Confirm, EmptyState, ErrorState, FieldChip, PageHeader, ScoreRuler, Skeleton, Stepper, useAletheia, useAletheiaScope, useToast } from "@/ui/kit";
import { compactCount, score } from "../object/format";
import { day, fieldText, useDo } from "./shared";

const GATE = 70;
const labels = () => ({ atRisk: t("At risk"), go: t("Go"), cap70: t("Cap at 70"), cap85: t("Cap at 85"), measured: (n: number) => t("Measured {n}", { n }) });

/** One cell of the weekly chart: a week and what happened in it, for the object on the board. */
interface Week { period: string; applied: number; verified: number; rolled: number }

function WeeklyChart({ weeks }: { weeks: Week[] }) {
  const W = 480, H = 150, L = 34, R = 8, T = 10, B = 26;
  const max = Math.max(1, ...weeks.flatMap((w) => [w.applied, w.verified]));
  const x = (i: number) => L + (weeks.length === 1 ? 0 : (i * (W - L - R)) / (weeks.length - 1));
  const y = (v: number) => T + ((max - v) * (H - T - B)) / max;
  const line = (k: "applied" | "verified") => weeks.map((w, i) => `${x(i)},${y(w[k])}`).join(" ");
  return (
    <svg className="mx-clean-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Findings applied and verified by week")}>
      <line className="mx-rl-gate" x1={L} x2={W - R} y1={y(0)} y2={y(0)} />
      <text className="mx-ruler-ax" x={L - 4} y={y(max) + 4} textAnchor="end" fontSize={10}>{compactCount(max)}</text>
      <text className="mx-ruler-ax" x={L - 4} y={y(0) + 4} textAnchor="end" fontSize={10}>0</text>
      <polyline className="mx-rl-measured" points={line("verified")} fill="none" />
      <polyline className="mx-rl-shown" points={line("applied")} fill="none" />
      {weeks.map((w, i) => <circle key={w.period} className="mx-rl-dot" cx={x(i)} cy={y(w.applied)} r={3} />)}
      <text className="mx-ruler-ax" x={L} y={H - 4} fontSize={10}>{weeks[0].period}</text>
      <text className="mx-ruler-ax" x={W - R} y={H - 4} textAnchor="end" fontSize={10}>{weeks[weeks.length - 1].period}</text>
      <title>{t("Applied, verified")}</title>
    </svg>
  );
}

export function CleanBoard({ module: initial, onReview }: { module?: string | null; onReview?: (checkId: string) => void }) {
  useInterfaceLang();
  const fx = useFixture();
  const chat = useAletheia();
  const run = useDo();
  const toast = useToast();
  const [approving, setApproving] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [chk, setChk] = useState<UploadChecks | null>(null);
  const [applied, setApplied] = useState(false);
  const [askAll, setAskAll] = useState(false);

  const landscape = useLandscape(null);
  const L = landscape.data;
  const objects = L?.objects ?? [];
  const mod = chosen ?? initial ?? objects[0]?.module ?? null;
  const object = objects.find((o) => o.module === mod);
  const system = L && mod ? systemForModule(L.systems, L.cells, mod) : undefined;
  const cell = L?.cells.find((c) => c.module === mod && c.system_id === system?.id);
  const runs = useRunsInfinite(system?.id ?? null, mod);
  const heads = runs.data?.pages.flatMap((p) => p.versions) ?? [];
  const head = heads.find((h) => isAnalysed(h.status)) ?? heads[0] ?? null;
  const receipt = useReceipt(mod ?? "", head?.id ?? null, !!mod && !!head).data;
  const groups = useWorkGroups({ module: mod ?? undefined }, !!mod).data?.groups ?? [];
  const metrics = useQuery({ queryKey: ["v2", "clean-board-metrics", fx], queryFn: getCleaningMetrics, retry: false });

  const proposed = groups.filter((g) => g.proposed > 0).sort((a, b) => b.proposed - a.proposed);
  const proposedTotal = proposed.reduce((n, g) => n + g.proposed, 0);
  const ready = chk && chk.verdict !== "fail" ? chk.edits : 0;
  const rejected = chk?.flagged_total ?? chk?.flagged?.length ?? 0;
  const runNo = head?.run_number ?? null;
  const records = receipt?.records_checked ?? cell?.records_checked ?? null;
  const shown = receipt?.score ?? cell?.score ?? null;
  const measured = receipt?.measured ?? cell?.raw_score ?? null;
  const dq = (h: (typeof heads)[number]) => h.dqs_summary?.[mod ?? ""];
  const step = !head ? 0 : applied ? 3 : chk ? 2 : 1;

  useAletheiaScope({
    key: "work", label: t("Asking about your work"),
    suggestions: [t("What should I clean first?"), t("Is auto-cleanse safe here?"), t("What should I fix first?")],
    context: { ...(mod ? { module: mod } : {}), ...(head ? { version_id: head.id } : {}) },
    answer: (prompt) => {
      const top = [...groups].sort((a, b) => b.records - a.records);
      if (prompt === t("Is auto-cleanse safe here?")) {
        return { text: t("Every fix is logged and can be rolled back. {n} fixes are proposed across {r} rules. Review a rule before you approve it.", { n: proposedTotal, r: proposed.length }), evidence: proposed.slice(0, 3).map((g) => `${g.check_id}: ${g.proposed}`), actions: [] };
      }
      if (prompt === t("What should I clean first?")) {
        const g = proposed[0] ?? top[0];
        return { text: g ? t("Start with {rule}: {n} records wait, {p} have a proposed fix.", { rule: g.check_id, n: g.records, p: g.proposed }) : t("No rule has work in this view."), evidence: (proposed.length ? proposed : top).slice(0, 3).map((x) => `${x.check_id}: ${x.records}`), actions: [] };
      }
      if (prompt !== t("What should I fix first?")) return null;
      return { text: t("{n} rules have records waiting. Start with {rule}.", { n: groups.length, rule: groups[0]?.check_id ?? "" }), evidence: groups.slice(0, 3).map((g) => `${g.check_id}: ${g.records}`), actions: [] };
    },
  });

  const onFile = (f: File | null) => {
    if (!f || !head) return;
    setFile(f); setApplied(false);
    void run(() => checkWorkbook(f, head.id, mod ?? undefined), () => t("File checked.")).then((r) => setChk(r));
  };
  const apply = () => {
    if (!file || !head || !chk) return;
    void run(() => uploadCleaned(file, head.id, mod ?? undefined, true, rejected > 0), (r) => t("{n} rows applied. Rescoring.", { n: r.applied })).then((r) => { if (r) setApplied(true); });
  };
  const download = () => { if (head && mod) void run(() => downloadCleaningWorkbook(head.id, mod), () => t("Workbook saved.")); };
  /** Accepts every proposed rule, one at a time. A failed rule is counted, not hidden, and the rest still run. */
  const approveAll = () => {
    if (approving) return;
    setApproving(true);
    let failed = 0;
    void run(async () => {
      let n = 0;
      for (const g of proposed) {
        try { const r = await postAcceptAll(g.check_id); n += r.accepted ?? r.updated ?? 0; } catch { failed += 1; }
      }
      return n;
    }, (n) => t("{n} fixes accepted.", { n })).then(() => { if (failed) toast(t("{f} rules failed. Try again.", { f: failed }), "bad"); }).finally(() => setApproving(false));
  };

  // Weekly chart: the cleaning metrics of this object, oldest week first.
  const weeks: Week[] = (metrics.data?.metrics ?? []).filter((m) => m.object_type === mod)
    .sort((a, b) => a.period.localeCompare(b.period)).slice(-12)
    .map((m) => ({ period: m.period.slice(0, 10), applied: m.applied, verified: m.verified, rolled: m.rolled_back }));
  const lastWeek = weeks[weeks.length - 1];

  // Cycles: the object's runs, oldest first. A cycle is one run; no cycle record exists yet.
  const cycles = heads.slice(0, 6).reverse().map((h) => {
    const s = dq(h);
    return { id: h.id, n: h.run_number ?? null, at: day(h.run_at), measured: s?.raw_score ?? s?.composite_score ?? null };
  }).filter((c): c is typeof c & { measured: number } => c.measured !== null);

  const sheetCount = 3;
  const sub = (a: string, b: string) => <><b>{a}</b> <span className="mx-muted">{b}</span></>;
  const flagged = new Map<string, { description: string; reasons: Map<string, number> }>();
  for (const c of chk?.flagged ?? []) {
    const e = flagged.get(c.field) ?? { description: fieldText(c.field, c.description), reasons: new Map<string, number>() };
    e.reasons.set(c.reason, (e.reasons.get(c.reason) ?? 0) + 1);
    flagged.set(c.field, e);
  }

  const switcher = (
    <div className="mx-chips" role="group" aria-label={t("Object")}>
      {objects.map((o) => <Chip key={o.module} selected={o.module === mod} onClick={() => { setChosen(o.module); setFile(null); setChk(null); setApplied(false); }}>{o.label}</Chip>)}
    </div>
  );
  const canApply = !!file && !!chk && chk.verdict !== "fail" && ready > 0 && !applied;
  const applyLabel = ready > 0 ? t("Apply {n} and rescore", { n: compactCount(ready) }) : t("Apply and rescore");

  if (landscape.isLoading) return <Skeleton lines={6} label={t("Loading the clean cycle")} />;
  if (landscape.isError) return <ErrorState heading={t("The clean cycle could not be loaded")} retryLabel={t("Try again")} onRetry={() => void landscape.refetch()} />;
  if (!mod || !object) return <EmptyState heading={t("No object is licensed to clean")} body={t("Ask an administrator to license an object, then pull it.")} action={<Button href={withFixture("/o", fx)}>{t("Open objects")}</Button>} />;

  return (
    <div className="mx-clean">
      <nav className="mx-crumb" aria-label={t("Where you are")}>
        <span>{t("Clean")}</span> / <span>{object.label}{system ? `, ${system.name}` : ""}</span>
      </nav>
      <PageHeader
        title={t("Clean cycle")}
        context={head ? t("Run {n}, pulled {date}", { n: runNo ?? "", date: day(head.run_at) }) : ""}
        actions={<>
          {chk || !head ? <Button variant="primary" disabled={!canApply} onClick={apply}>{applyLabel}</Button>
            : <Button variant="primary" onClick={download}>{t("Download workbook")}</Button>}
          <Button href={withFixture("/approvals", fx)}>{t("Approvals")}</Button>
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
        </>}
        stepper={<Stepper label={t("Clean cycle steps")} current={step} steps={[
          { id: "pull", label: t("Pull") }, { id: "excel", label: t("Clean in Excel") },
          { id: "upload", label: t("Upload"), state: chk?.verdict === "fail" ? "error" : undefined }, { id: "dqs", label: t("New DQS") },
        ]} />} />

      {switcher}
      <ul className="mx-clean-steps" aria-label={t("State of each step")}>
        <li className="mx-clean-step" data-state={step === 0 ? "current" : "done"}>
          <span className="mx-clean-step-name">{t("Pull")}</span>
          <span>{head ? t("{n} records from {system}", { n: records === null ? "-" : compactCount(records), system: system?.name ?? "" }) : t("No run yet")}</span>
          {head ? <span className="mx-muted">{t("Run {n}, done {date}", { n: runNo ?? "", date: day(head.run_at) })}</span> : null}
        </li>
        <li className="mx-clean-step" data-state={step === 1 ? "current" : step > 1 ? "done" : "todo"}>
          <span className="mx-clean-step-name">{t("Clean in Excel")}</span>
          <span>{t("Download the workbook and type the fixes")}</span>
          <span className="mx-muted">{chk ? t("{n} rows changed", { n: chk.edits }) : t("No file yet")}</span>
        </li>
        <li className="mx-clean-step" data-state={step === 2 ? "current" : step > 2 ? "done" : "todo"}>
          <span className="mx-clean-step-name">{t("Upload")}</span>
          <span>{chk ? t("File checked: {v}", { v: chk.verdict === "fail" ? t("Failed") : chk.verdict === "warn" ? t("Warning") : t("Passed") }) : t("Choose the cleaned file")}</span>
          <span className="mx-muted">{chk ? t("{n} rows ready", { n: ready }) : ""}</span>
        </li>
        <li className="mx-clean-step" data-state={step === 3 ? "current" : "todo"}>
          <span className="mx-clean-step-name">{t("New DQS")}</span>
          <span>{t("Every rule is scored again")}</span>
          <span className="mx-muted">{receipt?.rules_measured != null ? t("{n} rules measured", { n: receipt.rules_measured }) : ""}</span>
        </li>
      </ul>

      <Card title={t("Score and gates")} sub={t("Shown score, measured score and the 70 and 85 gates")}>
        {shown === null ? <EmptyState heading={t("This run has no score for the object")} body={t("Pull the object again to score it.")} /> : (
          <>
            <ScoreRuler marks={[{ id: mod, label: object.label, shown, measured: receipt?.capped && measured !== null ? measured : null }]} labels={labels()} ariaLabel={t("Score of this object against the gates")} showName={false} />
            <div className="mx-clean-hold">
              {receipt?.breaches.length ? (
                <p className="mx-clean-sub">{t("Held by")}{" "}{receipt.breaches.slice(0, 3).map((b, i) => <span key={b.check_id}>{i ? ", " : ""}<span className="mx-code">{b.check_id}</span> {b.name}</span>)}</p>
              ) : null}
              <p className="mx-clean-sub">{chk ? t("{n} records are cleared by this upload.", { n: ready }) : t("Add a cleaned workbook to see how many records it clears.")}</p>
            </div>
          </>
        )}
      </Card>

      <Card title={t("Upload check")} sub={file ? file.name : t("No file yet")}
        action={<><input ref={pick} type="file" accept=".xlsx" hidden aria-label={t("Choose the cleaned file")} onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          <Button onClick={() => pick.current?.click()}>{file ? t("Replace file") : t("Choose file")}</Button></>}>
        {!chk ? <EmptyState heading={t("No upload to check yet")} body={t("Download the workbook, type the fixes in Excel, then choose the saved file here.")} /> : (
          <>
            <ul className="mx-tiles" aria-label={t("Upload counts")}>
              <li><b>{ready}</b> {t("Ready to apply")}</li>
              <li><b>{rejected}</b> {t("Rejected")}</li>
            </ul>
            <ul className="mx-clean-why" aria-label={t("Checks")}>
              {chk.checks.map((c) => <li key={c.id}>{c.status === "pass" ? t("Passed") : c.status === "warn" ? t("Warning") : t("Failed")}: {checkSentence(c.id)}</li>)}
            </ul>
            {flagged.size ? (
              <>
                <h3 className="mx-clean-sub">{t("Why {n} were rejected", { n: rejected })}</h3>
                <ul className="mx-clean-why">
                  {[...flagged].map(([code, e]) => (
                    <li key={code}><FieldChip code={code} description={e.description} /> {[...e.reasons].map(([r, n]) => `${flagReason(r)} (${n})`).join(", ")}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <div className="mx-links">
              <Button variant="secondary" disabled={!canApply} onClick={apply}>{applyLabel}</Button>
              <Button onClick={download}>{t("Download {n} to fix", { n: compactCount(rejected) })}</Button>
            </div>
          </>
        )}
      </Card>

      <div className="mx-clean-pair">
        <Card title={t("Findings and fixes by week")} sub={t("Applied is the solid line, verified the dashed line")}>
          {weeks.length < 2 ? <EmptyState heading={t("Not enough weeks yet")} body={t("The chart appears after two weeks of applied fixes.")} /> : (
            <>
              <WeeklyChart weeks={weeks} />
              <p className="mx-clean-sub">{t("Week of {date}: {a} applied, {v} verified, {r} rolled back.", { date: lastWeek.period, a: lastWeek.applied, v: lastWeek.verified, r: lastWeek.rolled })}</p>
            </>
          )}
        </Card>

        <Card title={t("Auto-cleanse")} sub={t("{n} proposed fixes", { n: proposedTotal })}>
          {!proposed.length ? <EmptyState heading={t("No fix is proposed for this object")} body={t("Clean the open findings in the workbook instead.")} /> : (
            <>
              <ul className="mx-clean-list">
                {proposed.slice(0, 5).map((g) => (
                  <li key={g.check_id} className="mx-clean-row">
                    <span><span className="mx-code">{g.check_id}</span> {g.message ?? ""}{g.field ? <span className="mx-clean-sub"><FieldChip code={g.field} description={fieldText(g.field)} /></span> : null}</span>
                    <span className="mx-clean-bar" aria-hidden="true"><span style={{ width: `${Math.round((g.proposed / proposed[0].proposed) * 100)}%` }} /></span>
                    <span className="mx-clean-num">{compactCount(g.proposed)}</span>
                    <Button variant="ghost" onClick={() => onReview?.(g.check_id)}>{t("Review")}</Button>
                  </li>
                ))}
              </ul>
              <div className="mx-links">
                <Button variant="secondary" disabled={approving} onClick={() => setAskAll(true)}>{t("Approve all {n}", { n: compactCount(proposedTotal) })}</Button>
                <span className="mx-clean-sub">{t("Every fix is logged and can be rolled back.")}</span>
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="mx-clean-pair">
        <Card title={t("Cycles so far")} sub={cycles.length ? t("Measured score, {a} to {b}, gate at 70", { a: score(Math.min(...cycles.map((c) => c.measured))), b: score(Math.max(...cycles.map((c) => c.measured))) }) : undefined}>
          {cycles.length < 2 ? <EmptyState heading={t("Not enough runs yet")} body={t("The cycles appear after the second run of this object.")} /> : (
            <>
              {cycles.map((c) => (
                <div key={c.id} className="mx-clean-cycle">
                  <span>{t("Run {n}", { n: c.n ?? "" })}</span>
                  <span className="mx-clean-track" role="img" aria-label={score(c.measured)}><span style={{ width: `${Math.min(100, c.measured)}%` }} /><i style={{ insetInlineStart: `${GATE}%` }} /></span>
                  <span>{sub(score(c.measured), c.at)}</span>
                </div>
              ))}
              <p className="mx-clean-sub">{t("The score moved from {a} to {b} over {n} runs. The latest run is {side} the 70 gate.", { a: score(cycles[0].measured), b: score(cycles[cycles.length - 1].measured), n: cycles.length, side: cycles[cycles.length - 1].measured >= GATE ? t("above") : t("below") })}</p>
            </>
          )}
        </Card>

        <Card title={t("The workbook")} sub={head ? t("Built for run {n}", { n: runNo ?? "" }) : undefined}>
          <div className="mx-clean-sheet"><span className="mx-code">{t("Sheet {n}", { n: 1 })}</span>{sub(t("Start here"), t("what to change, in plain steps, with one worked example"))}</div>
          <div className="mx-clean-sheet"><span className="mx-code">{t("Sheet {n}", { n: 2 })}</span>{sub(t("Fix list"), t("one row per open finding, the rule and its description, the value now, a cell to type the fix"))}</div>
          <div className="mx-clean-sheet"><span className="mx-code">{t("Sheet {n}", { n: sheetCount })}</span>{sub(t("Allowed values"), t("every code with its description, as a dropdown on the fix cell"))}</div>
          <div className="mx-links"><Button onClick={download} disabled={!head}>{t("Download workbook again")}</Button></div>
        </Card>
      </div>
      <Confirm open={askAll} title={t("Approve all {n} proposed fixes?", { n: compactCount(proposedTotal) })} confirmLabel={t("Approve all")} cancelLabel={t("Cancel")} onConfirm={() => { setAskAll(false); approveAll(); }} onCancel={() => setAskAll(false)}>
        <p>{t("The fixes cover {r} rules of {object}. Each one is logged and you can roll it back.", { r: proposed.length, object: object.label })}</p>
      </Confirm>
    </div>
  );
}
