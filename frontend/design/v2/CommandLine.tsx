"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { getCommand } from "@/lib/api/v2/landscape";
import { useFixture } from "@/lib/api/v2/fixture";
import { useV2Href, useV2Session } from "@/lib/v2/hooks";
import { canAdminister, visibleSections } from "@/lib/v2/admin-sections";
import { commandHints, ledgerRegistry } from "@/lib/v2/keys";
import type { CommandGroup } from "@/lib/api/v2/types";
import { t as tr, tx } from "@/lib/v2/i18n";
import { chipValue, nlQuestion, nlTarget, slotWord } from "@/lib/v2/step10";
import { useNl } from "@/lib/v2/step10-queries";
import type { NlAnswer } from "@/lib/api/v2/step10";
import { Mono } from "./parts";
import "./step10.css";

const PLACES: CommandGroup = {
  kind: "action",
  get label() { return tr("Go to"); },
  items: [
    { id: "landscape", get title() { return tr("Landscape"); }, href: "/" },
    { id: "work", get title() { return tr("Work"); }, href: "/work" },
    { id: "runs", get title() { return tr("Runs"); }, href: "/runs" },
    { id: "people", get title() { return tr("People"); }, href: "/people" },
    { id: "rules", get title() { return tr("Rules"); }, href: "/rules" },
    { id: "connect", get title() { return tr("Connect a system"); }, href: "/s/new" },
  ],
};

/**
 * Every canvas and panel by name, in the reader's language, for the places this viewer may open: typing "reports",
 * "webhooks" or "Einstellungen" goes there without asking the server. They follow what the server found.
 */
export function placeIndex(can: (action: string) => boolean): { id: string; title: string; href: string }[] {
  const places = [
    ...PLACES.items,
    { id: "reports", title: tr("Reports"), href: "/reports" },
    { id: "requests", title: tr("Requests"), href: "/requests" },
    { id: "ask", title: tr("Ask Meridian"), href: "/?open=ask" },
    { id: "waves", title: tr("Waves"), href: "/?view=waves" },
    { id: "status", title: tr("Status"), href: "/status" },
    { id: "inbox", title: tr("Inbox"), href: "/?open=inbox" },
    { id: "help", title: tr("Help"), href: "/?open=help" },
    { id: "preferences", title: tr("Preferences"), href: "/?open=preferences" },
  ];
  if (canAdminister(can)) places.push({ id: "admin", title: tr("Administration"), href: "/admin" });
  for (const s of visibleSections(can)) places.push({ id: `admin-${s.slug}`, title: tr("Administration: {section}", { section: s.label }), href: `/admin/${s.slug}` });
  return places;
}

/** The places whose name contains the typed words, best first: a name that starts with them, then one that has them. */
export function matchPlaces(places: readonly { id: string; title: string; href: string }[], q: string): { id: string; title: string; href: string }[] {
  const needle = q.trim().toLocaleLowerCase();
  if (needle.length < 2) return [];
  const words = (s: string) => s.toLocaleLowerCase().split(/[\s:,]+/).filter(Boolean);
  const starts = places.filter((p) => words(p.title).some((w) => w.startsWith(needle)) || p.title.toLocaleLowerCase().startsWith(needle));
  const has = places.filter((p) => !starts.includes(p) && p.title.toLocaleLowerCase().includes(needle));
  return [...starts, ...has].slice(0, 6);
}

interface Row {
  id: string;
  kind: string;
  group: string;
  title: string;
  href: string;
}

/**
 * The actions the command line offers, wired to the v2 screens whatever address the API sends: "approve" opens the
 * ledger on the batches waiting for approval; "export" saves the fix sheet of the rows on screen (and, from another
 * screen, opens the ledger and exports its default rows).
 */
export const WORK_APPROVALS = "/work?filter=approvals";
export const WORK_EXPORT = "/work?export=1";
function actionTarget(r: Row): { href: string; exportNow: boolean } {
  if (r.kind === "action" && r.id === "approvals") return { href: WORK_APPROVALS, exportNow: false };
  if (r.kind === "action" && (r.id === "export-fix-sheet" || r.id === "export")) return { href: WORK_EXPORT, exportNow: true };
  return { href: r.href, exportNow: false };
}

/**
 * The command line: type a material number to open the record, a rule id to open the rule, an object, a run or a
 * word such as approve or export. Results come from GET /command grouped by kind; arrows move, Enter opens, Esc closes.
 */
