"use client";

import { Select as BaseSelect } from "@base-ui/react/select";
import { ChevronDown, Check } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
}

export function Select({
  value, onValueChange, options, placeholder, className,
}: { value: string; onValueChange: (v: string) => void; options: SelectOption[]; placeholder?: string; className?: string }) {
  return (
    <BaseSelect.Root value={value} onValueChange={(v) => onValueChange(v ?? "")} items={options}>
      <BaseSelect.Trigger
        className={className ?? "inline-flex items-center justify-between gap-2 rounded border px-3 py-1.5 text-[13px] min-w-[160px]"}
        style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
      >
        <BaseSelect.Value placeholder={placeholder} />
        <ChevronDown size={14} />
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner>
          <BaseSelect.Popup
            className="rounded border shadow-sm py-1"
            style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)" }}
          >
            {options.map((o) => (
              <BaseSelect.Item
                key={o.value}
                value={o.value}
                className="flex items-center justify-between gap-2 px-3 py-1.5 text-[13px] cursor-pointer"
              >
                <BaseSelect.ItemText>{o.label}</BaseSelect.ItemText>
                <BaseSelect.ItemIndicator><Check size={14} /></BaseSelect.ItemIndicator>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
