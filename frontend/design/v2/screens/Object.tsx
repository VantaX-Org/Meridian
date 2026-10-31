"use client";

import { EstimateNote, Money } from "../Money";
import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatDate, formatModuleName, MODULE_LABELS } from "@/lib/format";
import type { Landscape, LandscapeCell, LandscapeSystem, Receipt } from "@/lib/api/v2/types";
import { useOpenItem, usePhone, useRunParam } from "@/lib/v2/hooks";
import { useLandscape, useReceipt } from "@/lib/v2/queries";
import { ANY_SYSTEM, f1, findSystem, int, moduleFromSlug, pct1, systemForModule, systemSlug, VERDICT_LABEL } from "@/lib/v2/score";
import { Explain } from "../Explain";
import { VerdictMark } from "../marks";
import { ObjectBanner, DimensionBars } from "./object/Banner";
import { AletheiaDock, LandscapeTrend } from "./CommandCentre";
import { FixPipeline } from "./Cockpit";
import { Dash, EmptyFrame, ErrorFrame, PageTitle, Skeleton, V2Link } from "../parts";
import { Ruler } from "../Ruler";
import { dimsOf } from "../shell/MapPane";
import { contractMark } from "@/lib/v2/step9";
import { policyMark } from "@/lib/v2/step10";
import { RelatedObjects } from "./object/Related";
import { AsOfView, PolicyBreaches } from "./step10/ObjectParts";
import { ObjectContractsBlock } from "./step9/Contracts";
import { TopFailing } from "./object/TopFailing";
import { t as tr, tn } from "@/lib/v2/i18n";

type TabKey = "rules" | "records" | "fixes" | "runs" | "readiness" | "processes" | "lineage" | "glossary" | "golden";
const TABS: { key: TabKey; label: string; segment: string }[] = [
  { key: "rules", get label() { return tr("Rules"); }, segment: "" },
  { key: "records", get label() { return tr("Records"); }, segment: "/records" },
  { key: "fixes", get label() { return tr("Fixes"); }, segment: "/fixes" },
  { key: "runs", get label() { return tr("Runs"); }, segment: "/runs" },
  { key: "readiness", get label() { return tr("Readiness"); }, segment: "/readiness" },
  { key: "processes", get label() { return tr("Processes"); }, segment: "/processes" },
  { key: "lineage", get label() { return tr("Lineage"); }, segment: "/lineage" },
  { key: "glossary", get label() { return tr("Glossary"); }, segment: "/glossary" },
  { key: "golden", get label() { return tr("Golden records"); }, segment: "/golden" },
];

/** Names the capping rules as links that open them in the inspector. Reads the cell, so it never waits for the receipt. */
function CapSentence({ capped, cap, ids }: { capped: boolean; cap: number | null; ids: readonly string[] }) {
  const { hrefFor } = useOpenItem();
  const link = (id: string) => (
    <V2Link key={id} href={hrefFor({ kind: "rule", id })} className="m2-mono">
      {id}
    </V2Link>
  );
  if (!capped) {
    return <>{ids.length === 0 ? tr("No critical rule is failing, so nothing holds this score down.") : tr("A critical rule is failing, but the score is already below the level it would be held at.")}</>;
  }
  const n = ids.length;
  if (n === 1) return <>{tn("Held at {cap} because one critical rule fails: {rule}.", { cap: cap ?? 70, rule: link(ids[0]) })}</>;
  if (n === 2) return <>{tn("Held at {cap} because two critical rules fail: {rule} and {rule2}.", { cap: cap ?? 70, rule: link(ids[0]), rule2: link(ids[1]) })}</>;
  return <>{tn("Held at {cap} because {n} critical rules fail, including {rule} and {rule2}.", { cap: cap ?? 70, n, rule: link(ids[0]), rule2: link(ids[1]) })}</>;
}

/** Holds the receipt's place while it loads, at its real height, so the tabs below do not jump when it lands. */
function ReceiptSkeleton({ capRow, breaches }: { capRow: boolean; breaches: number }) {
  const rows = 6 + 2 + (capRow ? 1 : 0) + 1;
  return (
    <div aria-busy="true" data-testid="receipt-loading">
      <div style={{ height: 24 }} />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ height: 26, display: "flex", alignItems: "center" }}>
          <Skeleton width={`${34 + ((i * 13) % 30)}%`} height={12} />
        </div>
      ))}
      <div style={{ height: 42 }} />
      {breaches > 0 ? <div style={{ height: 20 + 12 + breaches * 33 + 32 }} /> : null}
    </div>
  );
}

