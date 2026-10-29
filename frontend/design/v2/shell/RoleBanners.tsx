"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { resolveShareLink, stopViewAs } from "@/lib/api/v2/roles";
import { failureText } from "@/lib/v2/errors";
import { useV2Href, useV2Session } from "@/lib/v2/hooks";
import { installViewAsHeader, ROLE_NAMES, setShareMode, setViewAs } from "@/lib/v2/view-as";
import { EmptyFrame, PageTitle, Skeleton } from "../parts";
import "../roles.css";

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
      <div className="m2-banner" role="status" data-testid="view-as-banner">
        <span>
          <strong>{`Viewing as ${ROLE_NAMES[session.viewAs] ?? session.viewAs}.`}</strong> Read-only: you see what this role sees, and nothing can be changed until you stop.
        </span>
        <button type="button" className="m2-btn m2-sm" onClick={() => void stop()}>
          Stop viewing as
        </button>
        {error ? <span role="alert">{error}</span> : null}
      </div>
    );
  }
  if (session.shared) {
    return (
      <div className="m2-banner" data-tone="info" role="status" data-testid="shared-banner">
        <span>
          <strong>Shared view.</strong> Read-only, as a viewer.
        </span>
        <button type="button" className="m2-btn m2-sm" onClick={() => setShareMode(null)}>
          Leave the shared view
        </button>
      </div>
    );
  }
  return null;
}

/** `/v2/share/<token>`: resolves the link, enters the read-only shared view and opens the page it points at. */
export function ShareLanding() {
  const pathname = usePathname();
  const router = useRouter();
  const href = useV2Href();
  const token = decodeURIComponent(pathname.split("/v2/share/")[1] ?? "").split("/")[0];
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    resolveShareLink(token)
      .then((r) => {
        if (!alive) return;
        setShareMode(r.label ?? "Shared view");
        const qs = new URLSearchParams(r.state).toString();
        router.replace(href(`${r.route}${qs ? `?${qs}` : ""}`));
      })
      .catch((e: unknown) => alive && setError(failureText(e)));
    return () => {
      alive = false;
    };
  }, [token, router, href]);
  return (
    <>
      <PageTitle>Shared view</PageTitle>
      {error ? <EmptyFrame>{error}</EmptyFrame> : <Skeleton width={320} height={14} />}
    </>
  );
}
