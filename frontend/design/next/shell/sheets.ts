import { createElement } from "react";
import { ConnectFlow } from "../flows/ConnectFlow";
import { InviteFlow } from "../flows/InviteFlow";
import { LicenceFlow } from "../flows/LicenceFlow";
import { NotifyFlow } from "../flows/NotifyFlow";
import { UpdateFlow } from "../flows/UpdateFlow";
import { PersonSheet } from "../admin/PersonSheet";
import { ReportSheet } from "../more/ReportSheet";
import { RuleSheet } from "../more/RuleSheet";

/** Later batches register their sheet kinds here: `registerSheet("connect", (ctx) => ...)`. Imported once by SheetHost. */

// story-feed: more
// SheetHost imports this file before it creates its registry, so a direct call here would hit the temporal dead zone.
// A dynamic import settles only once SheetHost has finished evaluating, and long before any sheet can open.
export const MORE_SHEETS = ["connect", "invite", "person", "rule", "report", "licence", "notify", "update"] as const;
function registerAll(registerSheet: typeof import("./SheetHost").registerSheet) {
  registerSheet("connect", (ctx) => createElement(ConnectFlow, { ctx }));
  registerSheet("invite", (ctx) => createElement(InviteFlow, { ctx }));
  registerSheet("person", (ctx) => createElement(PersonSheet, { ctx }));
  registerSheet("rule", (ctx) => createElement(RuleSheet, { ctx }));
  registerSheet("report", (ctx) => createElement(ReportSheet, { ctx }));
  registerSheet("licence", (ctx) => createElement(LicenceFlow, { ctx }));
  registerSheet("notify", (ctx) => createElement(NotifyFlow, { ctx }));
  registerSheet("update", (ctx) => createElement(UpdateFlow, { ctx }));
}

// Retry until SheetHost has finished evaluating; the first try can land inside its temporal dead zone.
function boot(tries = 0): void {
  import("./SheetHost").then(({ registerSheet }) => {
    try {
      registerAll(registerSheet);
    } catch (e) {
      if (tries < 50) setTimeout(() => boot(tries + 1), 0);
      else throw e;
    }
  });
}
boot();
