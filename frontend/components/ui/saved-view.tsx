"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookmarkCheck, ChevronDown, Check, Plus, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface View {
  id: string;
  name: string;
  /** Serialised query-string without the leading `?`. */
  qs: string;
}

function storageKey(routeKey: string) {
  return `meridian.saved-views.${routeKey}`;
}

function readViews(routeKey: string): View[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(routeKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is View =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as View).id === "string" &&
        typeof (v as View).name === "string" &&
        typeof (v as View).qs === "string",
    );
  } catch {
    return [];
  }
}

function writeViews(routeKey: string, views: View[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(routeKey), JSON.stringify(views));
}

export interface SavedViewProps {
  /** Stable key per route — e.g. `"findings"`, `"stewardship"`. */
  routeKey: string;
  className?: string;
}

/**
 * LocalStorage-backed named view switcher.
 *
 * Lets a user bookmark the current URL query-string under a name (e.g.
 * "Criticals only" or "My queue"). Phase 2 will replace the storage layer
 * with a server-side endpoint; the component contract is designed to absorb
 * that swap without touching call sites.
 */
export function SavedView({ routeKey, className }: SavedViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const currentQs = search.toString();

  const [views, setViews] = useState<View[]>([]);
  useEffect(() => {
    setViews(readViews(routeKey));
  }, [routeKey]);

  const activeView = useMemo(
    () => views.find((v) => v.qs === currentQs) ?? null,
    [views, currentQs],
  );

  const saveCurrent = useCallback(() => {
    const defaultName =
      currentQs.length === 0
        ? "All"
        : currentQs.length < 40
          ? currentQs
          : `${currentQs.slice(0, 37)}…`;
    const name = window.prompt("Name this view", defaultName);
    if (!name) return;
    const next: View[] = [
      ...views.filter((v) => v.name !== name),
      { id: crypto.randomUUID(), name, qs: currentQs },
    ];
    writeViews(routeKey, next);
    setViews(next);
  }, [currentQs, routeKey, views]);

  const applyView = useCallback(
    (view: View) => {
      router.replace(view.qs ? `${pathname}?${view.qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const deleteView = useCallback(
    (view: View) => {
      const next = views.filter((v) => v.id !== view.id);
      writeViews(routeKey, next);
      setViews(next);
    },
    [routeKey, views],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/[0.60] px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-white/[0.80]",
              className,
            )}
          />
        }
      >
        <BookmarkCheck className="h-3 w-3 text-primary" aria-hidden />
        <span className="max-w-[140px] truncate">{activeView?.name ?? "View"}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs">Saved views</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {views.length === 0 ? (
          <div className="px-2 py-2 text-[11px] text-muted-foreground">
            No views yet. Configure filters, then save.
          </div>
        ) : (
          views.map((v) => (
            <DropdownMenuItem
              key={v.id}
              onClick={() => applyView(v)}
              className="group text-xs"
            >
              <span className="flex-1 truncate">{v.name}</span>
              {activeView?.id === v.id ? (
                <Check className="h-3 w-3 text-primary" aria-hidden />
              ) : null}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteView(v);
                }}
                className="ml-1 hidden rounded p-0.5 text-muted-foreground hover:bg-black/[0.05] hover:text-foreground group-hover:inline-flex"
                aria-label={`Delete view ${v.name}`}
              >
                <Trash2 className="h-3 w-3" aria-hidden />
              </button>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={saveCurrent} className="text-xs">
          <Plus className="h-3 w-3" aria-hidden />
          Save current filters
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
