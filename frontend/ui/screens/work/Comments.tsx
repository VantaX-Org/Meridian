"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addComment, getComments, type CommentKind } from "@/lib/api/v2/roles";
import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { Button, EmptyState, Input, Skeleton } from "@/ui/kit";
import { day } from "./shared";

/** Local kit request: the discussion on a record, rule or batch (GET and POST /comments). Without a backend it shows an empty state. */
export function Comments({ kind, id }: { kind: CommentKind; id: string }) {
  const fx = useFixture();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const q = useQuery({ queryKey: ["v2", "comments", fx, kind, id], queryFn: () => getComments(kind, id), retry: false });
  if (q.isLoading) return <Skeleton lines={2} label={t("Loading the discussion")} />;
  const list = q.data?.comments ?? [];
  return (
    <div className="mx-col">
      {list.length === 0 ? <EmptyState heading={t("No comments yet")} body={q.isError ? t("The discussion is not available here.") : t("Start the discussion for this item.")} /> : (
        <ul className="mx-thread" aria-label={t("Comments")}>
          {list.map((c) => <li key={c.id} className="mx-msg"><b>{c.author_label}</b> <span className="mx-muted">{day(c.created_at)}</span><p>{c.body}</p></li>)}
        </ul>
      )}
      <form className="mx-links" onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; await addComment(kind, id, text.trim(), []); setText(""); await qc.invalidateQueries({ queryKey: ["v2", "comments"] }); }}>
        <Input aria-label={t("Add a comment")} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Write a comment")} />
        <Button type="submit" variant="secondary" disabled={!text.trim() || q.isError}>{t("Comment")}</Button>
      </form>
    </div>
  );
}
