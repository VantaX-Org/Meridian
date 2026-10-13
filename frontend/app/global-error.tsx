"use client";

import { useEffect, useState, type CSSProperties } from "react";
import "../design/tokens.css";
import { clientErrorId, reportClientError } from "@/lib/client-errors";

// Replaces the root layout, so there is no shell, no Tailwind and no design primitives here:
// plain elements with inline styles that read tokens.css variables only.
const button: CSSProperties = {
  height: "var(--m-control-h)",
  padding: "0 var(--m-space-3)",
  borderRadius: "var(--m-radius-control)",
  fontFamily: "inherit",
  fontSize: "var(--m-text-body)",
  fontWeight: 500,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  textDecoration: "none",
};
const primary: CSSProperties = { ...button, background: "var(--m-accent)", color: "var(--m-accent-ink)", border: "1px solid var(--m-accent)" };
const secondary: CSSProperties = { ...button, background: "var(--m-sheet)", color: "var(--m-ink)", border: "1px solid var(--m-line-strong)" };
const ghost: CSSProperties = { ...button, background: "transparent", color: "var(--m-ink-2)", border: "1px solid transparent" };

const THEME_SCRIPT = `try{var t=localStorage.getItem("meridian:theme")||"light";if(t==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`;

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const reference = clientErrorId(error, error.digest);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  useEffect(() => {
    reportClientError(error, { digest: error.digest });
  }, [error]);

  const copyDetails = async () => {
    const details = JSON.stringify({ digest: reference, message: error.message, pathname: window.location.pathname, time: new Date().toISOString() }, null, 2);
    try {
      await navigator.clipboard.writeText(details);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <html lang="en">
      <head>
        <title>Meridian</title>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body style={{ margin: 0, background: "var(--m-canvas)", color: "var(--m-ink)", fontFamily: "var(--m-font-ui)", fontSize: "var(--m-text-body)", lineHeight: "var(--m-leading-body)" }}>
        <main
          id="main"
          style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--m-space-6)", boxSizing: "border-box" }}
        >
          <div
            role="alert"
            className="m-elev-1"
            style={{ maxWidth: 560, width: "100%", background: "var(--m-sheet)", borderRadius: "var(--m-radius-sheet)", borderTop: "3px solid var(--m-critical)", padding: "var(--m-space-6)", display: "flex", flexDirection: "column", gap: "var(--m-space-2)" }}
          >
            <h1 style={{ margin: 0, fontSize: "var(--m-text-section)", lineHeight: "var(--m-leading-section)", fontWeight: 600 }}>This page hit an error</h1>
            <p style={{ margin: 0, color: "var(--m-ink-2)" }}>
              Reference <span style={{ fontFamily: "var(--m-font-mono)" }}>{reference}</span>
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--m-space-2)", marginTop: "var(--m-space-2)" }}>
              <button type="button" style={primary} onClick={() => reset()}>Try again</button>
              <a href="/home" style={secondary}>Go home</a>
              <button type="button" style={ghost} onClick={copyDetails}>Copy details</button>
              <span role="status" style={{ color: "var(--m-ink-3)", fontSize: "var(--m-text-meta)" }}>
                {copied === "done" ? "Details copied" : copied === "failed" ? "Could not copy details" : ""}
              </span>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
