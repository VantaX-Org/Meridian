"use client";

import { useEffect, useId, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Landscape, Receipt } from "@/lib/api/v2/types";
import { useOpenItem, type OpenItem } from "@/lib/v2/hooks";
import { useLandscape, v2Keys } from "@/lib/v2/queries";
import { moduleSlug, systemSlug } from "@/lib/v2/score";
import { IconClose } from "./marks";
import { EmptyFrame, Mono, V2Link } from "./parts";
import { extensionFor } from "./inspector/registry";
import { RuleInspectorBody } from "./inspector/rule";
import { RecordInspector } from "./screens/RecordInspector";
import { t } from "@/lib/v2/i18n";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface InspectorFrameProps {
  title: ReactNode;
  status?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The inspector's anatomy, the same for every kind of thing: a title, a status line, then facts, actions and
 * history in the body. It is a dialog: Tab cycles inside it, Esc closes it, focus goes to Close when it opens and
 * back to where it was when it closes. On a phone it fills the screen.
 */
export function InspectorFrame({ title, status, onClose, children }: InspectorFrameProps) {
  const root = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    closeBtn.current?.focus({ preventScroll: true });
    return () => {
      const back = opener && document.contains(opener) ? opener : document.getElementById("m2-canvas");
      back?.focus({ preventScroll: true });
    };
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !root.current) return;
    const items = Array.from(root.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("disabled"));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !root.current.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !root.current.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    // The aside is the inspector's landmark (a skip link and a screen reader's region list reach it); the dialog inside
    // it holds the focus loop and Esc.
    <aside className="m2-insp" id="m2-inspector" aria-label={t("Inspector")}>
      <div ref={root} className="m2-insp-d" role="dialog" aria-modal="false" aria-labelledby={titleId} onKeyDown={onKeyDown} data-testid="inspector">
      <div className="m2-ih">
        <div style={{ minWidth: 0 }}>
          <h2 id={titleId}>{title}</h2>
          {status ? <div className="m2-ih-sl">{status}</div> : null}
        </div>
        <button ref={closeBtn} type="button" className="m2-x" onClick={onClose} aria-label={t("Close inspector")}>
          <IconClose />
          <span className="m2-x-t">{t("Close")}</span>
        </button>
      </div>
      <div className="m2-ib">{children}</div>
      </div>
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
                <V2Link href={`/v2/o/${systemSlug(system(c.system_id)?.name ?? c.system_id)}/${moduleSlug(c.module)}`}>{label(c.module)}</V2Link>
                <span className="m2-meta">{system(c.system_id)?.name}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Actions>
        <V2Link href={`/v2/r/${encodeURIComponent(id)}`} className="m2-btn m2-strong">
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
        <EmptyFrame>{t("Feature impact fills here in the next step.")}</EmptyFrame>
      )}
    </InspectorFrame>
  );
}
