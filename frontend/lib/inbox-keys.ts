export interface InboxKeyContext {
  focusedIndex: number;
  rowCount: number;
  setFocus: (index: number) => void;
  onOpen: (index: number) => void;
}

/** j/k move focus through the inbox list, enter opens the fix sheet (spec 6.2). */
export function inboxKeyHandler(event: KeyboardEvent, ctx: InboxKeyContext): void {
  if (ctx.rowCount === 0) return;
  switch (event.key) {
    case "j":
      event.preventDefault();
      ctx.setFocus(Math.min(ctx.focusedIndex + 1, ctx.rowCount - 1));
      return;
    case "k":
      event.preventDefault();
      ctx.setFocus(Math.max(ctx.focusedIndex - 1, 0));
      return;
    case "Enter":
      event.preventDefault();
      ctx.onOpen(ctx.focusedIndex);
      return;
    default:
      return;
  }
}
