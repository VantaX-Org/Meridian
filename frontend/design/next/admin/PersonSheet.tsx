"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { removeGrant, removeUser, setUserActive } from "@/lib/api/v2/admin";
import { refreshAdmin, useGrants, useUsers } from "@/lib/v2/admin-queries";
import { userStatus } from "@/lib/users";
import { useV2Href, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { Button, Chip, Confirm, Sheet, Skeleton, useToast } from "../kit";
import { Denied, isSessionError, LongText, useSubmitGuard } from "../more/states";
import type { SheetCtx } from "../shell/SheetHost";
import { removeBlock } from "./guard";
import { statusText } from "./Users";

/** How long Undo stays on offer before a removal is sent. The server delete is final, so nothing is sent until then. */
export const UNDO_MS = 8000;

/** One person: role, objects, delegations, how they sign in, and Deactivate. Yourself and the last administrator cannot be deactivated. */
export function PersonSheet({ ctx }: { ctx: SheetCtx }) {
  const { close, under, id } = ctx;
  const { can, id: selfId } = useV2Session();
  const href = useV2Href();
  const qc = useQueryClient();
  const toast = useToast();
  const users = useUsers({}, can("manage_users"));
  const grants = useGrants(id, can("manage_users"));
  const guard = useSubmitGuard();
  const [confirm, setConfirm] = useState<"deactivate" | "remove" | null>(null);
  const [expired, setExpired] = useState(false);
  const all = users.data?.users ?? [];
  const user = all.find((u) => u.id === id);

  if (!can("manage_users")) return <Sheet open onClose={close} title={t("Person")} size="medium" under={under}><Denied what={t("Users and roles")} /></Sheet>;
  if (users.isLoading) return <Sheet open onClose={close} title={t("Person")} size="medium" under={under}><Skeleton lines={4} label={t("Loading this person")} /></Sheet>;
  if (!user) return <Sheet open onClose={close} title={t("Person")} size="medium" under={under}><p>{t("This person was not found. They may have been removed.")}</p></Sheet>;

  const block = removeBlock(user, all, selfId ?? undefined);
  const why = block === "self" ? t("You cannot deactivate yourself.") : block === "last-admin" ? t("This is the last active administrator. Make someone else an administrator first.") : "";
  const act = (job: () => Promise<unknown>, done: string) =>
    guard.run(async () => {
      try {
        await job();
        await refreshAdmin(qc, "users");
        toast({ text: done, tone: "good" });
        setConfirm(null);
        close();
      } catch (e) {
        if (isSessionError(e)) setExpired(true);
        else toast({ text: t("That change could not be saved."), tone: "bad" });
      }
    });
  const removeWhy = block === "self" ? t("You cannot remove yourself.") : block === "last-admin" ? t("This is the last active administrator. Make someone else an administrator first.") : "";
  // Removal waits out the Undo window, then sends the delete. A 409 means the person is still referenced: deactivate instead.
  const remove = () => {
    const who = user.name || user.email;
    let undone = false;
    setConfirm(null);
    close();
    toast({ text: t("{name} will be removed.", { name: who }), timeout: UNDO_MS, onUndo: () => { undone = true; toast({ text: t("Removal undone.") }); } });
    setTimeout(() => {
      if (undone) return;
      void removeUser(user.id).then(
        async () => { await refreshAdmin(qc, "users"); toast({ text: t("{name} was removed.", { name: who }), tone: "good" }); },
        (e: unknown) => toast({ tone: "bad", text: isAxiosError(e) && e.response?.status === 409 ? t("{name} is still linked to work, so they cannot be removed. Deactivate them instead.", { name: who }) : t("{name} could not be removed.", { name: who }) }),
      );
    }, UNDO_MS);
  };
  const s = userStatus(user);
  const list = grants.data ?? [];
  return (
    <Sheet open onClose={close} title={user.name || user.email} meta={statusText(s)} size="medium" under={under}
      secondary={<Button variant="danger" disabled={!!block} reason={why} loading={guard.busy} loadingLabel={t("Saving")} onClick={() => setConfirm("deactivate")}>{user.is_active ? t("Deactivate") : t("Reactivate")}</Button>}>
      {expired ? <p className="nx-note" role="status" data-testid="draft-note">{t("Your session ended. Sign in again, then repeat this change.")}</p> : null}
      {block ? <p className="nx-note" role="alert" data-testid="remove-block">{why}</p> : null}
      <dl className="nx-notes">
        <dt>{t("Email")}</dt><dd><LongText text={user.email} /></dd>
        <dt>{t("Role")}</dt><dd><Chip>{user.role}</Chip></dd>
        <dt>{t("Sign-in method")}</dt><dd>{user.clerk_user_id ? t("Single sign-on") : t("Password")}</dd>
        <dt>{t("Last sign-in")}</dt><dd>{user.last_login ? new Date(user.last_login).toLocaleString() : t("Never")}</dd>
      </dl>
      <h3>{t("Objects")}</h3>
      {grants.isLoading ? <Skeleton lines={2} label={t("Loading access")} /> : list.length === 0 ? <p className="nx-sub">{t("No grants yet.")}</p> : (
        <ul className="nx-pick" aria-label={t("Objects")}>
          {list.map((g) => (
            <li key={g.id} className="nx-row">
              <LongText text={`${g.role_key}${g.module ? `: ${g.module}` : ""}`} className="nx-row-main" />
              <Button size={32} onClick={() => void act(() => removeGrant(user.id, g.id), t("Access removed."))}>{t("Remove")}</Button>
            </li>
          ))}
        </ul>
      )}
      <h3>{t("Delegations")}</h3>
      <p><Link className="nx-link" href={href("/more/admin/delegations")}>{t("Manage who covers for people who are away")}</Link></p>
      <h3>{t("Remove")}</h3>
      <p className="nx-sub">{t("Removes this person and their sign-in for good. Deactivate keeps their history instead.")}</p>
      <Button variant="danger" size={32} disabled={!!block} reason={removeWhy} onClick={() => setConfirm("remove")} data-testid="remove-person">{t("Remove this person")}</Button>
      <Confirm open={confirm === "remove"} title={t("Remove this person?")} consequence={t("Their account and sign-in are deleted. You can undo for a few seconds; after that it cannot be reversed.")} confirmLabel={t("Remove")} danger onConfirm={remove} onCancel={() => setConfirm(null)} />
      <Confirm open={confirm === "deactivate"} title={user.is_active ? t("Deactivate this person?") : t("Reactivate this person?")} consequence={user.is_active ? t("They can no longer sign in. Their work stays. You can reactivate them.") : t("They can sign in again.")} confirmLabel={user.is_active ? t("Deactivate") : t("Reactivate")} danger={user.is_active} onConfirm={() => void act(() => setUserActive(user.id, !user.is_active), t("Saved."))} onCancel={() => setConfirm(null)} />
    </Sheet>
  );
}
