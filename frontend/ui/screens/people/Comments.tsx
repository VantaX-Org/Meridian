"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addComment, deleteComment, getComments, getMyWatches, putWatch, deleteWatch, type CommentKind } from "@/lib/api/v2/roles";
import { failureText } from "@/lib/v2/errors";
import { t } from "@/lib/v2/i18n";
import { Card, CommentsPanel as KitComments, EmptyState, Toggle, useToast } from "@/ui/kit";
import { Gate, day, refreshV2, useQ } from "./common";

/** The notes on one object (a contract here) and the caller's watch on it. */
export function CommentsPanel({ kind, id }: { kind: CommentKind; id: string }) {
  const qc = useQueryClient();
  const list = useQ(["comments", kind, id], () => getComments(kind, id));
  const watches = useQ(["watches"], () => getMyWatches());
  const toast = useToast();
  const refresh = () => void refreshV2(qc);
  const onError = (e: unknown) => toast(failureText(e), "bad");
  const add = useMutation({ mutationFn: (text: string) => addComment(kind, id, text, []), onSuccess: refresh, onError });
  const del = useMutation({ mutationFn: (cid: string) => deleteComment(cid), onSuccess: refresh, onError });
  const watching = !!watches.data?.watches?.some((w) => w.target_kind === kind && w.target_id === id);
  const watch = useMutation({ mutationFn: async () => { await (watching ? deleteWatch(kind, id) : putWatch(kind, id, [])); }, onSuccess: refresh, onError });
  return (
    <Card title={t("Notes")} action={<Toggle label={t("Watch")} checked={watching} onChange={() => watch.mutate()} />}>
      <Gate q={list} label={t("Loading notes")}>
        {(d) => (
          <KitComments
            listLabel={t("Notes")}
            deleteLabel={t("Delete")}
            items={d.comments.map((c) => ({ id: c.id, body: c.body, author: c.author_label, when: day(c.created_at), onDelete: c.mine ? () => del.mutate(c.id) : undefined }))}
            empty={<EmptyState heading={t("No notes yet")} body={t("Add the first note for the people who own this.")} />}
            composer={{ label: t("New note"), submitLabel: t("Add note"), disabled: add.isPending, onSubmit: (text) => add.mutateAsync(text).then(() => undefined) }}
          />
        )}
      </Gate>
    </Card>
  );
}
