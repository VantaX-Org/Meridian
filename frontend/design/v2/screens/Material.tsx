"use client";

import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getDuplicates, getMaterial, getMaterialFindings, getSupersession, type CellState, type ChainNode, type MaterialFindings } from "@/lib/api/v2/materials";
import { formatDate } from "@/lib/format";
import { useUrlParam } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { Sev } from "../inspector/rule";
import { Coded, Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { CcBanner, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * Material 360: one material across every view and organisational level, the rules it fails in each view, its
 * follow-up chain per plant with the bills of material that still use it, and the materials that look like it. The
 * matrix marks a cell failing when a failing rule sits on that view and level; the route leaves that to the client.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && s !== 409 && n < 2; };

const VIEW_TEXT: Record<string, () => string> = {
  basic_data: () => t("Basic data"),
  classification: () => t("Classification"),
  sales: () => t("Sales"),
  purchasing: () => t("Purchasing"),
  mrp: () => t("MRP"),
  work_scheduling: () => t("Work scheduling"),
  storage: () => t("Storage"),
  quality: () => t("Quality"),
  accounting: () => t("Accounting"),
};
const viewText = (view: string, label: string) => VIEW_TEXT[view]?.() ?? label;

/** What each chain and BOM flag means (checks/rules/ecc/material_master.yaml). */
const FLAG_TEXT: Record<string, () => string> = {
  MM544: () => t("Follow-up material is not in the same plant"),
  MM545: () => t("Follow-up material does not exist"),
  MM546: () => t("Follow-up material is flagged for deletion"),
  MM547: () => t("Follow-up material is flagged for deletion in the plant"),
  MM548: () => t("Follow-up material is blocked by its plant status"),
  MM549: () => t("Follow-up material has MRP type ND, so it is not planned"),
  MM550: () => t("Discontinued with no successor"),
  MM551: () => t("Follow-up materials form a loop"),
  MM552: () => t("Follow-up chain is longer than three links"),
  MM560: () => t("Discontinued part in an active BOM with no discontinuation group"),
  MM563: () => t("Follow-up item has no discontinuation group"),
};

function levelText(id: string): string {
  const [kind, key = ""] = id.split(":");
  if (kind === "client") return t("Client");
  if (kind === "plant") return t("Plant {k}", { k: key });
  if (kind === "sales") return t("Sales area {k}", { k: key });
  if (kind === "valuation") return t("Valuation {k}", { k: key });
  if (kind === "sloc") return t("Storage location {k}", { k: key });
  if (kind === "warehouse") return t("Warehouse {k}", { k: key });
  return id;
}

const CELL: Record<CellState | "failing", { band?: string; text: () => string }> = {
  ok: { band: "0", text: () => t("Maintained") },
  failing: { band: "2", text: () => t("Failing") },
  missing: { band: "3", text: () => t("Missing") },
  na: { text: () => t("Not needed") },
  none: { text: () => "" },
};

const ERR: Record<number, () => string> = {
  404: () => t("This material is not in the material master."),
  409: () => t("No run has data for this system yet."),
  403: () => t("Your role cannot read material records."),
};

export function Material() {
  const [m, setM] = useUrlParam<string>("m", "");
  const [draft, setDraft] = useState(m);
  const submit = (e: FormEvent) => { e.preventDefault(); setM(draft.trim()); };
  return (
    <CcPage>
      <form className="m2-rfilters" onSubmit={submit} aria-label={t("Find a material")} data-testid="material-search">
        <label>
          {t("Material number")}
          <input className="m2-inp" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("For example 10004711")} />
        </label>
        <button type="submit" className="m2-btn" disabled={!draft.trim()}>{t("Open material")}</button>
      </form>
      {m ? <MaterialBody m={m} /> : <EmptyFrame>{t("Type a material number to see it across every view, plant and level.")}</EmptyFrame>}
    </CcPage>
  );
}

