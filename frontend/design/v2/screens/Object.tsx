"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { formatDate, formatMoneyCompact } from "@/lib/format";
import type { Landscape, LandscapeCell, LandscapeSystem, Receipt } from "@/lib/api/v2/types";
import { useOpenItem, useRunParam } from "@/lib/v2/hooks";
import { useLandscape, useReceipt } from "@/lib/v2/queries";
import { f1, findSystem, int, moduleFromSlug, pct1, VERDICT_LABEL } from "@/lib/v2/score";
import { Explain } from "../Explain";
import { VerdictMark } from "../marks";
import { Dash, EmptyFrame, ErrorFrame, PageTitle, Skeleton, V2Link } from "../parts";
import { Ruler } from "../Ruler";
import { dimsOf } from "../shell/MapPane";
import { RelatedObjects } from "./object/Related";

type TabKey = "rules" | "records" | "fixes" | "runs" | "readiness" | "processes" | "lineage" | "glossary" | "golden";
const TABS: { key: TabKey; label: string; segment: string }[] = [
  { key: "rules", label: "Rules", segment: "" },
  { key: "records", label: "Records", segment: "/records" },
  { key: "fixes", label: "Fixes", segment: "/fixes" },
  { key: "runs", label: "Runs", segment: "/runs" },
  { key: "readiness", label: "Readiness", segment: "/readiness" },
  { key: "processes", label: "Processes", segment: "/processes" },
  { key: "lineage", label: "Lineage", segment: "/lineage" },
  { key: "glossary", label: "Glossary", segment: "/glossary" },
  { key: "golden", label: "Golden records", segment: "/golden" },
];

