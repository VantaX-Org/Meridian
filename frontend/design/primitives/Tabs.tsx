"use client";

import type { ReactNode } from "react";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { Badge } from "./Badge";

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
  /** Optional neutral count shown after the label. */
  count?: number;
}

export function Tabs({
  items, value, defaultValue, onValueChange,
}: { items: TabItem[]; value?: string; defaultValue?: string; onValueChange?: (value: string) => void }) {
  // `value` makes this controlled (so a client-side URL change can switch tabs after
  // mount); omit it and it falls back to the original uncontrolled `defaultValue` behaviour.
  return (
    <BaseTabs.Root
      {...(value !== undefined ? { value } : { defaultValue: defaultValue ?? items[0]?.value })}
      onValueChange={(v) => onValueChange?.(v as string)}
    >
      <BaseTabs.List className="m-tabs-list">
        {items.map((item) => (
          <BaseTabs.Tab
            key={item.value}
            value={item.value}
            className="m-tab m-motion-colors"
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
