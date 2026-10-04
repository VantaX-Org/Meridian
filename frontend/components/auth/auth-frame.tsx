"use client";

/**
 * Frame for the signed-out pages: sign in, forgot and reset password,
 * accept invite, licence error. Form on the left, plain facts on the right.
 */

import { useState, type ReactNode } from "react";
import { MeridianMark } from "@/components/meridian/icons";
import { Button, Field, Input } from "@/components/ui-core";
import { useAuroraPrefs } from "@/hooks/use-theme";

export function AuthFrame({ title, lead, side, children }: { title: string; lead?: ReactNode; side?: ReactNode; children: ReactNode }) {
  useAuroraPrefs(); // signed-out pages follow the theme picked in the app
  return (
    <div className={side ? "ui-auth" : "ui-auth ui-auth__single"}>
      <main className="ui-auth__main">
        <div className="ui-auth__form">
          <div className="ui-auth__brand"><MeridianMark size={20} className="ui-auth__mark" aria-hidden /> Meridian</div>
          <h1 className="ui-auth__title">{title}</h1>
          {lead ? <p className="ui-auth__lead">{lead}</p> : null}
          {children}
        </div>
      </main>
      {side ? <aside className="ui-auth__side">{side}</aside> : null}
    </div>
  );
}

/** Password input with a Show/Hide toggle. */
export function PasswordField({ label, value, onChange, autoComplete, helper }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete: "current-password" | "new-password"; helper?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} helper={helper} required>
      {({ controlId }) => (
        <div className="ui-password">
          <Input id={controlId} type={show ? "text" : "password"} required autoComplete={autoComplete}
            value={value} onChange={(e) => onChange(e.target.value)} />
          <Button type="button" size="sm" variant="ghost" aria-pressed={show} onClick={() => setShow((v) => !v)}>
            {show ? "Hide" : "Show"}
          </Button>
        </div>
      )}
    </Field>
  );
}
