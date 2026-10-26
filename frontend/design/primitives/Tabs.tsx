"use client";

import { useState, type ReactNode } from "react";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { Badge } from "./Badge";
import { Select } from "./Select";

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
  /** Optional neutral count shown after the label. */
  count?: number;
}

/**
 * A tab strip over its panels. Below 640px the strip would wrap or run off the screen, so a Select named
 * `label` picks the panel instead and the strip steps aside (CSS only: both share one value, nothing remounts).
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
      <BaseTabs.List className="m-tabs-list max-sm:hidden">
        {items.map((item) => (
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
        <BaseTabs.Indicator
          className="m-tab-indicator m-motion-slide"
          style={{ width: "var(--active-tab-width)", transform: "translateX(var(--active-tab-left))" }}
        />
      </BaseTabs.List>
      {items.map((item) => (
        <BaseTabs.Panel key={item.value} value={item.value} className="pt-4">
          {item.content}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  );
}
