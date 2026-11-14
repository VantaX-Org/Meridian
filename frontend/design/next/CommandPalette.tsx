"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { CommandPalette as KitPalette, type CommandGroup } from "./kit";
import { useV2Href, useRunParam, useV2Session } from "@/lib/v2/hooks";
import { useLandscape } from "@/lib/v2/queries";
import { useVersionsPage } from "@/lib/v2/runs-queries";
import { moduleSlug, systemSlug } from "@/lib/v2/score";
import { placeIndex } from "@/design/v2/CommandLine";
import { PATHS, redirectFor } from "@/lib/next/nav-defaults";
import { withSheets } from "@/lib/next/sheet";
import { t } from "@/lib/v2/i18n";

/** Every place the old command line knew, at its address in this interface. */
export function nextPlaces(can: (a: string) => boolean) {
  return placeIndex(can).map((p) => {
    const [path, query] = p.href.split("?");
    const to = redirectFor(path);
    return { ...p, href: to ? (to.includes("?") && query ? `${to}&${query}` : `${to}${query ? `?${query}` : ""}`) : p.href };
  });
}

/** Cmd K: go to, objects, actions here and across the portfolio, ask, recent runs. */
export function NextPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const href = useV2Href();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { can } = useV2Session();
  const run = useRunParam();
  const L = useLandscape(run).data;
  const runs = useVersionsPage({ limit: 5 }).data?.versions;
  const go = (to: string) => () => router.push(href(to));

  const groups = useMemo<CommandGroup[]>(() => {
    const out: CommandGroup[] = [{ id: "go", label: t("Go to"), items: nextPlaces(can).map((p) => ({ id: `go-${p.id}`, label: p.title, run: go(p.href) })) }];
    if (L?.objects.length) {
      out.push({
        id: "objects",
        label: t("Objects"),
        items: L.objects.flatMap((o) => {
          const c = L.cells.find((x) => x.module === o.module);
          const sys = L.systems.find((s) => s.id === c?.system_id);
          return sys ? [{ id: `obj-${o.module}`, label: o.label, hint: sys.name, run: go(`/o/${systemSlug(sys.name)}/${moduleSlug(o.module)}`) }] : [];
        }),
      });
    }
    const here = /^\/o\/([^/]+)\/([^/]+)/.exec(pathname);
    if (here) {
      const base = `/o/${here[1]}/${here[2]}`;
      out.push({ id: "here", label: t("On this object"), items: [
        { id: "here-rules", label: t("Open its rules"), run: go(`${base}/rules`) },
        { id: "here-trend", label: t("Open its trend"), run: go(`${base}/trend`) },
      ] });
    }
    out.push({ id: "across", label: t("Across the portfolio"), items: [
      { id: "x-work", label: t("Open the work queue"), run: go(PATHS.work) },
      { id: "x-approve", label: t("Approve waiting batches"), run: go("/work/approvals") },
      { id: "x-load", label: t("Load a file"), run: go(PATHS.load) },
      { id: "x-monitor", label: t("See what changed"), run: go("/work/monitor") },
    ] });
    out.push({ id: "ask", label: t("Ask"), items: [
      { id: "ask-open", label: t("Ask Meridian"), run: () => router.push(`${pathname}?${withSheets(sp, [{ kind: "ask", id: "" }])}`) },
      { id: "ask-work", label: t("Open in Work"), run: go(PATHS.work) },
    ] });
    if (runs?.length) out.push({ id: "runs", label: t("Recent runs"), items: runs.map((r) => ({ id: `run-${r.id}`, label: r.label || `#${r.run_number}`, hint: r.system_name ?? undefined, run: go(`${PATHS.runs}?run=${r.id}`) })) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- go closes over router and href only
  }, [can, L, runs, pathname, sp, href, router]);

  return <KitPalette open={open} onClose={onClose} groups={groups} />;
}
