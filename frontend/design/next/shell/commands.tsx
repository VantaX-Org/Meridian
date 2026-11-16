"use client";

import { canAdminister, visibleSections } from "@/lib/v2/admin-sections";
import type { NlAnswer } from "@/lib/api/v2/step10";
import { t } from "@/lib/v2/i18n";
import { chipValue, nlTarget, slotWord } from "@/lib/v2/step10";
import { Button, Code } from "../kit";
import "./commands.css";

export interface Place { id: string; title: string; href: string }

/**
 * Every place the command palette can open, by name in the reader's language, at its old address (the palette maps each
 * one to its address in this interface). "Connect a system" only for those who may connect one; the admin sections only
 * for administrators, and only the sections this viewer may open.
 */
export function placeIndex(can: (action: string) => boolean): Place[] {
  const places: Place[] = [
    { id: "landscape", title: t("Landscape"), href: "/" },
    { id: "objects", title: t("Objects"), href: "/objects" },
    { id: "work", title: t("Work"), href: "/work" },
    { id: "runs", title: t("Runs"), href: "/runs" },
    { id: "people", title: t("People"), href: "/people" },
    { id: "rules", title: t("Rules"), href: "/rules" },
    ...(can("manage_systems") ? [{ id: "connect", title: t("Connect a system"), href: "/s/new" }] : []),
    { id: "reports", title: t("Reports"), href: "/reports" },
    { id: "requests", title: t("Requests"), href: "/requests" },
    { id: "atlas", title: t("Landscape atlas"), href: "/atlas" },
    { id: "config", title: t("Configuration"), href: "/config" },
    { id: "cleansing", title: t("Cleansing"), href: "/cleansing" },
    { id: "processes", title: t("Process discovery"), href: "/processes" },
    { id: "mining", title: t("Data mining"), href: "/mining" },
    { id: "rule-promotion", title: t("Aletheia rule promotion"), href: "/rule-promotion" },
    { id: "rule-dry-run", title: t("Rule dry run"), href: "/rule-dry-run" },
    { id: "fix-drafts", title: t("Aletheia verified fixes"), href: "/fix-drafts" },
    { id: "data-requests", title: t("Data requests"), href: "/data-requests" },
    { id: "aletheia-survivorship", title: t("Aletheia verified survivorship"), href: "/aletheia-survivorship" },
    { id: "reference-data", title: t("Reference data"), href: "/reference-data" },
    { id: "catalogue", title: t("Data catalogue"), href: "/catalogue" },
    { id: "monitors", title: t("Learned monitors"), href: "/monitors" },
    { id: "entry-gate", title: t("Entry gate"), href: "/entry-gate" },
    { id: "anomaly-rules", title: t("Anomaly rules"), href: "/anomaly-rules" },
    { id: "work-analytics", title: t("Work analytics"), href: "/work/analytics" },
    { id: "migration", title: t("Migration analysis"), href: "/migration" },
    { id: "s4", title: t("S/4HANA readiness"), href: "/s4" },
    { id: "insights", title: t("Cost and causes"), href: "/insights" },
    { id: "forecast", title: t("Forecast and plan"), href: "/forecast" },
    { id: "value", title: t("Value delivered"), href: "/value" },
    { id: "score", title: t("Score lens"), href: "/score" },
    { id: "ask", title: t("Ask Meridian"), href: "/?open=ask" },
    { id: "waves", title: t("Waves"), href: "/?view=waves" },
    { id: "status", title: t("Status"), href: "/status" },
    { id: "inbox", title: t("Inbox"), href: "/?open=inbox" },
    { id: "help", title: t("Help"), href: "/?open=help" },
    { id: "preferences", title: t("Preferences"), href: "/?open=preferences" },
  ];
  if (canAdminister(can)) {
    places.push({ id: "admin", title: t("Administration"), href: "/admin" });
    for (const s of visibleSections(can)) places.push({ id: `admin-${s.slug}`, title: t("Administration: {section}", { section: s.label }), href: `/admin/${s.slug}` });
  }
  return places;
}

/**
 * The answer to a question typed after "?": the filter that will run (each matched phrase with the slot it fills), the
 * server's explanation, the words it did not understand, and Open in Work. The filter shown is the one Work reads.
 */
export function NlPanel({ question, answer, pending, failed, onOpen }: { question: string | null; answer: NlAnswer | undefined; pending: boolean; failed: boolean; onOpen: () => void }) {
  if (!question) {
    return (
      <div className="nx-nl" role="region" aria-label={t("Ask in a sentence")} data-testid="nl-panel">
        <p className="nx-nl-why">{t("Type a question after the ?, such as ?vendor bank data in ECC production, or ?overdue materials assigned to me.")}</p>
      </div>
    );
  }
  return (
    <div className="nx-nl" role="region" aria-label={t("The filter that will run")} aria-live="polite" data-testid="nl-panel">
      {failed ? (
        <p className="nx-nl-why" role="alert">{t("The question could not be read. Try other words, or search without the ?.")}</p>
      ) : !answer ? (
        <p className="nx-nl-why" role="status">{pending ? t("Reading the question") : ""}</p>
      ) : (
        <>
          <h3 className="nx-nl-title">{t("The filter that will run")}</h3>
          {answer.matched.length ? (
            <ul className="nx-nl-chips" data-testid="nl-chips">
              {answer.matched.map((m) => (
                <li key={`${m.slot}:${String(m.value)}`} title={t("From the words: {phrase}", { phrase: m.phrase })}>
                  <b>{t("{slot}:", { slot: slotWord(m.slot) })}</b> <span>{chipValue(m)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="nx-nl-why">{t("No filter: Open shows the open work.")}</p>
          )}
          <p className="nx-nl-why" data-testid="nl-explanation">{answer.explanation}</p>
          {answer.unmatched_words.length ? (
            <p className="nx-nl-why" data-testid="nl-unmatched">
              {t("Not understood, left out of the filter: {words}", { words: answer.unmatched_words.join(", ") })}
            </p>
          ) : null}
          {answer.llm_used ? <p className="nx-nl-why">{t("The language model mapped some words onto the same filters; the filter above is still what runs.")}</p> : null}
          <div className="nx-nl-acts">
            <Button variant="primary" onClick={onOpen}>{t("Open in Work")}</Button>
            <Code code={nlTarget(answer)} />
          </div>
        </>
      )}
    </div>
  );
}
