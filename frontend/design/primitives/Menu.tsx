"use client";

import type { ReactNode } from "react";
import { Menu as BaseMenu } from "@base-ui/react/menu";

export interface MenuItemDef {
  label: string;
  onSelect: () => void;
}

export function Menu({ trigger, items }: { trigger: ReactNode; items: MenuItemDef[] }) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger>{trigger}</BaseMenu.Trigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner>
          <BaseMenu.Popup className="rounded border shadow-sm py-1" style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)" }}>
            {items.map((item) => (
              <BaseMenu.Item key={item.label} onClick={item.onSelect} className="px-3 py-1.5 text-[13px] cursor-pointer">
                {item.label}
              </BaseMenu.Item>
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
