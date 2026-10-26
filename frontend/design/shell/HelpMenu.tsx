"use client";

import { useState } from "react";
import { IconButton } from "../primitives/IconButton";
import { Menu, type MenuItemDef } from "../primitives/Menu";
import { Dialog } from "../primitives/Dialog";
import { Button } from "../primitives/Button";
import { Textarea } from "../primitives/Textarea";
import { IconHelp } from "../icons";

export interface ReportContext {
  /** The page the person is on. */
  url: string;
  /** The selected run, when there is one. */
  runId?: string | null;
  /** The product version string. */
  version: string;
}

/** The text the person pastes into an e-mail or ticket. Nothing here leaves the browser unless they send it. */
export function reportText(ctx: ReportContext): string {
  return [`Page: ${ctx.url}`, `Run: ${ctx.runId || "none selected"}`, `Version: ${ctx.version}`].join("\n");
}

function ReportDialog({ open, onOpenChange, context, supportEmail }: { open: boolean; onOpenChange: (open: boolean) => void; context: ReportContext; supportEmail?: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const text = reportText(context);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) setCopied("idle"); onOpenChange(o); }}
      title="Report a problem"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Not now</Button>
          <Button variant="primary" onClick={() => void copy()}>Copy details</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {supportEmail ? (
          <p>Copy these details and send them to <strong className="font-medium m-ink">{supportEmail}</strong> with a sentence about what you expected. Nothing is sent from this page.</p>
        ) : (
          <p>Copy these details and send them to your support contact with a sentence about what you expected. Ask your administrator for the support address. Nothing is sent from this page.</p>
        )}
        <Textarea aria-label="Details" readOnly rows={3} value={text} onFocus={(e) => e.currentTarget.select()} />
        <p role="status" className="m-ink-3" style={{ minHeight: 18 }}>
          {copied === "done" ? "Copied to the clipboard" : copied === "failed" ? "Copying was blocked, select the text above and copy it" : ""}
        </p>
      </div>
    </Dialog>
  );
}

export interface HelpMenuProps {
  /** Show "Tour this page": the current route has a tour. */
  hasTour: boolean;
  onTour: () => void;
  onShortcuts: () => void;
  onWhatsNew: () => void;
  /** The newest release has not been seen yet. */
  hasNew: boolean;
  onDocs: () => void;
  context: ReportContext;
  /** The customer's support address (NEXT_PUBLIC_SUPPORT_EMAIL). Unset, the dialog says to ask the administrator. */
  supportEmail?: string;
}

/** The `?` button in the top bar: tour, shortcuts, what's new, documentation, report a problem. */
export function HelpMenu({ hasTour, onTour, onShortcuts, onWhatsNew, hasNew, onDocs, context, supportEmail }: HelpMenuProps) {
  const [reporting, setReporting] = useState(false);
  const items: MenuItemDef[] = [
    ...(hasTour ? [{ label: "Tour this page", onSelect: onTour }] : []),
    { label: "Keyboard shortcuts", onSelect: onShortcuts },
    { label: "What's new", onSelect: onWhatsNew, dot: hasNew },
    { label: "Documentation", onSelect: onDocs },
    { label: "Report a problem", onSelect: () => setReporting(true) },
  ];
  return (
    <>
      <Menu
        trigger={
          <IconButton aria-label={hasNew ? "Help, there is something new" : "Help"} data-tour="help-menu" style={{ position: "relative" }}>
            <IconHelp size={16} />
            {hasNew && <span aria-hidden data-testid="help-dot" className="absolute rounded-full" style={{ top: 6, right: 6, width: 6, height: 6, background: "var(--m-accent)" }} />}
          </IconButton>
        }
        items={items}
      />
      <ReportDialog open={reporting} onOpenChange={setReporting} context={context} supportEmail={supportEmail} />
    </>
  );
}
