"use client";

import type { MigrationWave } from "@/types/api";
import * as rep from "@/lib/api/v2/reports";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "../parts";
import { ResultFrame, useOutcome } from "./shared";

/**
 * A wave's readiness cockpit, inside the wave inspector: analyse the whole wave, read each object's verdict and the
 * blockers holding it, download the report, draft a fix batch for a blocker (migration.py /waves/{id}/...).
 */
export function WaveCockpitBlock({ wave }: { wave: MigrationWave }) {
  const session = useV2Session();
  const { outcome, pending, run } = useOutcome();
  const canAnalyse = session.can("analyse") && !session.shared && !session.viewAs;
  const analyse = () =>
    void run("analyse", async () => {
      const r = await rep.runWave(wave.id);
      return {
        tone: "ok",
        title: t("Analysis of {name} queued", { name: wave.name }),
        detail: t("{n, plural, one {# object is} other {# objects are}} being analysed. The verdicts update when it finishes.", { n: r.modules.length }),
      };
    });
  return (
    <div data-testid="wave-cockpit">
      {canAnalyse ? (
        <button type="button" className="m2-btn m2-sm" disabled={pending !== null || wave.modules.length === 0 || !wave.source_system_id} onClick={analyse}>
          {pending === "analyse" ? t("Queuing…") : t("Analyse the whole wave")}
        </button>
      ) : null}
      {outcome ? (
        <ResultFrame outcome={outcome}>
          <span>
            <V2Link href="/migration">{t("Open the migration analyses")}</V2Link>
          </span>
        </ResultFrame>
      ) : null}
    </div>
  );
}