function MaterialBody({ m }: { m: string }) {
  const fixture = useFixture();
  const opts = { staleTime: 60_000, retry };
  const mat = useQuery({ queryKey: ["material", fixture, m], queryFn: () => getMaterial(m), ...opts });
  const found = mat.isSuccess;
  const fin = useQuery({ queryKey: ["material-findings", fixture, m], queryFn: () => getMaterialFindings(m), enabled: found, ...opts });
  const sup = useQuery({ queryKey: ["material-supersession", fixture, m], queryFn: () => getSupersession(m), enabled: found, ...opts });
  const dup = useQuery({ queryKey: ["material-duplicates", fixture, m], queryFn: () => getDuplicates(m), enabled: found, ...opts });

  if (mat.isPending) return <Skeleton width="100%" height={320} />;
  if (mat.isError) {
    const why = ERR[status(mat.error) ?? 0];
    return why ? <EmptyFrame>{why()}</EmptyFrame> : <ErrorFrame onRetry={() => void mat.refetch()}>{t("The material could not be read.")}</ErrorFrame>;
  }
  const d = mat.data;
  const failing = fin.data?.by_view.flatMap((v) => v.failing) ?? [];
  const failingAt = new Set(fin.data?.by_view.flatMap((v) => v.failing.map((f) => `${v.view}|${f.level}`)) ?? []);
  const cells = d.views.flatMap((v) => v.cells);
  const missing = cells.filter((c) => c.state === "missing").length;
  const mara = d.mara as Record<string, string | undefined>;

  return (
    <>
      <CcBanner
        eyebrow={t("Material 360")}
        headline={d.description ?? d.matnr}
        why={t("{type}, {group}, base unit {unit}", { type: d.labels.MTART ?? mara.MTART ?? "", group: d.labels.MATKL ?? mara.MATKL ?? "", unit: d.labels.MEINS ?? mara.MEINS ?? "" })}
        figs={[
          { label: t("Material"), value: d.matnr },
          { label: t("Rules failing"), value: fin.data ? int(failing.length) : "—", note: fin.data ? t("of {n} rules", { n: int(fin.data.rules_total) }) : undefined },
          { label: t("Views missing"), value: int(missing), note: t("across {n} levels", { n: int(d.levels_total) }) },
          { label: t("Plants phasing out"), value: int(d.phasing.phasing_out), note: t("of {n} plants", { n: int(d.phasing.plants) }) },
        ]}
        testId="material-banner"
        label={t("Material 360")}
      />
      <section className="m2-ck-panel" aria-label={t("Views by level")} data-testid="material-matrix">
        <header className="m2-ck-head">
          <h2 className="m2-h2">{t("Views by level")}</h2>
          <span className="m2-ck-key" aria-hidden="true">
            <span data-band="0">{CELL.ok.text()}</span>
            <span data-band="2">{CELL.failing.text()}</span>
            <span data-band="3">{CELL.missing.text()}</span>
          </span>
        </header>
        {d.levels_total > d.levels.length ? <p className="m2-meta">{t("Showing the first {n} of {total} levels.", { n: int(d.levels.length), total: int(d.levels_total) })}</p> : null}
        <div className="m2-ck-scroll">
          <table className="m2-ck-matrix">
            <caption className="m2-sr">{t("Views by level")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("View")}</th>
                {d.levels.map((l) => <th key={l.id} scope="col" className="m2-ck-dimh">{levelText(l.id)}</th>)}
              </tr>
            </thead>
            <tbody>
              {d.views.map((v) => (
                <tr key={v.view}>
                  <th scope="row">
                    {viewText(v.view, v.label)}
                    {d.expected_known && v.expected === false ? <span className="m2-meta"> {t("Not expected for this type")}</span> : null}
                  </th>
                  {v.cells.map((c) => {
                    const s = c.state === "ok" && failingAt.has(`${v.view}|${c.level}`) ? "failing" : c.state;
                    return <td key={c.level} className="m2-ck-heat" data-band={CELL[s].band}>{CELL[s].text()}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Panel title={t("Rules failing, by view")} meta={fin.data ? t("{n} failing", { n: int(failing.length) }) : ""} testId="material-findings">
        {fin.isError ? <Dash why={t("The findings could not be read.")} /> : !fin.data ? <Skeleton width="100%" height={120} /> : <Findings f={fin.data} />}
      </Panel>
      <Panel title={t("Follow-up chain")} meta={t("{n} plants phasing out", { n: int(d.phasing.phasing_out) })} testId="material-chain">
        {sup.isError ? <Dash why={t("The follow-up chain could not be read.")} /> : !sup.data ? <Skeleton width="100%" height={120} /> : (
          <>
            {sup.data.plants.length === 0 ? <p className="m2-meta">{t("No plant is phasing this material out.")}</p> : sup.data.plants.map((p) => (
              <div key={p.werks} data-testid="material-chain-plant">
                <h3 className="m2-h3">
                  {levelText(`plant:${p.werks}`)}
                  {p.ausdt ? <span className="m2-meta"> {t("Discontinued on {d}", { d: formatDate(p.ausdt, "date") })}</span> : null}
                  {p.dead_end ? <span className="m2-meta"> {t("Ends with no successor")}</span> : null}
                  {p.loop_at ? <span className="m2-meta"> {t("Loops back at {m}", { m: p.loop_at })}</span> : null}
                  {p.truncated ? <span className="m2-meta"> {t("Cut at {n} links", { n: int(p.depth) })}</span> : null}
                </h3>
                <ol className="m2-list">{p.chain.map((n) => <ChainStep key={n.matnr} n={n} />)}</ol>
              </div>
            ))}
            <h3 className="m2-h3">{t("Bills of material that use it")}</h3>
            {sup.data.bom_usage == null ? (
              <Dash why={t("Bills of material were not extracted.")} />
            ) : sup.data.bom_usage.length === 0 ? (
              <p className="m2-meta">{t("No bill of material uses this material.")}</p>
            ) : (
              <ScrollFrame label={t("Bills of material that use it")}>
                <table className="m2-tbl m2-cards">
                  <caption className="m2-sr">{t("Bills of material that use it")}</caption>
                  <thead><tr><th scope="col">{t("Bill of material")}</th><th scope="col">{t("Item")}</th><th scope="col">{t("Plant")}</th><th scope="col">{t("Discontinuation group")}</th><th scope="col">{t("Problems")}</th></tr></thead>
                  <tbody>
                    {sup.data.bom_usage.map((b, i) => (
                      <tr key={`${b.stlnr}-${b.posnr}-${i}`}>
                        <th scope="row" className="m2-card-lead">{b.stlnr ? <Mono>{b.stlnr}</Mono> : <Dash />}</th>
                        <td data-label={t("Item")}>{b.posnr ? <Mono>{b.posnr}</Mono> : <Dash />}</td>
                        <td data-label={t("Plant")}>{b.werks ? <Mono>{b.werks}</Mono> : <Dash />}</td>
                        <td data-label={t("Discontinuation group")}>{b.nfgrp ? <Mono>{b.nfgrp}</Mono> : <Dash />}</td>
                        <td data-label={t("Problems")}><Flags flags={b.flags} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollFrame>
            )}
          </>
        )}
      </Panel>
      <Panel title={t("Materials that look like it")} meta={dup.data ? t("Match score {n} and up", { n: int(dup.data.threshold) }) : ""} testId="material-duplicates">
        {dup.isError ? <Dash why={t("The likely duplicates could not be read.")} /> : !dup.data ? <Skeleton width="100%" height={80} /> : dup.data.items.length === 0 ? (
          <p className="m2-meta">{t("No other material looks like this one.")}</p>
        ) : (
          <ScrollFrame label={t("Materials that look like it")}>
            <table className="m2-tbl m2-cards">
              <caption className="m2-sr">{t("Materials that look like it")}</caption>
              <thead><tr><th scope="col">{t("Material")}</th><th scope="col">{t("Type")}</th><th scope="col">{t("Group")}</th><th scope="col">{t("Matches on")}</th><th scope="col" className="m2-num">{t("Score")}</th></tr></thead>
              <tbody>
                {dup.data.items.map((x) => (
                  <tr key={x.matnr}>
                    <th scope="row" className="m2-card-lead">
                      <V2Link href={`/materials?m=${encodeURIComponent(x.matnr)}`}><Coded code={x.matnr} text={x.maktx} first /></V2Link>
                    </th>
                    <td data-label={t("Type")}>{x.mtart ? <Mono>{x.mtart}</Mono> : <Dash />}</td>
                    <td data-label={t("Group")}>{x.matkl ? <Mono>{x.matkl}</Mono> : <Dash />}</td>
                    <td data-label={t("Matches on")}>{x.matches_on.join(", ")}</td>
                    <td data-label={t("Score")} className="m2-num">{int(x.score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </Panel>
    </>
  );
}

function Findings({ f }: { f: MaterialFindings }) {
  const views = [...f.by_view].sort((a, b) => b.failing.length - a.failing.length);
  if (views.every((v) => v.failing.length === 0)) return <p className="m2-meta">{t("Every rule that ran on this material passes.")}</p>;
  return (
    <ScrollFrame label={t("Rules failing, by view")}>
      <table className="m2-tbl m2-cards">
        <caption className="m2-sr">{t("Rules failing, by view")}</caption>
        <thead><tr><th scope="col">{t("Rule")}</th><th scope="col">{t("View")}</th><th scope="col">{t("Level")}</th><th scope="col">{t("Field")}</th><th scope="col">{t("Value")}</th><th scope="col">{t("Severity")}</th><th scope="col">{t("Issue")}</th></tr></thead>
        <tbody>
          {views.flatMap((v) => v.failing.map((r) => (
            <tr key={`${v.view}-${r.check_id}-${r.level}`}>
              <th scope="row" className="m2-card-lead">
                <V2Link href={`/r/${encodeURIComponent(r.check_id)}`}><Coded code={r.check_id} text={r.message} first /></V2Link>
              </th>
              <td data-label={t("View")}>{viewText(v.view, v.label)}</td>
              <td data-label={t("Level")}>{levelText(r.level)}</td>
              <td data-label={t("Field")}>{r.field ? <Mono>{r.field}</Mono> : <Dash />}</td>
              <td data-label={t("Value")}>{r.actual_value ? <Mono>{r.actual_value}</Mono> : <Dash why={t("Blank")} />}</td>
              <td data-label={t("Severity")}><Sev severity={r.severity} /></td>
              <td data-label={t("Issue")}>{r.issue_id ? <V2Link href={`/issues?search=${encodeURIComponent(r.record_key)}`}>{t("Open issue")}</V2Link> : <Dash />}</td>
            </tr>
          )))}
        </tbody>
      </table>
    </ScrollFrame>
  );
}

function ChainStep({ n }: { n: ChainNode }) {
  return (
    <li>
      {n.this ? <Coded code={n.matnr} text={n.maktx} first /> : <V2Link href={`/materials?m=${encodeURIComponent(n.matnr)}`}><Coded code={n.matnr} text={n.maktx} first /></V2Link>}
      {n.this ? <span className="m2-meta"> {t("This material")}</span> : null}
      {n.dismm ? <span className="m2-meta"> {t("MRP type {v}", { v: n.dismm })}</span> : null}
      {n.ausdt ? <span className="m2-meta"> {t("Discontinued on {d}", { d: formatDate(n.ausdt, "date") })}</span> : null}
      {n.flags.length ? <> <Flags flags={n.flags} /></> : null}
    </li>
  );
}

function Flags({ flags }: { flags: string[] }) {
  if (!flags.length) return <Dash />;
  return <>{flags.map((f, i) => <span key={f}>{i ? ", " : null}<Coded code={f} text={FLAG_TEXT[f]?.()} first /></span>)}</>;
}
