"use client";

import { useEffect, useState } from "react";
import "../design/tokens.css";
import "../design/global-error.css";
import { clientErrorId, reportClientError } from "@/lib/client-errors";
import { Attribution } from "@/design/brand/Attribution";
import { themeBootScript } from "@/lib/theme";

// Replaces the root layout, so there is no shell, no Tailwind and no design primitives here: plain elements
// styled by design/global-error.css, which reads tokens.css variables only.
const THEME_SCRIPT = themeBootScript();

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
      <body className="m-ge-body">
        <main id="main" className="m-ge-main">
          <div role="alert" className="m-ge-card" data-tone="critical">
            <h1 className="m-ge-title">This page hit an error</h1>
            <p className="m-ge-ref">
              Reference <span className="m-ge-mono">{reference}</span>
            </p>
            <div className="m-ge-actions">
              <button type="button" className="m-ge-btn m-ge-btn-primary" onClick={() => reset()}>Try again</button>
              <a href="/home" className="m-ge-link">Go home</a>
              <button type="button" className="m-ge-link" onClick={copyDetails}>Copy details</button>
              <span role="status" className="m-ge-status">
                {copied === "done" ? "Details copied" : copied === "failed" ? "Could not copy details" : ""}
              </span>
            </div>
          </div>
        </main>
        <Attribution />
      </body>
    </html>
  );
}
