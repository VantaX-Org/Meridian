"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Drawer, EmptyState, ErrorState, Field, Mono, Select, Skeleton, Textarea } from "@/design";
import { commentIssue, getIssue, type IssueEvent } from "@/lib/api/issues";
import { getWorkRecord } from "@/lib/api/work";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { formatDate, plural } from "@/lib/format";

/** The comment limit of POST /issues/{id}/comments. */
export const COMMENT_MAX = 4000;

/** The same key the record sheet reads the record under, so opening the drawer costs no second request. */
const recordKey = (module: string, key: string, run?: string) => ["work", "record", module, key, run ?? "latest"];
const issueKey = (id: string) => ["issues", id, "thread"];

/** The comments of an issue's event log, oldest first. */
export function commentsOf(events: readonly IssueEvent[]): IssueEvent[] {
  return events.filter((e) => e.action === "comment" && !!e.note);
}

function Thread({ issueId, canComment }: { issueId: string; canComment: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const q = useQuery({ queryKey: issueKey(issueId), queryFn: () => getIssue(issueId), retry: false });
  const add = useMutation({
    mutationFn: () => commentIssue(issueId, text.trim()),
    onSuccess: () => {
      setText("");
      toast.success("Comment added");
      void qc.invalidateQueries({ queryKey: issueKey(issueId) });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  if (q.isLoading) return <Skeleton height={120} />;
  if (q.isError || !q.data) return <ErrorState {...apiErrorState(q.error)} onRetry={() => void q.refetch()} />;
  const comments = commentsOf(q.data.events);
  return (
    <div className="flex flex-col gap-4">
      {comments.length === 0 ? (
        <EmptyState variant="inline" title="No comments yet" detail={canComment ? "Write what you know about this issue so the next person sees it." : "Comments on this issue show here."} />
      ) : (
        <ul aria-label="Comments" className="flex flex-col gap-3">
          {comments.map((c, i) => (
            <li key={`${c.created_at}-${i}`} className="flex flex-col gap-1">
              <span className="m-text-meta m-ink-3">{c.user_label ?? "Someone"}, {formatDate(c.created_at, "datetime")}</span>
              <p className="m-text-body m-ink whitespace-pre-wrap [overflow-wrap:anywhere]">{c.note}</p>
            </li>
          ))}
        </ul>
      )}
      {canComment ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }}
        >
          <Field label="Add a comment">
            <Textarea rows={3} maxLength={COMMENT_MAX} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <span className="m-text-meta m-ink-3">{text.length.toLocaleString()} of {COMMENT_MAX.toLocaleString()} characters</span>
          <Button type="submit" className="self-end" pending={add.isPending} disabled={!text.trim()}>Add comment</Button>
        </form>
      ) : null}
    </div>
  );
}

/**
 * Comments on the issues of one record, in a drawer opened from the Fix record sheet. A comment belongs to an issue
 * (one rule failing on the record), so a record with several issues picks which one it is reading. The record is read
 * the way the sheet reads it (GET /work/records/...), the thread from GET /issues/{id}, a comment POSTs to
 * /issues/{id}/comments.
 */
export function IssueComments({ module, recordKey: key, run }: { module: string; recordKey: string; run?: string }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const rec = useQuery({ queryKey: recordKey(module, key, run), queryFn: () => getWorkRecord(module, key, run), enabled: open });
  const issues = (rec.data?.issues ?? []).filter((i): i is typeof i & { issue_id: string } => !!i.issue_id);
  const chosen = issues.find((i) => i.issue_id === picked) ?? issues[0];
  return (
    <>
      <Button variant="ghost" size="sm" className="self-start" onClick={() => setOpen(true)}>Comments on this record</Button>
      <Drawer open={open} onOpenChange={setOpen} title="Comments" subtitle={<Mono>{key}</Mono>}>
        {rec.isLoading ? <Skeleton height={160} />
          : rec.isError ? <ErrorState {...apiErrorState(rec.error)} onRetry={() => void rec.refetch()} />
          : !chosen ? <EmptyState variant="inline" title="No issue to comment on" detail="This record has no open issue with a history yet." />
          : (
            <div className="flex flex-col gap-4">
              {issues.length > 1 ? (
                <Select
                  label={`Issue, ${plural(issues.length, "issue")} on this record`}
                  value={chosen.issue_id}
                  onValueChange={setPicked}
                  options={issues.map((i) => ({ value: i.issue_id, label: i.message || i.check_id }))}
                />
              ) : (
                <p className="m-text-body m-ink-2"><Mono>{chosen.check_id}</Mono>, {chosen.message}</p>
              )}
              <Thread key={chosen.issue_id} issueId={chosen.issue_id} canComment={!!rec.data?.can.comment} />
            </div>
          )}
      </Drawer>
    </>
  );
}
