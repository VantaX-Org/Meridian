"use client";

import type { Delegation } from "@/lib/api/v2/roles";
import { formatDate } from "@/lib/format";
import { useMyDelegations } from "@/lib/v2/roles-queries";
import { t } from "@/lib/v2/i18n";
import { Note } from "./work-common";

const day = (iso: string): string => formatDate(`${iso.slice(0, 10)}T12:00:00Z`, "date");

/** One sentence per active delegation that concerns this inspector: `personId` narrows to delegations naming that person. */
export function DelegationBanner({ personId }: { personId?: string }) {
  const q = useMyDelegations();
  if (!q.data) return null;
  const mine = (d: Delegation) => d.state === "active" && (!personId || d.from_user_id === personId || d.to_user_id === personId);
  const away = q.data.away.filter(mine);
  const covering = q.data.covering.filter(mine);
  if (!away.length && !covering.length) return null;
  return (
    <div data-testid="delegation-banner">
      {covering.map((d) => (
        <Note key={d.id}>{t("You cover for {from_name} until {day}: their approvals and assigned work come to you as well.", { from_name: d.from_name, day: day(d.ends_on) })}</Note>
      ))}
      {away.map((d) => (
        <Note key={d.id}>{t("You are out of office until {day}. {to_name} covers your approvals and assigned work.", { day: day(d.ends_on), to_name: d.to_name })}</Note>
      ))}
    </div>
  );
}
