/**
 * What can be taken back: the last changes made in this tab, newest last. The server keeps each change for ten
 * minutes (POST /actions/undo); this list only remembers the action ids so Cmd+Z and the toast can name them.
 */
export interface DoneAction {
  /** One id per run the change touched; undone newest first. */
  ids: string[];
  /** Takes the change back itself (the Admin area: re-enable a user), instead of the server's POST /actions/undo. */
  undo?: () => Promise<void>;
  /** What was done, in a short sentence: "Accepted 112 suggested values". */
  label: string;
}

const MAX = 20;
let stack: DoneAction[] = [];

export const pushAction = (a: DoneAction): void => {
  stack = [...stack, a].slice(-MAX);
};
export const popAction = (): DoneAction | undefined => {
  const a = stack[stack.length - 1];
  stack = stack.slice(0, -1);
  return a;
};
export const removeAction = (a: DoneAction): void => {
  stack = stack.filter((x) => x !== a);
};
export const peekAction = (): DoneAction | undefined => stack[stack.length - 1];
export const resetActions = (): void => {
  stack = [];
};
