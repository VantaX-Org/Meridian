"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Skeleton, Textarea, toast } from "@/design";
import { useAuth } from "@/context/auth-context";
import { addComment, getException } from "@/lib/api/exceptions";
import { apiErrorMessage } from "@/lib/error";
import { relativeTime } from "@/lib/format";

/**
 * An exception's timeline and discussion in one list: assignment and escalation write their own entries
 * (by "system"), people add theirs below. Oldest first, so the thread reads like what happened.
 */
export function ExceptionThread({ id }: { id: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [text, setText] = useState("");
  const key = ["exceptions", "detail", id];
  const q = useQuery({ queryKey: key, queryFn: () => getException(id) });
  const add = useMutation({
    mutationFn: () => addComment(id, { text: text.trim(), user_name: user?.name ?? user?.email ?? undefined }),
    onSuccess: () => { setText(""); void qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const comments = q.data?.comments ?? [];
  return (
    <section aria-label="Activity" className="flex flex-col gap-3">
      <h3 className="m-text-h font-semibold">Activity</h3>
      {q.isLoading ? <Skeleton height={64} /> : comments.length === 0 ? (
        <EmptyState variant="inline" title="No activity yet" />
      ) : (
        <ol className="flex flex-col gap-2">
          {comments.map((c) => (
            <li key={c.id} className="flex flex-col gap-0.5">
              <span className="m-text-meta m-ink-3">{c.user_name === "system" ? "Meridian" : c.user_name}, {relativeTime(c.created_at)}</span>
              <span className="m-text-body">{c.text}</span>
            </li>
          ))}
        </ol>
      )}
      <Field label="Add a comment">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} />
      </Field>
      <div>
        <Button variant="secondary" disabled={!text.trim()} pending={add.isPending} onClick={() => add.mutate()}>Comment</Button>
      </div>
    </section>
  );
}
