"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHead } from "@/components/meridian/atoms";
import { ArrowRight } from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api/notifications";
import type { Notification, NotificationType } from "@/types/api";
import { relativeTime } from "@/lib/format";

const NOTIF_TYPES: Record<NotificationType, { bg: string; fg: string; l: string }> = {
  finding:   { bg: "var(--mn-primary-50)",  fg: "var(--mn-primary-700)", l: "FINDING" },
  cleaning:  { bg: "var(--mn-pos-bg)",      fg: "var(--mn-pos)",         l: "CLEANING" },
  exception: { bg: "rgba(15,23,42,0.06)",   fg: "var(--mn-ink-500)",     l: "EXCEPTION" },
  approval:  { bg: "rgba(124,58,237,0.12)", fg: "#7C3AED",               l: "APPROVAL" },
  digest:    { bg: "rgba(14,165,164,0.12)", fg: "#0EA5A4",               l: "DIGEST" },
  warning:   { bg: "var(--mn-warn-bg)",     fg: "var(--mn-warn)",        l: "WARNING" },
};

type Filter = "all" | "unread" | NotificationType;

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");

  const queryParams = filter === "all"
    ? { limit: 100 }
    : filter === "unread"
      ? { limit: 100, is_read: false }
      : { limit: 100, type: filter };

  const { data, isLoading, error } = useQuery({
    queryKey: ["notifications.list", filter],
    queryFn: () => getNotifications(queryParams),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications.list"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });

  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications.list"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });

  const items: Notification[] = data?.items ?? [];
  const unread = items.filter((i) => !i.is_read).length;
  const totalKnown = data?.total ?? items.length;

  return (
    <>
      <PageHead
        title="Notifications"
        route="/notifications"
        sub={
          isLoading
            ? "Loading…"
            : error
              ? "Could not load notifications."
              : (
                <>
                  <strong style={{ color: "var(--mn-ink-700)" }}>{unread} unread</strong> of {totalKnown}
                </>
              )
        }
        actions={
          <button
            type="button"
            className="mn-btn mn-btn-ghost"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending || unread === 0}
          >
            Mark all read
          </button>
        }
      />

      <div className="mn-segment" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        <button type="button" className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
          All
        </button>
        <button type="button" className={filter === "unread" ? "on" : ""} onClick={() => setFilter("unread")}>
          Unread{" "}
          <span className="mn-tabular" style={{ opacity: 0.6, marginLeft: 4 }}>
            {unread}
          </span>
        </button>
        {(Object.keys(NOTIF_TYPES) as NotificationType[]).map((t) => (
          <button key={t} type="button" className={filter === t ? "on" : ""} onClick={() => setFilter(t)}>
            {NOTIF_TYPES[t].l.charAt(0) + NOTIF_TYPES[t].l.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ padding: "16px 18px", borderBottom: "1px solid var(--mn-line-2)" }}>
              <Skeleton className="h-3 w-24 rounded" />
              <Skeleton className="h-4 w-2/3 rounded mt-2" />
              <Skeleton className="h-3 w-1/2 rounded mt-1" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/notifications</code>.
        </div>
      )}

      {!isLoading && !error && items.length === 0 && (
        <div className="mn-card mn-card-pad" style={{ textAlign: "center", color: "var(--mn-ink-400)" }}>
          No notifications.
        </div>
      )}

      {!isLoading && !error && items.length > 0 && (
        <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
          {items.map((n) => {
            const t = NOTIF_TYPES[n.type] ?? NOTIF_TYPES.digest;
            return (
              <button
                key={n.id}
                type="button"
                className={`mn-notif ${n.is_read ? "read" : ""}`}
                onClick={() => !n.is_read && markOne.mutate(n.id)}
              >
                {!n.is_read && <span className="mn-notif-dot" />}
                <span
                  style={{
                    display: "inline-flex",
                    padding: "3px 8px",
                    borderRadius: 4,
                    background: t.bg,
                    color: t.fg,
                    font: "700 9.5px/1 'JetBrains Mono', monospace",
                    letterSpacing: "0.1em",
                  }}
                >
                  {t.l}
                </span>
                <div className="mn-notif-body">
                  <div className="mn-notif-title">{n.title}</div>
                  <div className="mn-notif-text">{n.body}</div>
                </div>
                <div className="mn-notif-meta">
                  <span
                    className="mn-tabular"
                    style={{
                      font: "500 11px/1 'JetBrains Mono', monospace",
                      color: "var(--mn-ink-400)",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {relativeTime(n.created_at)}
                  </span>
                  {n.link && (
                    <Link
                      href={n.link}
                      className="mn-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!n.is_read) markOne.mutate(n.id);
                      }}
                    >
                      Open <ArrowRight size={11} />
                    </Link>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
