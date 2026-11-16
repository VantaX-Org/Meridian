"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { useV2Session } from "@/lib/v2/hooks";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { useLandscape } from "@/lib/v2/queries";
import { useWaves } from "@/lib/v2/admin-queries";
import { NextStep } from "@/design/v2/screens/Landscape";
import { NxLink } from "@/design/next/kit";
import { errorSentence } from "@/lib/api/v2/client";
import { analyseRun } from "@/lib/api/v2/runs";
import { fixtureAllowed, useFixture } from "@/lib/api/v2/fixture";
import { getFindings, type AletheiaFinding } from "@/lib/api/v2/insights";
import { actionOf, downloadWorkbooks, startObjects, usePortfolio, type PortfolioRow } from "@/lib/api/next/portfolio";
import { Confirm, EmptyState, ErrorState, Sheet, useToast, Button } from "../kit";
import { CompareObjects } from "../portfolio/CompareObjects";
import { BulkBar, type PortfolioActions } from "../portfolio/BulkBar";
import { UploadPanel } from "../panels/UploadPanel";
import { registerSheet, useSheets } from "../shell/SheetHost";
import { Greeting } from "./Greeting";
import { ObjectsSheet } from "./ObjectsSheet";
import { orderFeed, runningNow } from "./model";
import { QuietRow } from "./QuietRow";
import { StoryCard } from "./StoryCard";
import { StoryCardSkeleton } from "./StoryCardSkeleton";
import { CapNotice } from "./CapNotice";
import "./feed.css";

// The Objects switcher opens from the greeting; registered here so SheetHost and sheets.ts stay free of a cycle.
registerSheet("objects", ({ close }) => <ObjectsSheet onClose={close} />);

