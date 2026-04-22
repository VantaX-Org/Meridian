/**
 * Aurora primitive internal helpers.
 *
 * No external dependencies. Consumers import from the primitives barrel.
 */

/** Join classnames, dropping falsy values. */
export function clsx(
  ...values: Array<string | number | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

/** Generate a stable id for aria-describedby / aria-controls links. */
let idCounter = 0;
export function uniqueId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
