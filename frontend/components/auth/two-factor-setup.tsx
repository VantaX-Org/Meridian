"use client";

/**
 * Setting up two-factor sign-in, used by Me › Preferences and by the forced set-up after sign-in when the
 * organisation requires it. Three steps: get a setup key, confirm a code from the authenticator app, then the
 * ten recovery codes, shown this once. No QR image: the app takes the key typed in, or the otpauth:// link
 * opened on the phone (no QR library ships with the frontend).
 */

import { useState, type FormEvent } from "react";
import { Button, Checkbox, Field, Mono, Notice } from "@/design";
import { copyToClipboard } from "@/lib/actions";
import { confirmTwoFactor, startTwoFactorSetup, type TwoFactorSetup as Setup } from "@/lib/api/auth";
import { apiErrorMessage } from "@/lib/error";

/** "JBSW Y3DP ..." : the key in groups of four, the way authenticator apps print it. */
export function groupKey(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

/** Six digits, or a recovery code: what a code field accepts before it is sent. */
export function cleanCode(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}

function downloadText(filename: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function RecoveryCodes({ codes, onDone, doneLabel = "Done" }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false);
  const text = codes.join("\n");
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="warning" title="Save your recovery codes now">
        Each code signs you in once if you lose your phone. This is the only time Meridian shows them.
      </Notice>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1" aria-label="Recovery codes">
        {codes.map((c) => <li key={c}><Mono>{c}</Mono></li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => void copyToClipboard(text, "Recovery codes copied")}>Copy codes</Button>
        <Button type="button" variant="secondary" onClick={() => downloadText("meridian-recovery-codes.txt", `${text}\n`)}>Download codes</Button>
      </div>
      <label className="flex items-center gap-2 m-text-body">
        <Checkbox aria-label="I have saved my recovery codes" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I have saved my recovery codes</span>
      </label>
      <div>
        <Button type="button" disabled={!saved} onClick={onDone}>{doneLabel}</Button>
      </div>
    </div>
  );
}

/**
 * The set-up flow. `onConfirmed` gets the replacement session token as soon as the code is accepted (the API has
 * already stored it); `onDone` runs once the user has saved their recovery codes.
 */
export function TwoFactorSetup({ onConfirmed, onDone, onCancel, doneLabel }: {
  onConfirmed?: (token: string) => void;
  onDone: () => void;
  onCancel?: () => void;
  doneLabel?: string;
}) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      setSetup(await startTwoFactorSetup());
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const value = cleanCode(code);
    if (!/^\d{6}$/.test(value)) return setError("Enter the 6-digit code your app shows.");
    setBusy(true);
    try {
      const done = await confirmTwoFactor(value);
      onConfirmed?.(done.token);
      setCodes(done.recoveryCodes);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} doneLabel={doneLabel} />;

  if (!setup) {
    return (
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <p className="m-text-body m-ink-2">
          You need an authenticator app on your phone, such as Microsoft Authenticator, Google Authenticator or 1Password.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" pending={busy} onClick={() => void start()}>Get a setup key</Button>
          {onCancel ? <Button type="button" variant="ghost" onClick={onCancel}>Not now</Button> : null}
        </div>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={confirm} noValidate>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <ol className="flex list-decimal flex-col gap-3 pl-5 m-text-body">
        <li>
          <span>In your authenticator app, add an account and enter this setup key:</span>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <span data-testid="two-factor-key"><Mono>{groupKey(setup.secret)}</Mono></span>
            <Button type="button" size="sm" variant="ghost" onClick={() => void copyToClipboard(setup.secret, "Setup key copied")}>Copy key</Button>
          </span>
          <span className="mt-1 block m-text-meta m-ink-3">
            On the phone itself you can <a className="m-ink-accent underline underline-offset-2" href={setup.otpauth_uri}>open the setup link</a> instead.
          </span>
        </li>
        <li>
          <Field label="Code from the app">
            <input className="m-input w-40" inputMode="numeric" autoComplete="one-time-code" maxLength={7}
              placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
        </li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" pending={busy}>Turn on</Button>
        {onCancel ? <Button type="button" variant="ghost" onClick={onCancel}>Not now</Button> : null}
      </div>
    </form>
  );
}
