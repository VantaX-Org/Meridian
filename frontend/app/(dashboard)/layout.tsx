"use client";

/**
 * The Meridian shell: a 48 px workspace rail, a 48 px top bar, and the
 * workspace underneath. Five workspaces (lib/workspaces.ts), ⌘1–⌘5 to switch,
 * ⌘K for everything else. The nav itself lives in lib/nav.ts and feeds the
 * palette and the titles here, so a page is never named differently in two
 * places. Pages that are not a workspace hub render inside a light sheet
 * until their Aurora surface lands.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import {
  ClipboardList, Command as CommandIcon, Database, LayoutDashboard, Moon, Rows3, Settings2, Sun, Workflow,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppShell, Breadcrumb, WorkspaceSwitcher } from "@/components/aurora";
import { CommandPalette, useCommandPalette } from "@/components/command-palette";
import { MeridianMark } from "@/components/meridian/icons";
import { JobRail } from "@/components/shell/job-rail";
import { AuthGuard, HeaderExportMenu, NotificationBell, UserButton } from "@/components/shell/widgets";
import { useJobStream } from "@/hooks/use-jobs";
import { useNavGate, useVisibleNav } from "@/hooks/use-nav";
import { useRole } from "@/hooks/use-role";
import { useAuroraPrefs } from "@/hooks/use-theme";
import apiClient from "@/lib/api/client";
import { getPageTitle } from "@/lib/nav";
import { HUB_ROUTES, locate, visibleWorkspaces, type WorkspaceId } from "@/lib/workspaces";
import type { HealthResponse } from "@/types/api";

const ICONS: Record<WorkspaceId, React.ReactNode> = {
  "command-centre": <LayoutDashboard size={20} strokeWidth={1.5} />,
  data: <Database size={20} strokeWidth={1.5} />,
  workbench: <ClipboardList size={20} strokeWidth={1.5} />,
  process: <Workflow size={20} strokeWidth={1.5} />,
  admin: <Settings2 size={20} strokeWidth={1.5} />,
};
const DENSITY_NEXT = { compact: "default", default: "comfortable", comfortable: "compact" } as const;

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const gate = useNavGate();
  const { can } = useRole();
  const { theme, density, setTheme, setDensity } = useAuroraPrefs();
  const { open: cmdkOpen, setOpen: setCmdkOpen } = useCommandPalette();
  useVisibleNav(); // nav + palette share lib/nav.ts; titles below come from the same source
  useJobStream();

  const workspaces = useMemo(() => visibleWorkspaces(gate), [gate]);
  const here = locate(pathname);
  const isHub = HUB_ROUTES.has(pathname);

  // ⌘1–⌘5 switch workspace (Alt on Windows/Linux keyboards without a Meta key).
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

  const crumbs = [
    { label: "Meridian", href: "/" },
    ...(here ? [{ label: here.workspace.label, href: here.workspace.href }] : []),
    ...(!isHub ? [{ label: getPageTitle(pathname) }] : []),
  ];

  return (
    <AppShell
      rail={
        <>
          <Link href="/" className="aurora-rail__mark" aria-label="Meridian home">
            <MeridianMark size={22} />
          </Link>
          <WorkspaceSwitcher
            items={workspaces.map((w) => ({ id: w.id, label: w.label, shortcut: w.shortcut, href: w.href, icon: ICONS[w.id] }))}
            active={here?.workspace.id}
            renderLink={({ children: c, ...props }) => <Link {...props}>{c}</Link>}
          />
          <Link
            href="/settings/licence"
            className="aurora-rail__licence"
            data-state={licenceOk === true ? "ok" : licenceOk === false ? "bad" : "unknown"}
            title={licenceOk === true ? "Licensed" : licenceOk === false ? "Licence problem" : "Checking licence…"}
            aria-label="Licence"
          />
        </>
      }
      topBar={
        <>
          <Breadcrumb
            items={crumbs}
            renderLink={({ children: c, ...props }) => <Link {...props}>{c}</Link>}
          />
          <div className="aurora-topbar__spacer" />
          <JobRail />
          <button type="button" className="aurora-topbar__cmdk aurora-focus-ring" onClick={() => setCmdkOpen(true)}
                  aria-label="Open command palette">
            <CommandIcon size={13} aria-hidden /> <span>K</span>
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
          <CommandPalette open={cmdkOpen} onOpenChange={setCmdkOpen} />
        </>
      }
    >
      {isHub ? children : (
        <div className="aurora-hub">
          <div className="mn-legacy-host" data-theme="light">{children}</div>
        </div>
      )}
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
