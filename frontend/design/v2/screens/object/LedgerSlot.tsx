"use client";

import { useEffect, useState, type ComponentType } from "react";
import { useRunParam } from "@/lib/v2/hooks";
import { useLandscape } from "@/lib/v2/queries";
import { findSystem, moduleFromSlug } from "@/lib/v2/score";
import { EmptyFrame, Skeleton, V2Link } from "../../parts";

/**
 * The work ledger is built as design/v2/screens/Ledger.tsx. The Records tab and the rule canvas show it scoped, and
 * reach it only through this slot: a dynamic import that fails quietly when the module is not there, with a designed
 * frame in its place, so a branch without the ledger still builds and still reads well.
 */

export interface LedgerProps {
  /** API module id (material_master). */
  module?: string;
  /** System id. */
  system?: string;
  /** Narrowing filters, by the work API's names: check_id, status, severity. */
  filters?: Record<string, string | undefined>;
}

type LedgerModule = { Ledger?: ComponentType<LedgerProps> };
export type LedgerLoader = () => Promise<LedgerModule>;

// The name is a runtime value on purpose: webpack then builds a context limited by webpackInclude, and an absent
// Ledger.tsx is a rejected promise at run time rather than a failed build.
function loadScreen(name: string): Promise<LedgerModule> {
  return import(/* webpackInclude: /Ledger\.tsx$/ */ `../${name}.tsx`) as Promise<LedgerModule>;
}
const defaultLoader: LedgerLoader = () => loadScreen("Ledger");

let cached: ComponentType<LedgerProps> | null | undefined;

type State = { status: "loading" } | { status: "absent" } | { status: "ready"; Ledger: ComponentType<LedgerProps> };

export function LedgerSlot({ label, scope, loader = defaultLoader }: { label: string; scope: LedgerProps; loader?: LedgerLoader }) {
  const [state, setState] = useState<State>(() => (loader === defaultLoader && cached ? { status: "ready", Ledger: cached } : loader === defaultLoader && cached === null ? { status: "absent" } : { status: "loading" }));
  useEffect(() => {
    if (state.status !== "loading") return;
    let live = true;
    loader().then(
      (m) => {
        if (!live) return;
        if (m.Ledger) {
          if (loader === defaultLoader) cached = m.Ledger;
          setState({ status: "ready", Ledger: m.Ledger });
        } else {
          if (loader === defaultLoader) cached = null;
          setState({ status: "absent" });
        }
      },
      () => {
        if (!live) return;
        if (loader === defaultLoader) cached = null;
        setState({ status: "absent" });
      },
    );
    return () => {
      live = false;
    };
  }, [loader, state.status]);

  if (state.status === "ready") return <state.Ledger {...scope} />;
  if (state.status === "loading") {
    return (
      <div aria-busy="true" data-testid="ledger-loading">
        <Skeleton width="100%" height={200} />
      </div>
    );
  }
  return (
    <EmptyFrame action={<V2Link href={scope.module ? `/v2/work?module=${encodeURIComponent(scope.module)}` : "/v2/work"} className="m2-btn">Open Work</V2Link>}>
      {`The ledger of failing records for ${label} could not be loaded here. Work lists every record and failing field, ranked by value at risk, with the current value, the suggested value and the decision on the row.`}
    </EmptyFrame>
  );
}

/** Resets the module-level cache between tests. */
export function resetLedgerCache(): void {
  cached = undefined;
}

/** The Records tab: the ledger scoped to the object. */
export function RecordsTab({ system: systemSegment, module: moduleSegment }: { system: string; module: string }) {
  const run = useRunParam();
  const apiModule = moduleFromSlug(moduleSegment);
  const L = useLandscape(run).data;
  const system = L ? findSystem(L.systems, decodeURIComponent(systemSegment)) : undefined;
  const label = L?.objects.find((o) => o.module === apiModule)?.label ?? apiModule.replace(/_/g, " ");
  return <LedgerSlot label={label} scope={{ module: apiModule, system: system?.id }} />;
}
