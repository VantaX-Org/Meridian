"use client";

import { useQuery } from "@tanstack/react-query";
import { getSurvivorship, type SurvivorshipPick } from "@/lib/api/v2/aletheia-survivorship";
import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { StackedBar, type StackPart } from "../charts";
import { Coded, EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { CcBanner, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * Aletheia verified survivorship: when no survivorship rule decides a golden-record field, the model is asked to pick
 * a source. It sees only the shape of each source's value, never a value, a preview or a hash. The server then proves
 * the pick (the source exists, its value is not blank, the confidence is valid); a pick that fails does not win.
 */

const CHECK_TEXT: Record<string, () => string> = {
  SOURCE_KNOWN: () => t("The source is one of the contributors"),
  VALUE_PRESENT: () => t("The source's value is not blank"),
  CONFIDENCE_VALID: () => t("The confidence is between 0 and 1"),
};

function Pick({ p }: { p: SurvivorshipPick }) {
  return (
    <article className="m2-ck-panel" aria-label={`${p.sap_object_key} ${p.field}`} data-testid={`surv-pick-${p.sap_object_key}-${p.field}`}>
      <header className="m2-ck-head">
        <h3 className="m2-h2"><Coded code={p.field} text={p.field_text} /></h3>
        <span className="m2-meta">{p.verified ? t("Proved, the pick won") : t("Not proved, the pick did not win")}</span>
      </header>
      <p>{moduleText(p.domain)} <span className="m2-meta">{p.sap_object_key}</span> {t("Model picked {source}", { source: p.recommended_source })}</p>
      {p.reasoning ? <p className="m2-meta">{p.reasoning}</p> : null}
      <ul className="m2-cl-changes">
        {p.checks.map((c) => (
          <li key={c.code}><Coded code={c.code} text={CHECK_TEXT[c.code]?.()} /> <span className="m2-meta">{c.passed ? t("Passed") : t("Failed")}</span></li>
        ))}
      </ul>
    </article>
  );
}

export function AletheiaSurvivorship() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["survivorship", fixture], queryFn: getSurvivorship, staleTime: 15_000 });
  if (q.isPending) return <CcPage title={t("Aletheia verified survivorship")}><Skeleton width="100%" height={320} /></CcPage>;
  if (q.isError) return <CcPage title={t("Aletheia verified survivorship")}><ErrorFrame onRetry={() => void q.refetch()}>{t("The survivorship picks could not be read.")}</ErrorFrame></CcPage>;
  const { domains, picks } = q.data;
  const verified = domains.reduce((n, d) => n + d.verified, 0);
  const rejected = domains.reduce((n, d) => n + d.rejected, 0);
  return (
    <CcPage title={t("Aletheia verified survivorship")}>
      <CcBanner
        testId="survivorship"
        label={t("Aletheia verified survivorship")}
        eyebrow={t("Aletheia verified survivorship")}
        headline={t("{n, plural, one {# model pick did not pass its proof} other {# model picks did not pass their proof}}", { n: rejected })}
        why={t("The model sees only the shape of each source's value, never a value. A pick wins only when the server proves it against the contributing sources.")}
        figs={[{ label: t("Proved"), value: int(verified) }, { label: t("Not proved"), value: int(rejected) }]}
      />
      <Panel title={t("Picks by object")} meta={t("Model picks that were proved and that were not.")} testId="survivorship-domains">
        {domains.length === 0 ? <EmptyFrame>{t("The model has not picked a winner yet.")}</EmptyFrame> : (
          <ul className="m2-cl-changes">
            {domains.map((d) => {
              const parts: StackPart[] = [
                { key: "ok", label: t("Proved"), value: d.verified, colour: "--m2-chart-3", title: t("{n} proved", { n: int(d.verified) }) },
                { key: "no", label: t("Not proved"), value: d.rejected, colour: "--m2-sev-crit", title: t("{n} not proved", { n: int(d.rejected) }) },
              ];
              return (
                <li key={d.domain} data-testid={`surv-domain-${d.domain}`}>
                  <strong>{moduleText(d.domain)}</strong>
                  <StackedBar parts={parts} label={t("Model picks in {object}", { object: moduleText(d.domain) })} format={int} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Panel title={t("Newest picks")} meta={t("Each pick with the checks the server ran.")} testId="survivorship-picks">
        {picks.length === 0 ? <EmptyFrame>{t("The model has not picked a winner yet.")}</EmptyFrame> : (
          <ScrollFrame label={t("Model picks, scrollable")}>
            {picks.map((p) => <Pick key={`${p.sap_object_key}-${p.field}`} p={p} />)}
          </ScrollFrame>
        )}
      </Panel>
    </CcPage>
  );
}