export function CommandLine({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const href = useV2Href();
  const fixture = useFixture();
  const session = useV2Session();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 120);
    return () => clearTimeout(t);
  }, [q]);

  // Natural language mode: a leading `?` asks in a sentence (GET /command/nl) instead of searching.
  const question = nlQuestion(debounced);
  const nlMode = q.trimStart().startsWith("?");
  const nl = useNl(question ?? "", nlMode && Boolean(question));
  const result = useQuery({
    queryKey: ["v2", "command", fixture, debounced],
    queryFn: () => getCommand(debounced),
    enabled: debounced.length > 0 && !nlMode,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

  const rows = useMemo<Row[]>(() => {
    if (debounced.length === 0 || q.trim().length === 0) return PLACES.items.map((i) => ({ id: i.id, kind: PLACES.kind, group: PLACES.label, title: i.title, href: i.href }));
    const here = matchPlaces(placeIndex(session.can), debounced).map((p) => ({ id: `place-${p.id}`, kind: "action", group: tr("Go to"), title: p.title, href: p.href }));
    const served = (result.data?.groups ?? []).flatMap((g) => g.items.map((i) => ({ id: i.id, kind: g.kind, group: tx(g.label), title: i.title, href: i.href })));
    // What the server found comes first (a record, a rule, an action such as approve or export); the places follow.
    return [...served, ...here.filter((h) => !served.some((s) => s.href === h.href))];
  }, [debounced, q, result.data, session.can]);

  const clamped = Math.min(index, Math.max(0, rows.length - 1));
  const openNl = (a: NlAnswer | undefined) => {
    if (!a) return;
    onClose();
    router.push(href(nlTarget(a)));
  };
  const run = (r: Row | undefined) => {
    if (!r) return;
    onClose();
    const target = actionTarget(r);
    const ledger = ledgerRegistry.get();
    if (target.exportNow && ledger) ledger.exportSheet();
    else router.push(href(target.href));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex(Math.min(rows.length - 1, clamped + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex(Math.max(0, clamped - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (nlMode) openNl(nl.data);
      else run(rows[clamped]);
    } else if (e.key === "Tab") e.preventDefault();
  };

  useEffect(() => {
    document.getElementById(`m2-po-${clamped}`)?.scrollIntoView?.({ block: "nearest" });
  }, [clamped, rows]);

  let last = "";
  return (
    <div onKeyDown={onKeyDown}>
      <div className="m2-scrim" onClick={onClose} aria-hidden="true" />
      <div className="m2-pal" role="dialog" aria-modal="true" aria-label={tr("Search, ask, or type a command")} data-testid="command-line">
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded={!nlMode}
          aria-controls={nlMode ? "m2-nl" : "m2-pal-list"}
          aria-describedby="m2-pal-hint"
          aria-activedescendant={!nlMode && rows.length ? `m2-po-${clamped}` : undefined}
          aria-label={tr("Search, ask, or type a command")}
          placeholder={tr("Search, ask, or type a command")}
          autoComplete="off"
          spellCheck={false}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIndex(0);
          }}
        />
        <p id="m2-pal-hint" className="m2-pal-hint">
          {tr("Start with ? to ask in a sentence, such as ?critical vendors assigned to me due this week. The answer is a ledger filter you can see before it runs.")}
        </p>
        {nlMode ? (
          <NlPanel question={question} answer={nl.data} pending={nl.isFetching} failed={nl.isError} onOpen={() => openNl(nl.data)} />
        ) : (
        <ul id="m2-pal-list" role="listbox" aria-label={tr("Results")}>
          {rows.length === 0 ? (
            <li className="m2-pal-gh" role="presentation">
              {q.trim() && !result.isFetching ? tr("No match for {q}. Try a material number, a rule id such as MM142, or a word such as approve or export.", { q: q.trim() }) : result.isFetching ? tr("Searching") : ""}
            </li>
          ) : (
            rows.map((r, i) => {
              const head = r.group !== last;
              last = r.group;
              return (
                <li key={`${r.group}:${r.href}:${i}`} role="presentation">
                  {head ? <div className="m2-pal-gh">{r.group}</div> : null}
                  <div id={`m2-po-${i}`} role="option" aria-selected={i === clamped} className="m2-pal-o" onMouseEnter={() => setIndex(i)} onClick={() => run(r)}>
                    <span>{r.title}</span>
                  </div>
                </li>
              );
            })
          )}
        </ul>
        )}
        <div className="m2-pal-foot" aria-hidden="true">
          {commandHints().map((h) => (
            <span key={h.id}>
              <kbd className="m2-kb">{h.display}</kbd> {h.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The natural language answer: the filter that will run as chips (each matched phrase with the slot it fills), the
 * server's explanation, the words it did not understand, and Open. Nothing is hidden: the filter shown is the one the
 * ledger reads.
 */
function NlPanel({ question, answer, pending, failed, onOpen }: { question: string | null; answer: NlAnswer | undefined; pending: boolean; failed: boolean; onOpen: () => void }) {
  if (!question) {
    return (
      <div id="m2-nl" className="m2-nl" role="region" aria-label={tr("Ask in a sentence")} data-testid="nl-panel">
        <p className="m2-nl-why">{tr("Type a question after the ?, such as ?vendor bank data in ECC production, or ?overdue materials assigned to me.")}</p>
      </div>
    );
  }
  return (
    <div id="m2-nl" className="m2-nl" role="region" aria-label={tr("The filter that will run")} aria-live="polite" data-testid="nl-panel">
      {failed ? (
        <p className="m2-nl-why" role="alert">{tr("The question could not be read. Try other words, or search without the ?.")}</p>
      ) : !answer ? (
        <p className="m2-nl-why">{pending ? tr("Reading the question") : ""}</p>
      ) : (
        <>
          <h3>{tr("The filter that will run")}</h3>
          {answer.matched.length ? (
            <ul className="m2-nl-chips" data-testid="nl-chips">
              {answer.matched.map((m) => (
                <li key={`${m.slot}:${String(m.value)}`} title={tr("From the words: {phrase}", { phrase: m.phrase })}>
                  <b>{tr("{slot}:", { slot: slotWord(m.slot) })}</b>{" "}
                  <span>{chipValue(m)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m2-nl-why">{tr("No filter: Open shows the open work.")}</p>
          )}
          <p className="m2-nl-why" data-testid="nl-explanation">{answer.explanation}</p>
          {answer.unmatched_words.length ? (
            <p className="m2-nl-why" data-testid="nl-unmatched">
              {tr("Not understood, left out of the filter: {words}", { words: answer.unmatched_words.join(", ") })}
            </p>
          ) : null}
          {answer.llm_used ? <p className="m2-nl-why">{tr("The language model mapped some words onto the same filters; the filter above is still what runs.")}</p> : null}
          <div className="m2-nl-acts">
            <button type="button" className="m2-btn m2-strong" onClick={onOpen}>
              {tr("Open in Work")}
            </button>
            <Mono>{nlTarget(answer)}</Mono>
          </div>
        </>
      )}
    </div>
  );
}
