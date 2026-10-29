"use client";

import { Select as BaseSelect } from "@base-ui/react/select";
import { useEffect, useRef } from "react";
import { IconCheck, IconChevronDown } from "../icons";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * A combobox takes its accessible name from a label, never from the value or
 * placeholder it shows. Inside a Field or a wrapping <label> the name is wired
 * already; anywhere else pass `label`. Development builds warn when none of
 * the three name the trigger.
 */
export function Select({
  value, onValueChange, options, placeholder, label, className, disabled,
}: { value: string; onValueChange: (v: string) => void; options: SelectOption[]; placeholder?: string; label?: string; className?: string; disabled?: boolean }) {
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    // after a tick: a Field wires aria-labelledby on the render after its label registers
    const t = setTimeout(() => {
      const el = trigger.current;
      if (!el) return;
      const named = el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") || el.closest("label")
        || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
      if (!named) console.warn("Select has no accessible name: pass `label` or wrap it in a Field or <label>.", el);
    }, 0);
    return () => clearTimeout(t);
  }, []);
  return (
    <BaseSelect.Root value={value} onValueChange={(v) => onValueChange(v ?? "")} items={options} disabled={disabled}>
      <BaseSelect.Trigger
        ref={trigger}
        aria-label={label}
        className={className ?? "m-input inline-flex items-center justify-between gap-2 min-w-[160px]"}
      >
        <BaseSelect.Value placeholder={placeholder} className="min-w-0 truncate" />
        <IconChevronDown size={14} className="shrink-0" />
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="z-50">
          <BaseSelect.Popup
            className="m-popup"
          >
            {options.map((o) => (
              <BaseSelect.Item
                key={o.value}
                value={o.value}
                className="m-popup-item"
              >
                <BaseSelect.ItemText>{o.label}</BaseSelect.ItemText>
                <BaseSelect.ItemIndicator><IconCheck size={14} /></BaseSelect.ItemIndicator>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
