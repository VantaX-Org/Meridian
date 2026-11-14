"use client";

/**
 * The hero of the object page: where the object is, which run is shown, its score against the run before, and for a
 * paired system the source, projected and actual target score with the reasons they differ. One primary button opens
 * the cycle sheet at the step the object is on. The trend sits under it, its figures one click away.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AreaSpark, Button, LargeTitle, Popover, Ring } from "@/design/next/kit";
import { writeClipboard } from "@/lib/browser";
import { Coded, V2Link } from "@/design/v2/parts";
import { useSheets } from "@/design/next/shell/SheetHost";
import { getPairs } from "@/lib/api/v2/compare";
import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { useReceipt } from "@/lib/v2/queries";
import { downloadCleaningWorkbook, type ObjectCycle } from "@/lib/api/next/runs";
import { dqsOf, score, signed, statusOf } from "./model";
import { Trunc } from "./edge";
import { ObjectRunSwitcher } from "./RunSwitcher";
import { TrendStack } from "./TrendStack";
import type { ObjectRun } from "./useObjectRun";

const PRIMARY: Record<ObjectCycle["step"], () => string> = {
  pull: () => t("Pull now"),
  clean: () => t("Clean now"),
  upload: () => t("Upload workbook"),
  score: () => t("Score now"),
  compare: () => t("Compare runs"),
};

const val = (n: number | null | undefined) => (n === null || n === undefined ? "—" : score(n));

function Paired({ o }: { o: ObjectRun }) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["system-compare", "pairs", fx], queryFn: getPairs, staleTime: 60_000 });
  const pair = q.data?.pairs.find((p) => p.module === o.module && (p.source.id === o.systemId || p.target.id === o.systemId));
  const s = pair?.last?.scores;
  if (!pair) return null;
  return (
    <section className="nx-hero-pair" aria-label={t("Source and target scores")} data-testid="paired-scores">
      <h2 className="nx-sec-h">{t("{source} to {target}", { source: pair.source.name, target: pair.target.name })}</h2>
      <dl className="nx-paired-row nx-num">
        <div><dt>{t("Source DQS")}</dt><dd>{val(s?.source)}</dd>{s?.source == null ? <p className="nx-muted">{t("Not scored yet")}</p> : null}</div>
        <div><dt>{t("Projected target DQS")}</dt><dd>{val(s?.projected)}</dd>{s?.projected == null ? <p className="nx-muted">{s?.projected_reason ?? t("Not scored yet")}</p> : s.projected_reason ? <p className="nx-muted">{s.projected_reason}</p> : null}</div>
        <div><dt>{t("Actual target DQS")}</dt><dd>{val(s?.actual)}</dd>{s?.actual == null ? <p className="nx-muted">{s?.actual_reason ?? t("Not scored yet")}</p> : s.actual_reason ? <p className="nx-muted">{s.actual_reason}</p> : null}</div>
      </dl>
      {s && s.reasons.length ? (
        <div>
          <h3 className="nx-hero-why-h">{t("Why they differ")}</h3>
          <ul className="nx-paired-reasons">
            {s.reasons.slice(0, 5).map((r) => (
              <li key={r.check_id}><Coded code={r.check_id} text={r.description} first /> <span className="nx-num">({signed(r.change)})</span></li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function ObjectBar({ o, cycle }: { o: ObjectRun; cycle: ObjectCycle | null }) {
  const { open } = useSheets();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [menu, setMenu] = useState(false);
  const receipt = useReceipt(o.module, o.runId).data;
  const now = dqsOf(o.run, o.module);
  const before = dqsOf(o.previous, o.module);
  const delta = now !== null && before !== null ? now - before : null;
  const step = cycle?.step ?? "clean";
  const [busy, setBusy] = useState(false);
  const failed = o.run ? statusOf(o.run) === "failed" : false;
  const newest = o.heads[0];
  const series = o.heads.slice(0, 12).reverse().flatMap((h) => { const v = dqsOf(h, o.module); return v === null ? [] : [{ label: t("Run {n}", { n: h.run_number ?? "" }), value: v }]; });
  const stale = Boolean(newest && o.runId && newest.id !== o.runId);
  const download = () => {
    if (busy || !o.runId) return;
    setBusy(true);
    setMenu(false);
    downloadCleaningWorkbook(o.runId, o.module).catch(() => undefined).finally(() => setBusy(false));
  };
  const share = () => { setMenu(false); void writeClipboard(window.location.href); };

  return (
    <div className="nx-obar nx-hero" data-testid="object-bar" data-title-scope="">
      <nav aria-label={t("Breadcrumb")} className="nx-obar-crumbs">
        <V2Link href="/objects">{t("Objects")}</V2Link>
        <span aria-hidden="true">{"›"}</span>
        <V2Link href={`/s/${encodeURIComponent(o.systemSeg)}`}><Trunc text={o.systemName} /></V2Link>
      </nav>
      <LargeTitle
        title={o.label}
        subtitle={<><span className="nx-mono">{o.module}</span> {t("in {system}", { system: o.systemName })}</>}
        primary={{ label: PRIMARY[step](), onClick: () => open({ kind: "cycle", id: step }) }}
      />
      {failed ? (
        <div className="nx-banner" data-tone="bad" role="alert" data-testid="run-failed">
          <span>{t("Run {n} failed. Its scores are not final.", { n: o.run?.run_number ?? "" })}</span>
          <Button variant="secondary" size={32} onClick={() => open({ kind: "cycle", id: step })}>{t("Try again")}</Button>
        </div>
      ) : null}
      {stale && newest ? (
        <div className="nx-banner" role="status" data-testid="run-stale">
          <span>{t("A newer run exists: run {n}. You are looking at run {m}.", { n: newest.run_number ?? "", m: o.run?.run_number ?? "" })}</span>
          <Button variant="secondary" size={32} onClick={() => o.setRun(newest.id)}>{t("Show run {n}", { n: newest.run_number ?? "" })}</Button>
        </div>
      ) : null}
      <div className="nx-hero-row">
        <ObjectRunSwitcher o={o} onCompare={() => open({ kind: "compare", id: "" })} />
        <Button variant="secondary" size={32} onClick={() => open({ kind: "compare", id: "" })}>{t("Compare")}</Button>
        <Button ref={setAnchor} variant="quiet" size={32} aria-label={t("More actions")} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>{"…"}</Button>
        <Popover anchor={anchor} open={menu} onClose={() => setMenu(false)} label={t("More actions")} placement="bottom">
          <button type="button" role="menuitem" className="nx-menuitem" disabled={busy} aria-busy={busy} onClick={download}>{t("Download workbook")}</button>
          <button type="button" role="menuitem" className="nx-menuitem" onClick={share}>{t("Share")}</button>
        </Popover>
      </div>
      <div className="nx-hero-viz" data-testid="hero-viz">
        <Ring value={now} label={now === null ? t("Not scored yet") : t("DQS {score} of 100", { score: score(now) })} size={152}>
          <span className="nx-obar-dqs" data-testid="object-dqs">
            <span className="nx-obar-dqs-label">{t("DQS")}</span>
            <strong className="nx-hero-score nx-num">{now === null ? "—" : score(now)}</strong>
            {delta !== null ? (
              <span className="nx-num nx-obar-delta" data-tone={delta > 0 ? "good" : delta < 0 ? "bad" : "neutral"}>
                {signed(delta)} <span className="nx-sr">{t("against run {n}", { n: o.previous?.run_number ?? "" })}</span>
              </span>
            ) : null}
          </span>
        </Ring>
        <AreaSpark points={series} label={t("DQS over the last {n} runs", { n: series.length })} empty={t("Not enough runs for a trend yet")} />
      </div>
      {receipt ? (
        <p className="nx-hero-cap">
          {receipt.capped && receipt.cap_level !== null
            ? t("Capped at {cap} by {n} critical rules.", { cap: score(receipt.cap_level), n: receipt.breaches.length })
            : t("No critical rule caps this score.")}{" "}
          <Button variant="quiet" size={32} onClick={() => open({ kind: "score", id: o.module })}>{t("How this is scored")}</Button>
          <span className="nx-aletheia-by">{t("Scored by Aletheia")}</span>
        </p>
      ) : null}
      <Paired o={o} />
      <TrendStack o={o} />
    </div>
  );
}
