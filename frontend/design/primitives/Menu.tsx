"use client";

import { isValidElement, type ReactElement, type ReactNode } from "react";
import { Menu as BaseMenu } from "@base-ui/react/menu";

export interface MenuItemDef {
  label: string;
  onSelect: () => void;
  /** When defined, the item is a checkbox item that stays open on select. */
  checked?: boolean;
}

export function Menu({ trigger, items }: { trigger: ReactNode; items: MenuItemDef[] }) {
  return (
    <BaseMenu.Root>
      {/* An element trigger (Button, etc.) becomes the trigger itself; wrapping it would nest a button in a button. */}
      {isValidElement(trigger) ? <BaseMenu.Trigger render={trigger as ReactElement<Record<string, unknown>>} /> : <BaseMenu.Trigger>{trigger}</BaseMenu.Trigger>}
      <BaseMenu.Portal>
        <BaseMenu.Positioner>
          <BaseMenu.Popup className="m-popup">
            {items.map((item) =>
              item.checked === undefined ? (
                <BaseMenu.Item key={item.label} onClick={item.onSelect} className="m-popup-item">
                  {item.label}
                </BaseMenu.Item>
              ) : (
                <BaseMenu.CheckboxItem key={item.label} checked={item.checked} onCheckedChange={item.onSelect} closeOnClick={false} className="m-popup-item">
                  <span aria-hidden className="inline-block w-4">{item.checked ? "\u2713" : ""}</span>
                  {item.label}
                </BaseMenu.CheckboxItem>
              ),
            )}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
