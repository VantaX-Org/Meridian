"use client";

// The home feed's next-step button, by persona. Same logic as the Landscape page's NextStep (design/next/more/Landscape.tsx),
// which does not export it; exporting it from there would remove this copy.
import { useQueries } from "@tanstack/react-query";
import type { MigrationWave } from "@/types/api";
import { useFixture } from "@/lib/api/v2/fixture";
import { getProcessDocument } from "@/lib/api/v2/mdm";
import type { Landscape as LandscapeData, LandscapeCell } from "@/lib/api/v2/types";
import { formatDate } from "@/lib/format";
import { useBatches } from "@/lib/v2/approvals-queries";
import { useOpenItem, useV2Session, type V2Persona } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { mdmKeys } from "@/lib/v2/mdm-queries";
import { firstBlockedStep, PROCESS_MODULES, stepRef } from "@/lib/v2/process-tree";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { int, moduleSlug, systemSlug } from "@/lib/v2/score";
import { daysUntil, groupByWave, nextWave } from "@/lib/v2/waves";
import { useWorkGroups } from "@/lib/v2/work-queries";
import { KeepLink } from "../more/states";

/** The data owner's next step: the batch with the most at risk waiting for their approval. */
function OwnerNext() {
  const { hrefFor } = useOpenItem();
  const session = useV2Session();
  const batches = useBatches();
  const next = batches.rows
    .filter((b) => b.status === "draft" && b.ownerId !== session.id)
    .sort((a, b) => (b.valueAtRisk ?? -1) - (a.valueAtRisk ?? -1) || a.createdAt.localeCompare(b.createdAt))[0];
  if (batches.isLoading) return null;
  if (!next) return <KeepLink href="/people" className="nx-btn nx-btn-primary">{t("See who holds the work")}</KeepLink>;
  return <KeepLink href={hrefFor({ kind: "batch", id: next.id })} className="nx-btn nx-btn-primary">{t("Approve batch {label}", { label: next.label })}</KeepLink>;
}

/** Basis: a system whose credentials SAP refused comes first, then the next one to extract or analyse. */
function BasisNext({ landscape }: { landscape: LandscapeData }) {
  const { hrefFor } = useOpenItem();
  const refused = (useSystemsExtended().data ?? []).find((x) => x.health_status === "auth_failed");
  if (refused) {
    return (
      <KeepLink href={hrefFor({ kind: "connection", id: refused.id })} className="nx-btn nx-btn-primary" data-testid="basis-fix-signin">
        {t("Fix the {name} sign-in", { name: refused.name })}
      </KeepLink>
    );
  }
  const s = landscape.systems.find((x) => x.state === "not_extracted") ?? landscape.systems.find((x) => x.state === "extracted") ?? landscape.systems[0];
  if (!s) return null;
  const label = s.state === "extracted" ? t("Run analysis on {name}", { name: s.name }) : t("Extract {name}", { name: s.name });
  return <KeepLink href={hrefFor({ kind: "system", id: s.id })} className="nx-btn nx-btn-primary">{label}</KeepLink>;
}

/** The process analyst's next step: the first blocked process step, else the first process object's readiness. */
function ProcessNext({ landscape }: { landscape: LandscapeData }) {
  const fixture = useFixture();
  const cells = landscape.cells.filter((c) => PROCESS_MODULES.has(c.module) && c.run_id).slice(0, 6);
  const reads = useQueries({
    queries: cells.map((c) => ({ queryKey: mdmKeys.process(fixture, c.run_id, c.module), queryFn: () => getProcessDocument(c.run_id, c.module), staleTime: 30_000, retry: false })),
  });
  const base = (c: LandscapeCell) => `/o/${systemSlug(landscape.systems.find((x) => x.id === c.system_id)?.name ?? c.system_id)}/${moduleSlug(c.module)}/processes`;
  for (let i = 0; i < cells.length; i++) {
    const step = firstBlockedStep(reads[i]?.data?.processes ?? []);
    if (step) {
      return (
        <KeepLink href={`${base(cells[i])}?open=step:${stepRef(cells[i].module, step.id)}`} className="nx-btn nx-btn-primary">
          {t("Open {l1Id} step {number}", { l1Id: step.l1Id, number: step.number })}
        </KeepLink>
      );
    }
  }
  if (cells.length === 0) return null;
  return <KeepLink href={base(cells[0])} className="nx-btn nx-btn-primary">{t("Open the process readiness")}</KeepLink>;
}


/** The steward's next step: the rule with the most suggested values, opened on their rows. */
function StewardNext() {
  const top = (useWorkGroups({}).data?.groups ?? []).filter((g) => g.proposed > 0).sort((a, b) => b.proposed - a.proposed)[0];
  return (
    <KeepLink href={top ? `/work?rule=${encodeURIComponent(top.check_id)}` : "/work"} className="nx-btn nx-btn-primary" data-testid="steward-next">
      {top ? t("Accept {count} suggested {count2, plural, one {value} other {values}} for {check}", { count: int(top.proposed), count2: top.proposed, check: top.check_id }) : t("Accept the suggested values")}
    </KeepLink>
  );
}

/** The next-step button, by persona. One per page. */
export function NextStep({ landscape, persona, waves = [] }: { landscape: LandscapeData; persona: V2Persona; waves?: readonly MigrationWave[] }) {
  const { hrefFor } = useOpenItem();
  if (persona === "owner") return <OwnerNext />;
  if (persona === "steward") return <StewardNext />;
  if (persona === "process") return <ProcessNext landscape={landscape} />;
  if (persona === "admin") return <KeepLink href="/admin" className="nx-btn nx-btn-primary">{t("Open Administration")}</KeepLink>;
  if (persona === "auditor") return <KeepLink href="/rules" className="nx-btn nx-btn-primary">{t("Open the rules library")}</KeepLink>;
  if (persona === "basis") return <BasisNext landscape={landscape} />;
  const wave = waves.length ? nextWave(waves) : null;
  if (wave) {
    const [group] = groupByWave(landscape, [wave], landscape.cells);
    const noGo = group.counts["no-go"];
    const atRisk = group.counts["at-risk"];
    const due = daysUntil(wave.target_date);
    const when = wave.target_date ? t("due {target_date}{value}", { target_date: formatDate(wave.target_date), value: due != null ? (due < 0 ? t(", {value} {value, plural, one {day} other {days}} ago", { value: -due }) : due === 0 ? t(", today") : t(", in {due} {due, plural, one {day} other {days}}", { due })) : "" }) : t("no date set");
    const label = noGo > 0 ? t("Clear the {noGo} no-go {noGo, plural, one {object} other {objects}} in {name}", { noGo, name: wave.name }) : atRisk > 0 ? t("Review the {atRisk} at-risk {atRisk, plural, one {object} other {objects}} in {name}", { atRisk, name: wave.name }) : t("Open {name}", { name: wave.name });
    const href = noGo > 0 ? "/work?verdict=no-go" : atRisk > 0 ? "/work?verdict=at-risk" : hrefFor({ kind: "waves", id: "" });
    return (
      <>
        <KeepLink href={href} className="nx-btn nx-btn-primary" data-testid="wave-next-step">{label}</KeepLink>
        <span className="nx-sub" data-testid="wave-next-when">{t("{name}: {when}. {go} go, {atRisk} at risk, {noGo} no-go.", { name: wave.name, when, go: group.counts.go, atRisk, noGo })}</span>
      </>
    );
  }
  return <KeepLink href="/work?verdict=no-go" className="nx-btn nx-btn-primary">{t("Open the no-go objects")}</KeepLink>;
}
