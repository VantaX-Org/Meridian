"use client";

/**
 * What the old object frame drew around every view, carried into the new page so nothing is lost: the issues link,
 * the monitors, what Aletheia found, the dimension bars and top failing rules (Overview and Rules), the landscape trend,
 * the fix pipeline, how the score is made and the contracts (Rules), and the related objects (every view).
 */
import type { ReactNode } from "react";
import { V2Link } from "@/design/v2/parts";
import { OLD_RUN_REASON } from "@/design/v2/RunParts";
import { AletheiaFound } from "@/design/v2/screens/AletheiaFound";
import { FixPipeline } from "@/design/v2/screens/Cockpit";
import { LandscapeTrend } from "@/design/v2/screens/CommandCentre";
import { ReceiptTable } from "@/design/v2/screens/Object";
import { ObjectMonitorStrip } from "@/design/v2/screens/ObjectMonitors";
import { DimensionBars } from "@/design/v2/screens/object/Banner";
import { RelatedObjects } from "@/design/v2/screens/object/Related";
import { TopFailing } from "@/design/v2/screens/object/TopFailing";
import { ObjectContractsBlock } from "@/design/v2/screens/step9/Contracts";
import { t } from "@/lib/v2/i18n";
import { useReceipt } from "@/lib/v2/queries";
import { f1, moduleSlug } from "@/lib/v2/score";
import type { ObjectRun } from "./useObjectRun";
import type { TabId } from "./tabs";

/** Above the view: the old frame's headline parts for Overview and Rules. */
export function FrameHead({ id, o }: { id: TabId; o: ObjectRun }) {
  const cell = o.landscape.data?.cells.find((c) => c.system_id === o.systemId && c.module === o.module);
  const receipt = useReceipt(o.module, o.runId, id === "rules" && Boolean(cell));
  if (id !== "overview" && id !== "rules") return null;
  return (
    <div data-testid="frame-head">
      {id === "overview" ? (
        <>
          <ObjectMonitorStrip module={o.module} />
          <p><V2Link href={`/issues?module=${moduleSlug(o.module)}`} data-testid="object-issues">{t("Open the issues")}</V2Link></p>
        </>
      ) : null}
      <AletheiaFound module={o.module} />
      {cell ? (
        <div className="m2-co-grid">
          <DimensionBars cell={cell} />
          <TopFailing module={o.module} run={o.runId} />
        </div>
      ) : null}
      {id === "rules" ? (
        <>
          <div className="m2-ck-row">
            <section className="m2-cc-card"><LandscapeTrend systemId={o.systemId} module={o.module} /></section>
            <FixPipeline label={() => o.label} module={o.module} />
          </div>
          {receipt.data ? (
            <details className="m2-rdet">
              <summary>{t("How {score} is made", { score: f1(receipt.data.score) })}</summary>
              <ReceiptTable receipt={receipt.data} />
            </details>
          ) : null}
          <ObjectContractsBlock module={o.module} label={o.label} run={o.runId} />
        </>
      ) : null}
    </div>
  );
}

/** An old run is for reading: its actions wait behind the reason, as on the old frame. */
export function OldRunGate({ o, children }: { o: ObjectRun; children: ReactNode }) {
  const latest = o.heads[0]?.id;
  if (!latest || !o.runId || o.runId === latest) return <>{children}</>;
  return (
    <fieldset disabled className="m2-oldrun-gate" title={OLD_RUN_REASON()} data-testid="action-gate">
      <p className="m2-why1" data-testid="action-gate-reason">{OLD_RUN_REASON()}</p>
      {children}
    </fieldset>
  );
}

/** Under the view: the objects that share data with this one. */
export function FrameFoot({ o }: { o: ObjectRun }) {
  return o.systemId ? <RelatedObjects module={o.module} system={o.systemSeg} systemId={o.systemId} label={o.label} /> : null;
}
