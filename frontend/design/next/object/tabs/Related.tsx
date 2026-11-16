"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { applyTemplate, deleteWatch, putWatch, type ApplyPlan, type WatchKind } from "@/lib/api/v2/roles";
import { failureText } from "@/lib/v2/errors";
import { useOpenItem, useV2Href, useV2Session } from "@/lib/v2/hooks";
import { notFound, refreshRoles, useRelated, useWatch } from "@/lib/v2/roles-queries";
import { int, moduleSlug } from "@/lib/v2/score";
import { MODULE_LABELS } from "@/lib/format";
import { moduleText } from "@/lib/v2/labels";
import { t } from "@/lib/v2/i18n";
import Link from "next/link";
import { Button, Skeleton } from "@/design/next/kit";
import "./tabs-f.css";

const REL: Record<string, () => string> = { upstream: () => t("upstream"), downstream: () => t("downstream"), "shared-reference": () => t("shares reference data") };

/**
 * Under the object's title: the objects to govern with it, each with its relation and open critical failures, the
 * fix-order hint when an upstream object still fails, a Watch toggle, the way to the data contracts and the owner's
 * steward template.
 */
export function RelatedObjects({ module, system, systemId, label }: { module: string; system: string; systemId: string; label: string }) {
  const q = useRelated(module);
  const { hrefFor } = useOpenItem();
  const href = useV2Href();
  return (
    <section className="nx-tf-sec" aria-label={t("Related objects")} data-testid="related-objects">
      <div className="nx-tf-tools">
        <WatchToggle kind="object" id={`${systemId}:${module}`} label={label} />
        <Link href={hrefFor({ kind: "contracts", id: "" })} className="nx-btn nx-btn-secondary">
          {t("Data contracts")}
        </Link>
        <OwnerApply module={module} />
      </div>
      {q.isError ? (
        notFound(q.error) ? null : <p className="nx-muted">{t("The related objects could not be read.")}</p>
      ) : !q.data ? (
        <Skeleton lines={1} label={t("Loading")} />
      ) : q.data.related.length === 0 ? (
        <p className="nx-muted">{t("No related object is mapped for this object.")}</p>
      ) : (
        <>
          {q.data.fix_hint ? (
            <p className="nx-note" data-testid="fix-hint">
              {q.data.fix_hint.sentence}
            </p>
          ) : null}
          <ul className="nx-tf-related" aria-label={t("Objects related to {label}", { label })}>
            {q.data.related.map((r) => (
              <li key={r.module}>
                <Link className="nx-link" href={href(`/next/o/${system}/${moduleSlug(r.module)}`)}>{Object.hasOwn(MODULE_LABELS, r.module) ? moduleText(r.module) : r.label}</Link>
                <span className="nx-muted">{`${REL[r.relation]?.() ?? r.relation}${r.open_criticals ? t(", {open_criticals} critical", { open_criticals: int(r.open_criticals) }) : ""}`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Follow an item: runs, score drops, new critical breaches and comments reach the person. */
export function WatchToggle({ kind, id, label }: { kind: WatchKind; id: string; label: string }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const q = useWatch(kind, id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (q.isError && notFound(q.error)) return <span className="nx-muted" title={t("Watching is not available on this server yet")}>—</span>;
  const watching = q.data?.watching ?? false;
  const readOnly = session.shared || Boolean(session.viewAs);
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (watching) await deleteWatch(kind, id);
      else await putWatch(kind, id, []);
      await refreshRoles(qc, "watch");
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="nx-tf-watch" data-testid="watch">
      <Button variant="secondary" size={32} aria-pressed={watching} loading={busy} disabled={!q.data || readOnly} reason={readOnly ? t("Read-only view") : undefined} onClick={() => void toggle()}>
        {watching ? t("Watching") : t("Watch")}
      </Button>
      <span className="nx-muted">{watching ? t("You hear about runs, score drops, new critical breaches and comments on {label}.", { label }) : t("Hear about runs, score drops and comments on {label}.", { label })}</span>
      {error ? <span className="nx-error-line" role="alert">{error}</span> : null}
    </span>
  );
}

/**
 * An object's owner applies the steward assignment template to their own object (the server refuses any other): the
 * first click shows what would change, the second applies it. Administrators use Admin, Stewardship.
 */
function OwnerApply({ module }: { module: string }) {
  const session = useV2Session();
  const [plan, setPlan] = useState<ApplyPlan | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!session.can("approve") || session.can("manage_settings") || session.shared || Boolean(session.viewAs)) return null;
  const go = async (dry: boolean) => {
    setNote(null);
    setBusy(true);
    try {
      const r = await applyTemplate(dry, [module]);
      if (dry) setPlan(r);
      else {
        setPlan(null);
        setNote(t("Applied: {add} added, {change} changed.", { add: r.totals.add, change: r.totals.change }));
      }
    } catch (e) {
      setNote(failureText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="nx-tf-tools" data-testid="owner-apply">
      {plan ? (
        <>
          <span className="nx-muted">{t("The template would add {add} and change {change} assignments.", { add: plan.totals.add, change: plan.totals.change })}</span>
          <Button variant="primary" size={32} loading={busy} disabled={plan.totals.add + plan.totals.change === 0} onClick={() => void go(false)}>
            {t("Apply")}
          </Button>
        </>
      ) : (
        <Button variant="secondary" size={32} loading={busy} onClick={() => void go(true)}>
          {t("Steward template")}
        </Button>
      )}
      {note ? <span role="status">{note}</span> : null}
    </span>
  );
}
