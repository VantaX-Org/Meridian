"use client";

import { useState } from "react";
import { useAuth } from "@/context/auth-context";
import { AuthFrame } from "@/components/auth/auth-frame";
import { TwoFactorSetup } from "@/components/auth/two-factor-setup";
import { Button } from "@/design";

/**
 * Blocking screen after sign-in when the organisation requires two-factor sign-in and this account has none
 * (`must_enrol_2fa`). Until it is set up the session reaches only the set-up routes (the API refuses the rest),
 * so nothing else renders. The new session is stored when the code is accepted; the screen stays up until the
 * recovery codes are saved.
 */
export function ForceTwoFactorSetup() {
  const { user, logout, completeTwoFactorEnrolment } = useAuth();
  const [token, setToken] = useState<string | null>(null);

  return (
    <AuthFrame title="Set up two-factor sign-in to continue"
      lead={<>You are signed in as {user?.email}. Your organisation asks for a code from an authenticator app each time you sign in.</>}>
      <TwoFactorSetup
        onConfirmed={setToken}
        onDone={() => { if (token) completeTwoFactorEnrolment(token); }}
        doneLabel="Continue to Meridian"
      />
      {token ? null : (
        <div>
          <Button type="button" variant="ghost" onClick={logout}>Sign out</Button>
        </div>
      )}
    </AuthFrame>
  );
}
