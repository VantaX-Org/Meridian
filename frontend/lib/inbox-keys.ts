export interface InboxKeyContext {
  focusedIndex: number;
  rowCount: number;
  setFocus: (index: number) => void;
  /** Opens the focused row; returning false says nothing opened, so Enter keeps its default. */
  onOpen: (index: number) => boolean | void;
}

/** Widgets that own their keys: a list-level shortcut never fires while focus is inside one. */
const OWNS_KEYS =
  "input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=dialog],[role=alertdialog],[role=listbox],[role=option],[role=menu],[role=menuitem],[role=combobox],[role=tablist]";
/** Controls that Enter activates natively. */
const ACTIVATES = "a,button,summary";

/**
 * True when a window-level list shortcut must leave this key alone: focus is in a field, a dialog, a menu, a
 * listbox, a combobox or a tab list, or Enter is pressed on a link or button that is not one of the list's own rows
 * (`rowSelector` matches a row). Enter on a dialog's Reject button rejects; it never opens the focused record.
 */
export function keyBelongsElsewhere(event: KeyboardEvent, rowSelector?: string): boolean {
  const t = event.target;
  if (!(t instanceof Element)) return false;
  if (t instanceof HTMLElement && t.isContentEditable) return true;
  if (t.closest(OWNS_KEYS)) return true;
  if (event.key === "Enter" && t.closest(ACTIVATES) && !(rowSelector && t.closest(rowSelector))) return true;
  return false;
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
      if (ctx.onOpen(ctx.focusedIndex) !== false) event.preventDefault();
      return;
    default:
      return;
  }
}
