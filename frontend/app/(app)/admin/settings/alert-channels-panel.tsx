"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, Skeleton } from "@/design";
import { getAlertChannels } from "@/lib/api/notifications";
import { SettingsSection } from "@/components/mdm/ledger";
import { queryKeys } from "@/lib/query-keys";

/** Alert channels are managed in one place, Admin › Notifications; this section says how many there are and links there. */
export function AlertChannelsPanel() {
  const q = useQuery({ queryKey: queryKeys.alertChannels(), queryFn: getAlertChannels, retry: false, meta: { ignoreError: true } });
  const n = q.data?.length ?? 0;
  return (
    <SettingsSection title="Alert channels" hint="Where data-quality alerts and digests go. Alerts carry counts, rule ids and links, never record values">
      <div className="flex flex-wrap items-center gap-3">
        {q.isLoading ? <Skeleton width={160} height={20} /> : (
          <span className="m-text-body m-ink-2">{q.isError ? "Channels are managed under Notifications" : n ? `${n.toLocaleString()} ${n === 1 ? "channel" : "channels"} set up` : "No alert channel yet"}</span>
        )}
        <Button variant="secondary" render={<Link href="/admin/notifications">Manage channels</Link>} />
      </div>
    </SettingsSection>
  );
}
