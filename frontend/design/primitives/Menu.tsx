"use client";

import { isValidElement, type ReactElement, type ReactNode } from "react";
import { Menu as BaseMenu } from "@base-ui/react/menu";

export interface MenuItemDef {
  label: string;
  onSelect: () => void;
  /** When defined, the item is a checkbox item that stays open on select. */
  checked?: boolean;
  /** A small accent dot after the label, for "something new here". */
  dot?: boolean;
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
                  <span>{item.label}</span>
                  {item.dot && (
                    <>
                      <span aria-hidden className="inline-block rounded-full" style={{ width: 6, height: 6, background: "var(--m-accent)" }} />
                      <span className="sr-only">(new)</span>
                    </>
                  )}
                </BaseMenu.Item>
              ) : (
                <BaseMenu.CheckboxItem key={item.label} checked={item.checked} onCheckedChange={item.onSelect} closeOnClick={false} className="m-popup-item">
                  <span aria-hidden className="inline-block w-4">
                    {item.checked && (
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 4.2 3.2 6.4 7 1.6" />
                      </svg>
                    )}
                  </span>
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
