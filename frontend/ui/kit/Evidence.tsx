"use client";

import type { Evidence } from "@/lib/api/v2/aletheia-engine";
import { whole } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";

/** The licensed Aletheia mark, served unaltered (docs/diligence/licences.md section 6). */
export function AletheiaMarkImg() {
  // eslint-disable-next-line @next/next/no-img-element -- the Aletheia mark is served unaltered, docs/diligence/licences.md section 6
  return <img className="mx-aletheia-mark" src="/brand/aletheia-mark.svg" alt="" aria-hidden="true" width={16} height={16} />;
}

/** The mark with its name, put on every result Aletheia computed. */
export function AletheiaMark() {
  return <span className="mx-aletheia-tag"><AletheiaMarkImg />{t("Aletheia")}</span>;
}

const date = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : t("n/a"));

/** What an engine result was computed from, how, how sure it is and which runs it used. */
export function EvidenceNote({ ev, testId }: { ev: Evidence; testId?: string }) {
  return (
    <details className="mx-evidence-note" data-testid={testId}>
      <summary className="mx-evidence-l">{t("Evidence")}</summary>
      <dl className="mx-evidence">
        <dt>{t("Inputs")}</dt><dd>{ev.inputs.join("; ")}</dd>
        <dt>{t("Method")}</dt><dd>{ev.method}</dd>
        <dt>{t("Confidence")}</dt>
        <dd>{ev.confidence == null ? t("Shown per result, as its deviation score") : t("{n} out of 100", { n: whole(ev.confidence) })}</dd>
        {ev.first_run ? <><dt>{t("Runs used")}</dt><dd>{t("{n} runs, {from} to {to}", { n: whole(ev.runs ?? 0), from: date(ev.first_run), to: date(ev.last_run) })}</dd></> : null}
      </dl>
    </details>
  );
}
