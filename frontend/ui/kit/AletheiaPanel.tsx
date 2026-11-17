"use client";

import { useEffect, useState } from "react";
import { getSuggestions } from "@/lib/api/v2/assistant";
import { t } from "@/lib/v2/i18n";
import { AletheiaSheet, type AletheiaLabels } from "./AletheiaSheet";
import { useAletheia } from "./aletheia";

/** The one chat instance, mounted by the shell. It reads its open state, thread and scope from AletheiaProvider. */
export default function AletheiaPanel({ labels }: { labels: AletheiaLabels }) {
  const { open, setOpen, scope, thread, ask, clearContext } = useAletheia();
  const ctx = scope?.context;
  const ctxKey = ctx ? JSON.stringify(ctx) : "";
  const live = open && !!ctx && !scope?.answer;
  const [fetched, setFetched] = useState<{ key: string; list: string[] } | null>(null);
  useEffect(() => {
    if (!live || !ctx) return;
    let gone = false;
    getSuggestions({ module: ctx.module, version_id: ctx.version_id, check_id: ctx.check_id })
      .then((list) => { if (!gone) setFetched({ key: ctxKey, list }); })
      .catch(() => undefined);
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, ctxKey]);
  // The screen's own prompts are the static fallback until the live ones arrive.
  const suggestions = fetched?.key === ctxKey && fetched.list.length ? fetched.list : scope?.suggestions ?? [];
  const chip = ctx && (ctx.check_id || ctx.record_key || ctx.module) ? (
    <p className="mx-ans-scope" aria-label={t("Scope of this chat")}>
      <span>{ctx.check_id ? t("Rule {rule}", { rule: ctx.check_id }) : scope?.label}</span>
      {ctx.check_id || ctx.record_key ? <button type="button" onClick={clearContext} aria-label={t("Clear the rule scope")}>{t("Clear")}</button> : null}
    </p>
  ) : null;
  return (
    <AletheiaSheet
      open={open}
      onClose={() => setOpen(false)}
      labels={scope ? { ...labels, scope: scope.label } : labels}
      thread={thread}
      suggestions={suggestions}
      onAsk={ask}
      scopeChip={chip}
    />
  );
}
