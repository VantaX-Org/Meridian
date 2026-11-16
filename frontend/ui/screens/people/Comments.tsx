"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addComment, deleteComment, getComments, getMyWatches, putWatch, deleteWatch, type CommentKind } from "@/lib/api/v2/roles";
import { t } from "@/lib/v2/i18n";
import { Button, Card, EmptyState, Field, Input, Toggle } from "@/ui/kit";
import { Gate, day, refreshV2, useQ } from "./common";

/** The notes on one object (a contract here) and the caller's watch on it. */
export function CommentsPanel({ kind, id }: { kind: CommentKind; id: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const list = useQ(["comments", kind, id], () => getComments(kind, id));
  const watches = useQ(["watches"], () => getMyWatches());
  const refresh = () => void refreshV2(qc);
  const add = useMutation({ mutationFn: () => addComment(kind, id, text.trim(), []), onSuccess: () => { setText(""); refresh(); } });
  const del = useMutation({ mutationFn: (cid: string) => deleteComment(cid), onSuccess: refresh });
  const watching = !!watches.data?.watches?.some((w) => w.target_kind === kind && w.target_id === id);
  const watch = useMutation({ mutationFn: async () => { await (watching ? deleteWatch(kind, id) : putWatch(kind, id, [])); }, onSuccess: refresh });
  return (
    <Card title={t("Notes")} action={<Toggle label={t("Watch")} checked={watching} onChange={() => watch.mutate()} />}>
      <Gate q={list} label={t("Loading notes")}>
        {(d) => d.comments.length === 0 ? <EmptyState heading={t("No notes yet")} body={t("Add the first note for the people who own this.")} /> : (
          <ul className="mx-list" aria-label={t("Notes")}>
            {d.comments.map((c) => (
              <li key={c.id}>
                <span>{c.body}</span>{" "}
                <span className="mx-muted">{c.author_label}, {day(c.created_at)}</span>{" "}
                {c.mine ? <Button variant="ghost" onClick={() => del.mutate(c.id)}>{t("Delete")}</Button> : null}
              </li>
            ))}
          </ul>
        )}
      </Gate>
      <Field label={t("New note")}><Input value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <Button variant="primary" disabled={!text.trim() || add.isPending} onClick={() => add.mutate()}>{t("Add note")}</Button>
    </Card>
  );
}
