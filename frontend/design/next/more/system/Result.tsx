"use client";

import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "@/design/v2/parts";
import type { Outcome } from "@/design/v2/inspector/shared";

/** The answer to an action: its title, its sentence and, for a started job, the link to it. */
export function Result({ outcome }: { outcome: Outcome }) {
  const { hrefFor } = useOpenItem();
  return (
    <p className="nx-note" role="status" data-tone={outcome.tone} data-testid="action-result">
      <strong>{outcome.title}</strong> {outcome.detail ?? ""}
      {outcome.job ? <> <V2Link className="nx-link" href={hrefFor({ kind: "job", id: outcome.job })}>{t("Open the job")}</V2Link></> : null}
    </p>
  );
}
