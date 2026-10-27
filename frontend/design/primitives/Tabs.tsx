"use client";

import { useState, type ReactNode } from "react";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { Badge } from "./Badge";
import { Menu } from "./Menu";
import { Select } from "./Select";
import { IconChevronDown } from "../icons";

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
  /** Optional neutral count shown after the label. */
  count?: number;
  /** Kept out of the strip: listed under one "More" menu at its end (the phone Select still lists every item). */
  overflow?: boolean;
}

/**
 * A tab strip over its panels. Below 640px the strip would wrap or run off the screen, so a Select named
 * `label` picks the panel instead and the strip steps aside (CSS only: both share one value, nothing remounts).
 * Items marked `overflow` sit under one "More" menu after the strip, so a detail page keeps five tabs or fewer in
 * view; while one of them is open the menu's trigger names it and carries the selected style.
 */
export function Tabs({
  items, value, defaultValue, onValueChange, onTabHover, label = "Section",
}: {
  items: TabItem[]; value?: string; defaultValue?: string; onValueChange?: (value: string) => void;
  /** Fired on pointer enter and focus of a tab trigger, e.g. to prefetch that tab's data. */
  onTabHover?: (value: string) => void;
  /** Accessible name of the Select that stands in for the strip below 640px. */
  label?: string;
}) {
  // `value` makes this controlled (so a client-side URL change can switch tabs after mount); omit it and the
  // tabs keep their own state from `defaultValue`. Either way the strip and the phone Select read the same value.
  const [own, setOwn] = useState(defaultValue ?? items[0]?.value ?? "");
  const current = value ?? own;
  const change = (v: string) => {
    setOwn(v);
    onValueChange?.(v);
  };
  const strip = items.filter((i) => !i.overflow);
  const more = items.filter((i) => i.overflow);
  const openOverflow = more.find((i) => i.value === current);
  return (
    <BaseTabs.Root value={current} onValueChange={(v) => change(v as string)}>
      <div className="sm:hidden" data-testid="tabs-select">
        <Select
          label={label}
          value={current}
          onValueChange={(v) => { if (v) change(v); }}
          options={items.map((i) => ({ value: i.value, label: i.count ? `${i.label} (${i.count.toLocaleString()})` : i.label }))}
          className="m-input inline-flex w-full items-center justify-between gap-2"
        />
      </div>
      <div className="m-tabs-bar max-sm:hidden">
        <BaseTabs.List className="m-tabs-list max-sm:hidden">
          {strip.map((item) => (
            <BaseTabs.Tab
              key={item.value}
              value={item.value}
              className="m-tab m-motion-colors"
              onPointerEnter={() => onTabHover?.(item.value)}
              onFocus={() => onTabHover?.(item.value)}
            >
              {item.label}
              {item.count !== undefined && item.count > 0 && <span className="m-tab-count"><Badge count={item.count} tone="neutral" /></span>}
            </BaseTabs.Tab>
          ))}
          {/* With an overflow item open no strip tab is selected, so there is no indicator to draw. */}
          {openOverflow ? null : (
            <BaseTabs.Indicator
              className="m-tab-indicator m-motion-slide"
              style={{ width: "var(--active-tab-width)", transform: "translateX(var(--active-tab-left))" }}
            />
          )}
        </BaseTabs.List>
        {more.length > 0 ? (
          <Menu
            trigger={
              <button
                type="button"
                className="m-tab m-tab-more m-motion-colors"
                data-selected={openOverflow ? "" : undefined}
                aria-label={openOverflow ? `More sections, ${openOverflow.label} open` : "More sections"}
              >
                {openOverflow ? `More: ${openOverflow.label}` : "More"}
                <IconChevronDown size={14} />
              </button>
            }
            items={more.map((i) => ({ label: i.label, onSelect: () => change(i.value) }))}
          />
        ) : null}
      </div>
      {items.map((item) => (
        <BaseTabs.Panel key={item.value} value={item.value} className="pt-4">
          {item.content}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  );
}
