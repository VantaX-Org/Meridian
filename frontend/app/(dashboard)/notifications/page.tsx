"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Bell,
  Check,
  CheckCheck,
  ExternalLink,
  Filter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/api/notifications";
import { relativeTime } from "@/lib/format";
import type { NotificationType } from "@/types/api";

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All Types" },
  { value: "finding", label: "Findings" },
  { value: "cleaning", label: "Cleaning" },
  { value: "exception", label: "Exceptions" },
  { value: "approval", label: "Approvals" },
  { value: "digest", label: "Digests" },
  { value: "warning", label: "Warnings" },
];

const READ_OPTIONS = [
  { value: "", label: "All" },
  { value: "false", label: "Unread" },
  { value: "true", label: "Read" },
];

const TYPE_ICONS: Record<string, string> = {
  finding: "🔍",
  cleaning: "✨",
  exception: "🚨",
  approval: "✅",
  digest: "📊",
  warning: "⚠️",
};

const TYPE_COLORS: Record<string, string> = {
  finding: "bg-[#2563EB]/15 text-[#2563EB]",
  cleaning: "bg-[#16A34A]/15 text-[#16A34A]",
  exception: "bg-[#DC2626]/15 text-[#DC2626]",
  approval: "bg-[#16A34A]/15 text-[#16A34A]",
  digest: "bg-[#D97706]/15 text-[#D97706]",
  warning: "bg-[#D97706]/15 text-[#EA580C]",
};

export default function NotificationsPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const [typeFilter, setTypeFilter] = useState("");
  const [readFilter, setReadFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["notifications-full", typeFilter, readFilter, page],
    queryFn: () =>
      getNotifications({
        type: typeFilter || undefined,
        is_read: readFilter === "" ? undefined : readFilter === "true",
        limit,
        offset: page * limit,
      }),
  });

  const markAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-full"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await markNotificationRead(id);
      }
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["notifications-full"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!data?.items) return;
    if (selectedIds.size === data.items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.items.map((n) => n.id)));
    }
  };

  return (
    <TooltipProvider delay={0}>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
          {data && (
            <Badge variant="secondary" className="ml-2">
              {data.total}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => markReadMutation.mutate([...selectedIds])}
              disabled={markReadMutation.isPending}
            >
              <CheckCheck className="mr-1 h-4 w-4" />
              Mark selected read ({selectedIds.size})
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => markAllMutation.mutate()}
            disabled={markAllMutation.isPending}
          >
            <Check className="mr-1 h-4 w-4" />
            Mark all read
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(0);
          }}
          className="rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-1.5 text-sm text-foreground"
        >
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={readFilter}
          onChange={(e) => {
            setReadFilter(e.target.value);
            setPage(0);
          }}
          className="rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-1.5 text-sm text-foreground"
        >
          {READ_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* List */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : !data?.items?.length ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              No notifications found
            </div>
          ) : (
            <>
              {/* Select all header */}
              <div className="flex items-center gap-3 border-b border-black/[0.08] px-4 py-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={selectedIds.size === data.items.length && data.items.length > 0}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-black/[0.08] accent-primary"
                />
                <span>Select all</span>
              </div>

              {data.items.map((notif) => (
                <div
                  key={notif.id}
                  className={`flex items-start gap-3 border-b border-black/[0.04] px-4 py-3 transition-colors hover:bg-black/[0.03] ${
                    notif.is_read ? "opacity-60" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(notif.id)}
                    onChange={() => toggleSelect(notif.id)}
                    className="mt-1 h-4 w-4 rounded border-black/[0.08] accent-primary"
                  />
                  <span className="mt-0.5 text-base">
                    {TYPE_ICONS[notif.type] || "📋"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {notif.title}
                      </p>
                      <Badge
                        className={`text-xs ${TYPE_COLORS[notif.type] || "bg-white/[0.60] text-muted-foreground"}`}
                      >
                        {notif.type}
                      </Badge>
                      {!notif.is_read && (
                        <span className="h-2 w-2 rounded-full bg-primary" />
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{notif.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground/70">
                      {relativeTime(notif.created_at)}
                    </p>
                  </div>
                  {notif.link && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => router.push(notif.link!)}
                            className="shrink-0 text-primary"
                          />
                        }
                      >
                        <ExternalLink className="h-4 w-4" />
                      </TooltipTrigger>
                      <TooltipContent>Go to item</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.total > limit && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {page * limit + 1}–
            {Math.min((page + 1) * limit, data.total)} of {data.total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(page + 1) * limit >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}
