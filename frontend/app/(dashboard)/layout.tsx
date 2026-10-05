"use client";

/**
 * The Meridian shell: a labelled journey sidebar, a 48 px top bar, and the
 * workspace underneath. Workspaces live in lib/workspaces.ts, ⌘1–⌘6 to switch,
 * ⌘K for everything else. The nav itself lives in lib/nav.ts and feeds the
 * palette and the titles here, so a page is never named differently in two
 * places.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  Bookmark, ClipboardList, Database, LayoutDashboard, Moon, Rows3, ScanSearch, Search, Settings2, Sun, Workflow,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppShell, CommandPalette, DepthCrumb, type CommandPaletteCommand, type DepthSegment } from "@/components/aurora";
import { MeridianMark } from "@/components/meridian/icons";
import { JobRail } from "@/components/shell/job-rail";
import { SELF_CRUMB } from "@/components/shell/page-crumb";
import { JourneyNav } from "@/components/shell/journey-nav";
import { AuthGuard, HeaderExportMenu, NotificationBell, UserButton } from "@/components/shell/widgets";
import { useJobStream } from "@/hooks/use-jobs";
import { useNavGate, useVisibleNav } from "@/hooks/use-nav";
import { useRole } from "@/hooks/use-role";
import { useAuroraPrefs } from "@/hooks/use-theme";
import apiClient from "@/lib/api/client";
import { flattenNav, getPageTitle } from "@/lib/nav";
import { HUB_ROUTES, locate, visibleWorkspaces, type WorkspaceId } from "@/lib/workspaces";
import type { HealthResponse } from "@/types/api";

const ICONS: Record<WorkspaceId, React.ReactNode> = {
  "command-centre": <LayoutDashboard size={20} strokeWidth={1.5} />,
  data: <Database size={20} strokeWidth={1.5} />,
  analyse: <ScanSearch size={20} strokeWidth={1.5} />,
  workbench: <ClipboardList size={20} strokeWidth={1.5} />,
  process: <Workflow size={20} strokeWidth={1.5} />,
  admin: <Settings2 size={20} strokeWidth={1.5} />,
};
const DENSITY_NEXT = { compact: "default", default: "comfortable", comfortable: "compact" } as const;

/** Portfolio, hub, tab: the tab comes from ?tab= on a hub, from the page title elsewhere. */
function Crumb({ pathname }: { pathname: string }) {
  const tabId = useSearchParams().get("tab");
  const here = locate(pathname);
  const w = here?.workspace;
  const hubTab = w && HUB_ROUTES.has(pathname)
    ? (w.tabs.find((t) => t.id === tabId) ?? w.tabs.find((t) => !t.hidden))
    : undefined;
  if (SELF_CRUMB.test(pathname)) return null; // the page draws its own, one level deeper
  const segments: DepthSegment[] = [{ level: "portfolio", label: "Portfolio", href: "/" }];
  if (w) segments.push({ level: "hub", label: w.label, href: w.href });
  if (hubTab) segments.push({ level: "tab", label: hubTab.label });
  else if (!HUB_ROUTES.has(pathname)) segments.push({ level: "page", label: getPageTitle(pathname) });
  return <DepthCrumb segments={segments} renderLink={({ children: c, ...props }) => <Link {...props}>{c}</Link>} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const gate = useNavGate();
  const { can } = useRole();
  const { theme, density, setTheme, setDensity } = useAuroraPrefs();
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const groups = useVisibleNav(); // nav + palette share lib/nav.ts; titles below come from the same source
  useJobStream();

  const workspaces = useMemo(() => visibleWorkspaces(gate), [gate]);

  // Palette: workspaces, every visible nav page, and one quick action. Same
  // role and licence filters as the rail, because it reads the same nav.
  const commands = useMemo<CommandPaletteCommand[]>(() => {
    const out: CommandPaletteCommand[] = workspaces.map((w) => ({
      id: `ws:${w.id}`, label: w.label, group: "Workspaces", hint: w.shortcut, keywords: ["workspace"],
      onRun: () => router.push(w.href),
    }));
    const hrefs = new Set<string>();
    for (const g of groups) {
      for (const item of flattenNav(g.items)) {
        hrefs.add(item.href);
        out.push({
          id: `nav:${item.href}`, label: item.label, group: g.group, hint: item.shortcut,
          keywords: item.keywords ? item.keywords.split(/\s+/) : undefined,
          icon: <item.icon size={16} aria-hidden />,
          onRun: () => router.push(item.href),
        });
      }
    }
    if (hrefs.has("/findings")) {
      out.push({
        id: "action:saved-views", label: "Go to Findings with active filters", group: "Quick actions",
        hint: "Opens the last saved view", icon: <Bookmark size={16} aria-hidden />,
        onRun: () => router.push("/findings"),
      });
    }
    return out;
  }, [workspaces, groups, router]);

  // ⌘1–⌘6 switch workspace (Alt on Windows/Linux keyboards without a Meta key).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.altKey) || e.ctrlKey || e.shiftKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= workspaces.length) {
        e.preventDefault();
        router.push(workspaces[n - 1].href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [workspaces, router]);

  const { data: health } = useQuery<HealthResponse>({
    queryKey: ["health"],
    queryFn: async () => (await apiClient.get("/health")).data,
    staleTime: 60_000,
  });
  const licenceOk = health?.licence?.valid;

  return (
    <AppShell
      rail={
        <>
          <Link href="/" className="aurora-rail__mark" aria-label="Meridian home">
            <MeridianMark size={22} />
          </Link>
          <Suspense fallback={null}>
            <JourneyNav workspaces={workspaces} icons={ICONS} />
          </Suspense>
          <Link
            href="/settings/licence"
            className="aurora-rail__licence"
            data-state={licenceOk === true ? "ok" : licenceOk === false ? "bad" : "unknown"}
            title={licenceOk === true ? "Licence valid" : licenceOk === false ? "Licence problem: open licence settings" : "Checking licence"}
            aria-label="Licence"
          />
        </>
      }
      topBar={
        <>
          <Suspense fallback={null}>
            <Crumb pathname={pathname} />
          </Suspense>
          <div className="aurora-topbar__spacer" />
          <JobRail />
          <button type="button" className="aurora-topbar__cmdk aurora-focus-ring" onClick={() => setCmdkOpen(true)}
                  aria-label="Search and go to (Command K)">
            <Search size={14} aria-hidden /> <span>Search and go to</span> <kbd>⌘K</kbd>
          </button>
          {can("export") ? <HeaderExportMenu /> : null}
          <NotificationBell />
          <button type="button" className="aurora-topbar__icon aurora-focus-ring" aria-label="Change density"
                  title={`Density: ${density}`} onClick={() => setDensity(DENSITY_NEXT[density])}>
            <Rows3 size={16} aria-hidden />
          </button>
          <button type="button" className="aurora-topbar__icon aurora-focus-ring"
                  aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
          </button>
          <UserButton />
          <CommandPalette
            commands={commands}
            open={cmdkOpen}
            onOpenChange={setCmdkOpen}
            placeholder="Jump to a page, for example findings or systems"
            emptyMessage="No matches."
          />
        </>
      }
    >
      {children}
    </AppShell>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <Shell>{children}</Shell>
    </AuthGuard>
  );
}
