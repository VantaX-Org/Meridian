"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Bell, Download, FileText, FileJson, FileSpreadsheet, List, LogOut } from "lucide-react";
import { toast } from "sonner";
import { downloadAuthenticated } from "@/lib/api/download";
import { useAuth } from "@/context/auth-context";
import { ForcePasswordChange } from "@/components/force-password-change";
import { UpdateAvailableModal } from "@/components/shell/update-available-modal";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/aurora";
import { UpdateModalProvider } from "@/context/update-modal-context";
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
  const initials = user
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "?";

  const handleSignOut = () => {
    logout();
    router.push("/sign-in");
  };

  return (
    <Menu label="Account" trigger={initials} triggerClassName="aurora-topbar__avatar" width={240}>
      {user && (
        <div className="ui-menu__head">
          <strong>{user.name}</strong>
          <span className="ui-micro">{user.email}</span>
        </div>
      )}
      <MenuItem onClick={handleSignOut}><LogOut size={16} aria-hidden />Sign out</MenuItem>
    </Menu>
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
  const router = useRouter();
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

  const download = async (url: string, filename: string, done: string, failed: string) => {
    try {
      await downloadAuthenticated(url, filename);
      toast.success(done);
    } catch {
      toast.error(failed);
    }
  };

  return (
    <Menu
      label="Export"
      trigger={<><Download size={16} aria-hidden />Export</>}
      triggerClassName="aurora-topbar__cmdk aurora-topbar__export aurora-focus-ring"
      width={272}
    >
      <MenuLabel>
        {isLoading
          ? "Finding the latest version…"
          : hasReport
            ? `Latest analysed version: ${latestLabel}`
            : "No analysed version yet"}
      </MenuLabel>
      <MenuSeparator />
      <MenuItem
        disabled={!hasReport}
        onClick={() => latestComplete && download(getReportDownloadUrl(latestComplete.id), `meridian_dq_report_${latestComplete.id}.pdf`, "PDF report downloaded", "The PDF report did not download. Check your sign-in and try again.")}
      >
        <FileText size={16} aria-hidden />Download PDF report
      </MenuItem>
      <MenuItem
        disabled={!hasReport}
        onClick={() => latestComplete && download(getReportJsonExportUrl(latestComplete.id), `meridian_dq_report_${latestComplete.id}.json`, "JSON report downloaded", "The JSON report did not download. Check your sign-in and try again.")}
      >
        <FileJson size={16} aria-hidden />Download JSON report
      </MenuItem>
      <MenuItem
        disabled={!hasReport}
        onClick={() => latestComplete && download(getConfigMatchesExportUrl(latestComplete.id), `meridian-config-${latestComplete.id.slice(0, 8)}.xlsx`, "Config matches downloaded", "The config matches did not download. Check your sign-in and try again.")}
      >
        <FileSpreadsheet size={16} aria-hidden />Download config matches (xlsx)
      </MenuItem>
      <MenuSeparator />
      <MenuItem onClick={() => router.push("/reports")}><List size={16} aria-hidden />View all reports</MenuItem>
    </Menu>
  );
}


/* ─── Notification bell ─── */
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
      router.push(notif.link);
    }
  };

  return (
    <Menu
      label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
      trigger={<><Bell size={18} aria-hidden />{unreadCount > 0 && <span className="ui-bell__count">{unreadCount > 9 ? "9+" : unreadCount}</span>}</>}
      triggerClassName="aurora-topbar__icon ui-bell aurora-focus-ring"
      width={320}
      onOpenChange={setOpen}
    >
      <div className="ui-menu__head ui-menu__head--row">
        <strong>Notifications</strong>
        {unreadCount > 0 && (
          <button type="button" className="ui-menu__link" onClick={() => markAllMutation.mutate()}>Mark all read</button>
        )}
      </div>
      <div className="ui-notifs">
        {!recent?.items || recent.items.length === 0 ? (
          <p className="ui-note ui-notifs__empty">No notifications yet</p>
        ) : (
          recent.items.map((notif) => (
            <MenuItem key={notif.id} className="ui-notif" data-read={notif.is_read ? "" : undefined} onClick={() => handleClick(notif)}>
              <span className="ui-notif__body">
                <strong>{notif.title}</strong>
                <span className="ui-micro">{notif.body.length > 60 ? notif.body.slice(0, 60) + "…" : notif.body}</span>
                <span className="ui-micro">{relativeTime(notif.created_at)}</span>
              </span>
              {!notif.is_read && <span className="ui-notif__dot" aria-label="Unread" />}
            </MenuItem>
          ))
        )}
      </div>
      <MenuSeparator />
      <MenuItem onClick={() => router.push("/notifications")}>View all notifications</MenuItem>
    </Menu>
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
      <div className="ui-boot" role="status" aria-label="Loading"><span className="ui-update__spin" aria-hidden /></div>
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