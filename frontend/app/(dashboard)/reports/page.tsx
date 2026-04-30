"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Download, ChevronDown, ChevronUp, Bell, FileJson, FileSpreadsheet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { getVersions } from "@/lib/api/versions";
import { getReportDownloadUrl, getReportJsonExportUrl } from "@/lib/api/reports";
import { getConfigMatchesExportUrl } from "@/lib/api/config-matches";
import { downloadAuthenticated } from "@/lib/api/download";
import { getSettings, saveNotificationSettings } from "@/lib/api/settings";
import { formatModuleName, scoreColor } from "@/lib/format";
import { useLicence } from "@/hooks/use-licence";
import type { Version } from "@/types/api";

const READINESS_BADGE: Record<string, { label: string; className: string }> = {
  go: { label: "Go", className: "bg-green-600" },
  conditional: { label: "Conditional", className: "bg-amber-500 text-black" },
  "no-go": { label: "No-go", className: "bg-red-600" },
};

export default function ReportsPage() {
  const { isFeatureEnabled } = useLicence();
  const exportEnabled = isFeatureEnabled("export_reports");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: versionData, isLoading } = useQuery({
    queryKey: ["versions-reports"],
    queryFn: () => getVersions({ limit: 100 }),
  });

  const completedVersions = (versionData?.versions ?? []).filter(
    (v) => v.status === "agents_complete" || v.status === "agents_failed"
  );

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Reports</h1>

      {/* Reports list */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-3">Run Date</th>
                    <th className="px-4 py-3">Label</th>
                    <th className="px-4 py-3">Modules</th>
                    <th className="px-4 py-3 text-right">DQS</th>
                    <th className="px-4 py-3">Readiness</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {completedVersions.map((v) => {
                    const dqs = v.dqs_summary
                      ? Math.round(
                          Object.values(v.dqs_summary).reduce(
                            (sum, s) => sum + s.composite_score,
                            0
                          ) / Object.values(v.dqs_summary).length * 10
                        ) / 10
                      : null;
                    const expanded = expandedId === v.id;

                    return (
                      <ReportRow
                        key={v.id}
                        version={v}
                        dqs={dqs}
                        expanded={expanded}
                        exportEnabled={exportEnabled}
                        onToggle={() =>
                          setExpandedId(expanded ? null : v.id)
                        }
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Schedule section */}
      <NotificationSchedule />
    </div>
  );
}

function ReportRow({
  version,
  dqs,
  expanded,
  exportEnabled,
  onToggle,
}: {
  version: Version;
  dqs: number | null;
  expanded: boolean;
  exportEnabled: boolean;
  onToggle: () => void;
}) {
  // Determine readiness from DQS summary (approximation without report_json)
  const critCount = version.dqs_summary
    ? Object.values(version.dqs_summary).reduce(
        (sum, s) => sum + s.critical_count,
        0
      )
    : 0;
  const readiness =
    dqs != null && dqs >= 90 && critCount === 0
      ? "go"
      : dqs != null && (critCount >= 2 || (dqs != null && dqs < 60))
        ? "no-go"
        : "conditional";
  const badge = READINESS_BADGE[readiness];

  return (
    <>
      <tr className="border-b border-border/50 hover:bg-accent/30">
        <td className="px-4 py-3">
          {new Date(version.run_at).toLocaleString()}
        </td>
        <td className="px-4 py-3">{version.label ?? "—"}</td>
        <td className="px-4 py-3">
          {version.metadata?.modules?.map(formatModuleName).join(", ") ?? "—"}
        </td>
        <td className="px-4 py-3 text-right">
          {dqs != null ? (
            <span style={{ color: scoreColor(dqs) }}>{dqs}</span>
          ) : (
            "—"
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <Badge className={badge.className}>{badge.label}</Badge>
            {version.status === "agents_failed" && (
              <Badge
                variant="outline"
                className="border-amber-500 bg-amber-50 text-amber-700"
                title="Deterministic report is available; AI insights (root causes, remediations) could not be generated"
              >
                AI unavailable
              </Badge>
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex gap-1">
            {exportEnabled ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      await downloadAuthenticated(
                        getReportDownloadUrl(version.id),
                        `meridian_dq_report_${version.id}.pdf`,
                      );
                    } catch {
                      toast.error("Failed to download PDF report");
                    }
                  }}
                >
                  <Download className="mr-1 h-4 w-4" /> PDF
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Export assembled report as JSON (always available when analysis is complete)"
                  onClick={async () => {
                    try {
                      await downloadAuthenticated(
                        getReportJsonExportUrl(version.id),
                        `meridian_dq_report_${version.id}.json`,
                      );
                    } catch {
                      toast.error("Failed to download JSON report");
                    }
                  }}
                >
                  <FileJson className="mr-1 h-4 w-4" /> JSON
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Export live SAP config vs. standard-rule mismatches as an Excel workbook"
                  onClick={async () => {
                    try {
                      await downloadAuthenticated(
                        getConfigMatchesExportUrl(version.id),
                        `meridian-config-${version.id.slice(0, 8)}.xlsx`,
                      );
                    } catch {
                      toast.error("Failed to download config matches export");
                    }
                  }}
                >
                  <FileSpreadsheet className="mr-1 h-4 w-4" /> Config
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" disabled title="Not included in your current licence">
                <Download className="mr-1 h-4 w-4" /> PDF
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onToggle}>
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              Summary
            </Button>
          </div>
        </td>
      </tr>
      {expanded && version.dqs_summary && (
        <tr>
          <td colSpan={6} className="bg-accent/30 px-6 py-4">
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Module Scores</h4>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(version.dqs_summary).map(([mod, s]) => (
                  <div
                    key={mod}
                    className="flex items-center justify-between rounded-md border border-border p-2"
                  >
                    <span className="text-sm">{formatModuleName(mod)}</span>
                    <span
                      className="font-bold"
                      style={{ color: scoreColor(s.composite_score) }}
                    >
                      {s.composite_score}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function NotificationSchedule() {
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  const nc = settings?.notification_config;
  const [email, setEmail] = useState(nc?.email ?? "");
  const [teamsWebhook, setTeamsWebhook] = useState(nc?.teams_webhook ?? "");
  const [daily, setDaily] = useState(nc?.daily_digest ?? false);
  const [weekly, setWeekly] = useState(nc?.weekly_summary ?? false);
  const [monthly, setMonthly] = useState(nc?.monthly_report ?? false);

  // Sync when settings load
  useState(() => {
    if (nc) {
      setEmail(nc.email);
      setTeamsWebhook(nc.teams_webhook);
      setDaily(nc.daily_digest);
      setWeekly(nc.weekly_summary);
      setMonthly(nc.monthly_report);
    }
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      saveNotificationSettings({
        email,
        teams_webhook: teamsWebhook,
        daily_digest: daily,
        weekly_summary: weekly,
        monthly_report: monthly,
      }),
    onSuccess: () => toast.success("Notification settings saved"),
    onError: () => toast.error("Failed to save settings"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="h-4 w-4" /> Scheduled Reports
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={daily}
              onChange={(e) => setDaily(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            <span className="text-sm">Daily digest email</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={weekly}
              onChange={(e) => setWeekly(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            <span className="text-sm">Weekly summary email</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={monthly}
              onChange={(e) => setMonthly(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            <span className="text-sm">Monthly executive report email</span>
          </label>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Email address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="reports@company.com"
            className="w-full rounded-md border border-border bg-accent px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">
            Teams Webhook URL (optional)
          </label>
          <input
            type="url"
            value={teamsWebhook}
            onChange={(e) => setTeamsWebhook(e.target.value)}
            placeholder="https://outlook.office.com/webhook/..."
            className="w-full rounded-md border border-border bg-accent px-3 py-2 text-sm"
          />
        </div>

        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          Save Notification Settings
        </Button>

        {(daily || weekly || monthly) && (
          <p className="text-xs text-muted-foreground">
            Next scheduled report:{" "}
            {daily
              ? "Tomorrow at 07:00 SAST"
              : weekly
                ? "Next Monday at 07:00 SAST"
                : "1st of next month at 07:00 SAST"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
