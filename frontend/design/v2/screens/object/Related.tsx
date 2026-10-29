"use client";

import { useState } from "react";
import { applyTemplate, type ApplyPlan } from "@/lib/api/v2/roles";
import { failureText } from "@/lib/v2/errors";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { notFound, useRelated } from "@/lib/v2/roles-queries";
import { int, moduleSlug } from "@/lib/v2/score";
import { WatchToggle } from "../../inspector/collab";
import { Dash, V2Link } from "../../parts";
import "../../roles.css";

/**
 * Under the object's title (step 6c): the objects to govern with it (sap/object_relationships.yaml), each with its
 * relation and open critical failures, the fix-order hint when an upstream object still fails, a Watch toggle and the
 * way to the data contracts.
 */
const REL: Record<string, string> = { upstream: "upstream", downstream: "downstream", "shared-reference": "shares reference data" };

export function RelatedObjects({ module, system, systemId, label }: { module: string; system: string; systemId: string; label: string }) {
  const q = useRelated(module);
  const { hrefFor } = useOpenItem();
  return (
    <section className="m2-sec" aria-label="Related objects" data-testid="related-objects">
      <div className="m2-gtools">
        <WatchToggle kind="object" id={`${systemId}:${module}`} label={label} />
        <V2Link href={hrefFor({ kind: "contracts", id: "" })} className="m2-btn m2-sm">
          Data contracts
        </V2Link>
        <OwnerApply module={module} />
      </div>
      {q.isError ? (
        notFound(q.error) ? null : <p className="m2-meta">The related objects could not be read.</p>
      ) : !q.data ? null : q.data.related.length === 0 ? (
        <p className="m2-meta">No related object is mapped for this object.</p>
      ) : (
        <>
          {q.data.fix_hint ? (
            <p className="m2-fixhint" data-testid="fix-hint">
              {q.data.fix_hint.sentence}
            </p>
          ) : null}
          <ul className="m2-related" aria-label={`Objects related to ${label}`}>
            {q.data.related.map((r) => (
              <li key={r.module}>
                <V2Link href={`/v2/o/${system}/${moduleSlug(r.module)}`}>{r.label}</V2Link>
                <span className="m2-meta">{`${REL[r.relation]}${r.open_criticals ? `, ${int(r.open_criticals)} critical` : ""}`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** The Work ledger's and the record inspector's hint: fix the upstream object first. Nothing when there is none. */
export function FixOrderHint({ module }: { module: string | null }) {
  const q = useRelated(module);
  if (!module || !q.data?.fix_hint) return q.isError && !notFound(q.error) ? <Dash why="The fix order could not be read" /> : null;
  return (
    <p className="m2-fixhint" data-testid="fix-hint" role="note">
      {`${q.data.fix_hint.sentence}. Records there fail before this object can pass.`}
    </p>
  );
}

/**
 * An object's owner applies the steward assignment template to their own object (the server refuses any other):
 * the first click shows what would change, the second applies it. Administrators use Admin, Stewardship.
 */
function OwnerApply({ module }: { module: string }) {
  const session = useV2Session();
  const [plan, setPlan] = useState<ApplyPlan | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (!session.can("approve") || session.can("manage_settings") || session.shared || Boolean(session.viewAs)) return null;
  const go = async (dry: boolean) => {
    setNote(null);
    try {
      const r = await applyTemplate(dry, [module]);
      if (dry) setPlan(r);
      else {
        setPlan(null);
        setNote(`Applied: ${r.totals.add} added, ${r.totals.change} changed.`);
      }
    } catch (e) {
      setNote(failureText(e));
    }
  };
  return (
    <span className="m2-gtools" data-testid="owner-apply">
      {plan ? (
        <>
          <span className="m2-meta">{`The template would add ${plan.totals.add} and change ${plan.totals.change} assignments.`}</span>
          <button type="button" className="m2-btn m2-sm m2-strong" disabled={plan.totals.add + plan.totals.change === 0} onClick={() => void go(false)}>
            Apply
          </button>
        </>
      ) : (
        <button type="button" className="m2-btn m2-sm" onClick={() => void go(true)}>
          Steward template
        </button>
      )}
      {note ? <span role="status">{note}</span> : null}
    </span>
  );
}
