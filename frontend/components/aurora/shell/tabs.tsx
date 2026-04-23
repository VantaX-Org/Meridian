/**
 * Aurora <Tabs> — WS4.
 *
 * Horizontal tab bar used at the top of Workbench lists, record drawers,
 * and Admin tab sections. Consumers own active-tab state; this primitive
 * is purely presentational.
 *
 * Active tab is indicated by an accent underline that slides between tabs
 * in `fast` under standard motion (disabled under reduced-motion — the
 * underline snaps). Tab labels use the UI font; counts render in a
 * tabular pill.
 */

"use client";

import {
  useCallback,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { clsx } from "../primitives/internal";

export interface TabsItem<TValue extends string = string> {
  id: TValue;
  label: ReactNode;
  count?: number;
  disabled?: boolean;
  icon?: ReactNode;
}

export interface TabsProps<TValue extends string = string> {
  items: ReadonlyArray<TabsItem<TValue>>;
  value: TValue;
  onValueChange: (value: TValue) => void;
  /** ARIA label for the tablist. */
  ariaLabel: string;
  className?: string;
}

export function Tabs<TValue extends string = string>({
  items,
  value,
  onValueChange,
  ariaLabel,
  className,
}: TabsProps<TValue>) {
  const activeIndex = useMemo(
    () => items.findIndex((item) => item.id === value),
    [items, value],
  );

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectAt = useCallback(
    (targetIndex: number) => {
      const item = items[targetIndex];
      if (!item || item.disabled) return;
      onValueChange(item.id);
      // Move DOM focus to the newly selected tab so subsequent arrow presses
      // fire from the new index. Required by WAI-ARIA roving-tabindex.
      tabRefs.current[targetIndex]?.focus();
    },
    [items, onValueChange],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const dir = event.key === "ArrowRight" ? 1 : -1;
      for (let i = 1; i <= items.length; i += 1) {
        const next = (index + dir * i + items.length) % items.length;
        if (!items[next].disabled) {
          selectAt(next);
          break;
        }
      }
    } else if (event.key === "Home") {
      event.preventDefault();
      const first = items.findIndex((item) => !item.disabled);
      if (first >= 0) selectAt(first);
    } else if (event.key === "End") {
      event.preventDefault();
      for (let i = items.length - 1; i >= 0; i -= 1) {
        if (!items[i].disabled) {
          selectAt(i);
          break;
        }
      }
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={clsx("aurora-tabs", className)}
    >
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`aurora-tabpanel-${item.id}`}
            id={`aurora-tab-${item.id}`}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            className={clsx("aurora-tabs__tab", "aurora-focus-ring")}
            data-selected={selected ? "true" : undefined}
            onClick={() => onValueChange(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.icon ? <span className="aurora-tabs__icon">{item.icon}</span> : null}
            <span>{item.label}</span>
            {item.count !== undefined ? (
              <span className="aurora-tabs__count" data-numeric="true">
                {formatCount(item.count)}
              </span>
            ) : null}
          </button>
        );
      })}
      <div
        className="aurora-tabs__underline"
        data-visible={activeIndex >= 0 ? "true" : undefined}
      />
    </div>
  );
}

function formatCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return count.toString();
}
