"use client";

/**
 * The top of the Runs route: one object's runs on a shared scale, the figures of its newest run, and the two runs to
 * compare. Every figure is read from an existing endpoint; what no endpoint supplies is left out (see the change report).
 */
import { isAnalysed } from "@/lib/v2/run-label";
import { useState } from "react";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { exportRuns } from "@/lib/api/v2/run-ops";
import { useRunsInfinite } from "@/lib/api/next/runs";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { useLandscape, useReceipt } from "@/lib/v2/queries";
import { useTimeline } from "@/lib/v2/runs-queries";
import { systemForModule } from "@/lib/v2/score";
import { Button, Card, Chip, EmptyState, Skeleton, StatTile, useAletheiaScope, useSheet, useToast } from "@/ui/kit";
import { compactCount, dqsOf, score, signed } from "../object/format";
import { answer } from "./answers";
import { runPath } from "./util";
import "./runsboard.css";

const LO = 55, HI = 80;
const pos = (n: number) => `${Math.min(100, Math.max(0, ((n - LO) / (HI - LO)) * 100))}%`;

/** One run's place on the 55 to 80 stretch of the ruler: the 70 gate, the measured tick and the shown dot. */
export function MiniRuler({ shown, measured, name }: { shown: number; measured: number; name: string }) {
  return (
    <span className="rn-mini" role="img" aria-label={name}>
      <i className="rn-mini-gate" style={{ insetInlineStart: pos(70) }} />
      {measured !== shown && <i className="rn-mini-meas" style={{ insetInlineStart: pos(measured) }} />}
      <i className="rn-mini-dot" style={{ insetInlineStart: pos(shown) }} />
    </span>
  );
}

