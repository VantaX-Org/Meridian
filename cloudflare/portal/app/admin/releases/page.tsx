"use client";

import { useEffect, useState } from "react";

interface PlatformRelease {
  id: number;
  latest_version: string;
  release_notes: string;
  released_at: string | null;
  updated_at: string;
}

export default function ReleasesPage() {
  const [form, setForm] = useState({ latest_version: "", release_notes: "" });
  const [release, setRelease] = useState<PlatformRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const inputStyle = {
    background: "var(--background)",
    border: "1px solid var(--border)",
  };

  const showMsg = (m: string) => {
    setMessage(m);
    setTimeout(() => setMessage(""), 4000);
  };

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch("/api/admin/releases", { cache: "no-store" });
        if (!resp.ok) {
          const data = await resp.json() as { message?: string };
          throw new Error(data.message || "Failed to load release info");
        }
        const data = await resp.json() as PlatformRelease;
        setRelease(data);
        setForm({
          latest_version: data.latest_version || "",
          release_notes: data.release_notes || "",
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load release info");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const resp = await fetch("/api/admin/releases", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!resp.ok) {
        const data = await resp.json() as { message?: string };
        throw new Error(data.message || "Failed to update release");
      }
      const data = await resp.json() as PlatformRelease;
      setRelease(data);
      setForm({
        latest_version: data.latest_version || "",
        release_notes: data.release_notes || "",
      });
      showMsg("Saved successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update release");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Releases</h1>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          Sets the platform version every customer deployment is told about via
          the licence check, so admins can be prompted to trigger a one-click update.
        </p>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div
            className="rounded-lg p-5 space-y-4"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <div className="space-y-1">
              <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>
                Latest Version
              </label>
              <input
                type="text"
                required
                placeholder="e.g. 2.4.1"
                value={form.latest_version}
                onChange={(e) => setForm({ ...form, latest_version: e.target.value })}
                className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none"
                style={inputStyle}
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>
                Release Notes
              </label>
              <textarea
                rows={6}
                value={form.release_notes}
                onChange={(e) => setForm({ ...form, release_notes: e.target.value })}
                className="w-full rounded-md px-3 py-2 text-sm text-white outline-none resize-none"
                style={inputStyle}
              />
            </div>

            {release?.released_at && (
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Last published: {new Date(release.released_at).toLocaleString("en-ZA")}
              </p>
            )}
          </div>

          {error && (
            <p className="text-sm" style={{ color: "var(--aurora-status-danger-500)" }}>
              {error}
            </p>
          )}
          {message && (
            <p className="text-sm" style={{ color: "var(--aurora-status-success-500)" }}>
              {message}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md px-5 py-2 text-sm font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-90"
              style={{ background: "var(--primary)" }}
            >
              {saving ? "Publishing…" : "Publish"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
