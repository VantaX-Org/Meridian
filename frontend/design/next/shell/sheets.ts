/** Later batches register their sheet kinds here: `registerSheet("connect", (ctx) => ...)`. Imported once by SheetHost. */
export {};

// story-feed: work (Batch E) start
import { createElement } from "react";
import { registerSheet } from "./registry";
import { RunSheet } from "../runs/RunSheet";
import { CompareSheet } from "../runs/CompareSheet";
import { RunDetailSheet } from "../runs/RunDetail";

registerSheet("run", ({ id, step, setStep, close, under }) =>
  id === "new"
    ? createElement(RunSheet, { step, setStep, close, under })
    : createElement(RunDetailSheet, { id, close, under }));
registerSheet("compare", ({ id, close, under }) => createElement(CompareSheet, { id, close, under }));
// story-feed: work (Batch E) end

// story-feed: object
import "../object/register";
