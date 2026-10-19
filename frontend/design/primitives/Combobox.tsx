"use client";

import { Combobox as BaseCombobox } from "@base-ui/react/combobox";

export interface ComboboxOption {
  value: string;
  label: string;
}

export function Combobox({
  value, onValueChange, options, placeholder,
}: { value: string; onValueChange: (v: string) => void; options: ComboboxOption[]; placeholder?: string }) {
  return (
    <BaseCombobox.Root items={options} value={value} onValueChange={(v) => onValueChange(String(v ?? ""))}>
      <BaseCombobox.Input
        placeholder={placeholder}
        className="m-input"
      />
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner className="z-50">
          <BaseCombobox.Popup className="m-popup">
            <BaseCombobox.List>
              {(option: ComboboxOption) => (
                <BaseCombobox.Item key={option.value} value={option.value} className="m-popup-item">
                  {option.label}
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
