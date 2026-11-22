"use client";

import { useState } from "react";

/**
 * Pill at the foot of every screen. Typing and sending, or pressing the open button, hands over to the one Aletheia sheet.
 * Takes translated strings; the page scope shows as the small label inside the pill.
 */
export function AletheiaDock({ scope, placeholder, inputLabel, send, onAsk, onOpen }: { scope: string; placeholder: string; inputLabel: string; send: string; onAsk: (q: string) => void; onOpen: () => void }) {
  const [q, setQ] = useState("");
  return (
    <form className="mx-dock" role="search" aria-label={inputLabel} onSubmit={(e) => { e.preventDefault(); const v = q.trim(); setQ(""); if (v) onAsk(v); else onOpen(); }}>
      <span className="mx-dock-scope">{scope}</span>
      <input className="mx-dock-in" aria-label={inputLabel} placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => { if (!q) onOpen(); }} />
      <button type="submit" className="mx-dock-go">{send}</button>
    </form>
  );
}
