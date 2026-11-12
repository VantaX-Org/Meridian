"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { t } from "@/lib/v2/i18n";
import { Icon } from "../Icon";
import { cx } from "./cx";
import { trapTab } from "./focus";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}
export interface CommandGroup {
  id: string;
  label: string;
  items: Command[];
}

/**
 * Ctrl or Cmd K, in the caller. Type to filter across groups; a leading ? lists what the palette can do. Combobox
 * pattern: focus stays in the input, aria-activedescendant names the highlighted result.
 */
type PaletteProps = { open: boolean; onClose: () => void; groups: CommandGroup[] };

/** Mounts the palette body only while open, so the query and selection reset by remounting. */
export function CommandPalette(props: PaletteProps) {
  return props.open ? <PaletteBody {...props} /> : null;
}

function PaletteBody({ onClose, groups }: PaletteProps) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const base = useId();

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => opener.current?.focus?.();
  }, []);

  const help = q.startsWith("?");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return groups
      .map((g) => ({ ...g, items: help || !needle ? g.items : g.items.filter((c) => c.label.toLowerCase().includes(needle)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, q, help]);
  const flat = shown.flatMap((g) => g.items);
  // Flat index of each group's first item, so rows get their index without a render-time counter.
  const starts = shown.map((_, gi) => shown.slice(0, gi).reduce((sum, g) => sum + g.items.length, 0));
  const run = (c?: Command) => {
    if (!c) return;
    onClose();
    c.run();
  };
  return (
    <div className="nx-scrim nx-scrim-top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={t("Command palette")}
        className="nx-dialog nx-palette"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
          trapTab(e, box.current);
        }}
      >
        <div className="nx-palette-field">
          <Icon name="search" />
          <input
            ref={input}
            className="nx-palette-input"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${base}-list`}
            aria-activedescendant={flat[at] ? `${base}-${flat[at].id}` : undefined}
            aria-label={t("Type a command or ? for help")}
            placeholder={t("Type a command or ? for help")}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAt((a) => Math.min(flat.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAt((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(flat[at]);
              }
            }}
          />
        </div>
        {help ? <p className="nx-palette-help">{t("Pick a command with the arrow keys and press Enter. Type a word to filter. Esc closes.")}</p> : null}
        <div id={`${base}-list`} role="listbox" aria-label={t("Commands")} className="nx-palette-list">
          {shown.length === 0 ? <p className="nx-palette-empty">{t("No command matches.")}</p> : null}
          {shown.map((g, gi) => (
            <div key={g.id} role="group" aria-labelledby={`${base}-g-${g.id}`}>
              <div id={`${base}-g-${g.id}`} className="nx-palette-group">{g.label}</div>
              {g.items.map((c, ci) => {
                const i = starts[gi] + ci;
                return (
                  <div key={c.id} id={`${base}-${c.id}`} role="option" aria-selected={i === at} className={cx("nx-palette-item", i === at && "nx-palette-on")} onMouseMove={() => setAt(i)} onClick={() => run(c)}>
                    <span>{c.label}</span>
                    {c.hint ? <span className="nx-palette-hint">{c.hint}</span> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
