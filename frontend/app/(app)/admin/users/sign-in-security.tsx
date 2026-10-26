"use client";

/**
 * Admin › Users: whether everyone must use two-factor sign-in (PUT /settings/security, manage_users). Turning it on
 * asks everyone without it to set it up the next time they open Meridian; the API refuses it until the admin has
 * it themselves, so the requirement never starts with the person who set it.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, ConfirmDialog, Skeleton, Switch, toast } from "@/design";
import { getSecuritySettings, updateSecuritySettings } from "@/lib/api/users";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import type { User } from "@/types/api";

export function SignInSecurity({ users }: { users: User[] | undefined }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: queryKeys.securitySettings(), queryFn: getSecuritySettings });
  const [confirming, setConfirming] = useState(false);
  const save = useMutation({
    mutationFn: (require_2fa: boolean) => updateSecuritySettings({ require_2fa }),
    onSuccess: (s) => {
      qc.setQueryData(queryKeys.securitySettings(), s);
      setConfirming(false);
      toast.success(s.require_2fa ? "Two-factor sign-in is now required" : "Two-factor sign-in is now optional");
    },
    onError: (e) => { setConfirming(false); toast.error(`Not saved. ${apiErrorMessage(e)}`); },
  });
  const active = (users ?? []).filter((u) => u.is_active);
  const without = active.filter((u) => !u.totp_enabled).length;
  const required = q.data?.require_2fa ?? false;

  return (
    <Card title="Sign-in security" meta="Two-factor sign-in asks for a code from an authenticator app after the password">
      {q.isLoading ? <Skeleton width={240} height={24} /> : q.isError ? (
        <p className="m-text-body m-ink-3" role="alert">{`The setting did not load. ${apiErrorMessage(q.error)}`}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Switch
            label="Require two-factor sign-in for everyone"
            checked={required}
            disabled={save.isPending}
            onCheckedChange={(on) => { if (on) setConfirming(true); else save.mutate(false); }}
          />
          {users ? (
            <p className="m-text-meta m-ink-3">
              {without === 0
                ? "Every active user has it set up."
                : `${without.toLocaleString()} of ${active.length.toLocaleString()} active ${active.length === 1 ? "user has" : "users have"} not set it up${required ? " and will be asked to next time they open Meridian" : ""}.`}
            </p>
          ) : null}
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Require two-factor sign-in"
        body={`Everyone without it is asked to set it up the next time they open Meridian, and cannot use Meridian until they do.${without ? ` That is ${without.toLocaleString()} ${without === 1 ? "person" : "people"} today.` : ""} You need it set up on your own account first.`}
        confirmLabel="Require it"
        cancelLabel="Keep it optional"
        pending={save.isPending}
        onConfirm={() => save.mutate(true)}
      />
    </Card>
  );
}
