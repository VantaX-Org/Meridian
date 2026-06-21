"use client";

import { useEffect, useState } from "react";

// `beforeinstallprompt` is non-standard and absent from lib.dom types.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Auto-install affordance for the admin portal PWA. Browsers forbid a truly
// silent install — prompt() must run inside a user gesture — so "auto" here means
// the banner appears the instant the portal becomes installable; one click installs.
export default function PwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const onPrompt = (e: Event) => {
      e.preventDefault(); // stop Chrome's mini-infobar; we drive the prompt ourselves
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!deferred || dismissed) return null;

  const install = async () => {
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  };

  return (
    <div
      role="dialog"
      aria-label="Install Meridian HQ"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg"
      style={{ background: "var(--card, #111726)", border: "1px solid var(--border)" }}
    >
      <span className="text-sm text-white">Install Meridian HQ as an app</span>
      <button
        type="button"
        onClick={install}
        className="rounded px-3 py-1.5 text-xs font-semibold text-white"
        style={{ background: "var(--primary)" }}
      >
        Install
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="rounded px-2 py-1 text-xs"
        style={{ color: "var(--muted)" }}
      >
        Not now
      </button>
    </div>
  );
}
