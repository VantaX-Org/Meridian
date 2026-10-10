"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { useRole } from "../../hooks/use-role";
import { Button } from "./Button";
import { Menu } from "./Menu";

export type ExportFormat = "xlsx" | "csv" | "pdf";

export interface ExportOption {
  format: ExportFormat;
  label?: string;
  run: () => Promise<void>;
}

export interface ExportMenuProps {
  options: ExportOption[];
  size?: "sm" | "md";
  disabled?: boolean;
}

const DEFAULT_LABEL: Record<ExportFormat, string> = {
  xlsx: "Excel (.xlsx)",
  csv: "CSV",
  pdf: "PDF",
};

/** Export affordance: a single "Export" button, or a menu when there is more than one option. Hidden for viewers. */
export function ExportMenu({ options, size, disabled }: ExportMenuProps) {
  const { can } = useRole();
  const [busy, setBusy] = useState(false);

  if (!can("export") || options.length === 0) return null;

  const runOption = async (option: ExportOption) => {
    setBusy(true);
    try {
      await option.run();
      toast.success("Download started");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const triggerClassName = size === "sm" ? "text-[12px] px-2 py-1" : undefined;
  const label = busy ? "Preparing" : "Export";

  if (options.length === 1) {
    const option = options[0];
    return (
      <Button
        variant="secondary"
        className={triggerClassName}
        disabled={disabled || busy}
        aria-busy={busy}
        onClick={() => void runOption(option)}
      >
        {label}
      </Button>
    );
  }

  return (
    <Menu
      trigger={
        <Button variant="secondary" className={triggerClassName} disabled={disabled || busy} aria-busy={busy}>
          {label}
          {!busy && <ChevronDown size={14} />}
        </Button>
      }
      items={options.map((option) => ({
        label: option.label ?? DEFAULT_LABEL[option.format],
        onSelect: () => void runOption(option),
      }))}
    />
  );
}

/** Wraps real options so each one resolves immediately with the empty-table toast instead of calling the API. */
export function emptyExportOptions(options: ExportOption[]): ExportOption[] {
  return options.map((option) => ({
    ...option,
    run: async () => {
      toast.error("Nothing to export");
    },
  }));
}
