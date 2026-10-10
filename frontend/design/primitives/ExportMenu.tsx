"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import { apiErrorMessage } from "../../lib/error";
import { useRole } from "../../hooks/use-role";
import { Button } from "./Button";
import { Menu } from "./Menu";

export type ExportFormat = "xlsx" | "csv" | "pdf";

export interface ExportOption {
  format: ExportFormat;
  label?: string;
  run: () => Promise<void>;
  /** True for a placeholder option (see emptyExportOptions) — runOption shows its own toast and skips the success toast. */
  empty?: boolean;
}

/** The server's `detail` when there is one (even behind a blob response, via downloadBlob's rethrow),
 * else a generic fallback — never the raw Error/AxiosError message. */
function exportErrorMessage(err: unknown): string {
  if (isAxiosError(err)) return apiErrorMessage(err);
  if (err instanceof Error && err.message) return err.message;
  return "Export failed";
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
      if (!option.empty) toast.success("Download started");
    } catch (err) {
      toast.error(exportErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // self-start: in a column flex parent the button would otherwise stretch to full width.
  const triggerClassName = size === "sm" ? "self-start text-[12px] px-2 py-1" : "self-start";
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
    empty: true,
    run: async () => {
      toast.error("Nothing to export");
    },
  }));
}
