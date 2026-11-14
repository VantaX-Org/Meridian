"use client";

/**
 * The object page: the hero, the segments, and the open segment under them. The segment is a path segment, the run is
 * `?run=`; both survive a reload and a shared link.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Denied, isDenied } from "../object/edge";
import { Popover, Skeleton, ErrorState, EmptyState } from "@/design/next/kit";
import { V2Link } from "@/design/v2/parts";
import { Inspector } from "@/design/v2/Inspector";
import { t } from "@/lib/v2/i18n";
import { useObjectCycle } from "@/lib/api/next/runs";
import { ObjectBar } from "../object/ObjectBar";
import { useObjectRun } from "../object/useObjectRun";
import { MORE, SEGMENTS, renderTab, tabLabel, type TabId } from "../object/tabs";
import { LegacyScope } from "../shell/LegacyMount";
import { withSheets } from "@/lib/next/sheet";
import "../object/object.css";

const ID = "nx-object";

export function ObjectPage({ system, module, tab }: { system: string; module: string; tab: TabId }) {
  const router = useRouter();
  const params = useSearchParams();
  const o = useObjectRun(system, module);
  const { cycle } = useObjectCycle(o.runId, o.module);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const go = useCallback(
    (next: TabId, extra: Record<string, string | null> = {}) => {
      const q = new URLSearchParams(params.toString());
      // A step or segment belongs to the tab it was chosen on.
      if (next !== tab) for (const k of ["step", "seg", "before", "after"]) q.delete(k); // i18n-ignore
      for (const [k, v] of Object.entries(extra)) if (v === null) q.delete(k); else q.set(k, v);
      const qs = q.toString();
      router.push(`/next/o/${encodeURIComponent(system)}/${encodeURIComponent(module)}/${next}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [params, router, system, module, tab],
  );

  const inMore = MORE.includes(tab);

  // The old cycle tab is now a sheet; an old link lands on the overview with the sheet open.
  const step = cycle?.step ?? "clean";
  useEffect(() => {
    if (tab !== "cycle") return;
    // An old /cycle?step=compare link opens the compare sheet, the rest open the cycle sheet. One replace carries the
    // sheet with it: opening it apart would write the stale /cycle address back over the redirect.
    const sheet = params.get("step") === "compare" ? { kind: "compare", id: "" } : { kind: "cycle", id: step };
    const qs = withSheets(params.toString(), [sheet]);
    router.replace(`/next/o/${encodeURIComponent(system)}/${encodeURIComponent(module)}/overview${qs ? `?${qs}` : ""}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  if (o.landscape.isLoading) return <div className="nx-object"><Skeleton lines={6} label={t("Loading the object")} /></div>;
  if (o.landscape.isError && isDenied(o.landscape.error)) return <div className="nx-object"><Denied what={t("this object")} /></div>;
  if (o.landscape.isError) return <div className="nx-object"><ErrorState sentence={t("The object could not be loaded.")} error={o.landscape.error} onRetry={() => void o.landscape.refetch()} /></div>;
  if (!o.systemId) {
    return (
      <div className="nx-object">
        <EmptyState heading={t("No system called {name}", { name: decodeURIComponent(system) })} action={<V2Link className="nx-btn nx-btn-secondary" href="/objects">{t("All objects")}</V2Link>}>
          {t("The address names a system this workspace does not hold. Pick the object from the list of objects.")}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="nx-object" data-testid="object-page">
      <ObjectBar o={o} cycle={cycle} />
      <div className="nx-segs" role="tablist" aria-label={t("Object views")}>
        {SEGMENTS.map((id) => (
          <button key={id} type="button" role="tab" id={`${ID}-tab-${id}`} aria-selected={tab === id} aria-controls={`${ID}-panel-${tab}`} className="nx-seg" onClick={() => go(id)}>{tabLabel(id)}</button>
        ))}
        <button ref={moreRef} type="button" role="tab" aria-selected={inMore} aria-haspopup="menu" aria-expanded={moreOpen} className="nx-seg" onClick={() => setMoreOpen((v) => !v)}>
          {inMore ? tabLabel(tab) : t("More")}
        </button>
        <Popover anchor={moreRef.current} open={moreOpen} onClose={() => setMoreOpen(false)} placement="bottom" label={t("More views")}>
          {MORE.map((id) => (
            <button key={id} type="button" role="menuitem" className="nx-menuitem" onClick={() => { setMoreOpen(false); go(id); }}>{tabLabel(id)}</button>
          ))}
        </Popover>
      </div>
      <section
        id={`${ID}-panel-${tab}`}
        role="tabpanel"
        {...(inMore ? { "aria-label": tabLabel(tab) } : { "aria-labelledby": `${ID}-tab-${tab}` })}
        className="nx-opanel"
        tabIndex={-1}
      >
        <LegacyScope>{renderTab(tab, o, go)}<Inspector /></LegacyScope>
      </section>
    </div>
  );
}
