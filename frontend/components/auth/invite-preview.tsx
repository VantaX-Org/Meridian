"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/design";
import { isAxiosError } from "axios";
import { getInvitePreview } from "@/lib/api/auth";

/** Shows who the invite is for and what access it grants, above the password form. */
export function InvitePreview() {
  const token = useSearchParams().get("token") ?? "";
  const q = useQuery({ queryKey: ["invite-preview", token], queryFn: () => getInvitePreview(token), enabled: !!token, retry: false });
  if (!token) return null;
  if (q.isPending) return <div aria-busy="true" className="mx-auto w-full max-w-md p-4"><Skeleton width="100%" height={64} /></div>;
  if (q.isError) {
    const limited = isAxiosError(q.error) && q.error.response?.status === 429;
    return <p role="alert" className="mx-auto w-full max-w-md p-4 m-text-body">{limited ? "Too many attempts. Try again in a minute." : "This invitation link is invalid or has expired."}</p>;
  }
  const { email, grants } = q.data;
  return (
    <section aria-label="Invitation" className="mx-auto w-full max-w-md p-4 m-text-body">
      <p>Invited as {email}</p>
      {grants.length === 0 ? <p>No access has been granted yet.</p> : (
        <ul className="mt-1 list-disc pl-5">
          {grants.map((g, i) => (
            <li key={i}>{g.role_label}{g.system_name ? `, ${g.system_name}` : ", all systems"}{g.module ? `, ${g.module}` : ", all modules"}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
