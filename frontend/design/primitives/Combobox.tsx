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
        className="rounded border px-3 py-1.5 text-[13px]"
        style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
      />
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner>
          <BaseCombobox.Popup className="rounded border shadow-sm py-1" style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)" }}>
            <BaseCombobox.List>
              {(option: ComboboxOption) => (
                <BaseCombobox.Item key={option.value} value={option.value} className="px-3 py-1.5 text-[13px] cursor-pointer">
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
