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
