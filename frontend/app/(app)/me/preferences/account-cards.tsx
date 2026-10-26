"use client";

/**
 * Me › Preferences: the signed-in user's own password and the log of notifications sent to them.
 * POST /auth/change-password and GET /me/notifications/deliveries are self-service; neither needs a role.
 */

import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Async, Button, Card, Notice, Pill, type PillTone, toast } from "@/design";
import { PasswordField } from "@/components/auth/auth-frame";
import { changeOwnPassword } from "@/lib/api/auth";
import { getMyDeliveries, type DeliveryKind, type DeliveryStatus } from "@/lib/api/notifications";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

/** The API's own floor (api/routes/auth.py _MIN_PASSWORD_LENGTH). */
export const MIN_PASSWORD_LENGTH = 12;

export function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!current) return setError("Enter your current password.");
    if (next.length < MIN_PASSWORD_LENGTH) return setError(`The new password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (next !== confirm) return setError("The new password and its confirmation do not match.");
    if (next === current) return setError("The new password must differ from the current one.");
    setSaving(true);
    try {
      await changeOwnPassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success("Password changed");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Password" meta="Change the password you sign in with. Accounts that sign in through single sign-on change it there">
      <form className="flex max-w-md flex-col gap-3" onSubmit={onSubmit} noValidate>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <PasswordField label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordField label="New password" value={next} onChange={setNext} autoComplete="new-password" helper={`At least ${MIN_PASSWORD_LENGTH} characters.`} />
        <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <div>
          <Button type="submit" variant="secondary" pending={saving}>Change password</Button>
        </div>
      </form>
    </Card>
  );
}

const KIND: Record<DeliveryKind, string> = { critical: "Critical finding", digest: "Digest", test: "Test" };
const STATUS: Record<DeliveryStatus, { label: string; tone: PillTone }> = {
  sent: { label: "Sent", tone: "go" },
  failed: { label: "Failed", tone: "no-go" },
  no_backend: { label: "Email not configured", tone: "neutral" },
  skipped: { label: "Skipped", tone: "neutral" },
};
const DELIVERY_LIMIT = 20;

export function DeliveriesCard() {
  const q = useQuery({ queryKey: queryKeys.myDeliveries(DELIVERY_LIMIT), queryFn: () => getMyDeliveries(DELIVERY_LIMIT) });
  return (
    <Card title="Delivery history" meta={`The last ${DELIVERY_LIMIT} notifications Meridian sent you, newest first`}>
      <Async
        query={q}
        skeleton="list"
        isEmpty={(d) => d.length === 0}
        empty={{ variant: "inline", title: "Nothing has been sent to you yet.", detail: "Turn on a digest or send yourself a test above." }}
        error={{ error: q.error, title: "The delivery history did not load.", onRetry: () => void q.refetch() }}
      >
        {(items) => (
        <table className="m-table w-full">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">What</th>
              <th scope="col">Where</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => {
              const s = STATUS[d.status] ?? { label: d.status, tone: "neutral" as const };
              return (
                <tr key={d.id}>
                  <td className="tabular-nums">{formatDate(d.created_at, "datetime")}</td>
                  <td>{KIND[d.kind] ?? d.kind}</td>
                  <td>{d.channel === "email" ? "Email" : "Inbox"}</td>
                  <td><span title={d.error ?? undefined}><Pill tone={s.tone}>{s.label}</Pill></span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </Async>
    </Card>
  );
}
