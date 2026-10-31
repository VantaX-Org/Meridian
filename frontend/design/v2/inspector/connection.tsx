"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { systemTypeLabel } from "@/lib/format";
import { retryJobById } from "@/lib/api/v2/runs";
import { useOpenItem, useV2Href } from "@/lib/v2/hooks";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { InspectorFrame } from "../Inspector";
import { EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../parts";
import { ConnectionForm } from "../screens/system/ConnectionForm";
import { t } from "@/lib/v2/i18n";

/**
 * `?open=connection:<system id>` edits a system's connection; `?open=connection:new` connects a new one. The form is
 * the same one the /s/new canvas draws. A new system opens its own inspector next, to test, extract and schedule.
 * `?open=connection:<system id>:<job id>` comes from a job SAP refused the sign-in for: saving retries that job and
 * opens the new one.
 */
export function ConnectionInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const router = useRouter();
  const v2 = useV2Href();
  const qc = useQueryClient();
  const { openItem } = useOpenItem();
  const systems = useSystemsExtended();
  const isNew = id === "new";
  const [systemId, retryJob] = id.split(":");
  const system = systems.data?.find((s) => s.id === systemId);
  const saveAndRetry = async () => {
    if (!retryJob) return;
    const r = await retryJobById(retryJob);
    void qc.invalidateQueries({ queryKey: ["v2"] });
    void qc.invalidateQueries({ queryKey: ["jobs"] });
    if (r.job_id) openItem({ kind: "job", id: r.job_id });
  };
  return (
    <InspectorFrame title={isNew ? t("Connect a system") : system?.name ?? t("Connection")} status={isNew ? t("New system") : system ? t("{systemTypeLabel}, connection settings", { systemTypeLabel: systemTypeLabel(system.system_type) }) : undefined} onClose={onClose}>
      {isNew ? (
        <ConnectionForm onSaved={(s) => router.replace(v2(`/s/${s.id}?open=system:${s.id}`))} />
      ) : systems.isLoading ? (
        <Skeleton width="100%" height={160} />
      ) : systems.isError ? (
        <ErrorFrame onRetry={() => void systems.refetch()}>{t("The system could not be read.")}</ErrorFrame>
      ) : !system ? (
        <EmptyFrame>{t("This system is not in the tenant. It may have been removed.")}</EmptyFrame>
      ) : (
        <>
          <p className="m2-prov">
            <V2Link href={`/s/${system.id}`}>{t("Open the system")}</V2Link>
          </p>
          <ConnectionForm key={system.id} system={system} onRemoved={() => router.replace(v2("/"))} {...(retryJob ? { onSaved: saveAndRetry, saveLabel: t("Save and retry the failed job") } : {})} />
        </>
      )}
    </InspectorFrame>
  );
}
