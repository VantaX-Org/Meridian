"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { IconSearch, Mono, Pill } from "@/design";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { searchWork } from "@/lib/api/work";
import { formatModuleName, plural, recordKeyLabel } from "@/lib/format";
import { isTypingTarget } from "@/lib/shortcuts";
import { STATUS } from "@/components/work/status";

/** Results shown at most; the API ranks them. */
export const SEARCH_LIMIT = 20;
const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;
const PLACEHOLDER = "Find a record by key or name";

type Result = Awaited<ReturnType<typeof searchWork>>["items"][number];

/** Screens whose `?run=` is a process-discovery run, not an analysis run (components/global-run.tsx). */
const ownsRun = (path: string) => path === "/process" || path.startsWith("/process/");

/** The record's page in its object workbench, keeping the run the user is looking at. */
export function recordHref(item: Pick<Result, "module" | "record_key">, run: string | null): string {
  const params = new URLSearchParams({ record: item.record_key });
  if (run) params.set("run", run);
  return `/objects/${encodeURIComponent(item.module)}?${params}`;
}

/**
 * The scope bar's record finder: type a record key or name, pick one of the failing records it matches in the
 * current run, and open it in its object. "/" focuses it from anywhere outside a text field; Escape closes the list.
 */
export function GlobalSearch() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  const run = ownsRun(pathname) ? null : search?.get("run") ?? null;
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = useDebouncedValue(text.trim(), DEBOUNCE_MS);
  const enabled = q.length >= MIN_CHARS;

  const { data, isFetching, isError } = useQuery({
    queryKey: ["work-search", run ?? "latest", q],
    queryFn: () => searchWork(q, run ?? undefined),
    enabled,
    staleTime: 30_000,
  });
  const items: Result[] = enabled ? (data?.items ?? []).slice(0, SEARCH_LIMIT) : [];
  const shown = open && enabled;

  // "/" focuses the finder from anywhere, unless the user is typing somewhere.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // A click outside closes the list.
  useEffect(() => {
    if (!shown) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [shown]);

  const go = (item: Result) => {
    setOpen(false);
    setText("");
    inputRef.current?.blur();
    router.push(recordHref(item, run));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (shown) setOpen(false);
      else inputRef.current?.blur();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!items.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
      return;
    }
    if (e.key === "Enter") {
      const item = items[active];
      if (shown && item) {
        e.preventDefault();
        go(item);
      }
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;
  const status = isError
    ? "Search failed. Try again."
    : isFetching && !items.length
      ? "Searching…"
      : !items.length && data
        ? "No failing record matches"
        : null;
  // Always mounted, so a screen reader hears each change: the result count, searching, or the failure.
  const announce = !shown ? "" : status ?? (items.length ? plural(items.length, "matching record") : "");

  return (
    <div ref={rootRef} className="relative" data-testid="global-search">
      <span aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 inline-flex m-ink-3">
        <IconSearch size={14} />
      </span>
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label={PLACEHOLDER}
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && items[active] ? optionId(active) : undefined}
        placeholder={PLACEHOLDER}
        autoComplete="off"
        spellCheck={false}
        value={text}
        onChange={(e) => { setText(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="m-input w-[180px] xl:w-[260px] pl-7"
      />
      <span role="status" className="sr-only">{announce}</span>
      {shown && (
        <div className="m-popup absolute right-0 top-[calc(100%+4px)] z-50 w-[440px] max-w-[calc(100vw-32px)]">
          {status && <p className="m-text-meta m-ink-3 px-2 py-2" aria-hidden="true">{status}</p>}
          <ul id={listId} role="listbox" aria-label="Matching records">
            {items.map((item, i) => {
              const st = STATUS[item.status];
              return (
                <li
                  key={`${item.module}:${item.record_key}`}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  data-highlighted={i === active ? "" : undefined}
                  className="m-popup-item h-auto py-2"
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(item)}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{item.name ?? recordKeyLabel(item.record_key)}</span>
                    <span className="m-text-meta m-ink-3 truncate">
                      {formatModuleName(item.module)}, <Mono>{item.record_key}</Mono>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="m-text-meta m-ink-3">{plural(item.issues, "issue")}</span>
                    {st && <Pill tone={st.tone}>{st.label}</Pill>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
