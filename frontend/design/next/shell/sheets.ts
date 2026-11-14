import { createElement } from "react";
import { registerSheet } from "./registry";
import { ConnectFlow } from "../flows/ConnectFlow";
import { InviteFlow } from "../flows/InviteFlow";
import { LicenceFlow } from "../flows/LicenceFlow";
import { NotifyFlow } from "../flows/NotifyFlow";
import { UpdateFlow } from "../flows/UpdateFlow";
import { PersonSheet } from "../admin/PersonSheet";
import { ReportSheet } from "../more/ReportSheet";
import { RuleSheet } from "../more/RuleSheet";

// story-feed: work (Batch E) start
import { registerSheet as registerWorkSheet } from "./registry";
import { RunSheet } from "../runs/RunSheet";
import { CompareSheet } from "../runs/CompareSheet";
import { RunDetailSheet } from "../runs/RunDetail";

registerWorkSheet("run", ({ id, step, setStep, close, under }) =>
  id === "new"
    ? createElement(RunSheet, { step, setStep, close, under })
    : createElement(RunDetailSheet, { id, close, under }));
registerWorkSheet("compare", ({ id, close, under }) => createElement(CompareSheet, { id, close, under }));
// story-feed: work (Batch E) end

// story-feed: object
import "../object/register";

// story-feed: load
import "../load/register";

/** Later batches register their sheet kinds here: `registerSheet("connect", (ctx) => ...)`. Imported once by SheetHost. */

// story-feed: more
// The Rules page's sheet is "library-rule" so it does not take over the object page's "rule" sheet.
export const MORE_SHEETS = ["connect", "invite", "person", "library-rule", "report", "licence", "notify", "update"] as const;
registerSheet("connect", (ctx) => createElement(ConnectFlow, { ctx }));
registerSheet("invite", (ctx) => createElement(InviteFlow, { ctx }));
registerSheet("person", (ctx) => createElement(PersonSheet, { ctx }));
registerSheet("library-rule", (ctx) => createElement(RuleSheet, { ctx }));
registerSheet("report", (ctx) => createElement(ReportSheet, { ctx }));
registerSheet("licence", (ctx) => createElement(LicenceFlow, { ctx }));
registerSheet("notify", (ctx) => createElement(NotifyFlow, { ctx }));
registerSheet("update", (ctx) => createElement(UpdateFlow, { ctx }));
