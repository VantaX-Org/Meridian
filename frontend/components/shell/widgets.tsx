"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Bell, Download, FileText, FileJson, FileSpreadsheet, List, LogOut } from "lucide-react";
import { toast } from "sonner";
import { downloadAuthenticated } from "@/lib/api/download";
import { useAuth } from "@/context/auth-context";
import { ForcePasswordChange } from "@/components/force-password-change";
import { UpdateAvailableModal } from "@/components/update-available-modal";
import { UpdateModalProvider } from "@/context/update-modal-context";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getVersions } from "@/lib/api/versions";
import { getReportDownloadUrl, getReportJsonExportUrl } from "@/lib/api/reports";
import { getConfigMatchesExportUrl } from "@/lib/api/config-matches";
import { getNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead } from "@/lib/api/notifications";
import { relativeTime } from "@/lib/format";
import type { Notification as NotifType } from "@/types/api";

export function LocalUserButton() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const initials = user
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "?";

  const handleSignOut = () => {
    setOpen(false);
    logout();
    router.push("/sign-in");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Account"
            aria-label="Account"
            className="aurora-topbar__avatar"
          />
        }
      >
        {initials}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 overflow-hidden rounded-2xl p-0 shadow-xl" sideOffset={8}>
        {user && (
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground truncate">{user.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
        )}
        <div className="p-1.5">
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const UserButton = LocalUserButton;

/**
 * Header-bar export dropdown. Rendered only for roles with the `export`
 * permission (the config-matches export requires it; the PDF/JSON report
 * stays available to every role from /reports).
 *
 * Resolves the most recent ``agents_complete`` version and offers direct
 * downloads for its PDF report, JSON report, and config-matches workbook.
 * No hardcoded URLs or version IDs — everything is keyed off the first
 * completed version returned by ``/api/v1/versions``. If there is no
 * completed version yet the menu items are disabled.
 */
export function HeaderExportMenu() {
  const { data, isLoading } = useQuery({
    queryKey: ["header-export-latest-version"],
    queryFn: () => getVersions({ limit: 10 }),
    staleTime: 30_000,
  });

  const latestComplete = (data?.versions ?? []).find(
    (v) => v.status === "agents_complete",
  );
  const hasReport = Boolean(latestComplete);
  const latestLabel = latestComplete?.label
    ? `“${latestComplete.label}”`
    : latestComplete
      ? new Date(latestComplete.run_at).toLocaleString()
      : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="aurora-topbar__cmdk aurora-focus-ring hidden sm:inline-flex"
          />
        }
      >
        <Download className="h-4 w-4" />
        Export
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
            {isLoading
              ? "Finding the latest version…"
              : hasReport
                ? `Latest analysed version: ${latestLabel}`
                : "No analysed version yet"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />


          <DropdownMenuItem
            disabled={!hasReport}
            onClick={async () => {
              if (!hasReport) return;
              const versionId = latestComplete!.id;
              try {
                await downloadAuthenticated(
                  getReportDownloadUrl(versionId),
                  `meridian_dq_report_${versionId}.pdf`,
                );
                toast.success("PDF report downloaded");
              } catch {
                toast.error("Failed to download PDF report — check your login and try again");
              }
            }}
            className="flex items-center gap-2 cursor-pointer"
          >
            <FileText className="h-4 w-4" />
            <span>Download PDF report</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            disabled={!hasReport}
            onClick={async () => {
              if (!hasReport) return;
              const versionId = latestComplete!.id;
              try {
                await downloadAuthenticated(
                  getReportJsonExportUrl(versionId),
                  `meridian_dq_report_${versionId}.json`,
                );
                toast.success("JSON report downloaded");
              } catch {
                toast.error("Failed to download JSON report — check your login and try again");
              }
            }}
          >
            <FileJson className="h-4 w-4" />
            <span>Download JSON report</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            disabled={!hasReport}
            onClick={async () => {
              if (!hasReport) return;
              const versionId = latestComplete!.id;
              try {
                await downloadAuthenticated(
                  getConfigMatchesExportUrl(versionId),
                  `meridian-config-${versionId.slice(0, 8)}.xlsx`,
                );
                toast.success("Config matches downloaded");
              } catch {
                toast.error("Failed to download config matches — check your login and try again");
              }
            }}
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span>Download config matches (xlsx)</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem
            render={
              <Link href="/reports" className="flex items-center gap-2 cursor-pointer" />
            }
          >
            <List className="h-4 w-4" />
            <span>View all reports</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


/* ─── Notification bell ─── */
const NOTIF_TYPE_ICONS: Record<string, string> = {
  finding: "🔍",
  cleaning: "✨",
  exception: "🚨",
  approval: "✅",
  digest: "📊",
  warning: "⚠️",
};

export function NotificationBell() {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: getUnreadCount,
    refetchInterval: 30_000,
    retry: false,
    meta: { ignoreError: true },
  });

  const { data: recent } = useQuery({
    queryKey: ["notifications-recent"],
    queryFn: () => getNotifications({ limit: 10 }),
    enabled: open,
  });

  const markAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
      qc.invalidateQueries({ queryKey: ["notifications-recent"] });
    },
  });

  const handleClick = async (notif: NotifType) => {
    if (!notif.is_read) {
      await markNotificationRead(notif.id);
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
      qc.invalidateQueries({ queryKey: ["notifications-recent"] });
    }
    if (notif.link) {
      setOpen(false);
      router.push(notif.link);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Notifications"
            aria-label="Notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-foreground/[0.04] hover:text-foreground"
          />
        }
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-white ring-2 ring-[var(--aurora-canvas-base)]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 overflow-hidden rounded-2xl p-0 shadow-xl" sideOffset={8}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="font-display text-sm font-semibold text-foreground">Notifications</span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllMutation.mutate()}
              className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {(!recent?.items || recent.items.length === 0) ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            recent.items.map((notif) => (
              <button
                key={notif.id}
                type="button"
                onClick={() => handleClick(notif)}
                className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-foreground/[0.03] ${
                  notif.is_read ? "opacity-50" : ""
                }`}
              >
                <span className="mt-0.5 text-sm">{NOTIF_TYPE_ICONS[notif.type] || "📋"}</span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{notif.title}</p>
                  <p className="truncate text-xs text-muted-foreground mt-0.5">
                    {notif.body.length > 60 ? notif.body.slice(0, 60) + "…" : notif.body}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{relativeTime(notif.created_at)}</p>
                </div>
                {!notif.is_read && (
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />
                )}
              </button>
            ))
          )}
        </div>
        <div className="border-t border-border px-4 py-2.5">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              router.push("/notifications");
            }}
            className="w-full text-center text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            View all notifications
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/*
 * Sidebar content — uses data-* attributes for CSS-driven responsive collapse.
 * Between lg (1024px) and xl (1280px), globals.css hides labels and collapses
 * the sidebar to 72px via aside[data-sidebar] selectors.
 * When user manually collapses, JS `collapsed` prop hides labels directly.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading, mustChangePassword } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/sign-in");
    }
  }, [isLoading, user, router]);

  // Force password change before any dashboard UI renders. Blocking
  // overlay; user can explicitly sign out from inside it.
  if (user && mustChangePassword) {
    return <ForcePasswordChange />;
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }
  if (!user) return null;
  return (
    <UpdateModalProvider>
      {children}
      <UpdateAvailableModal />
    </UpdateModalProvider>
  );
}

/* ─── Sidebar collapse preference (localStorage-backed external store) ─── */