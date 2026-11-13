"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { useV2Href } from "@/lib/v2/hooks";
import { useLandscape } from "@/lib/v2/queries";
import { groupByRun, useFeed, type RunGroup } from "@/lib/api/next/monitor";
import { LearnedMonitors } from "@/design/v2/screens/LearnedMonitors";
import { LegacyMount } from "../shell/LegacyMount";
import { Button, Chip, Code, EmptyState, ErrorState, Skeleton, Tabs } from "../kit";
import "../shell/shell.css";
import "../monitor/monitor.css";

const STEP = 100;
const TOP = 5;

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
}

function Run({ g, open, onToggle }: { g: RunGroup; open: boolean; onToggle: () => void }) {
  const href = useV2Href();
  const shown = open ? g.findings : g.findings.slice(0, TOP);
  return (
    <li className="nx-mon-run">
      <div className="nx-mon-run-h">
        <h3>{g.label}</h3>
        <span className="nx-mon-when">{when(g.detected_at)}</span>
        {g.newCount ? <Chip tone="new" count={g.newCount}>{t("new")}</Chip> : null}
        {g.regressedCount ? <Chip tone="regressed" count={g.regressedCount}>{t("regressed")}</Chip> : null}
        <span className="nx-mon-end">
          <Link className="nx-link" href={href(`/run/${g.version_id}/vs/${g.baseline_version_id}`)}>{t("Open all in Compare")}</Link>
        </span>
      </div>
      <ul className="nx-mon-find">
        {shown.map((f) => (
          <li key={`${f.check_id}-${f.change}`}>
            <Code code={f.check_id} />
            <Chip tone={f.change === "new" ? "new" : "regressed"} count={f.records}>{f.change === "new" ? t("new") : t("regressed")}</Chip>
            <span className="nx-mon-reason">{f.reason}</span>
          </li>
        ))}
      </ul>
      {g.findings.length > TOP ? (
        <Button variant="quiet" onClick={onToggle} aria-expanded={open}>
          {open ? t("Show fewer") : t("Show all {n} findings").replace("{n}", formatInt(g.findings.length))}
        </Button>
      ) : null}
    </li>
  );
}

function Feed() {
  const landscape = useLandscape(null).data;
  const [module, setModule] = useState("");
  const [system, setSystem] = useState("");
  const [only, setOnly] = useState<"" | "new" | "regressed">("");
  const [since, setSince] = useState("");
  const [limit, setLimit] = useState(STEP);
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());
  const q = useFeed({ module: module || undefined, limit });

  const inSystem = useMemo(() => {
    if (!system || !landscape) return null;
    return new Set(landscape.cells.filter((c) => c.system_id === system).map((c) => c.module));
  }, [system, landscape]);

  const groups = useMemo(() => {
    const items = (q.data?.items ?? []).filter((f) => (!only || f.change === only) && (!inSystem || inSystem.has(f.module)) && (!since || (f.detected_at ?? "") >= since));
    return groupByRun(items);
  }, [q.data, only, inSystem, since]);

  const total = q.data?.total ?? 0;
  const loaded = q.data?.items.length ?? 0;
  const toggle = (id: string) => setOpenRuns((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });

  return (
    <div id="nx-mon-panel-feed" role="tabpanel" className="nx-mon">
      <p className="nx-mon-lede">{t("Everything new, resolved or regressed, across every object, run by run.")}</p>
      <div className="nx-mon-filters" role="group" aria-label={t("Filters")}>
        <label>{t("Object")}
          <select value={module} onChange={(e) => { setModule(e.target.value); setLimit(STEP); }}>
            <option value="">{t("All objects")}</option>
            {(landscape?.objects ?? []).map((o) => <option key={o.module} value={o.module}>{o.label}</option>)}
          </select>
        </label>
        <label>{t("System")}
          <select value={system} onChange={(e) => setSystem(e.target.value)}>
            <option value="">{t("All systems")}</option>
            {(landscape?.systems ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>{t("Since")}
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </label>
        <Chip tone="regressed" pressed={only === "regressed"} onClick={() => setOnly(only === "regressed" ? "" : "regressed")}>{t("Only regressions")}</Chip>
        <Chip tone="new" pressed={only === "new"} onClick={() => setOnly(only === "new" ? "" : "new")}>{t("Only new")}</Chip>
      </div>
      {q.isLoading ? (
        <Skeleton lines={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState heading={t("Nothing new")}>{t("No object has a new or regressed finding since its baseline.")}</EmptyState>
      ) : (
        <ul className="nx-mon-list">
          {groups.map((g) => <Run key={g.version_id} g={g} open={openRuns.has(g.version_id)} onToggle={() => toggle(g.version_id)} />)}
        </ul>
      )}
      {total > 0 ? (
        <div className="nx-mon-foot" aria-live="polite">
          <span>{t("Showing {n} of {m} findings").replace("{n}", formatInt(loaded)).replace("{m}", formatInt(total))}</span>
          {loaded < total ? <Button variant="secondary" onClick={() => setLimit(limit + STEP)}>{t("Show more")}</Button> : null}
        </div>
      ) : null}
    </div>
  );
}

/** What changed, across every object and run. The feed groups findings by run; learned monitors is the second tab. */
export function Monitor() {
  const router = useRouter();
  const path = usePathname();
  const tab = useSearchParams().get("tab") === "learned" ? "learned" : "feed";
  const go = (id: string) => router.replace(id === "feed" ? path : `${path}?tab=${id}`);
  return (
    <div className="nx-monitor">
      <header className="nx-strip">
        <h1>{t("Monitor")}</h1>
        <Tabs items={[{ id: "feed", label: t("Feed") }, { id: "learned", label: t("Learned monitors") }]} value={tab} onChange={go} label={t("Monitor")} idBase="nx-mon" />
      </header>
      {tab === "feed" ? (
        <Feed />
      ) : (
        <div id="nx-mon-panel-learned" role="tabpanel">
          <LegacyMount><LearnedMonitors /></LegacyMount>
        </div>
      )}
    </div>
  );
}
