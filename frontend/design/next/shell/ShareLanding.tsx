"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { resolveShareLink } from "@/lib/api/v2/roles";
import { failureText } from "@/lib/v2/errors";
import { useV2Href } from "@/lib/v2/hooks";
import { setShareMode } from "@/lib/v2/view-as";
import { t } from "@/lib/v2/i18n";
import { ErrorState, LargeTitle, Skeleton } from "../kit";
import "../frames.css";

/** A share link: resolve the token, mark the session read only, then go to the shared page. */
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
    <div className="nx-share" data-testid="share-frame">
      <section className="nx-share-card" aria-busy={!error || undefined}>
        <LargeTitle title={t("Shared view")} subtitle={t("Opens a shared view of one page, read only, then takes you to it.")} />
        {error ? (
          <>
            <ErrorState sentence={error} />
            <p>{t("Ask the person who shared it for a new link, or sign in to open the page directly.")}</p>
          </>
        ) : (
          <Skeleton lines={2} label={t("Opening the shared page")} />
        )}
      </section>
    </div>
  );
}
