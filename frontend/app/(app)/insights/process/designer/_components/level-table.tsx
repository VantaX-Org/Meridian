"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { Button, DataTable, EmptyState } from "@/design";
import type { DqColour } from "@/types/process-model";
import { activitiesUnder, childrenOf, type Doc, type Level, type TreeItem } from "./doc";
import type { TreeActions } from "./tree";

interface Row { item: TreeItem; level: Level; activities: number; blocked: number; degraded: number; index: number; count: number }

/** The children of an L1 to L3 item (or the L1s when nothing is selected), with their counts. */
export function LevelTable({ doc, parent, parentLevel, colour, actions, onOpen, editable, onBlocked, canDesign = true }: {
  doc: Doc;
  parent: TreeItem | null;
  parentLevel: Level | 0;
  colour: (activityId: string) => DqColour | undefined;
  actions: TreeActions;
  onOpen: (id: string) => void;
  editable: boolean;
  onBlocked: () => void;
  /** False when the user lacks `analyse` (wave 16): mutating controls are not rendered. */
  canDesign?: boolean;
}) {
  const level = (parentLevel + 1) as Level;
  const list = parent ? childrenOf(parent, parentLevel as Level) : doc.l1;
  const data = useMemo<Row[]>(() => list.map((item, index) => {
    const acts = activitiesUnder(item, level);
    return {
      item, level, index, count: list.length, activities: acts.length,
      blocked: acts.filter((a) => colour(a.id) === "red").length,
      degraded: acts.filter((a) => colour(a.id) === "amber").length,
    };
  }), [list, level, colour]);
  const guard = (fn: () => void) => (editable ? fn() : onBlocked());

  const all: ColumnDef<Row>[] = [
    { id: "name", header: "Name", accessorFn: (r) => r.item.name, cell: ({ row }) => (
      <Button variant="ghost" onClick={() => onOpen(row.original.item.id)}>{row.original.item.name}</Button>
    ) },
    { id: "activities", header: "Activities", accessorFn: (r) => r.activities },
    { id: "blocked", header: "Blocked", accessorFn: (r) => r.blocked },
    { id: "degraded", header: "Degraded", accessorFn: (r) => r.degraded },
    { id: "actions", header: "Actions", enableSorting: false, cell: ({ row }) => {
      const r = row.original;
      return (
        <span className="m-designer__actions" data-open>
          <Button variant="ghost" disabled={r.index === 0} aria-label={`Move ${r.item.name} up`} onClick={() => guard(() => actions.move(r.item.id, -1))}>Up</Button>
          <Button variant="ghost" disabled={r.index === r.count - 1} aria-label={`Move ${r.item.name} down`} onClick={() => guard(() => actions.move(r.item.id, 1))}>Down</Button>
        </span>
      );
    } },
  ];
  const columns = canDesign ? all : all.filter((c) => c.id !== "actions");

  return (
    <div className="m-designer__level">
      {canDesign ? <div className="m-designer__toolbar">
        <Button variant="secondary" disabled={level > 4} onClick={() => guard(() => actions.add(parent?.id ?? null))}>
          {`Add L${level}`}
        </Button>
      </div> : null}
      {data.length ? (
        <DataTable columns={columns} data={data} getRowId={(r) => r.item.id} onRowClick={(r) => onOpen(r.item.id)} />
      ) : <EmptyState title="Nothing at this level yet. Add the first item." />}
    </div>
  );
}
