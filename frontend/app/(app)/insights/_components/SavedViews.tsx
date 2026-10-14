"use client";

// Named filter sets for one route, stored server-side and shared with the user's later sessions.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Dialog, Field, Input } from "@/design";
import { deleteSavedView, listSavedViews, saveNamedView } from "@/lib/api/findings";
import { apiErrorMessage } from "@/lib/error";

export function SavedViews({ route, current, onApply }: { route: string; current: Record<string, string | undefined>; onApply: (filters: Record<string, string>) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const key = ["saved-views", route];
  const views = useQuery({ queryKey: key, queryFn: () => listSavedViews(route), enabled: open });
  const filters = Object.fromEntries(Object.entries(current).filter((e): e is [string, string] => !!e[1]));
  const save = useMutation({
    mutationFn: () => saveNamedView(route, name.trim(), filters),
    onSuccess: () => { toast.success(`Saved "${name.trim()}"`); setName(""); void qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteSavedView(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const list = views.data ?? [];
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Views</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Saved views" footer={<Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>}>
        <div className="flex flex-col gap-4">
          {list.length === 0 ? (
            <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>{views.isLoading ? "Loading" : "No saved views for this page yet"}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {list.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  <span className="m-text-body">{v.name}</span>
                  <span className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => { onApply(v.filters); setOpen(false); }}>Apply</Button>
                    <Button variant="ghost" size="sm" onClick={() => remove.mutate(v.id)} pending={remove.isPending && remove.variables === v.id}>Delete</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(); }}>
            <Field label="Save the current filters as">
              <Input value={name} maxLength={60} placeholder="Blocking vendor gaps" onChange={(e) => setName(e.target.value)} />
            </Field>
            <Button type="submit" disabled={!name.trim() || Object.keys(filters).length === 0} pending={save.isPending}>Save</Button>
          </form>
        </div>
      </Dialog>
    </>
  );
}
