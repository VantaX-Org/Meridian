import { Button } from "./Button";

/** The last change with a one-step Undo. Render it only while there is something to undo. */
export function UndoToast({ message, actionLabel, onAction }: { message: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="mx-undo" role="status">
      <span>{message}</span>
      <Button variant="ghost" onClick={onAction}>{actionLabel}</Button>
    </div>
  );
}
