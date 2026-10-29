"use client";

import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { V2Link } from "../parts";
import "../roles.css";

/**
 * The People canvas's verbs (step 6c): Balance work for whoever may assign, Data contracts for everyone (the verbs
 * inside are gated), and Out of office.
 */
export function PeopleActions() {
  const session = useV2Session();
  const { hrefFor } = useOpenItem();
  const live = !session.shared && !session.viewAs;
  return (
    <div className="m2-gtools" data-testid="people-actions" style={{ margin: "8px 0" }}>
      {session.can("assign") && live ? (
        <V2Link href={hrefFor({ kind: "balance", id: "" })} className="m2-btn m2-sm">
          Balance work
        </V2Link>
      ) : null}
      <V2Link href={hrefFor({ kind: "contracts", id: "" })} className="m2-btn m2-sm">
        Data contracts
      </V2Link>
      {live ? (
        <V2Link href={hrefFor({ kind: "away", id: "" })} className="m2-btn m2-sm">
          Out of office
        </V2Link>
      ) : null}
    </div>
  );
}
