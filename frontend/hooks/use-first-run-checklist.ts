"use client";

import { useQuery } from "@tanstack/react-query";
import type { ChecklistItem } from "@/design";
import { getSystems } from "@/lib/api/connectivity";
import { getVersions } from "@/lib/api/versions";
import { listBatches } from "@/lib/api/remediation";
import { getUsers } from "@/lib/api/users";
import { getAlertChannels } from "@/lib/api/notifications";
import { queryKeys } from "@/lib/query-keys";
import { useRole } from "./use-role";

const FINISHED = new Set(["complete", "agents_complete", "ai_enriched"]);

/**
 * The first-run checklist's items, each derived from the same queries the pages use, so the list is
 * never a second record of what has been done. An item whose data the viewer cannot read (a 403, or a
 * permission they lack) is left out rather than shown as undone.
 */
export function useFirstRunChecklist(): { items: ChecklistItem[]; loading: boolean } {
  const { can } = useRole();
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const versionsQ = useQuery({ queryKey: queryKeys.run("list"), queryFn: () => getVersions() });
  const batchesQ = useQuery({ queryKey: queryKeys.remediationBatches(), queryFn: listBatches, retry: false });
  const usersQ = useQuery({ queryKey: queryKeys.users(), queryFn: getUsers, enabled: can("manage_users"), retry: false });
  const channelsQ = useQuery({ queryKey: queryKeys.alertChannels(), queryFn: getAlertChannels, enabled: can("manage_settings"), retry: false });

  const items: ChecklistItem[] = [];
  if (systemsQ.data) {
    items.push({ id: "system", label: "Connect a system", done: systemsQ.data.length > 0, href: "/systems" });
  }
  if (versionsQ.data) {
    items.push({ id: "run", label: "Complete a first run", done: versionsQ.data.versions.some((v) => FINISHED.has(v.status)), href: "/systems" });
  }
  if (batchesQ.data) {
    items.push({ id: "fix", label: "Create a first fix batch", done: batchesQ.data.items.length > 0, href: "/fix?tab=batches" });
  }
  if (usersQ.data) {
    items.push({ id: "team", label: "Invite your team", done: usersQ.data.users.length > 1, href: "/admin/users" });
  }
  if (channelsQ.data) {
    items.push({ id: "alerts", label: "Set an alert channel", done: channelsQ.data.length > 0, href: "/admin/notifications" });
  }
  const pending = [systemsQ, versionsQ, batchesQ, usersQ, channelsQ].some((q) => q.isLoading);
  return { items, loading: pending };
}
