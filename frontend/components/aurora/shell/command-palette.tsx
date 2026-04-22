/**
 * Aurora <CommandPalette> — WS4.
 *
 * Thin wrapper over `cmdk` that enforces the Aurora open contract: ≤ 80 ms
 * from keystroke to first paint (spec §12 · moment 05 — Palette opens).
 * Opens on ⌘K / Ctrl+K globally; closes on Esc; items are groupable. The
 * component itself is purely presentational — consumers pass the item tree
 * and the `onRunCommand` callback.
 *
 * Keyboard contract:
 *   ⌘K / Ctrl+K   toggle
 *   Esc           close
 *   ↑ / ↓         navigate items
 *   Enter         run focused item
 *
 * Under `prefers-reduced-motion` the open / close transition is instant
 * (aurora.css §5.5.1 zeroes `medium` + `slow`; the palette runs on `fast`).
 */

"use client";

import { Command } from "cmdk";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { clsx } from "../primitives/internal";
import { Text } from "../primitives";

export interface CommandPaletteCommand {
  /** Stable id. */
  id: string;
  /** Visible label. */
  label: string;
  /** Optional keywords for cmdk fuzzy match. */
  keywords?: string[];
  /** Optional group heading. Missing → renders at top level. */
  group?: string;
  /** Optional right-aligned hint (shortcut, metadata). */
  hint?: string;
  /** Optional leading glyph. */
  icon?: ReactNode;
  /** Invoked when Enter / click / shortcut runs the command. */
  onRun: () => void;
}

export interface CommandPaletteProps {
  commands: ReadonlyArray<CommandPaletteCommand>;
  /** Placeholder for the search input. */
  placeholder?: string;
  /** Empty-state message when no items match. */
  emptyMessage?: string;
  /** Controlled open state. If absent, the palette self-manages. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Disable the global ⌘K binding — useful when host wires it. */
  disableGlobalHotkey?: boolean;
  className?: string;
}

export function CommandPalette({
  commands,
  placeholder = "Search commands, records, settings…",
  emptyMessage = "No commands match.",
  open: openProp,
  onOpenChange,
  disableGlobalHotkey,
  className,
}: CommandPaletteProps) {
  const isControlled = openProp !== undefined;
  const [openInternal, setOpenInternal] = useState(false);
  const open = isControlled ? openProp : openInternal;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setOpenInternal(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  // ⌘K / Ctrl+K global hotkey.
  useEffect(() => {
    if (disableGlobalHotkey) return;
    function onKey(event: KeyboardEvent) {
      const k = event.key.toLowerCase();
      if (k === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(!open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen, disableGlobalHotkey]);

  const groups = useMemo(() => {
    const map = new Map<string | undefined, CommandPaletteCommand[]>();
    commands.forEach((command) => {
      const key = command.group;
      const list = map.get(key);
      if (list) list.push(command);
      else map.set(key, [command]);
    });
    return Array.from(map.entries());
  }, [commands]);

  const rootRef = useRef<HTMLDivElement>(null);

  if (!open) return null;

  return (
    <div
      className={clsx("aurora-command-palette__scrim", className)}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
      // Close on Escape — cmdk's base <Command> handles list navigation
      // but not dismissal, and the visible <kbd>Esc</kbd> hint in the
      // input row documents this contract. Handled at the scrim (rather
      // than the dialog) so it fires even when focus has left the input.
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
        }
      }}
    >
      <div
        ref={rootRef}
        className="aurora-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <Command label="Command palette" shouldFilter>
          <div className="aurora-command-palette__input-row">
            <CommandIcon />
            <Command.Input
              className="aurora-command-palette__input"
              placeholder={placeholder}
              autoFocus
            />
            <span className="aurora-command-palette__hint">
              <kbd>Esc</kbd>
            </span>
          </div>
          <Command.List className="aurora-command-palette__list">
            <Command.Empty className="aurora-command-palette__empty">
              <Text variant="text-small" tone="tertiary">
                {emptyMessage}
              </Text>
            </Command.Empty>
            {groups.map(([group, items]) => (
              <Command.Group
                key={group ?? "__top"}
                heading={group}
                className="aurora-command-palette__group"
              >
                {items.map((command) => (
                  <Command.Item
                    key={command.id}
                    value={`${command.label} ${command.keywords?.join(" ") ?? ""}`}
                    onSelect={() => {
                      command.onRun();
                      setOpen(false);
                    }}
                    className="aurora-command-palette__item"
                  >
                    {command.icon ? (
                      <span className="aurora-command-palette__item-icon">
                        {command.icon}
                      </span>
                    ) : null}
                    <span className="aurora-command-palette__item-label">
                      {command.label}
                    </span>
                    {command.hint ? (
                      <span className="aurora-command-palette__item-hint">
                        {command.hint}
                      </span>
                    ) : null}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function CommandIcon() {
  return (
    <svg
      className="aurora-command-palette__icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4.5-4.5" />
    </svg>
  );
}
