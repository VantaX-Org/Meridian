"use client";

/**
 * Shared button action helpers for the Meridian surfaces.
 *
 * Three kinds of placeholder buttons exist across the dashboard:
 *
 *  1. Actions that *should* work but don't have a backend endpoint yet
 *     (e.g. "Schedule report", "Upgrade plan", "Share"). These fire a
 *     friendly toast so clicks aren't silent.
 *
 *  2. View-state actions (e.g. "Save view", "Bookmark") — persisted to
 *     `localStorage` and surfaced via toast.
 *
 *  3. "Copy ID / share link" actions — uses the Clipboard API.
 *
 * Every helper here is intentionally tiny so pages can just `onClick={fn}`
 * without ceremony.
 */

import { toast } from "sonner";

export function comingSoon(label?: string) {
  toast.info(label ? `${label} — coming soon` : "Coming soon", {
    description: "This action will be wired up once the backend endpoint lands.",
  });
}

export function notImplemented() {
  toast.info("Not implemented yet");
}

export function saveView(routeKey: string, state: Record<string, unknown>) {
  try {
    localStorage.setItem(`mn.savedView.${routeKey}`, JSON.stringify(state));
    toast.success("View saved", { description: "Filters restored on your next visit." });
  } catch {
    toast.error("Could not save view");
  }
}

export function loadView<T extends Record<string, unknown>>(routeKey: string): T | null {
  try {
    const raw = localStorage.getItem(`mn.savedView.${routeKey}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function copyToClipboard(text: string, label = "Copied to clipboard") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  } catch {
    toast.error("Could not copy");
  }
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    toast.info("Nothing to export");
    return;
  }
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const body = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");

  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"}`);
}
