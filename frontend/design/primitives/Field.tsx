import type { ReactNode } from "react";
import { Field as BaseField } from "@base-ui/react/field";

export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <BaseField.Root className="flex flex-col gap-1">
      <BaseField.Label className="text-[12px] leading-4" style={{ color: "var(--m-ink-2)" }}>
        {label}
      </BaseField.Label>
      {children}
      {error && (
        <BaseField.Error className="text-[12px] leading-4" style={{ color: "var(--m-critical)" }}>
          {error}
        </BaseField.Error>
      )}
    </BaseField.Root>
  );
}
