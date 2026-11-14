"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { t } from "@/lib/v2/i18n";
import { getUpdateProgress, triggerUpdate } from "@/lib/api/v2/admin";
import { useUpdateStatus } from "@/lib/v2/admin-queries";
import { Button, Chip, Confirm, EmptyState, Sheet } from "../kit";
import type { SheetCtx } from "../shell/SheetHost";

const END = ["done", "failed", "rolled_back"];

/** Update the stack: version, release notes, a confirm, then the live progress. Offered only when an updater exists and a newer version is out. */
export function UpdateFlow({ ctx }: { ctx: SheetCtx }) {
  const status = useUpdateStatus().data;
  const [ask, setAsk] = useState(false);
  const [started, setStarted] = useState(false);
  const [err, setErr] = useState(false);
  const progress = useQuery({
    queryKey: ["next", "update-progress"],
    queryFn: getUpdateProgress,
    enabled: started,
    refetchInterval: (q) => (q.state.data && END.includes(q.state.data.status) ? false : 3000),
  });
  const go = async () => {
    setAsk(false);
    try {
      await triggerUpdate();
      setStarted(true);
    } catch {
      setErr(true);
    }
  };
  const canUpdate = !!status?.updater_configured && !!status.update_available;
  const p = progress.data;
  return (
    <Sheet open onClose={ctx.close} title={t("Update")} size="small" under={ctx.under} primary={canUpdate && !started ? <Button variant="primary" onClick={() => setAsk(true)}>{t("Update now")}</Button> : undefined}>
      {!status ? <p>{t("Loading")}</p> : (
        <div>
          <p>{t("Installed")} <Chip tone="neutral">{status.current_version}</Chip> {t("Latest")} <Chip tone={status.update_available ? "accent" : "good"}>{status.latest_version}</Chip></p>
          {!status.updater_configured ? <EmptyState heading={t("Updates are not set up")}>{t("This deployment has no update service yet.")}</EmptyState> : null}
          {status.updater_configured && !status.update_available ? <EmptyState icon="check" heading={t("You are up to date")} /> : null}
          {canUpdate && status.release_notes ? <pre className="nx-notes">{status.release_notes}</pre> : null}
          {started ? <p role="status">{p ? `${p.status}${p.message ? `: ${p.message}` : ""}` : t("Starting")}</p> : null}
          {err ? <p role="alert">{t("The update could not start.")}</p> : null}
        </div>
      )}
      <Confirm open={ask} title={t("Update now?")} consequence={t("The service restarts. Do not update while an extraction runs.")} confirmLabel={t("Update now")} onConfirm={go} onCancel={() => setAsk(false)} />
    </Sheet>
  );
}
