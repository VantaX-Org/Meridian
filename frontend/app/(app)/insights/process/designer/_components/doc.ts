/** Pure edits of a process model document. Every function returns a new document. */
import type {
  DiagramNode, DqColour, L1, L2, L3, L4, L5, NodeType, ProcessModelDocument, ProcessVariant,
} from "@/types/process-model";
import { layoutDiagram, SIZE } from "./layout";

export type Doc = ProcessModelDocument;
export type TreeItem = L1 | L2 | L3 | L4;
export type Level = 1 | 2 | 3 | 4;

const clone = (d: Doc): Doc => structuredClone(d);

export function allIds(d: Doc): Set<string> {
  const s = new Set<string>();
  for (const a of d.l1) {
    s.add(a.id);
    for (const b of a.l2) {
      s.add(b.id);
      for (const c of b.l3) {
        s.add(c.id);
        for (const l4 of c.l4) {
          s.add(l4.id);
          l4.activities.forEach((x) => s.add(x.id));
          l4.diagram.nodes.forEach((x) => s.add(x.id));
          l4.diagram.flows.forEach((x) => s.add(x.id));
        }
      }
    }
  }
  return s;
}

/** An id that matches the backend pattern and is unused in the document. */
export function newId(d: Doc, prefix: string): string {
  const used = allIds(d);
  const base = prefix.toUpperCase().replace(/[^A-Z0-9_-]/g, "_").replace(/^-+|-+$/g, "") || "ITEM";
  for (let n = 1; ; n++) {
    const id = `${base}-${n}`;
    if (!used.has(id)) return id;
  }
}

export interface Located { level: Level; item: TreeItem; list: TreeItem[]; parent: TreeItem | null }

export function locate(d: Doc, id: string | null): Located | null {
  if (!id) return null;
  const walk = (list: TreeItem[], level: Level, parent: TreeItem | null): Located | null => {
    for (const item of list) {
      if (item.id === id) return { level, item, list, parent };
      const kids = childrenOf(item, level);
      const hit = kids.length && level < 4 ? walk(kids, (level + 1) as Level, item) : null;
      if (hit) return hit;
    }
    return null;
  };
  return walk(d.l1, 1, null);
}

export function childrenOf(item: TreeItem, level: Level): TreeItem[] {
  if (level === 1) return (item as L1).l2;
  if (level === 2) return (item as L2).l3;
  if (level === 3) return (item as L3).l4;
  return [];
}

export const l4Of = (item: TreeItem, level: Level): L4[] =>
  level === 4 ? [item as L4] : childrenOf(item, level).flatMap((c) => l4Of(c, (level + 1) as Level));

export const allL4 = (d: Doc): L4[] => d.l1.flatMap((x) => l4Of(x, 1));
export const activitiesUnder = (item: TreeItem, level: Level): L5[] => l4Of(item, level).flatMap((x) => x.activities);

export function findActivity(d: Doc, id: string | null): { act: L5; l4: L4; l1: L1 } | null {
  if (!id) return null;
  for (const l1 of d.l1) for (const l4 of l4Of(l1, 1)) {
    const act = l4.activities.find((a) => a.id === id);
    if (act) return { act, l4, l1 };
  }
  return null;
}

export function l1Of(d: Doc, id: string): L1 | null {
  for (const l1 of d.l1) if (l1.id === id || locateIn(l1, id)) return l1;
  return null;
}
const locateIn = (l1: L1, id: string) => locate({ schema_version: 1, l1: [l1] }, id);

/** Worst colour of the activities under an item, by overlay. */
export function worstUnder(item: TreeItem, level: Level, colour: (activityId: string) => DqColour | undefined): DqColour | null {
  let worst: DqColour | null = null;
  for (const a of activitiesUnder(item, level)) {
    const c = colour(a.id);
    if (c === "red") return "red";
    if (c === "amber") worst = "amber";
  }
  return worst;
}

function mutate(d: Doc, fn: (copy: Doc) => void): Doc {
  const c = clone(d);
  fn(c);
  return c;
}

