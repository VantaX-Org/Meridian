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
        className={className ?? "m-input inline-flex items-center justify-between gap-2 min-w-[160px]"}
      >
        <BaseSelect.Value placeholder={placeholder} />
        <ChevronDown size={14} />
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner>
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
                <BaseSelect.ItemIndicator><Check size={14} /></BaseSelect.ItemIndicator>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
