/**
 * Aurora <Combobox> primitive — WS2.
 *
 * Uncontrolled text input with an open listbox. Typeahead filters `options`
 * case-insensitively; arrow keys navigate the active option; Enter commits;
 * Escape closes without change. Matches the WAI-ARIA 1.2 Combobox pattern
 * (aria-controls + aria-activedescendant + role="listbox").
 *
 * This is the stock listbox combobox. `CommandPalette` (WS4) layers grouped
 * sections and keyboard affordances on top of this pattern.
 */

"use client";

import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { clsx } from "./internal";
import type { SelectOption } from "./forms";

export interface ComboboxProps<TValue extends string = string> {
  options: ReadonlyArray<SelectOption<TValue>>;
  value?: TValue;
  onValueChange: (value: TValue) => void;
  placeholder?: string;
  emptyMessage?: string;
  invalid?: boolean;
  className?: string;
}

export function Combobox<TValue extends string = string>({
  options,
  value,
  onValueChange,
  placeholder,
  emptyMessage = "No matches",
  invalid,
  className,
}: ComboboxProps<TValue>) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );
  const filtered = useMemo(() => {
    if (query.trim().length === 0) return options;
    const needle = query.trim().toLowerCase();
    return options.filter((option) =>
      option.label.toLowerCase().includes(needle),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function onDocumentPointerDown(event: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocumentPointerDown);
    return () => document.removeEventListener("mousedown", onDocumentPointerDown);
  }, [open]);

  function commit(index: number) {
    const option = filtered[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  }

  const displayValue = open ? query : (selected?.label ?? "");

  return (
    <div ref={rootRef} className={clsx("aurora-combobox", className)}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && filtered[activeIndex]
            ? `${listboxId}-option-${activeIndex}`
            : undefined
        }
        aria-invalid={invalid || undefined}
        className="aurora-input aurora-focus-ring aurora-combobox__trigger"
        data-invalid={invalid ? "true" : undefined}
        placeholder={placeholder}
        value={displayValue}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul id={listboxId} role="listbox" className="aurora-combobox__listbox">
          {filtered.length === 0 ? (
            <li role="presentation" className="aurora-combobox__empty">
              {emptyMessage}
            </li>
          ) : (
            filtered.map((option, index) => (
              <li
                key={option.value}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                className="aurora-combobox__option"
                data-active={index === activeIndex ? "true" : undefined}
                data-selected={option.value === value ? "true" : undefined}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(index);
                }}
              >
                {option.label}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
