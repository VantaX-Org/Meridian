"use client";

import type { ReactNode } from "react";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
}

export function Tabs({
  items, defaultValue, onValueChange,
}: { items: TabItem[]; defaultValue?: string; onValueChange?: (value: string) => void }) {
  return (
    <BaseTabs.Root defaultValue={defaultValue ?? items[0]?.value} onValueChange={(v) => onValueChange?.(v as string)}>
      <BaseTabs.List className="flex gap-4 border-b" style={{ borderColor: "var(--m-line)" }}>
        {items.map((item) => (
          <BaseTabs.Tab
            key={item.value}
            value={item.value}
            className="py-2 text-[13px] leading-[18px] data-[selected]:font-semibold"
            style={{ color: "var(--m-ink)" }}
          >
            {item.label}
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
      {items.map((item) => (
        <BaseTabs.Panel key={item.value} value={item.value} className="pt-4">
          {item.content}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  );
}
