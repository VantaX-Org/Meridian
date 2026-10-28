"use client";

import { Button } from "@/design";
import { ssoStartHref } from "./sso";

/**
 * "Continue with <provider>" above the password form. A plain link, not a client-side route: the server answers with
 * a redirect to the identity provider.
 */
export function SsoSignInButton({ displayName, next }: { displayName: string; next: string | null }) {
  return (
    <div className="flex flex-col gap-3">
      <Button variant="secondary" className="w-full" render={<a href={ssoStartHref(next)}>Continue with {displayName}</a>} />
    </div>
  );
}