const renumber = (list: Array<{ order: number }>) => list.forEach((x, i) => { x.order = i + 1; });

export function renameItem(d: Doc, id: string, name: string): Doc {
  return mutate(d, (c) => { const l = locate(c, id); if (l) l.item.name = name; });
}

export function patchItem<T extends TreeItem>(d: Doc, id: string, patch: Partial<T>): Doc {
  return mutate(d, (c) => { const l = locate(c, id); if (l) Object.assign(l.item, patch); });
}

export function removeItem(d: Doc, id: string): Doc {
  return mutate(d, (c) => {
    const l = locate(c, id);
    if (!l) return;
    l.list.splice(l.list.indexOf(l.item), 1);
    renumber(l.list);
  });
}

export function moveItem(d: Doc, id: string, dir: -1 | 1): Doc {
  return mutate(d, (c) => {
    const l = locate(c, id);
    if (!l) return;
    const i = l.list.indexOf(l.item);
    const j = i + dir;
    if (j < 0 || j >= l.list.length) return;
    [l.list[i], l.list[j]] = [l.list[j], l.list[i]];
    renumber(l.list);
  });
}

const emptyDiagram = (prefix: string, d: Doc) => {
  const start = newId(d, `${prefix}-START`);
  const end = newId(d, `${prefix}-END`);
  return {
    nodes: [
      { id: start, type: "startEvent" as const, activity_id: null, label: null, x: 24, y: 40 },
      { id: end, type: "endEvent" as const, activity_id: null, label: null, x: 144, y: 40 },
    ],
    flows: [{ id: newId(d, `${prefix}-FLOW`), source: start, target: end, label: null, condition: null }],
  };
};

/** Add a child one level below `parentId` (null adds an L1). Returns the new id. */
export function addChild(d: Doc, parentId: string | null, name: string): { doc: Doc; id: string } {
  const parent = locate(d, parentId);
  if (parentId && !parent) return { doc: d, id: "" };
  const level = (parent ? parent.level + 1 : 1) as Level;
  const id = newId(d, parent ? parent.item.id : "L1");
  const base = { id, name, description: "" };
  const doc = mutate(d, (c) => {
    const p = parentId ? locate(c, parentId)!.item : null;
    const order = (p ? childrenOf(p, (level - 1) as Level).length : c.l1.length) + 1;
    if (level === 1) c.l1.push({ ...base, order, modules: [], l2: [] });
    else if (level === 2) (p as L1).l2.push({ ...base, order, l3: [] });
    else if (level === 3) (p as L2).l3.push({ ...base, order, l4: [] });
    else (p as L3).l4.push({ ...base, order, tcode: null, config_dependency: null, activities: [], diagram: emptyDiagram(id, c), variants: [] });
  });
  return { doc, id };
}

/** Insert a node before the last end event so the diagram stays connected. */
export function addNode(d: Doc, l4Id: string, type: NodeType, name = ""): { doc: Doc; nodeId: string; actId: string | null } {
  let nodeId = "";
  let actId: string | null = null;
  const doc = mutate(d, (c) => {
    const l4 = locate(c, l4Id)?.item as L4 | undefined;
    if (!l4) return;
    nodeId = newId(c, `${l4Id}-N`);
    const end = [...l4.diagram.nodes].reverse().find((n) => n.type === "endEvent");
    const into = end ? l4.diagram.flows.filter((f) => f.target === end.id) : [];
    const node: DiagramNode = { id: nodeId, type, activity_id: null, label: null, x: end?.x ?? 24, y: end?.y ?? 40 };
    if (type === "task") {
      actId = newId(c, `${l4Id}-A`);
      node.activity_id = actId;
      l4.activities.push({ id: actId, name: name || "New activity", description: "", order: l4.activities.length + 1, tcode: l4.tcode, fields: [], check_ids: [], sap_tables: [] });
    } else if (type !== "endEvent") node.label = name || (type === "startEvent" ? "Start" : "Decision");
    l4.diagram.nodes.push(node);
    const flowId = () => newId(c, `${l4Id}-F`);
    const link = (source: string, target: string) => { l4.diagram.flows.push({ id: flowId(), source, target, label: null, condition: null }); };
    if (type === "endEvent") {
      if (into[0]) link(into[0].source, nodeId);
    } else if (type === "startEvent") {
      if (end) link(nodeId, end.id);
    } else if (end) {
      into.forEach((f) => { f.target = nodeId; });
      link(nodeId, end.id);
      if (end.x != null) end.x += SIZE[type].w + 40;
    }
  });
  return { doc, nodeId, actId };
}

