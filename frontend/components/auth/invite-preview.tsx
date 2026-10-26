"use client";

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Notice, Skeleton } from "@/design";
import { isAxiosError } from "axios";
import { getInvitePreview } from "@/lib/api/auth";
import { formatModuleName } from "@/lib/format";

/**
 * Shows who the invite is for and what access it grants, above the password form (`children`). An invalid or
 * expired invite shows why and no form, since a password set against it cannot succeed.
 */
export function InvitePreview({ children = null }: { children?: ReactNode }) {
  const token = useSearchParams().get("token") ?? "";
  const q = useQuery({ queryKey: ["invite-preview", token], queryFn: () => getInvitePreview(token), enabled: !!token, retry: false });
  // No token: the form itself says the link is missing its token.
  if (!token) return <>{children}</>;
  if (q.isPending) return <div aria-busy="true" className="mx-auto w-full max-w-md p-4"><Skeleton width="100%" height={64} /></div>;
  if (q.isError) {
    const limited = isAxiosError(q.error) && q.error.response?.status === 429;
    return (
      <div role="alert">
        <Notice tone={limited ? "warning" : "danger"}>
          {limited ? "Too many attempts. Try again in a minute." : "This invitation link is invalid or has expired."}
        </Notice>
        {limited ? null : <p className="m-text-body m-ink-2 mt-2">Ask your administrator to send a new invitation.</p>}
      </div>
    );
  }
  const { email, grants } = q.data;
  return (
    <>
      <section aria-label="Invitation" className="mx-auto w-full max-w-md p-4 m-text-body">
        <p>Invited as {email}</p>
        {grants.length === 0 ? <p>No access has been granted yet.</p> : (
          <ul className="mt-1 list-disc pl-5">
            {grants.map((g, i) => (
              <li key={i}>{g.role_label}{g.system_name ? `, ${g.system_name}` : ", all systems"}{g.module ? `, ${formatModuleName(g.module)}` : ", all modules"}</li>
            ))}
          </ul>
        )}
      </section>
      {children}
    </>
  );
}
