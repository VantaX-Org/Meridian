"use client";

import { useRunParam } from "@/lib/v2/hooks";
import { useLandscape } from "@/lib/v2/queries";
import { moduleSlug, systemSlug } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { RunTimelineMenu } from "../RunTimeline";
import { PageTitle, V2Link } from "../parts";

/** Every system and its objects, one link each. A stub until the objects index is designed. */
export function ObjectsCanvas() {
  const L = useLandscape(useRunParam()).data;
  return (
    <>
      <PageTitle>{t("Objects")}</PageTitle>
      <RunTimelineMenu />
      {(L?.systems ?? []).map((s) => (
        <section key={s.id}>
          <h2 className="m2-h2">{s.name}</h2>
          {s.state === "analysed" ? (
            <ul>
              {L?.cells
                .filter((c) => c.system_id === s.id)
                .map((c) => (
                  <li key={c.module}>
                    <V2Link href={`/o/${systemSlug(s.name)}/${moduleSlug(c.module)}`}>{L.objects.find((o) => o.module === c.module)?.label ?? c.module}</V2Link>
                  </li>
                ))}
            </ul>
          ) : (
            <p>{s.state === "extracted" ? t("Extracted, not analysed.") : t("Not extracted yet.")}</p>
          )}
        </section>
      ))}
    </>
  );
}
