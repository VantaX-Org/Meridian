"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { formatDate } from "@/lib/format";
import type { Landscape, LandscapeCell, LandscapeSystem } from "@/lib/api/v2/types";
import { useOpenItem, useRunParam } from "@/lib/v2/hooks";
import { useCounts, useLandscape } from "@/lib/v2/queries";
import { DIMENSIONS } from "@/lib/api/v2/types";
import { f1, int, moduleSlug, readingText, systemSlug } from "@/lib/v2/score";
import { Ruler } from "../Ruler";
import { IconChevron } from "../marks";
import { ErrorFrame, Skeleton, V2Link } from "../parts";
import { RunMenu, ScopeMenu } from "./TopBar";

export function dimsOf(cell: LandscapeCell): (number | null)[] {
  return DIMENSIONS.map((d) => cell.dimensions[d.key] ?? null);
}

function ObjectRow({ system, cell, label, current, fixtureRun }: { system: LandscapeSystem; cell: LandscapeCell; label: string; current: boolean; fixtureRun: string | null }) {
  const reading = readingText({ label, measured: cell.raw_score, score: cell.score, capped: cell.capped, capLevel: cell.cap_level, breaches: cell.breaches, dims: dimsOf(cell), records: cell.records_checked, rules: cell.rules_measured, coverage: cell.coverage, lowConfidence: cell.low_confidence });
  const href = `/v2/o/${systemSlug(system.name)}/${moduleSlug(cell.module)}${fixtureRun ? `?run=${fixtureRun}` : ""}`;
  return (
    <V2Link href={href} className="m2-orow" aria-current={current ? "page" : undefined} title={reading}>
      <span className="m2-orow-nm">
        <span className="m2-orow-nt">
          {label}
          {cell.low_confidence ? <span className="m2-orow-lc">low coverage</span> : null}
        </span>
        {cell.open_work ? <span className="m2-orow-wk">{int(cell.open_work)}</span> : null}
      </span>
      <span className="m2-sc">{f1(cell.score)}</span>
      <span className="m2-orow-r">
        <Ruler
          size={48}
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
          showScore={false}
        />
      </span>
    </V2Link>
  );
}

function SystemStatus({ system, landscape }: { system: LandscapeSystem; landscape: Landscape }) {
  const { hrefFor } = useOpenItem();
  const link = (label: string) => (
    <V2Link href={hrefFor({ kind: "system", id: system.id })}>
      {label}
    </V2Link>
  );
  if (system.state === "analysed") {
    const n = landscape.cells.filter((c) => c.system_id === system.id).length;
    return <>{`${system.last_extracted_at ? formatDate(system.last_extracted_at, "datetime") : "Analysed"}, ${n} ${n === 1 ? "object" : "objects"}`}</>;
  }
  if (system.state === "extracted") return <>Extracted, not analysed. {link("Run analysis")}</>;
  return <>Not extracted yet. {link("Extract")}</>;
}

/**
 * The map: the whole landscape as a tree. Four places at the top (Landscape, Work, Runs, People), then each system
 * with its objects, each object a row with its 48 ruler, its score and the work waiting. A system that was never
 * extracted keeps its row and says so. On a phone it is a bottom sheet.
 */
export function MapPane({ open, onClose, phone }: { open: boolean; onClose: () => void; phone: boolean }) {
  const pathname = usePathname();
  const run = useRunParam();
  const q = useLandscape(run);
  const counts = useCounts();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const current = (href: string, exact = false) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const L = q.data;
  const isOpen = (s: LandscapeSystem) => expanded[s.id] ?? s.state === "analysed";
  return (
    <aside
      id="m2-map"
      className={`m2-map${open ? " m2-open" : ""}`}
      aria-label="Map"
      role={phone && open ? "dialog" : undefined}
      aria-modal={phone && open ? true : undefined}
      data-testid="map"
    >
      <div className="m2-map-head">
        <span>Map</span>
        <button type="button" className="m2-x" onClick={onClose} aria-label="Close map">
          <span className="m2-x-t">Close</span>
        </button>
      </div>
      {phone ? (
        <div className="m2-map-sw">
          <ScopeMenu compact />
          <RunMenu compact />
        </div>
      ) : null}
      <nav className="m2-mnav" aria-label="Places">
        <V2Link href="/v2" className="m2-mi" aria-current={current("/v2", true) ? "page" : undefined}>
          <span>Landscape</span>
          <kbd className="m2-kb">g l</kbd>
        </V2Link>
        <V2Link href="/v2/work" className="m2-mi" aria-current={current("/v2/work") ? "page" : undefined}>
          <span>Work</span>
          {counts.data?.fix ? <span className="m2-n">{int(counts.data.fix)}</span> : <kbd className="m2-kb">g w</kbd>}
        </V2Link>
        <V2Link href="/v2/runs" className="m2-mi" aria-current={current("/v2/runs") || current("/v2/run") ? "page" : undefined}>
          <span>Runs</span>
          <kbd className="m2-kb">g r</kbd>
        </V2Link>
        <V2Link href="/v2/people" className="m2-mi" aria-current={current("/v2/people") ? "page" : undefined}>
          <span>People</span>
          <kbd className="m2-kb">g p</kbd>
        </V2Link>
      </nav>
      <div className="m2-mgrp">Systems</div>
      {q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>The systems could not be read.</ErrorFrame>
      ) : !L ? (
        <div className="m2-sys" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="m2-sysrow">
              <span />
              <span>
                <Skeleton width={120} height={14} />
                <br />
                <Skeleton width={180} height={12} />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="m2-sys">
          {L.systems.map((s) => {
            const openNow = isOpen(s);
            const cells = L.cells.filter((c) => c.system_id === s.id);
            return (
              <div key={s.id}>
                <button type="button" className="m2-sysrow" aria-expanded={openNow} onClick={() => setExpanded((e) => ({ ...e, [s.id]: !openNow }))}>
                  <IconChevron open={openNow} />
                  <span className="m2-sysrow-nm">{s.name}</span>
                </button>
                <div className="m2-sysrow-st">
                  <SystemStatus system={s} landscape={L} />
                </div>
                {openNow
                  ? cells.map((c) => {
                      const label = L.objects.find((o) => o.module === c.module)?.label ?? c.module;
                      const here = pathname.startsWith(`/v2/o/${systemSlug(s.name)}/${moduleSlug(c.module)}`);
                      return <ObjectRow key={c.module} system={s} cell={c} label={label} current={here} fixtureRun={run} />;
                    })
                  : null}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