/** Home: a greeting, the objects that need you in order, one action each, then the quiet ones. */
export function Home() {
  const session = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const sheets = useSheets();
  const fixture = useFixture();
  const systems = useSystemsExtended().data ?? [];
  // The persona's next step the old landscape led with (the owner's batch to approve, basis's system to fix).
  const landscape = useLandscape(null).data;
  const waves = useWaves().data ?? [];
  const [all, setAll] = useState(false);
  const feed = usePortfolio({ limit: 500 }, all);
  const found = useQuery({ queryKey: ["aletheia-found", fixture, "home"], queryFn: () => getFindings(), staleTime: 60_000 });
  const [pulling, setPulling] = useState<PortfolioRow[] | null>(null);
  const [uploadFor, setUploadFor] = useState<PortfolioRow[] | null>(null);
  const [scoring, setScoring] = useState<Set<string>>(new Set());
  // Ticked runs by version_id; the rows come from the current feed, so a refetch never shows a stale snapshot.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [compared, setCompared] = useState<PortfolioRow[] | null>(null);
  const pullBusy = useRef(false);

  const rows = useMemo(() => feed.data?.objects ?? [], [feed.data]);
  const selected = useMemo(() => rows.filter((r) => picked.has(r.version_id)), [rows, picked]);
  // Drop ticked ids the current feed no longer holds (a new run, or the `all` toggle).
  useEffect(() => {
    if (selected.length !== picked.size) setPicked(new Set(selected.map((r) => r.version_id)));
  }, [selected, picked]);
  const unpick = (ids: string[]) => setPicked((s) => new Set([...s].filter((id) => !ids.includes(id))));
  const { needs, quiet } = useMemo(() => orderFeed(rows, session.persona), [rows, session.persona]);
  const top = useMemo(() => {
    const m = new Map<string, AletheiaFinding>();
    for (const f of [...(found.data?.findings ?? [])].sort((a, b) => b.impact - a.impact)) if (!m.has(f.module)) m.set(f.module, f);
    return m;
  }, [found.data]);
  const count = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of found.data?.findings ?? []) m.set(f.module, (m.get(f.module) ?? 0) + 1);
    return m;
  }, [found.data]);
  const sysName = (id: string | null) => systems.find((s) => s.id === id)?.name ?? id ?? t("Unknown system");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["next", "portfolio"] });

  const act: PortfolioActions = {
    sysName,
    can: session.can,
    scoring,
    pull: (rs) => setPulling(rs),
    upload: (rs) => setUploadFor(rs),
    compare: (rs) => {
      setCompared(rs.slice(0, 6));
      if (rs.length > 6) toast({ text: t("Compare shows six objects at most; the first six are shown."), tone: "neutral" });
    },
    download: async (rs) => {
      for (let i = 0; i < rs.length; i += 50) {
        try {
          await downloadWorkbooks(rs.slice(i, i + 50));
        } catch (err) {
          toast({ text: errorSentence(err, t("The workbook could not be downloaded. Try again.")), tone: "bad" });
          return;
        }
      }
      toast({
        text: rs.length === 1 ? t("Workbook for run {n} downloaded. Upload it when you are done.", { n: formatInt(rs[0].run_number ?? 0) }) : t("{n} workbooks downloaded. Upload them when you are done.", { n: formatInt(rs.length) }),
        tone: "good",
        timeout: 12000,
        action: { label: t("Open Upload"), onClick: () => setUploadFor(rs) },
      });
    },
    score: async (rs) => {
      setScoring((s) => new Set([...s, ...rs.map((r) => r.version_id)]));
      const out = await Promise.allSettled(rs.map((r) => analyseRun(r.version_id)));
      // A failed score frees its button again; a started one stays locked until the refreshed row shows the new run.
      const freed = rs.filter((_, i) => out[i].status === "rejected").map((r) => r.version_id);
      if (freed.length) setScoring((s) => new Set([...s].filter((id) => !freed.includes(id))));
      unpick(rs.map((r) => r.version_id).filter((id) => !freed.includes(id)));
      const failed = out.filter((o) => o.status === "rejected").length;
      toast(failed ? { text: t("{n} of {m} runs could not be scored. Try again.", { n: formatInt(failed), m: formatInt(rs.length) }), tone: "bad" } : { text: t("Scoring {n} runs.", { n: formatInt(rs.length) }), tone: "good" });
      refresh();
    },
  };

  const confirmPull = async () => {
    if (pullBusy.current) return;
    pullBusy.current = true;
    const rs = pulling ?? [];
    setPulling(null);
    try {
      const res = await startObjects([...new Set(rs.map((r) => r.module))]);
      toast({ text: res.skipped.length ? t("{n} objects queued to pull, {m} already running.", { n: formatInt(res.queued.length), m: formatInt(res.skipped.length) }) : t("{n} objects queued to pull.", { n: formatInt(res.queued.length) }), tone: "good" });
      unpick(rs.map((r) => r.version_id));
      refresh();
    } catch (err) {
      toast({ text: errorSentence(err, t("The pull could not start. Try again.")), tone: "bad" });
    } finally {
      pullBusy.current = false;
    }
  };

  const toggle = (r: PortfolioRow) =>
    setPicked((s) => {
      const n = new Set(s);
      if (!n.delete(r.version_id)) n.add(r.version_id);
      return n;
    });
  const firstRun = rows.length > 0 && rows.every((r) => actionOf(r) === "pull");

  const card = (r: PortfolioRow) => (
    <StoryCard key={r.version_id} row={r} act={act} selected={picked.has(r.version_id)} onSelect={() => toggle(r)} finding={top.get(r.module)} evidence={count.get(r.module) ?? 0} onEvidence={() => { const f = top.get(r.module); if (f) sheets.open({ kind: "evidence", id: f.id }); }} />
  );

  return (
    <div className="nx-fd" data-testid="home">
      <Greeting name={session.name} needs={needs.length} running={rows.filter(runningNow).length} onCompare={() => sheets.open({ kind: "compare", id: "" })} onObjects={() => sheets.open({ kind: "objects", id: "" })} next={landscape ? <NextStep landscape={landscape} persona={session.persona} waves={waves} /> : null} />
      {feed.isError ? <ErrorState error={feed.error} fallback={t("Home could not be read. Check that the API is reachable, then retry.")} onRetry={() => void feed.refetch()} />
        : feed.isLoading ? <div className="nx-fd-feed" aria-live="polite">{[0, 1, 2].map((i) => <StoryCardSkeleton key={i} />)}</div>
        : rows.length === 0 && systems.length > 0 ? (
          <EmptyState heading={t("No run yet.")} action={<NxLink className="nx-btn nx-btn-primary" href={`/s/${systems[0].id}`}>{t("Run your first pull")}</NxLink>}>
            {t("A system is connected. Pull its objects to see their quality here.")}
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState heading={t("Connect a system to start")} action={<><Button variant="primary" onClick={() => sheets.open({ kind: "connect", id: "" })}>{t("Connect a system")}</Button>{fixtureAllowed() ? <> <NxLink className="nx-btn nx-btn-quiet" href="/portfolio?fixture=1">{t("Use the demo data")}</NxLink></> : null}</>}>
            {t("Meridian pulls your master data once, scores it, and gives you a workbook to clean it in Excel.")}
          </EmptyState>
        ) : (
          <>
            <CapNotice page={feed.data} onAll={() => setAll(true)} loading={all && feed.isFetching} />
            {firstRun ? <p className="nx-fd-first" role="status" data-testid="fd-first-run">{t("Pull your first object to see its score.")}</p> : null}
            <div className="nx-fd-feed">{needs.map(card)}</div>
            <QuietRow rows={quiet} sysName={sysName} />
            {selected.length ? <div className="nx-fd-bulk"><BulkBar rows={selected} act={act} onClear={() => setPicked(new Set())} /></div> : null}
          </>
        )}
      <Confirm open={!!pulling} title={t("Pull {n} objects now?", { n: formatInt(new Set((pulling ?? []).map((r) => r.module)).size) })} consequence={t("Meridian reads {n} objects from their systems again and scores the new runs. Nothing is written to the systems.", { n: formatInt(new Set((pulling ?? []).map((r) => r.module)).size) })} confirmLabel={t("Pull now")} onConfirm={() => void confirmPull()} onCancel={() => setPulling(null)} />
      <UploadPanel open={!!uploadFor} expected={uploadFor ?? []} onClose={() => setUploadFor(null)} onDone={(res) => { unpick(res.map((r) => r.parent_version_id)); setUploadFor(null); refresh(); }} />
      <Sheet open={!!compared} onClose={() => setCompared(null)} title={t("Compare objects")} size="large">
        <CompareObjects rows={compared ?? []} sysName={sysName} />
      </Sheet>
    </div>
  );
}
