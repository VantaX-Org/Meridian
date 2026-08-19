"use client";

import { useQuery } from "@tanstack/react-query";
import { SectionHeader } from "@/components/meridian/atoms";
import { Skeleton } from "@/components/ui/skeleton";
import { getUpdateStatus } from "@/lib/api/system-update";
import { useAuth } from "@/context/auth-context";
import { useUpdateModal } from "@/context/update-modal-context";

/**
 * Current running version + "check for updates" entry point. Fetches
 * `/api/v1/system/update-status`, which is admin-only (403 for everyone
 * else) — hard-gated on the real `useAuth().user.role`, not the
 * `use-role.ts` demo stub. Renders nothing for non-admins, so it's safe to
 * drop into a page (like /settings/licence) that every role can visit.
 *
 * Shared between the Admin page's Licence tab and /settings/licence — the
 * latter is the page most users actually land on when looking for licence/
 * version info (nav label "Licence", permission "view"), so this needs to
 * live there too, not just under Admin.
 */
export function PlatformVersionCard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { open: openUpdateModal } = useUpdateModal();

  const statusQ = useQuery({
    queryKey: ["system-update-status"],
    queryFn: getUpdateStatus,
    enabled: isAdmin,
    staleTime: 60_000,
  });

  if (!isAdmin) return null;

  return (
    <div className="mn-card mn-card-pad" style={{ marginTop: 18 }}>
      <SectionHeader title="Platform version" caption="Current Meridian release for this deployment" />
      {statusQ.isLoading ? (
        <Skeleton className="h-16 rounded-[10px]" />
      ) : statusQ.error || !statusQ.data ? (
        <div style={{ color: "var(--mn-ink-400)", fontSize: 12.5 }}>
          Could not reach <code>/api/v1/system/update-status</code>.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div className="mn-eyebrow">Running version</div>
            <div className="v mn-tabular">{statusQ.data.current_version}</div>
          </div>

          {statusQ.data.update_available && statusQ.data.updater_configured && (
            <button type="button" className="mn-btn mn-btn-primary" onClick={openUpdateModal}>
              View update ({statusQ.data.latest_version})
            </button>
          )}

          {statusQ.data.update_available && !statusQ.data.updater_configured && (
            <p style={{ fontSize: 12.5, color: "var(--mn-ink-500)", maxWidth: 340, margin: 0 }}>
              Version {statusQ.data.latest_version} is available, but the auto-update sidecar
              isn&apos;t configured on this deployment. Update manually or contact support.
            </p>
          )}

          {!statusQ.data.update_available && (
            <span style={{ fontSize: 12.5, color: "var(--mn-pos)" }}>Up to date</span>
          )}
        </div>
      )}
    </div>
  );
}
