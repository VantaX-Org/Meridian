"use client";

import { createContext, useContext, useState } from "react";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import { apiErrorMessage } from "../../lib/error";
import { useRole } from "../../hooks/use-role";
import { Button } from "./Button";
import { Menu } from "./Menu";
import { IconChevronDown } from "../icons";

export type ExportFormat = "xlsx" | "csv" | "pdf" | "json";

const DEFAULT_LABEL: Record<ExportFormat, string> = {
  xlsx: "Excel (.xlsx)",
  csv: "CSV",
  pdf: "PDF",
  json: "JSON",
};

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

/** Runs one option with the shared toasts: success unless the option is an empty placeholder, the server's error on failure. */
export async function runExportOption(option: ExportOption): Promise<void> {
  try {
    await option.run();
    if (!option.empty) toast.success("Download started");
  } catch (err) {
    toast.error(exportErrorMessage(err));
  }
}

export function exportOptionLabel(option: ExportOption): string {
  return option.label ?? DEFAULT_LABEL[option.format];
}

/** ReportPage provides true, so an ExportMenu inside a report page gains a "Print" item (window.print(); design/print.css shapes the paper). */
export const ReportPrintContext = createContext(false);

export interface ExportMenuProps {
  options: ExportOption[];
  size?: "sm" | "md";
  disabled?: boolean;
}

/** Export affordance: a single "Export" button, or a menu when there is more than one option. Hidden for viewers,
 * except that on a report page everyone keeps "Print". */
export function ExportMenu({ options, size, disabled }: ExportMenuProps) {
  const { can } = useRole();
  const printable = useContext(ReportPrintContext);
  const [busy, setBusy] = useState(false);

  const canExport = can("export");
  const exportOptions = canExport ? options : [];
  if (exportOptions.length === 0 && !printable) return null;

  const runOption = async (option: ExportOption) => {
    setBusy(true);
    try {
      await runExportOption(option);
    } finally {
      setBusy(false);
    }
  };

  // self-start: in a column flex parent the button would otherwise stretch to full width.
  const triggerClassName = size === "sm" ? "self-start m-text-meta px-2 py-1" : "self-start";
  const label = busy ? "Preparing" : "Export";
  const print = () => window.print();

  if (exportOptions.length === 0) {
    return (
      <Button variant="secondary" className={triggerClassName} disabled={disabled} onClick={print}>
        Print
      </Button>
    );
  }

  if (exportOptions.length === 1 && !printable) {
    const option = exportOptions[0];
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
          {!busy && <IconChevronDown size={14} />}
        </Button>
      }
      items={[
        ...exportOptions.map((option) => ({
          label: exportOptionLabel(option),
          onSelect: () => void runOption(option),
        })),
        ...(printable ? [{ label: "Print", onSelect: print }] : []),
      ]}
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
