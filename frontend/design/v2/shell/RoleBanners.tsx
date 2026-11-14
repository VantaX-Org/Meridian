"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { resolveShareLink, stopViewAs } from "@/lib/api/v2/roles";
import { failureText } from "@/lib/v2/errors";
import { useV2Href, useV2Session } from "@/lib/v2/hooks";
import { installViewAsHeader, ROLE_NAMES, setShareMode, setViewAs } from "@/lib/v2/view-as";
import { PageTitle } from "../parts";
import { Mark } from "../marks";
import "../roles.css";
import "@/design/next/tokens.css";
import "@/design/next/motion.css";
import "@/design/next/frames.css";
import { t } from "@/lib/v2/i18n";

/**
 * The shell's role banners (step 6c), one line under the job line: "Viewing as Data steward, read-only" while an
 * administrator views as a role, and "Shared view, read-only" on a page opened from a share link. Each says how to
 * leave. Also installs the X-View-As-Role request header once.
 */
export function RoleBanners() {
  const session = useV2Session();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => installViewAsHeader(), []);
  const stop = async () => {
    setError(null);
    try {
      await stopViewAs();
    } catch (e) {
      setError(failureText(e));
    }
    setViewAs(null);
    await qc.invalidateQueries();
  };
  if (session.viewAs) {
    return (
      <div className="m2-rbanner" role="status" data-testid="view-as-banner">
        <span>
          <strong>{t("Viewing as {ROLE_NAMES}.", { ROLE_NAMES: ROLE_NAMES[session.viewAs] ?? session.viewAs })}</strong>{" "}{t("Read-only: you see what this role sees, and nothing can be changed until you stop.")}
        </span>
        <button type="button" className="m2-btn m2-sm" onClick={() => void stop()}>
          {t("Stop viewing as")}
        </button>
        {error ? <span role="alert">{error}</span> : null}
      </div>
    );
  }
  if (session.shared) {
    return (
      <div className="m2-rbanner" data-tone="info" role="status" data-testid="shared-banner">
        <span>
          <strong>{t("Shared view.")}</strong>{" "}{t("Read-only, as a viewer.")}
        </span>
        <button type="button" className="m2-btn m2-sm" onClick={() => setShareMode(null)}>
          {t("Leave the shared view")}
        </button>
      </div>
    );
  }
  return null;
}

/** `/share/<token>`: resolves the link, enters the read-only shared view and opens the page it points at. */
export function ShareLanding() {
  const pathname = usePathname();
  const router = useRouter();
  const href = useV2Href();
  const token = decodeURIComponent(pathname.split("/share/")[1] ?? "").split("/")[0];
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    resolveShareLink(token)
      .then((r) => {
        if (!alive) return;
        setShareMode(r.label ?? t("Shared view"));
        const qs = new URLSearchParams(r.state).toString();
        router.replace(href(`${r.route}${qs ? `?${qs}` : ""}`));
      })
      .catch((e: unknown) => alive && setError(failureText(e)));
    return () => {
      alive = false;
    };
  }, [token, router, href]);
  return (
    <div className="nx-root nx-frame nx-share" data-testid="share-frame">
      <section className="nx-share-card" aria-busy={!error || undefined}>
        <Mark />
        <PageTitle>{t("Shared view")}</PageTitle>
        <p>{t("Opens a shared view of one page, read only, then takes you to it.")}</p>
        {error ? (
          <>
            <p className="nx-share-failed" role="alert">{error}</p>
            <p>{t("Ask the person who shared it for a new link, or sign in to open the page directly.")}</p>
          </>
        ) : (
          <div className="nx-share-story" role="status" aria-label={t("Opening the shared page")}>
            <span className="nx-skeleton-bar" aria-hidden="true" />
            <span className="nx-skeleton-bar" aria-hidden="true" />
          </div>
        )}
      </section>
    </div>
  );
}
