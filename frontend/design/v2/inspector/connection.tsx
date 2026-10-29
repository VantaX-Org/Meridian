"use client";

import { useRouter } from "next/navigation";
import { systemTypeLabel } from "@/lib/format";
import { useV2Href } from "@/lib/v2/hooks";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { InspectorFrame } from "../Inspector";
import { EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { ConnectionForm } from "../screens/system/ConnectionForm";

/**
 * `?open=connection:<system id>` edits a system's connection; `?open=connection:new` connects a new one. The form is
 * the same one the /v2/s/new canvas draws. A new system opens its own inspector next, to test, extract and schedule.
 */
export function ConnectionInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const router = useRouter();
  const v2 = useV2Href();
  const systems = useSystemsExtended();
  const isNew = id === "new";
  const system = systems.data?.find((s) => s.id === id);
  return (
    <InspectorFrame title={isNew ? "Connect a system" : system?.name ?? "Connection"} status={isNew ? "New system" : system ? `${systemTypeLabel(system.system_type)}, connection settings` : undefined} onClose={onClose}>
      {isNew ? (
        <ConnectionForm onSaved={(s) => router.replace(v2(`/v2/s/${s.id}?open=system:${s.id}`))} />
      ) : systems.isLoading ? (
        <Skeleton width="100%" height={160} />
      ) : systems.isError ? (
        <ErrorFrame onRetry={() => void systems.refetch()}>The system could not be read.</ErrorFrame>
      ) : !system ? (
        <EmptyFrame>This system is not in the tenant. It may have been removed.</EmptyFrame>
      ) : (
        <ConnectionForm key={system.id} system={system} onRemoved={() => router.replace(v2("/v2"))} />
      )}
    </InspectorFrame>
  );
}