export function RunsBoard() {
  useInterfaceLang();
  const fx = useFixture();
  const sheet = useSheet();
  const toast = useToast();
  const [chosen, setChosen] = useState<string | null>(null);
  const [pickA, setPickA] = useState<string | null>(null);
  const [pickB, setPickB] = useState<string | null>(null);
  const landscape = useLandscape(null);
  const L = landscape.data;
  const objects = L?.objects ?? [];
  const mod = chosen ?? objects[0]?.module ?? null;
  const system = L && mod ? systemForModule(L.systems, L.cells, mod) : undefined;
  const runs = useRunsInfinite(system?.id ?? null, mod);
  const heads = runs.data?.pages.flatMap((p) => p.versions) ?? [];
  const head = heads.find((h) => isAnalysed(h.status)) ?? heads[0] ?? null;
  const receipt = useReceipt(mod ?? "", head?.id ?? null, !!mod && !!head).data;
  const timeline = useTimeline(system?.id ?? null, 8, mod ?? undefined).data?.runs ?? [];
  const tl = timeline.find((r) => r.id === head?.id);

  // Newest first, so a higher index is an older run. A is the older run of the pair, B the newer.
  const idx = (id: string | null) => heads.findIndex((h) => h.id === id);
  const b = heads[idx(pickB) >= 0 ? idx(pickB) : 0] ?? null;
  const a = heads[idx(pickA) >= 0 ? idx(pickA) : 1] ?? null;
  const pair = a && b && a.id !== b.id ? (idx(a.id) > idx(b.id) ? [a, b] : [b, a]) : null;
  const num = (h: { run_number?: number | null }) => (h.run_number != null ? t("Run {n}", { n: h.run_number }) : t("Run"));

  const rows = heads.slice(0, 12).map((h, i) => {
    const shown = dqsOf(h, mod ?? "");
    const prev = heads[i + 1] ? dqsOf(heads[i + 1], mod ?? "") : null;
    const raw = h.dqs_summary?.[mod ?? ""]?.raw_score ?? shown;
    return { h, shown, measured: raw, change: shown !== null && prev !== null ? shown - prev : null };
  });

  useAletheiaScope({
    key: "runs-board", label: t("Asking about these runs"),
    suggestions: [t("Which run was the turning point?")],
    context: { ...(mod ? { module: mod } : {}), ...(head ? { version_id: head.id } : {}) },
    answer: (prompt) => {
      if (prompt !== t("Which run was the turning point?")) return null;
      const moves = rows.filter((r) => r.change !== null);
      const top = [...moves].sort((x, y) => Math.abs(y.change ?? 0) - Math.abs(x.change ?? 0))[0];
      if (!top) return answer(t("There is nothing here to answer from yet."), []);
      return answer(t("{run} moved the score most: {change} points.", { run: num(top.h), change: signed(top.change ?? 0) }), moves.slice(0, 3).map((r) => `${num(r.h)}: ${signed(r.change ?? 0)}`));
    },
  });

  if (landscape.isLoading) return <Skeleton lines={5} label={t("Loading the runs")} />;
  if (!objects.length) return null;

  const exportOne = async () => {
    try { toast(t("Saved {name}", { name: await exportRuns("xlsx", { system_id: system?.id }) }), "good"); }
    catch { toast(t("The export did not work. Try again."), "bad"); }
  };
  const href = pair ? withFixture(`${runPath(pair[0].id)}/vs/${pair[1].id}`, fx) : null;
  const records = tl?.records_checked ?? receipt?.records_checked ?? null;
  const cover = receipt?.coverage ?? null;
  const seconds = tl?.duration_s ?? null;

  return (
    <section className="rn-board" aria-label={t("Runs of one object")} data-testid="runs-board">
      <div className="mx-chips" role="group" aria-label={t("Object")}>
        {objects.map((o) => <Chip key={o.module} selected={o.module === mod} onClick={() => { setChosen(o.module); setPickA(null); setPickB(null); }}>{moduleText(o.module)}</Chip>)}
      </div>
      <Card title={t("All runs")} sub={t("{n, plural, one {# run} other {# runs}}", { n: heads.length })}
        action={<span className="rn-row-actions"><Button onClick={() => sheet.open("cycle")}>{t("Run now")}</Button>{head && <Button variant="secondary" onClick={() => void exportOne()}>{t("Export run {n}", { n: head.run_number ?? "" })}</Button>}</span>}>
        {runs.isLoading ? <Skeleton lines={4} label={t("Loading the runs")} /> : rows.length === 0 ? <EmptyState heading={t("No runs yet")} body={t("Start a run to see this object on the ruler.")} /> : (
          <table className="rn-board-table">
            <thead><tr><th scope="col">{t("Run")}</th><th scope="col">{t("Finished")}</th><th scope="col">{t("On the ruler, 55 to 80")}</th><th scope="col" className="rn-num">{t("Shown")}</th><th scope="col" className="rn-num">{t("Measured")}</th><th scope="col" className="rn-num">{t("Change")}</th><th scope="col">{t("Compare")}</th></tr></thead>
            <tbody>
              {rows.map(({ h, shown, measured, change }) => (
                <tr key={h.id} data-testid="runs-board-row">
                  <th scope="row"><a href={withFixture(runPath(h.id), fx)}>{num(h)}</a></th>
                  <td>{(h.run_at ?? "").slice(0, 10)}</td>
                  <td>{shown !== null && measured !== null ? <MiniRuler shown={shown} measured={measured} name={t("{run}: shown {shown}, measured {measured}", { run: num(h), shown: score(shown), measured: score(measured) })} /> : null}</td>
                  <td className="rn-num">{shown !== null ? score(shown) : ""}</td>
                  <td className="rn-num">{measured !== null ? score(measured) : ""}</td>
                  <td className="rn-num" data-tone={change === null ? undefined : change >= 0 ? "good" : "bad"}>{change !== null ? signed(change) : ""}</td>
                  <td>
                    <span className="rn-row-actions">
                      <Chip selected={a?.id === h.id} onClick={() => setPickA(h.id)}>{t("A")}</Chip>
                      <Chip selected={b?.id === h.id} onClick={() => setPickB(h.id)}>{t("B")}</Chip>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pair && href && <p className="rn-board-go"><Button variant="secondary" href={href}>{t("Compare {a} to {b}", { a: num(pair[0]), b: num(pair[1]) })}</Button></p>}
      </Card>
      {head && (
        <dl className="mx-tiles" aria-label={t("{run}, {object}", { run: num(head), object: moduleText(mod ?? "") })}>
          {records !== null && <StatTile label={t("Records")} value={compactCount(records)} />}
          {receipt?.rules_measured != null && <StatTile label={t("Rules run")} value={String(receipt.rules_measured)} />}
          {seconds !== null && <StatTile label={t("Duration")} value={t("{n} s", { n: Math.round(seconds) })} />}
          {cover !== null && <StatTile label={t("Coverage")} value={`${score(cover <= 1 ? cover * 100 : cover)}%`} />}
        </dl>
      )}
    </section>
  );
}
