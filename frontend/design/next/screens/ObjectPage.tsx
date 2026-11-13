"use client";

/**
 * The object page: the object bar, the tabs, and the open tab under them. The tab is a path segment, the run is
 * `?run=`; both survive a reload and a shared link. Under 1100 px the tabs after Fixes move into one list.
 */
import { useCallback, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, Skeleton, ErrorState, EmptyState } from "@/design/next/kit";
import { V2Link } from "@/design/v2/parts";
import { t } from "@/lib/v2/i18n";
import { useObjectCycle } from "@/lib/api/next/runs";
import { ObjectBar } from "../object/ObjectBar";
import { useObjectRun } from "../object/useObjectRun";
import { PRIMARY, TAB_IDS, renderTab, tabLabel, type TabId } from "../object/tabs";
import "../object/object.css";

const WIDE = "(min-width: 1100px)"; // i18n-ignore
const subscribeWide = (cb: () => void) => {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, () => typeof window.matchMedia !== "function" || window.matchMedia(WIDE).matches, () => true);
}

const ID = "nx-object";

export function ObjectPage({ system, module, tab }: { system: string; module: string; tab: TabId }) {
  const router = useRouter();
  const params = useSearchParams();
  const o = useObjectRun(system, module);
  const { cycle } = useObjectCycle(o.runId, o.module);
  const wide = useWide();

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

  const shown = wide ? TAB_IDS : PRIMARY;
  const items = shown.map((id) => ({ id, label: tabLabel(id) }));
  const inMore = !shown.includes(tab);

  if (o.landscape.isLoading) return <div className="nx-object"><Skeleton lines={6} label={t("Loading the object")} /></div>;
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
      <ObjectBar o={o} cycle={cycle} onCompare={() => go("cycle", { step: "compare" })} />
      <div className="nx-otabs">
        <Tabs items={items} value={inMore ? "" : tab} onChange={(id) => go(id as TabId)} label={t("Object views")} idBase={ID} />
        {!wide ? (
          <label className="nx-otabs-more">
            <span className="nx-sr">{t("More tabs")}</span>
            <select aria-label={t("More tabs")} value={inMore ? tab : ""} onChange={(e) => e.target.value && go(e.target.value as TabId)}>
              <option value="">{t("More")}</option>
              {TAB_IDS.filter((id) => !PRIMARY.includes(id)).map((id) => <option key={id} value={id}>{tabLabel(id)}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      <section
        id={`${ID}-panel-${tab}`}
        role="tabpanel"
        {...(inMore ? { "aria-label": tabLabel(tab) } : { "aria-labelledby": `${ID}-tab-${tab}` })}
        className="nx-opanel"
        tabIndex={-1}
      >
        {renderTab(tab, o, go)}
      </section>
    </div>
  );
}
