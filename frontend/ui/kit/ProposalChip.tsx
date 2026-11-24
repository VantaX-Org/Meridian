"use client";

import { useRef, useState, type ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { EvidencePopover } from "./Evidence";

export interface RejectReason { id: string; label: string }

/**
 * One proposed fix: the current value struck through, the proposed value in violet (Aletheia's colour), the confidence as text.
 * With focus on the chip: A accepts, R opens the reason menu, E edits, I opens the evidence. The same four actions are buttons.
 * Evidence parts are shown only when passed; the chip never makes any up.
 */
export function ProposalChip({ current, proposed, confidence, reasons, evidence, onAccept, onReject, onEdit }: {
  current: string; proposed: string;
  /** Already translated, for example "92 out of 100". Omit when the engine gave none. */
  confidence?: string | null;
  reasons: RejectReason[];
  evidence?: { source?: string | null; confidence?: number | null; reason?: string | null; records?: string[] | null };
  onAccept: () => void; onReject: (reasonId: string) => void; onEdit: () => void;
}) {
  const [menu, setMenu] = useState<"reject" | "evidence" | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const key = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target !== e.currentTarget) return;
    const k = e.key.toLowerCase();
    if (k === "a") { e.preventDefault(); onAccept(); }
    else if (k === "r") { e.preventDefault(); setMenu("reject"); }
    else if (k === "e") { e.preventDefault(); onEdit(); }
    else if (k === "i") { e.preventDefault(); setMenu((m) => (m === "evidence" ? null : "evidence")); }
    else if (k === "escape" && menu) { e.stopPropagation(); setMenu(null); }
  };
  const act = (label: string, run: () => void, extra?: ReactNode) => <button type="button" className="mx-btn" data-variant="ghost" onClick={run}>{label}{extra}</button>;
  return (
    <span ref={root} className="mx-proposal" tabIndex={0} role="group" aria-label={t("Proposed fix: {from} to {to}", { from: current, to: proposed })} onKeyDown={key}>
      <del className="mx-proposal-cur">{current}</del>
      <ins className="mx-proposal-new">{proposed}</ins>
      {confidence ? <span className="mx-proposal-conf">{confidence}</span> : null}
      <span className="mx-proposal-acts">
        {act(t("Accept"), onAccept)}
        {act(t("Reject"), () => setMenu("reject"))}
        {act(t("Edit"), onEdit)}
        {evidence ? act(t("Evidence"), () => setMenu((m) => (m === "evidence" ? null : "evidence"))) : null}
      </span>
      {menu === "reject" ? (
        <ul className="mx-proposal-menu" role="menu" aria-label={t("Why reject")}>
          {reasons.map((r) => <li key={r.id} role="none"><button type="button" role="menuitem" className="mx-btn" data-variant="ghost" onClick={() => { setMenu(null); onReject(r.id); }}>{r.label}</button></li>)}
        </ul>
      ) : null}
      {menu === "evidence" && evidence ? <EvidencePopover {...evidence} onClose={() => { setMenu(null); root.current?.focus(); }} /> : null}
    </span>
  );
}
