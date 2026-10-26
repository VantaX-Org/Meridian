"use client";

/**
 * "Hand to a steward": a process owner gives one blocking rule to a person who can fix it, with a note and a due
 * date. Needs `handoff_rule` (process analysts, and every `assign` holder), never `assign` itself: it creates one
 * task in the steward's inbox and nothing else (POST /api/v1/stewardship/handoff).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Field, Input, Mono, Notice, Select, Textarea, toast } from "@/design";
import { useRole } from "@/hooks/use-role";
import { getHandoffStewards, handoffRule, type HandoffSteward } from "@/lib/api/stewardship";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { roleLabel } from "@/lib/roles";

export interface HandoffTarget {
  checkId: string;
  /** The object (module) the rule runs on. */
  module: string;
  /** The run the rule failed in, so the task links its finding. */
  versionId?: string;
  findingId?: string;
  /** Where the rule blocks (an L1 process name), for the task title. */
  process?: string;
  field?: string;
}

/**
 * yyyy-mm-dd of today plus `days`, by the UTC calendar: the API refuses a due date before today's UTC date
 * (api/routes/stewardship.py), so west of UTC in the evening the local date would be refused as past.
 */
export function dateInDays(days: number, from: Date = new Date()): string {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + days)).toISOString().slice(0, 10);
}

const personLabel = (s: HandoffSteward) => `${s.name || s.email}, ${roleLabel(s.role)}`;

function HandoffDialog({ target, open, onOpenChange, onDone }: {
  target: HandoffTarget; open: boolean; onOpenChange: (open: boolean) => void; onDone: (name: string) => void;
}) {
  const qc = useQueryClient();
  const stewards = useQuery({ queryKey: queryKeys.handoffStewards(), queryFn: getHandoffStewards, enabled: open });
  const [stewardId, setStewardId] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState(() => dateInDays(7));
  const today = dateInDays(0);
  const send = useMutation({
    mutationFn: () => handoffRule({
      check_id: target.checkId, module: target.module, assignee_id: stewardId, note: note.trim(), due_date: due,
      version_id: target.versionId, finding_id: target.findingId, process: target.process, field: target.field,
    }),
    onSuccess: () => {
      const who = stewards.data?.find((s) => s.id === stewardId);
      const name = who ? who.name || who.email : "the steward";
      toast.success(`${target.checkId} handed to ${name}. It is in their inbox.`);
      qc.invalidateQueries({ queryKey: ["inbox"] });
      onOpenChange(false);
      onDone(name);
    },
  });
  const options = (stewards.data ?? []).map((s) => ({ value: s.id, label: personLabel(s) }));
  const ready = !!stewardId && !!note.trim() && !!due && due >= today;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Hand to a steward"
      footer={<>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Close without handing over</Button>
        <Button onClick={() => send.mutate()} pending={send.isPending} disabled={!ready}>Hand over</Button>
      </>}>
      <div className="grid gap-4">
        <p>
          <Mono>{target.checkId}</Mono> on {formatModuleName(target.module)}
          {target.process ? `, blocking ${target.process}` : ""}
          {target.field ? <> (<Mono>{target.field}</Mono>)</> : null}
        </p>
        <p className="m-ink-2">The steward gets one task in their inbox with your note and due date. You can follow it from the inbox.</p>
        {stewards.isError ? (
          <Notice tone="danger" title="Could not load the people who can fix">{apiErrorMessage(stewards.error)}</Notice>
        ) : stewards.data && !options.length ? (
          <Notice tone="info" title="No one can fix data yet">Ask an admin to give someone the data steward role.</Notice>
        ) : (
          <Field label="Steward">
            <Select value={stewardId} onValueChange={setStewardId} options={options}
              placeholder={stewards.isLoading ? "Loading people" : "Choose who fixes it"} />
          </Field>
        )}
        <Field label="Note">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={2000}
            placeholder="What blocks the process and what good looks like" />
        </Field>
        <Field label="Due date" error={due && due < today ? "Choose today or a later date" : undefined}>
          <Input type="date" value={due} min={today} onChange={(e) => setDue(e.target.value)} />
        </Field>
        {send.isError && <Notice tone="danger" title="Could not hand the rule over">{apiErrorMessage(send.error)}</Notice>}
      </div>
    </Dialog>
  );
}

/** The action, for a ledger row or a header. Renders nothing without `handoff_rule`. */
export function HandToSteward({ target, variant = "ghost" }: { target: HandoffTarget; variant?: "ghost" | "secondary" }) {
  const { can } = useRole();
  const [open, setOpen] = useState(false);
  const [handed, setHanded] = useState<string | null>(null);
  if (!can("handoff_rule")) return null;
  if (handed) return <span className="m-text-body m-ink-2">{`Handed to ${handed}`}</span>;
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)} aria-label={`Hand ${target.checkId} to a steward`}>Hand to a steward</Button>
      {open && <HandoffDialog target={target} open={open} onOpenChange={setOpen} onDone={setHanded} />}
    </>
  );
}
