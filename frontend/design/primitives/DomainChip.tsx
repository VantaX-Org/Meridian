import { clsx } from "clsx";
import { domainLabel, domainOf, type DomainKey } from "../tokens";

/**
 * Domain chip: soft domain fill, 8px square swatch (square, so it never reads as a status dot).
 * Pass `domain` directly, or `moduleId` to resolve it through `domainOf`. `label` overrides the domain name.
 */
export function DomainChip({ domain, moduleId, label }: { domain?: DomainKey; moduleId?: string | null; label?: string }) {
  const key = domain ?? domainOf(moduleId);
  return (
    <span className={clsx("m-chip-domain", `m-chip-domain-${key}`)} data-domain={key}>
      <span className="m-chip-domain-swatch" aria-hidden="true" />
      {label ?? domainLabel[key]}
    </span>
  );
}