/** Names the capping rules as links that open them in the inspector. Reads the cell, so it never waits for the receipt. */
function CapSentence({ capped, capLevel, ids }: { capped: boolean; capLevel: number | null; ids: readonly string[] }) {
  const { hrefFor } = useOpenItem();
  const link = (id: string) => (
    <V2Link key={id} href={hrefFor({ kind: "rule", id })} className="m2-mono">
      {id}
    </V2Link>
  );
  if (!capped) {
    return <>{ids.length === 0 ? "No critical rule is over tolerance, so nothing caps this score." : "A critical rule is over tolerance, but the score is already below its cap."}</>;
  }
  const n = ids.length;
  if (n === 1) return <>Capped at {capLevel} by {link(ids[0])}, one critical rule over tolerance.</>;
  if (n === 2) return <>Capped at {capLevel} by {link(ids[0])} and {link(ids[1])}, two critical rules over tolerance.</>;
  return <>Capped at {capLevel} by {n} critical rules over tolerance, among them {link(ids[0])} and {link(ids[1])}.</>;
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
            <th scope="col">Dimension</th>
            <th scope="col">Weight</th>
            <th scope="col">Score</th>
            <th scope="col">Points</th>
            <th scope="col">Rules measured</th>
            <th scope="col">Records checked</th>
            <th scope="col">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {receipt.dimensions.map((d) => (
            <tr key={d.key}>
              <th scope="row">
                {d.label} <Explain metric="dimension" label={d.label} module={receipt.module} run={receipt.run_id} dimension={d.key} />
              </th>
              <td>{`${Math.round(d.weight * 100)}%`}</td>
              <td>{d.score == null ? <Dash why="Not measured" /> : f1(d.score)}</td>
              <td>{d.points == null ? <Dash /> : f1(d.points)}</td>
              <td>{int(d.rules_measured)}</td>
              <td>{int(d.records_checked)}</td>
              <td>{pct1(d.coverage)}</td>
            </tr>
          ))}
          {receipt.weighted != null ? (
            <tr className="m2-sum">
              <th scope="row">
                Weighted <Explain metric="dqs" label="the weighted score" module={receipt.module} run={receipt.run_id} />
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
              Measured <Explain metric="dqs" label="the measured score" module={receipt.module} run={receipt.run_id} />
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
                {`Cap, ${n} critical ${n === 1 ? "rule" : "rules"} over tolerance`} <Explain metric="cap" label="the cap" module={receipt.module} run={receipt.run_id} />
              </th>
              <td />
              <td />
              <td>{receipt.capped ? `${receipt.cap_level}.0` : "not reached"}</td>
              <td />
              <td />
              <td />
            </tr>
          ) : null}
          <tr className="m2-sum">
            <th scope="row">
              Score shown <Explain metric="dqs" label="the score shown" module={receipt.module} run={receipt.run_id} />
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
          <b>Low confidence.</b> {`Coverage ${pct1(receipt.coverage)} is low: part of the records could not be evaluated by at least one rule, so this score may move when extraction improves.`}
        </p>
      ) : null}
      <p className="m2-formula" data-testid="receipt-footer">
        <span className="m2-mono">{receipt.formula}</span>
        {`; severity weights critical ${receipt.severity_weights.critical}, high ${receipt.severity_weights.high}, medium ${receipt.severity_weights.medium}, low ${receipt.severity_weights.low}; tolerance ${Math.round(receipt.tolerance.pct * 100)}% of rows or ${receipt.tolerance.rows} rows, as set on each rule; cap rule: ${receipt.cap_rule}.`}
      </p>
      {receipt.breaches.length > 0 ? (
        <>
          <h2 className="m2-h2 m2-sec">Critical rules over tolerance</h2>
          <ul className="m2-breaches" data-testid="breaches">
            {receipt.breaches.map((b) => (
              <li key={b.check_id}>
                <span>
                  <V2Link href={hrefFor({ kind: "rule", id: b.check_id })} className="m2-mono">
                    {b.check_id}
                  </V2Link>{" "}
                  {b.name}
                </span>
                <span className="m2-meta">{b.failing == null ? <Dash why="The count is not stored for this run" /> : `${int(b.failing)} failing${b.pct == null ? "" : `, ${b.pct}%`}`}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

function resolve(landscape: Landscape | undefined, systemSegment: string, moduleSegment: string): { system?: LandscapeSystem; cell?: LandscapeCell; label: string } {
  const apiModule = moduleFromSlug(moduleSegment);
  const system = landscape ? findSystem(landscape.systems, decodeURIComponent(systemSegment)) : undefined;
  const cell = landscape && system ? landscape.cells.find((c) => c.system_id === system.id && c.module === apiModule) : undefined;
  const label = landscape?.objects.find((o) => o.module === apiModule)?.label ?? apiModule.replace(/_/g, " ");
  return { system, cell, label };
}

function statusItems(receipt: Receipt, cell: LandscapeCell | undefined): ReactNode[] {
  const items: ReactNode[] = [];
  if (receipt.run_at) items.push(`Run ${formatDate(receipt.run_at, "datetime")}`);
  items.push(`${int(receipt.records_checked)} records checked`);
  items.push(`${int(receipt.rules_measured)} rules measured`);
  if (receipt.open_work != null) items.push(`${int(receipt.open_work)} to fix`);
  if (receipt.value_at_risk != null) items.push(`${formatMoneyCompact(receipt.value_at_risk, receipt.currency)} at risk`);
  if (receipt.features_blocked != null) items.push(`${receipt.features_blocked} ${receipt.features_blocked === 1 ? "feature" : "features"} blocked`);
  if (cell) items.push(<span key="v" className="m2-v"><VerdictMark verdict={cell.verdict} />{VERDICT_LABEL[cell.verdict]} for wave 1</span>);
  return items;
}

/** The object canvas: header, the 240 ruler with its receipt, the capping rules, and the tabs of views. */
export function ObjectFrame({ system: systemSegment, module: moduleSegment, children }: { system: string; module: string; children: ReactNode }) {
  const run = useRunParam();
  const pathname = usePathname();
  const L = useLandscape(run);
  const { system, cell, label } = resolve(L.data, systemSegment, moduleSegment);
  const apiModule = moduleFromSlug(moduleSegment);
  const receiptQ = useReceipt(apiModule, run, Boolean(cell));
  const base = `/v2/o/${systemSegment}/${moduleSegment}`;
  const query = run ? `?run=${run}` : "";

  if (L.isError) {
    return (
      <>
        <PageTitle>{label}</PageTitle>
        <div className="m2-sec">
          <ErrorFrame onRetry={() => void L.refetch()}>The object could not be read. Check that the API is reachable, then retry.</ErrorFrame>
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
  if (!system) {
    return (
      <>
        <PageTitle>{label}</PageTitle>
        <div className="m2-sec">
          <EmptyFrame action={<V2Link href="/v2" className="m2-btn">Open the landscape</V2Link>}>
            No system matches this address. Open the landscape and choose an object from the map.
          </EmptyFrame>
        </div>
      </>
    );
  }
  const receipt = receiptQ.data;
  const tabs = (
    <nav className="m2-tabs" aria-label={`Views of ${label}`}>
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
      {!cell ? (
        <>
          <p className="m2-statusline">
            <span>{system.state === "analysed" ? "This object has no run on this system." : system.state === "extracted" ? "Extracted, not analysed." : "Not extracted yet."}</span>
          </p>
          <div className="m2-score">
            <Ruler size={240} dims={[null, null, null, null, null, null]} measured={null} score={null} capped={false} capLevel={null} breaches={[]} label={label} records={null} rules={null} coverage={null} empty selected />
          </div>
          <div className="m2-sec">
            <EmptyFrame action={<V2Link href={`/v2?open=system:${system.id}`} className="m2-btn">{system.state === "not_extracted" ? `Extract ${system.name}` : `Run analysis on ${system.name}`}</V2Link>}>
              No run yet. The ruler fills when an analysis scores this object.
            </EmptyFrame>
          </div>
          {tabs}
          <div className="m2-tabpanel">{children}</div>
        </>
      ) : (
        <>
          {receiptQ.isError ? (
            <div className="m2-sec">
              <ErrorFrame onRetry={() => void receiptQ.refetch()}>The score&apos;s working could not be read for this run.</ErrorFrame>
            </div>
          ) : null}
          {receipt ? (
            <p className="m2-statusline" data-testid="object-status">
              {statusItems(receipt, cell).map((it, i) => (
                <span key={i}>{it}</span>
              ))}
            </p>
          ) : (
            <p className="m2-statusline"><Skeleton width={420} height={14} /></p>
          )}
          <div className="m2-score">
            <Ruler
              size={240}
              dims={dimsOf(cell)}
              measured={cell.raw_score}
              score={cell.score}
              capped={cell.capped}
              capLevel={cell.cap_level}
              breaches={cell.breaches}
              label={label}
              records={cell.records_checked}
              rules={cell.rules_measured}
              coverage={cell.coverage}
              lowConfidence={cell.low_confidence}
              selected
            />
            <div className="m2-sline" data-testid="cap-sentence">
              <span className="m2-v">
                <VerdictMark verdict={cell.verdict} />
                {VERDICT_LABEL[cell.verdict]}
              </span>
              <p>
                {`Measured ${f1(cell.raw_score)}, the tick on the ruler. `}
                <CapSentence capped={cell.capped} capLevel={cell.cap_level} ids={cell.breaches} />
              </p>
            </div>
          </div>
          {receipt ? (
            <details className="m2-rdet" open>
              <summary>{`How ${f1(receipt.score)} is made`}</summary>
              <ReceiptTable receipt={receipt} />
            </details>
          ) : receiptQ.isError ? null : (
            <ReceiptSkeleton capRow={cell.cap_level != null} breaches={cell.breaches.length} />
          )}
          {tabs}
          <div className="m2-tabpanel">{children}</div>
        </>
      )}
    </>
  );
}

/** The Rules tab lives in object/RulesTab.tsx; it is re-exported here so the object screen keeps one front door. */
export { RulesTab } from "./object/RulesTab";

const EMPTY: Record<Exclude<TabKey, "rules">, { text: (label: string) => string; action: string; href: (system: string, module: string) => string }> = {
  records: { text: (l) => `No failing records are listed for ${l} yet. Rows appear when an analysis finds rules with a fixable or suggested value.`, action: "Open Work", href: () => "/v2/work" },
  fixes: { text: (l) => `No fix batches for ${l} yet. A batch starts when a steward accepts suggested values or imports a filled fix sheet.`, action: "Open Work", href: () => "/v2/work" },
  runs: { text: (l) => `${l} has no run history here yet. Each run adds a point once two runs have scored this object.`, action: "Open the runs", href: () => "/v2/runs" },
  readiness: { text: (l) => `Feature impact for ${l} is calculated from the rules that fail. It fills when the impact model has run for this object.`, action: "Open the capping rules", href: () => "" },
  processes: { text: (l) => `No process step reads ${l} yet. Process readiness fills when a step of the process model reads the fields of the object.`, action: "Open the designer", href: (s, m) => `/v2/o/${s}/${m}/processes/design` },
  lineage: { text: (l) => `Lineage fills when a field map is loaded for ${l}: it shows where its fields come from and which rules read them.`, action: "Open the landscape", href: () => "/v2" },
  glossary: { text: (l) => `No glossary terms are linked to ${l} yet. A data owner links a term to a field and it appears here.`, action: "Open the rules", href: (s, m) => `/v2/o/${s}/${m}` },
  golden: { text: (l) => `No golden records for ${l} yet. A match run creates them from the records that describe the same thing.`, action: "Open the rules", href: (s, m) => `/v2/o/${s}/${m}` },
};

/** A tab that has no data behind it in this step: a designed empty frame with its one action. */
export function EmptyTab({ tab, system: systemSegment, module: moduleSegment }: { tab: Exclude<TabKey, "rules">; system: string; module: string }) {
  const run = useRunParam();
  const { label } = resolve(useLandscape(run).data, systemSegment, moduleSegment);
  const def = EMPTY[tab];
  const href = tab === "readiness" ? `/v2/o/${systemSegment}/${moduleSegment}` : def.href(systemSegment, moduleSegment);
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
