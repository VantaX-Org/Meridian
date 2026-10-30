"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { getCommand } from "@/lib/api/v2/landscape";
import { useFixture } from "@/lib/api/v2/fixture";
import { useV2Href } from "@/lib/v2/hooks";
import { commandHints, ledgerRegistry } from "@/lib/v2/keys";
import type { CommandGroup } from "@/lib/api/v2/types";
import { t as tr, tx } from "@/lib/v2/i18n";

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

  const result = useQuery({
    queryKey: ["v2", "command", fixture, debounced],
    queryFn: () => getCommand(debounced),
    enabled: debounced.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

  const rows = useMemo<Row[]>(() => {
    const groups = debounced.length === 0 || q.trim().length === 0 ? [PLACES] : (result.data?.groups ?? []);
    return groups.flatMap((g) => g.items.map((i) => ({ id: i.id, kind: g.kind, group: tx(g.label), title: i.title, href: i.href })));
  }, [debounced, q, result.data]);

  const clamped = Math.min(index, Math.max(0, rows.length - 1));
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
      run(rows[clamped]);
    } else if (e.key === "Tab") e.preventDefault();
  };

  useEffect(() => {
    document.getElementById(`m2-po-${clamped}`)?.scrollIntoView?.({ block: "nearest" });
  }, [clamped, rows]);

  let last = "";
  return (
    <div onKeyDown={onKeyDown}>
      <div className="m2-scrim" onClick={onClose} aria-hidden="true" />
      <div className="m2-pal" role="dialog" aria-modal="true" aria-label={tr("Search or type a command")} data-testid="command-line">
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="m2-pal-list"
          aria-activedescendant={rows.length ? `m2-po-${clamped}` : undefined}
          aria-label={tr("Search or type a command")}
          placeholder={tr("Search or type a command")}
          autoComplete="off"
          spellCheck={false}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIndex(0);
          }}
        />
        <ul id="m2-pal-list" role="listbox" aria-label={tr("Results")}>
          {rows.length === 0 ? (
            <li className="m2-pal-gh" role="presentation">
              {q.trim() && !result.isFetching ? tr("No match for {q}. Try a material number, a rule id such as MM014, or a word such as approve or export.", { q: q.trim() }) : result.isFetching ? tr("Searching") : ""}
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
