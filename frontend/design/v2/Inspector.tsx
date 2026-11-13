"use client";

import { useMemo, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Landscape, Receipt } from "@/lib/api/v2/types";
import { useOpenItem, type OpenItem } from "@/lib/v2/hooks";
import { useLandscape, v2Keys } from "@/lib/v2/queries";
import { moduleSlug, systemSlug } from "@/lib/v2/score";
import { Sheet } from "@/design/next/kit/Sheet";
import { EmptyFrame, Mono, V2Link } from "./parts";
import { extensionFor } from "./inspector/registry";
import { RuleInspectorBody } from "./inspector/rule";
import { RecordInspector } from "./screens/RecordInspector";
import { t } from "@/lib/v2/i18n";
// The kit Sheet's styles are scoped under .nx-root; the v2 layout does not load them, so the frame does.
import "@/design/next/tokens.css";
import "@/design/next/motion.css";
import "@/design/next/kit/kit.css";
import "@/design/next/layers.css";

export interface InspectorFrameProps {
  title: ReactNode;
  status?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The inspector's anatomy, the same for every kind of thing: a title, a status line, then facts, actions and
 * history in the body. It is the kit Sheet: a panel from the right (a bottom sheet on a phone) that traps focus,
 * closes on Esc and gives focus back to where it was.
 */
export function InspectorFrame({ title, status, onClose, children }: InspectorFrameProps) {
  return (
    <aside className="nx-root nx-scope" aria-label={t("Inspector")} data-testid="inspector">
      <Sheet open onClose={onClose} title={title} size="large" id="m2-inspector" closeLabel={t("Close inspector")} focusClose>
        <div className="m2-ib">
          {status ? <div className="m2-ih-sl">{status}</div> : null}
          {children}
        </div>
      </Sheet>
    </aside>
  );
}

export function Facts({ children }: { children: ReactNode }) {
  return (
    <>
      <h3>{t("Facts")}</h3>
      <dl className="m2-facts">{children}</dl>
    </>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="m2-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Actions({ children }: { children: ReactNode }) {
  return (
    <>
      <h3>{t("Actions")}</h3>
      <div className="m2-acts">{children}</div>
    </>
  );
}

/** The step 0 body, kept as the plain fallback and for its tests. */
export function RuleBody({ id, landscape }: { id: string; landscape: Landscape | undefined }) {
  const qc = useQueryClient();
  const name = useMemo(() => {
    for (const [, data] of qc.getQueriesData<Receipt>({ queryKey: v2Keys.receiptRoot })) {
      const hit = data?.breaches.find((b) => b.check_id === id);
      if (hit) return hit.name;
    }
    return null;
  }, [qc, id]);
  const capped = (landscape?.cells ?? []).filter((c) => c.breaches.includes(id));
  const label = (module: string) => landscape?.objects.find((o) => o.module === module)?.label ?? module;
  const system = (sid: string) => landscape?.systems.find((s) => s.id === sid);
  return (
    <>
      <Facts>
        <Fact label={t("Rule")}>
          <Mono>{id}</Mono>
        </Fact>
        <Fact label={t("Name")}>{name ?? "—"}</Fact>
        <Fact label={t("Over tolerance in")}>{capped.length === 0 ? t("No object") : t("{cappedCount} {cappedCount, plural, one {object} other {objects}}", { cappedCount: capped.length })}</Fact>
      </Facts>
      {capped.length > 0 ? (
        <>
          <h3>{t("Objects it caps")}</h3>
          <ul className="m2-breaches">
            {capped.map((c) => (
              <li key={`${c.system_id}:${c.module}`}>
                <V2Link href={`/o/${systemSlug(system(c.system_id)?.name ?? c.system_id)}/${moduleSlug(c.module)}`}>{label(c.module)}</V2Link>
                <span className="m2-meta">{system(c.system_id)?.name}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Actions>
        <V2Link href={`/r/${encodeURIComponent(id)}`} className="m2-btn m2-strong">
          {t("Open the rule")}
        </V2Link>
      </Actions>
    </>
  );
}

function titleFor(item: OpenItem): { title: ReactNode; status: ReactNode } {
  if (item.kind === "rule") return { title: <Mono>{item.id}</Mono>, status: t("Rule") };
  return { title: item.id, status: t("Feature") };
}

/** Shell slot: the right-hand inspector, driven by `?open=<kind>:<id>`. Renders nothing when nothing is open. */
export function Inspector() {
  const { open, close } = useOpenItem();
  const landscape = useLandscape(null).data;
  if (!open) return null;
  const extension = extensionFor(open, close);
  if (extension) return extension;
  if (open.kind === "record") return <RecordInspector id={open.id} onClose={close} />;
  const { title, status } = titleFor(open);
  return (
    <InspectorFrame title={title} status={status} onClose={close}>
      {open.kind === "rule" ? (
        <RuleInspectorBody id={open.id} landscape={landscape} />
      ) : (
        <EmptyFrame>{t("This selection has nothing more to show. Close the inspector and choose a row.")}</EmptyFrame>
      )}
    </InspectorFrame>
  );
}
