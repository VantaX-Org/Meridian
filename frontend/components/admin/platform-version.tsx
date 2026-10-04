"use client";

/**
 * Running Meridian version and the update entry point. The status endpoint
 * is admin-only, so this renders nothing for other roles and is safe on any
 * surface.
 */

import { useQuery } from "@tanstack/react-query";
import { Banner, Button, Chip, Panel, Stack, Text } from "@/components/aurora";
import { useAuth } from "@/context/auth-context";
import { useUpdateModal } from "@/context/update-modal-context";
import { getUpdateStatus } from "@/lib/api/system-update";

export function PlatformVersion() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { open } = useUpdateModal();
  const q = useQuery({ queryKey: ["system-update-status"], queryFn: getUpdateStatus, enabled: isAdmin, staleTime: 60_000 });
  if (!isAdmin) return null;
  const s = q.data;
  return (
    <Panel title="Platform version" action={s ? <Chip tone={s.update_available ? "warning" : "success"}>{s.update_available ? `${s.latest_version} available` : "up to date"}</Chip> : undefined}>
      {q.isLoading ? <Text tone="muted">Reading the running version.</Text>
        : q.error || !s ? <Banner tone="warning" title="The update status could not be read">The update-status endpoint did not answer; the deployment itself is running.</Banner>
        : (
          <Stack direction="row" gap={4} align="center" wrap>
            <Stack gap={1}>
              <Text variant="text-micro" tone="muted" className="aurora-exec__eyebrow">Running</Text>
              <Text variant="display-sm" className="aurora-number">{s.current_version}</Text>
            </Stack>
            <span style={{ flex: 1 }} />
            {s.update_available && s.updater_configured ? <Button onClick={open}>View update {s.latest_version}</Button> : null}
            {s.update_available && !s.updater_configured ? (
              <Text variant="text-small" tone="secondary" style={{ maxWidth: 360 }}>Version {s.latest_version} is available, but the auto-update sidecar is not configured on this deployment. Update with update.sh or contact support.</Text>
            ) : null}
          </Stack>
        )}
    </Panel>
  );
}
