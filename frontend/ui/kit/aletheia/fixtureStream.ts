import type { AskDone, AskEvidence, AskScope, AskStreamHandlers } from "@/lib/api/v2/assistant";
import { getFindings } from "@/lib/api/v2/insights";
import { t } from "@/lib/v2/i18n";

/** The same three events the backend sends, built from the fixture findings. Used only in fixture mode. */
export async function fixtureStream(body: AskScope, h: AskStreamHandlers): Promise<void> {
  const found = await getFindings(body.module);
  const top = [...found.findings]
    .filter((f) => !body.check_id || f.check_id === body.check_id)
    .sort((a, b) => b.affected - a.affected)
    .slice(0, 5);
  const evidence: AskEvidence = {
    intent: "worst_rules",
    version_id: top[0]?.version_id ?? null,
    facts: top.map((f) => ({
      statement: `${f.check_id} ${f.name}`,
      value: f.affected,
      source: "findings",
      href: `/o/ecc/${f.module}?rule=${f.check_id}&fixture=1`,
      checks: [{ check_id: f.check_id, module: f.module }],
    })),
    citations: top.slice(0, 3).map((f) => ({ check_id: f.check_id, module: f.module, href: `/o/ecc/${f.module}?rule=${f.check_id}&fixture=1` })),
    data: top.map((f) => ({ label: f.check_id, value: f.affected })),
    chart: top.length ? "bar" : null,
    links: [],
    coverage: 1,
    grounded: top.length > 0,
  };
  h.onEvidence(evidence);
  const lead = top[0];
  const answer = lead
    ? t("{rule} fails most: {n} records. {count} rules are listed with the figures they rest on.", { rule: lead.check_id, n: lead.affected, count: top.length })
    : t("No failing rules are recorded for this scope yet.");
  for (const word of answer.split(/(?<=\s)/)) h.onToken(word);
  const done: AskDone = { ...evidence, answer, ai: false, phrased: false };
  h.onDone(done);
}
