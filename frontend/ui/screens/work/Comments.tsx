"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addComment, getComments, type CommentKind } from "@/lib/api/v2/roles";
import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { CommentsPanel, EmptyState, Skeleton } from "@/ui/kit";
import { day } from "./shared";

/** The discussion on a record, rule or batch (GET and POST /comments). Without a backend it shows an empty state. */
export function Comments({ kind, id }: { kind: CommentKind; id: string }) {
  const fx = useFixture();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["v2", "comments", fx, kind, id], queryFn: () => getComments(kind, id), retry: false });
  if (q.isLoading) return <Skeleton lines={2} label={t("Loading the discussion")} />;
  return (
    <CommentsPanel
      listLabel={t("Comments")}
      items={(q.data?.comments ?? []).map((c) => ({ id: c.id, body: c.body, author: c.author_label, when: day(c.created_at) }))}
      empty={<EmptyState heading={t("No comments yet")} body={q.isError ? t("The discussion is not available here.") : t("Start the discussion for this item.")} />}
      composer={{
        label: t("Add a comment"), placeholder: t("Write a comment"), submitLabel: t("Comment"), disabled: q.isError,
        onSubmit: async (text) => { await addComment(kind, id, text, []); await qc.invalidateQueries({ queryKey: ["v2", "comments"] }); },
      }}
    />
  );
}
