"use client";

/**
 * Me › Preferences: two-factor sign-in for the signed-in user. Set it up with an authenticator app, see how many
 * recovery codes are left, or turn it off with the password and a code. While the organisation requires it, it
 * cannot be turned off here: an administrator resets it for someone who lost their phone.
 */

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Field, Notice, Pill, toast } from "@/design";
import { PasswordField } from "@/components/auth/auth-frame";
import { TwoFactorSetup, cleanCode } from "@/components/auth/two-factor-setup";
import { disableTwoFactor, getTwoFactorStatus } from "@/lib/api/auth";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

function TurnOffForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!password) return setError("Enter your password.");
    if (!cleanCode(code)) return setError("Enter a code from your app or a recovery code.");
    setSaving(true);
    try {
      await disableTwoFactor(password, cleanCode(code));
      toast.success("Two-factor sign-in is off");
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="flex max-w-md flex-col gap-3" onSubmit={onSubmit} noValidate>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
      <Field label="Code from the app or a recovery code">
        <input className="m-input w-full" inputMode="text" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <p className="m-text-meta m-ink-3">Turning it off signs you out everywhere else.</p>
      <div>
        <Button type="submit" variant="secondary" pending={saving}>Turn off</Button>
      </div>
    </form>
  );
}

export function TwoFactorCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: queryKeys.twoFactor(), queryFn: getTwoFactorStatus });
  const [settingUp, setSettingUp] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: queryKeys.twoFactor() });
  const s = q.data;

  return (
    <Card
      title="Two-factor sign-in"
      meta="A code from an authenticator app on your phone, asked for after your password"
      actions={s ? <Pill tone={s.enabled ? "go" : "neutral"}>{s.enabled ? "On" : "Off"}</Pill> : undefined}
    >
      {q.isError ? (
        <div className="flex items-center gap-3 m-text-body" role="alert">
          <span>{`Two-factor sign-in did not load. ${apiErrorMessage(q.error)}`}</span>
          <Button variant="secondary" onClick={() => void q.refetch()}>Retry</Button>
        </div>
      ) : !s ? (
        <p className="m-text-body m-ink-3">Checking your sign-in settings</p>
      ) : s.enabled ? (
        <div className="flex flex-col gap-3">
          <p className="m-text-body m-ink-2">
            {`You have ${s.recovery_codes_left.toLocaleString()} unused recovery ${s.recovery_codes_left === 1 ? "code" : "codes"}.`}
            {s.recovery_codes_left <= 2 ? " Ask an administrator to reset two-factor sign-in before you run out, then set it up again for new codes." : ""}
          </p>
          {s.required
            ? <Notice tone="info">Your organisation requires two-factor sign-in, so it stays on. If you lose your phone, an administrator can reset it.</Notice>
            : <TurnOffForm onDone={refresh} />}
        </div>
      ) : settingUp ? (
        // confirmTwoFactor has already stored the replacement session the API returned.
        <TwoFactorSetup
          onCancel={() => setSettingUp(false)}
          onDone={() => { setSettingUp(false); toast.success("Two-factor sign-in is on"); refresh(); }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {s.required ? <Notice tone="warning">Your organisation requires two-factor sign-in. Set it up now.</Notice> : null}
          <p className="m-text-body m-ink-2">Off. Anyone with your password can sign in as you.</p>
          <div>
            <Button variant="secondary" onClick={() => setSettingUp(true)}>Set up</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
