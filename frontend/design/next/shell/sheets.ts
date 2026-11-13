/** Later batches register their sheet kinds here: `registerSheet("connect", (ctx) => ...)`. Imported once by SheetHost. */
export {};

// story-feed: load
// The load sheets live in a .tsx file; registration is deferred one tick so SheetHost has finished evaluating.
import { registerLoadSheets } from "../load/register";
// SheetHost imports this file before its registry exists, so retry on the next tick until it does.
const registerLoad = (n = 0) => {
  try {
    registerLoadSheets();
  } catch (e) {
    if (n < 20 && e instanceof ReferenceError) setTimeout(() => registerLoad(n + 1), 0);
    else throw e;
  }
};
registerLoad();
