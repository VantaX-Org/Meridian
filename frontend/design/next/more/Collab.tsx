"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { addComment, deleteComment, deleteWatch, putWatch, type CommentKind, type WatchKind } from "@/lib/api/v2/roles";
import { formatDate } from "@/lib/format";
import { useAssignable } from "@/lib/v2/approvals-queries";
import { failureText } from "@/lib/v2/errors";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { notFound, refreshRoles, useComments, useWatch } from "@/lib/v2/roles-queries";
import { Button, Confirm, Skeleton, useToast } from "../kit";
import { useSubmitGuard } from "./states";
import "./journey.css";

/** The mention handle of an email address ("ana.lee@x.com" gives "ana.lee"). */
const handleOf = (email: string | null | undefined): string => (email ?? "").split("@")[0].toLowerCase();
/** The handle being typed at the end of the draft ("@a.na" gives "a.na"), or null. */
const typingHandle = (draft: string): string | null => /(?:^|\s)@([\w.-]*)$/.exec(draft)?.[1].toLowerCase() ?? null;

/**
 * Watch and comments in the new interface (GET/PUT/DELETE /watches, GET/POST /comments, DELETE /comments/{id}).
 * Any sheet adds both with one line: `<Collab kind="contract" id={id} label={t("this contract")} />`.
 */

export function WatchToggle({ kind, id, label }: { kind: WatchKind; id: string; label: string }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const toast = useToast();
  const q = useWatch(kind, id);
  const { busy, run } = useSubmitGuard();
  if (q.isError && notFound(q.error)) return <p className="nx-sub">{t("Watching is not available on this server yet")}</p>;
  const watching = q.data?.watching ?? false;
  const readOnly = session.shared || Boolean(session.viewAs);
  const toggle = () =>
    run(async () => {
      try {
        if (watching) await deleteWatch(kind, id);
        else await putWatch(kind, id, []);
        await refreshRoles(qc, "watch");
      } catch (e) {
        toast({ text: failureText(e), tone: "bad" });
      }
    });
  return (
    <div className="nx-row nx-row-wrap" data-testid="watch">
      <Button variant="secondary" size={32} aria-pressed={watching} loading={busy} disabled={!q.data || readOnly} reason={readOnly ? t("Read-only view") : undefined} onClick={() => void toggle()}>
        {watching ? t("Watching") : t("Watch")}
      </Button>
      <span className="nx-sub nx-row-main">
        {watching ? t("You hear about runs, score drops, new critical breaches and comments on {label}.", { label }) : t("Hear about runs, score drops and comments on {label}.", { label })}
      </span>
    </div>
  );
}

export function Comments({ kind, id }: { kind: CommentKind; id: string }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const toast = useToast();
  const q = useComments(kind, id);
  const people = useAssignable(true);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [asking, setAsking] = useState<{ id: string; at: string } | null>(null);
  const { busy, run } = useSubmitGuard();
  const typing = typingHandle(draft);
  const suggestions = useMemo(
    () => (typing === null ? [] : (people.data ?? []).filter((p) => handleOf(p.email).startsWith(typing) || p.name.toLowerCase().includes(typing)).slice(0, 5)),
    [typing, people.data],
  );
  const names = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p.name])), [people.data]);
  const canWrite = session.can("view") && !session.shared && !session.viewAs;
  const pick = (pid: string, email: string) => {
    setDraft((d) => d.replace(/@([\w.-]*)$/, `@${handleOf(email)} `));
    setPicked((p) => [...new Set([...p, pid])]);
  };
  const post = () =>
    run(async () => {
      try {
        await addComment(kind, id, draft.trim(), picked);
        setDraft("");
        setPicked([]);
        await refreshRoles(qc, "comments");
      } catch (e) {
        toast({ text: failureText(e), tone: "bad" });
      }
    });
  const remove = async (cid: string) => {
    setAsking(null);
    try {
      await deleteComment(cid);
      await refreshRoles(qc, "comments");
    } catch (e) {
      toast({ text: failureText(e), tone: "bad" });
    }
  };
  if (q.isError && notFound(q.error)) return <p className="nx-sub">{t("Comments are not available on this server yet")}</p>;
  const list = q.data?.comments ?? [];
  return (
    <section className="nx-form" aria-label={t("Comments")} data-testid="comments">
      <h3 className="nx-jh">{t("Comments")}</h3>
      {q.isPending ? (
        <Skeleton lines={2} label={t("Comments")} />
      ) : list.length === 0 ? (
        <p className="nx-sub">{t("No comments yet. Type @ and a name to bring someone in.")}</p>
      ) : (
        <ul className="nx-pick">
          {list.map((c) => (
            <li key={c.id} className="nx-row" data-testid="comment">
              <div className="nx-row-main">
                <div className="nx-sub">{`${c.author_label}, ${formatDate(c.created_at, "date")}`}</div>
                <div className="nx-notes">{c.body}</div>
                {c.mentions.length ? <div className="nx-sub">{c.mentions.map((m) => `@${names.get(m) ?? m}`).join(", ")}</div> : null}
              </div>
              {c.mine && canWrite ? (
                <Button variant="quiet" size={32} onClick={() => setAsking({ id: c.id, at: formatDate(c.created_at, "date") })} aria-label={t("Remove your comment of {created_at}", { created_at: formatDate(c.created_at, "date") })}>
                  {t("Remove")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <>
          <label className="nx-field">
            {t("Add a comment")}
            <textarea className="nx-input nx-jtext" rows={3} value={draft} maxLength={4000} onChange={(e) => setDraft(e.target.value)} placeholder={t("Ask, explain, or @mention someone")} />
          </label>
          {suggestions.length ? (
            <ul className="nx-pick" aria-label={t("People to mention")}>
              {suggestions.map((p) => (
                <li key={p.id}>
                  <Button variant="quiet" size={32} onClick={() => pick(p.id, p.email)}>{`${p.name} @${handleOf(p.email)}`}</Button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="nx-row">
            <Button size={32} loading={busy} loadingLabel={t("Posting…")} disabled={!draft.trim()} onClick={() => void post()}>
              {t("Post comment")}
            </Button>
          </div>
        </>
      ) : (
        <p className="nx-sub">{session.shared ? t("This is a shared, read-only view.") : t("Viewing as another role: comments are read-only.")}</p>
      )}
      <Confirm
        open={asking !== null}
        title={t("Remove")}
        consequence={asking ? t("Your comment of {created_at} is removed for everyone who reads this item.", { created_at: asking.at }) : ""}
        confirmLabel={t("Remove")}
        danger
        onConfirm={() => asking && void remove(asking.id)}
        onCancel={() => setAsking(null)}
      />
    </section>
  );
}

/** Watch and comments together, for the foot of any sheet. */
export function Collab({ kind, id, label }: { kind: CommentKind; id: string; label: string }) {
  return (
    <>
      <section className="nx-form" aria-label={t("Watch")}>
        <h3 className="nx-jh">{t("Watch")}</h3>
        <WatchToggle kind={kind} id={id} label={label} />
      </section>
      <Comments kind={kind} id={id} />
    </>
  );
}