export function moveNode(d: Doc, l4Id: string, nodeId: string, x: number, y: number): Doc {
  return mutate(d, (c) => {
    const n = (locate(c, l4Id)?.item as L4 | undefined)?.diagram.nodes.find((q) => q.id === nodeId);
    if (n) { n.x = Math.round(x); n.y = Math.round(y); }
  });
}

export function connect(d: Doc, l4Id: string, source: string, target: string): Doc {
  return mutate(d, (c) => {
    const l4 = locate(c, l4Id)?.item as L4 | undefined;
    if (!l4 || l4.diagram.flows.some((f) => f.source === source && f.target === target)) return;
    l4.diagram.flows.push({ id: newId(c, `${l4Id}-F`), source, target, label: null, condition: null });
  });
}

export function removeFlow(d: Doc, l4Id: string, flowId: string): Doc {
  return mutate(d, (c) => {
    const l4 = locate(c, l4Id)?.item as L4 | undefined;
    if (l4) l4.diagram.flows = l4.diagram.flows.filter((f) => f.id !== flowId);
  });
}

/** Remove a node and its flows; `withActivity` also removes the task's activity. */
export function removeNode(d: Doc, l4Id: string, nodeId: string, withActivity: boolean): Doc {
  return mutate(d, (c) => {
    const l4 = locate(c, l4Id)?.item as L4 | undefined;
    const node = l4?.diagram.nodes.find((n) => n.id === nodeId);
    if (!l4 || !node) return;
    l4.diagram.nodes = l4.diagram.nodes.filter((n) => n.id !== nodeId);
    l4.diagram.flows = l4.diagram.flows.filter((f) => f.source !== nodeId && f.target !== nodeId);
    if (withActivity && node.activity_id) {
      l4.activities = l4.activities.filter((a) => a.id !== node.activity_id);
      renumber(l4.activities);
    }
  });
}

export function patchNode(d: Doc, l4Id: string, nodeId: string, patch: Partial<DiagramNode>): Doc {
  return mutate(d, (c) => {
    const n = (locate(c, l4Id)?.item as L4 | undefined)?.diagram.nodes.find((q) => q.id === nodeId);
    if (n) Object.assign(n, patch);
  });
}

export function patchFlow(d: Doc, l4Id: string, flowId: string, patch: { label?: string | null; condition?: string | null }): Doc {
  return mutate(d, (c) => {
    const f = (locate(c, l4Id)?.item as L4 | undefined)?.diagram.flows.find((q) => q.id === flowId);
    if (f) Object.assign(f, patch);
  });
}

export function patchActivity(d: Doc, actId: string, patch: Partial<L5>): Doc {
  return mutate(d, (c) => {
    const hit = findActivity(c, actId);
    if (!hit) return;
    Object.assign(hit.act, patch);
    hit.act.sap_tables = [...new Set(hit.act.fields.map((f) => f.field.split(".")[0]))];
    hit.act.check_ids = [...new Set(hit.act.fields.map((f) => f.check_id).filter((x): x is string => !!x))];
  });
}

export function autoLayout(d: Doc, l4Id: string): Doc {
  return mutate(d, (c) => {
    const l4 = locate(c, l4Id)?.item as L4 | undefined;
    if (!l4) return;
    const pos = layoutDiagram(l4.diagram);
    l4.diagram.nodes.forEach((n) => { n.x = pos[n.id].x; n.y = pos[n.id].y; });
  });
}

export const isUnmapped = (v: ProcessVariant) => !v.l4_id && v.value !== "*";
