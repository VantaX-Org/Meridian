"use client";

import { t } from "@/lib/v2/i18n";
import { errorSentence } from "@/lib/api/v2/client";
import { Button } from "./Button";
import { Icon } from "../Icon";

/** One sentence and Retry. Never a stack trace: pass the raw error and the fallback sentence, or a ready sentence. */
export function ErrorState({ sentence, error, fallback, onRetry }: { sentence?: string; error?: unknown; fallback?: string; onRetry?: () => void }) {
  const text = sentence ?? errorSentence(error, fallback ?? t("Something went wrong. Try again."));
  return (
    <div role="alert" className="nx-error">
      <span className="nx-error-icon" aria-hidden="true"><Icon name="alert" size={20} /></span>
      <p className="nx-error-p">{text}</p>
      {onRetry ? <Button variant="secondary" size={32} icon="refresh" onClick={onRetry}>{t("Retry")}</Button> : null}
    </div>
  );
}