/** The receipt: how the shown score is made, row by row, with the formula and the rules that cap it. */
export function ReceiptTable({ receipt }: { receipt: Receipt }) {
  const { hrefFor } = useOpenItem();
  const n = receipt.breaches.length;
  return (
    <>
      <table className="m2-rcpt" data-testid="receipt">
        <thead>
          <tr>
            <th scope="col">{tr("Dimension")}</th>
            <th scope="col">{tr("Weight")}</th>
            <th scope="col">{tr("Score")}</th>
            <th scope="col">{tr("Points")}</th>
            <th scope="col">{tr("Rules measured")}</th>
            <th scope="col">{tr("Records checked")}</th>
            <th scope="col">{tr("Coverage")}</th>
          </tr>
        </thead>
        <tbody>
          {receipt.dimensions.map((d) => (
            <tr key={d.key}>
              <th scope="row">
                {d.label} <Explain metric="dimension" label={d.label} module={receipt.module} run={receipt.run_id} dimension={d.key} />
              </th>
              <td>{`${Math.round(d.weight * 100)}%`}</td>
              <td>{d.score == null ? <Dash why={tr("Not measured")} /> : f1(d.score)}</td>
              <td>{d.points == null ? <Dash /> : f1(d.points)}</td>
              <td>{int(d.rules_measured)}</td>
              <td>{int(d.records_checked)}</td>
              <td>{pct1(d.coverage)}</td>
            </tr>
          ))}
          {receipt.weighted != null ? (
            <tr className="m2-sum">
              <th scope="row">
                {tr("Weighted")}{" "}<Explain metric="dqs" label={tr("the weighted score")} module={receipt.module} run={receipt.run_id} />
              </th>
              <td>100%</td>
              <td />
              <td>{f1(receipt.weighted)}</td>
              <td>{int(receipt.rules_measured)}</td>
              <td>{int(receipt.records_checked)}</td>
              <td>{pct1(receipt.coverage)}</td>
            </tr>
          ) : null}
          <tr className="m2-sum">
            <th scope="row">
              {tr("Measured")}{" "}<Explain metric="dqs" label={tr("the measured score")} module={receipt.module} run={receipt.run_id} />
            </th>
            <td />
            <td />
            <td>{f1(receipt.measured)}</td>
            <td />
            <td />
            <td />
          </tr>
          {receipt.cap_level != null ? (
            <tr>
              <th scope="row">
                {tr("Held down by {n} critical {n, plural, one {rule} other {rules}} failing", { n })} <Explain metric="cap" label={tr("the cap")} module={receipt.module} run={receipt.run_id} />
              </th>
              <td />
              <td />
              <td>{receipt.capped ? `${receipt.cap_level}.0` : tr("not reached")}</td>
              <td />
              <td />
              <td />
            </tr>
          ) : null}
          <tr className="m2-sum">
            <th scope="row">
              {tr("Score shown")}{" "}<Explain metric="dqs" label={tr("the score shown")} module={receipt.module} run={receipt.run_id} />
            </th>
            <td />
            <td />
            <td>{f1(receipt.score)}</td>
            <td />
            <td />
            <td />
          </tr>
        </tbody>
      </table>
      {receipt.low_confidence ? (
        <p className="m2-formula">
          <b>{tr("Low confidence.")}</b> {tr("Coverage {pct1} is low: part of the records could not be evaluated by at least one rule, so this score may move when extraction improves.", { pct1: pct1(receipt.coverage) })}
        </p>
      ) : null}
      <p className="m2-formula" data-testid="receipt-footer">
        <span className="m2-mono">{receipt.formula}</span>
        {tr("; severity weights critical {critical}, high {high}, medium {medium}, low {low}; tolerance {value}% of rows or {rows} rows, as set on each rule; cap rule: {cap_rule}.", { critical: receipt.severity_weights.critical, high: receipt.severity_weights.high, medium: receipt.severity_weights.medium, low: receipt.severity_weights.low, value: Math.round(receipt.tolerance.pct * 100), rows: receipt.tolerance.rows, cap_rule: receipt.cap_rule })}
      </p>
      {receipt.breaches.length > 0 ? (
        <>
          <h2 className="m2-h2 m2-sec">{tr("Critical rules failing on too many records")}</h2>
          <ul className="m2-breaches" data-testid="breaches">
            {receipt.breaches.map((b) => (
              <li key={b.check_id}>
                <span>
                  <V2Link href={hrefFor({ kind: "rule", id: b.check_id })} className="m2-mono">
                    {b.check_id}
                  </V2Link>{" "}
                  {b.name}
                </span>
                <span className="m2-meta">{b.failing == null ? <Dash why={tr("The count is not stored for this run")} /> : tr("{failing} failing{value}", { failing: int(b.failing), value: b.pct == null ? "" : `, ${b.pct}%` })}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <PolicyBreaches receipt={receipt} />
    </>
  );
}

function resolve(landscape: Landscape | undefined, systemSegment: string, moduleSegment: string): { system?: LandscapeSystem; cell?: LandscapeCell; label: string } {
  const apiModule = moduleFromSlug(moduleSegment);
  const system = landscape ? findSystem(landscape.systems, decodeURIComponent(systemSegment)) : undefined;
  const cell = landscape && system ? landscape.cells.find((c) => c.system_id === system.id && c.module === apiModule) : undefined;
  const label = landscape?.objects.find((o) => o.module === apiModule)?.label ?? formatModuleName(apiModule);
  return { system, cell, label };
}

function statusItems(receipt: Receipt, cell: LandscapeCell | undefined): ReactNode[] {
  const items: ReactNode[] = [];
  if (receipt.run_at) items.push(tr("Run {run_at}", { run_at: formatDate(receipt.run_at, "datetime") }));
  items.push(tr("{records_checked} records checked", { records_checked: int(receipt.records_checked) }));
  items.push(tr("{rules_measured} rules measured", { rules_measured: int(receipt.rules_measured) }));
  if (receipt.open_work != null) items.push(tr("{open_work} to fix", { open_work: int(receipt.open_work) }));
  if (receipt.value_at_risk != null) items.push(<span key="m">{tn("{money} at risk", { money: <Money amount={receipt.value_at_risk} currency={receipt.currency} source={receipt.cost_model_source} /> })}, <EstimateNote source={receipt.cost_model_source} /></span>);
  if (receipt.features_blocked != null) items.push(tr("{features_blocked} {features_blocked, plural, one {feature} other {features}} blocked", { features_blocked: receipt.features_blocked }));
  if (cell) items.push(<span key="v" className="m2-v"><VerdictMark verdict={cell.verdict} />{VERDICT_LABEL[cell.verdict]}{" "}{tr("for wave 1")}</span>);
  return items;
}

/** The object canvas: header, the 240 ruler with its receipt, the capping rules, and the tabs of views. */
export function ObjectFrame({ system: systemSegment, module: moduleSegment, children }: { system: string; module: string; children: ReactNode }) {
  const run = useRunParam();
  const phone = usePhone();
  const asOf = useSearchParams().get("as_of");
  const pathname = usePathname();
  const router = useRouter();
  const L = useLandscape(run);
  const { system, cell, label } = resolve(L.data, systemSegment, moduleSegment);
  const apiModule = moduleFromSlug(moduleSegment);
  const receiptQ = useReceipt(apiModule, run, Boolean(cell));
  const base = `/o/${systemSegment}/${moduleSegment}`;
  const query = run ? `?run=${run}` : "";
  // An address without its system (`/o/_/{module}`, from an old link): replace it with the system that holds the object.
  const anySystem = systemSegment === ANY_SYSTEM;
  const holder = anySystem && L.data ? systemForModule(L.data.systems, L.data.cells, apiModule) : undefined;
  const canonical = holder ? `${pathname.replace(`/o/${ANY_SYSTEM}/`, `/o/${systemSlug(holder.name)}/`)}${typeof window === "undefined" ? "" : window.location.search}` : null;
  useEffect(() => {
    if (canonical) router.replace(canonical);
  }, [canonical, router]);
  if (anySystem && (!L.data || holder)) {
    return (
      <div aria-busy="true" data-testid="object-loading">
        <PageTitle>{label}</PageTitle>
        <p className="m2-statusline"><Skeleton width={420} height={14} /></p>
      </div>
    );
  }

  if (L.isError) {
    return (
      <>
        <PageTitle>{label}</PageTitle>
        <div className="m2-sec">
          <ErrorFrame onRetry={() => void L.refetch()}>{tr("The object could not be read. Check that the API is reachable, then retry.")}</ErrorFrame>
        </div>
      </>
    );
  }
  if (!L.data) {
    return (
      <div aria-busy="true" data-testid="object-loading">
        <PageTitle>{label}</PageTitle>
        <p className="m2-statusline"><Skeleton width={420} height={14} /></p>
        <div className="m2-score"><Skeleton width={406} height={152} /></div>
      </div>
    );
  }
  // An address that names no object Meridian knows is not found, never a page that looks real.
  const known = L.data.objects.some((o) => o.module === apiModule) || Object.hasOwn(MODULE_LABELS, apiModule);
  if (!system || !known) {
    return (
      <div data-testid="object-not-found">
        <PageTitle>{tr("Object not found")}</PageTitle>
        <div className="m2-sec">
          <EmptyFrame action={<V2Link href="/" className="m2-btn">{tr("Open the landscape")}</V2Link>}>
            {!system
              ? tr("No system matches this address. Open the landscape and choose an object from the map.")
              : tr("{system} has no object called {segment}. Open the landscape and choose an object from the map.", { system: system.name, segment: decodeURIComponent(moduleSegment) })}
          </EmptyFrame>
        </div>
      </div>
    );
  }
  const receipt = receiptQ.data;
  // The score's working (the receipt and the contracts) belongs to the Rules view; the other views keep the ruler and
  // put their own content straight under it.
  const onRules = pathname === base || pathname === `${base}/rules`;
  const tabs = (
    <nav className="m2-tabs" aria-label={tr("Views of {label}", { label })}>
      {TABS.map((t) => {
        const href = `${base}${t.segment}${query}`;
        const active = t.key === "rules" ? pathname === base || pathname === `${base}/rules` : (pathname === `${base}${t.segment}` || pathname.startsWith(`${base}${t.segment}/`));
        const count = t.key === "rules" ? receipt?.rules_measured : t.key === "records" ? receipt?.open_work : null;
        return (
          <V2Link key={t.key} href={href} className="m2-tab" aria-current={active ? "page" : undefined}>
            {t.label}
            {count ? <span className="m2-meta">{int(count)}</span> : null}
          </V2Link>
        );
      })}
    </nav>
  );
  return (
    <>
      <PageTitle sub={system.name}>{label}</PageTitle>
      <RelatedObjects module={apiModule} system={systemSegment} systemId={system.id} label={label} />
      {tabs}
      {!cell ? (
        <>
          <p className="m2-statusline">
            <span>{system.state === "analysed" ? tr("This object has no run on this system.") : system.state === "extracted" ? tr("Extracted, not analysed.") : tr("Not extracted yet.")}</span>
          </p>
          <div className="m2-score">
            <Ruler size={240} dims={[null, null, null, null, null, null]} measured={null} score={null} capped={false} capLevel={null} breaches={[]} label={label} records={null} rules={null} coverage={null} empty selected />
          </div>
          <div className="m2-sec">
            <EmptyFrame action={<V2Link href={`/?open=system:${system.id}`} className="m2-btn">{system.state === "not_extracted" ? tr("Extract {name}", { name: system.name }) : tr("Run analysis on {name}", { name: system.name })}</V2Link>}>
              {tr("No run yet. The ruler fills when an analysis scores this object.")}
            </EmptyFrame>
          </div>
          <div className="m2-tabpanel">{children}</div>
        </>
      ) : asOf ? (
        <>
          <AsOfView module={apiModule} label={label} asOf={asOf} />
          <div className="m2-tabpanel">{children}</div>
        </>
      ) : (
        <>
          {receiptQ.isError ? (
            <div className="m2-sec">
              <ErrorFrame onRetry={() => void receiptQ.refetch()}>{tr("The score's working could not be read for this run.")}</ErrorFrame>
            </div>
          ) : null}
          <ObjectBanner cell={cell} receipt={receipt} label={label} system={systemSegment} module={moduleSegment} cap={<CapSentence capped={cell.capped} cap={cell.cap_level} ids={cell.breaches} />} />
          <div className="m2-cc m2-co">
            <div className="m2-cc-main">
              {receipt ? (
                <p className="m2-statusline" data-testid="object-status">
                  {statusItems(receipt, cell).map((it, i) => (
                    <span key={i}>{it}</span>
                  ))}
                </p>
              ) : (
                <p className="m2-statusline"><Skeleton width={420} height={14} /></p>
              )}
              {onRules ? (
                <div className="m2-co-grid">
                  <DimensionBars cell={cell} />
                  <TopFailing module={apiModule} run={run} />
                </div>
              ) : null}
              {onRules ? (
                <div className="m2-ck-row">
                  <section className="m2-cc-card">
                    <LandscapeTrend systemId={system.id} module={apiModule} />
                  </section>
                  <FixPipeline label={() => label} module={apiModule} />
                </div>
              ) : null}
              {!onRules ? null : receipt ? (
                <details className="m2-rdet" open>
                  <summary>{tr("How {score} is made", { score: f1(receipt.score) })}</summary>
                  <div className="m2-score">
                    <Ruler size={240} dims={dimsOf(cell)} measured={cell.raw_score} score={cell.score} capped={cell.capped} capLevel={cell.cap_level} breaches={cell.breaches} label={label} records={cell.records_checked} rules={cell.rules_measured} coverage={cell.coverage} lowConfidence={cell.low_confidence} selected compact={phone || undefined} contract={contractMark(cell)} policy={policyMark(cell)} />
                  </div>
                  <ReceiptTable receipt={receipt} />
                </details>
              ) : receiptQ.isError ? null : (
                <ReceiptSkeleton capRow={cell.cap_level != null} breaches={cell.breaches.length} />
              )}
              {onRules ? <ObjectContractsBlock module={apiModule} label={label} run={run} /> : null}
              <div className="m2-tabpanel">{children}</div>
            </div>
            <AletheiaDock />
          </div>
        </>
      )}
    </>
  );
}

/** The Rules tab lives in object/RulesTab.tsx; it is re-exported here so the object screen keeps one front door. */
export { RulesTab } from "./object/RulesTab";

const EMPTY: Record<Exclude<TabKey, "rules">, { text: (label: string) => string; action: string; href: (system: string, module: string) => string }> = {
  records: { text: (l) => tr("No failing records are listed for {l} yet. Rows appear when an analysis finds rules with a fixable or suggested value.", { l }), get action() { return tr("Open Work"); }, href: () => "/work" },
  fixes: { text: (l) => tr("No fix batches for {l} yet. A batch starts when a steward accepts suggested values or imports a filled fix sheet.", { l }), get action() { return tr("Open Work"); }, href: () => "/work" },
  runs: { text: (l) => tr("{l} has no run history here yet. Each run adds a point once two runs have scored this object.", { l }), get action() { return tr("Open the runs"); }, href: () => "/runs" },
  readiness: { text: (l) => tr("Feature impact for {l} is calculated from the rules that fail. It fills when the impact model has run for this object.", { l }), get action() { return tr("Open the capping rules"); }, href: () => "" },
  processes: { text: (l) => tr("No process step reads {l} yet. Process readiness fills when a step of the process model reads the fields of the object.", { l }), get action() { return tr("Open the designer"); }, href: (s, m) => `/o/${s}/${m}/processes/design` },
  lineage: { text: (l) => tr("Lineage fills when a field map is loaded for {l}: it shows where its fields come from and which rules read them.", { l }), get action() { return tr("Open the landscape"); }, href: () => "/" },
  glossary: { text: (l) => tr("No glossary terms are linked to {l} yet. A data owner links a term to a field and it appears here.", { l }), get action() { return tr("Open the rules"); }, href: (s, m) => `/o/${s}/${m}` },
  golden: { text: (l) => tr("No golden records for {l} yet. A match run creates them from the records that describe the same thing.", { l }), get action() { return tr("Open the rules"); }, href: (s, m) => `/o/${s}/${m}` },
};

/** A tab that has no data behind it in this step: a designed empty frame with its one action. */
export function EmptyTab({ tab, system: systemSegment, module: moduleSegment }: { tab: Exclude<TabKey, "rules">; system: string; module: string }) {
  const run = useRunParam();
  const { label } = resolve(useLandscape(run).data, systemSegment, moduleSegment);
  const def = EMPTY[tab];
  const href = tab === "readiness" ? `/o/${systemSegment}/${moduleSegment}` : def.href(systemSegment, moduleSegment);
  return (
    <EmptyFrame
      action={
        <V2Link href={href} className="m2-btn">
          {def.action}
        </V2Link>
      }
    >
      {def.text(label)}
    </EmptyFrame>
  );
}
