"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { HelpMenu, ShortcutSheet, TourHost, WhatsNew, startTour, useShortcutHotkey, useWhatsNew } from "@/design";
import { getSystems } from "@/lib/api/connectivity";
import { getCatalogue } from "@/lib/api/process-discovery";
import { getVersions } from "@/lib/api/versions";
import { getObjects } from "@/lib/api/v1/objects";
import { resolveTourHref, type TourLinkSources } from "@/lib/help/tour-links";
import { tourForPath } from "@/lib/help/tours";
import { queryKeys } from "@/lib/query-keys";
import { APP_VERSION } from "@/lib/version";

const FINISHED = new Set(["complete", "agents_complete", "ai_enriched"]);
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || undefined;

/**
 * The top bar's help button and everything it opens: the `?` shortcut sheet, what's new, the tour
 * runner and the report dialog. Mounted once, in the app layout's top bar.
 */
export function HelpSlot() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const { hasNew, markSeen } = useWhatsNew();
  useShortcutHotkey(useCallback(() => setSheetOpen((o) => !o), []));

  const run = searchParams.get("run");

  const sources = useMemo<TourLinkSources>(() => {
    const systems = () => qc.fetchQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
    return {
      run: async () => {
        if (run) return run;
        const data = await qc.fetchQuery({ queryKey: queryKeys.run("list"), queryFn: () => getVersions() });
        return data.versions.find((v) => FINISHED.has(v.status))?.id ?? null;
      },
      system: async () => (await systems())[0]?.id ?? null,
      object: async () => {
        const data = await qc.fetchQuery({ queryKey: queryKeys.objects("latest"), queryFn: () => getObjects("latest") });
        const worst = [...data.objects].sort((a, b) => b.failing_checks - a.failing_checks)[0];
        return worst?.module ?? null;
      },
      process: async () => {
        for (const s of await systems()) {
          try {
            const rows = await qc.fetchQuery({ queryKey: queryKeys.processCatalogue(s.id), queryFn: () => getCatalogue(s.id) });
            const row = rows.find((r) => r.coverage !== "reference" && r.last_run?.status === "completed");
            if (row?.last_run) return { l1: row.l1, runId: row.last_run.id, systemId: s.id };
          } catch {
            /* a system with no catalogue is not a candidate */
          }
        }
        return null;
      },
    };
  }, [qc, run]);

  const tour = tourForPath(pathname);
  const search = searchParams.toString();
  const url = `${typeof window === "undefined" ? "" : window.location.origin}${pathname}${search ? `?${search}` : ""}`;

  return (
    <>
      <HelpMenu
        hasTour={Boolean(tour)}
        onTour={() => tour && startTour(tour.id)}
        onShortcuts={() => setSheetOpen(true)}
        onWhatsNew={() => { setNewsOpen(true); markSeen(); }}
        hasNew={hasNew}
        onDocs={() => router.push("/docs")}
        context={{ url, runId: run, version: APP_VERSION }}
        supportEmail={SUPPORT_EMAIL}
      />
      <ShortcutSheet open={sheetOpen} onOpenChange={setSheetOpen} first={pathname.startsWith("/inbox") ? "Inbox" : undefined} />
      <WhatsNew open={newsOpen} onOpenChange={setNewsOpen} />
      <TourHost navigate={(href) => router.push(href)} resolveHref={(href) => resolveTourHref(href, sources)} />
    </>
  );
}
