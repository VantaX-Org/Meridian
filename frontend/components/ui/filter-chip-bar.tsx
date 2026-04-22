"use client";

import { useMemo } from "react";
import { X, Filter } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface FilterGroup {
  key: string;
  label: string;
  options: ReadonlyArray<FilterOption>;
  /** Selected values for this group. */
  selected: string[];
  /** Fires with the full next selection for this group. */
  onChange: (next: string[]) => void;
  /** When true, only one option may be selected at a time. */
  single?: boolean;
}

export interface FilterChipBarProps {
  groups: ReadonlyArray<FilterGroup>;
  className?: string;
  /** Optional right-hand slot — commonly an export or "save view" control. */
  right?: React.ReactNode;
}

function toggle<T>(arr: ReadonlyArray<T>, item: T): T[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

/**
 * Horizontal bar of filter chips. Each group is represented by a chip that
 * opens a popover of checkbox options; selected values render as removable
 * sub-chips inline. All selections are expected to be URL-synced by the
 * parent via `useUrlMultiState` so deep-links and SavedViews work.
 */
export function FilterChipBar({ groups, className, right }: FilterChipBarProps) {
  const totalSelected = useMemo(
    () => groups.reduce((sum, g) => sum + g.selected.length, 0),
    [groups],
  );

  const clearAll = () => {
    groups.forEach((g) => g.onChange([]));
  };

  return (
    <div
      role="toolbar"
      aria-label="Filters"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      <div className="flex items-center gap-1.5 rounded-full bg-white/[0.60] px-2.5 py-1 text-xs text-muted-foreground">
        <Filter className="h-3 w-3" aria-hidden />
        Filters
      </div>

      {groups.map((group) => {
        const selectedSet = new Set(group.selected);
        const label =
          group.selected.length === 0
            ? group.label
            : `${group.label} · ${group.selected.length}`;
        return (
          <DropdownMenu key={group.key}>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    group.selected.length === 0
                      ? "border-black/[0.08] bg-white/[0.60] text-muted-foreground hover:text-foreground"
                      : "border-primary/20 bg-primary/10 text-primary",
                  )}
                />
              }
            >
              {label}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-xs">{group.label}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {group.options.map((opt) => (
                  <DropdownMenuCheckboxItem
                    key={opt.value}
                    checked={selectedSet.has(opt.value)}
                    onCheckedChange={() => {
                      const next = group.single
                        ? selectedSet.has(opt.value)
                          ? []
                          : [opt.value]
                        : toggle(group.selected, opt.value);
                      group.onChange(next);
                    }}
                    className="text-xs"
                  >
                    <span className="truncate">{opt.label}</span>
                    {opt.count !== undefined ? (
                      <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                        {opt.count}
                      </span>
                    ) : null}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}

      {/* Inline removable chips for each active selection */}
      {groups.flatMap((group) =>
        group.selected.map((val) => {
          const opt = group.options.find((o) => o.value === val);
          return (
            <button
              key={`${group.key}-${val}`}
              type="button"
              onClick={() => group.onChange(group.selected.filter((v) => v !== val))}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20"
            >
              <span className="truncate">{opt?.label ?? val}</span>
              <X className="h-3 w-3" aria-hidden />
            </button>
          );
        }),
      )}

      {totalSelected > 0 ? (
        <button
          type="button"
          onClick={clearAll}
          className="ml-1 text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Clear all
        </button>
      ) : null}

      {right ? <div className="ml-auto">{right}</div> : null}
    </div>
  );
}
