/**
 * Aurora SAP iconography — §5.8 + §10.
 *
 * Hand-drawn, 24×24, 1.5px stroke, `currentColor` fill. These are the
 * domain-specific icons that Lucide cannot supply. Every SAP module and
 * core object gets a recognisable mark so the product reads as
 * SAP-native — not as a generic B2B shell.
 *
 * Size tokens from `@/lib/aurora` (`iconSize.sm` 16 / `md` 20 / `lg` 24).
 * Stroke weight is invariant across sizes.
 */

import type { SVGProps } from "react";

import { iconSize } from "../tokens";

type AuroraIconProps = SVGProps<SVGSVGElement> & {
  size?: keyof typeof iconSize | number;
  title?: string;
};

function resolveSize(size: AuroraIconProps["size"]): number {
  if (typeof size === "number") return size;
  if (size && size in iconSize) return iconSize[size];
  return iconSize.md;
}

function withTitle(title?: string) {
  return title ? <title>{title}</title> : null;
}

/** Base wrapper so every icon inherits the same defaults. */
function AuroraSvg({
  children,
  size,
  title,
  ...props
}: AuroraIconProps & { children: React.ReactNode }) {
  const px = resolveSize(size);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {withTitle(title)}
      {children}
    </svg>
  );
}

/** Business Partner (BP) — figure joined to an enterprise mark. */
export function BusinessPartnerIcon(props: AuroraIconProps) {
  return (
    <AuroraSvg title="Business partner" {...props}>
      <circle cx="8" cy="8" r="3" />
      <path d="M3 20c0-3 2.2-5 5-5s5 2 5 5" />
      <path d="M15 9h6v12h-6z" />
      <path d="M17.5 13h1M17.5 16h1" />
    </AuroraSvg>
  );
}

/** Material Master (MM) — isometric cube with a facet line. */
export function MaterialMasterIcon(props: AuroraIconProps) {
  return (
    <AuroraSvg title="Material master" {...props}>
      <path d="M12 3 21 7.5v9L12 21 3 16.5v-9Z" />
      <path d="m3 7.5 9 4.5 9-4.5" />
      <path d="M12 12v9" />
    </AuroraSvg>
  );
}

/** Finance (FI) — ledger book with binding. */
export function FinanceLedgerIcon(props: AuroraIconProps) {
  return (
    <AuroraSvg title="Finance ledger" {...props}>
      <path d="M5 4h13a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Z" />
      <path d="M5 17h14" />
      <path d="M9 4v16" />
      <path d="M12 8h5M12 11h5" />
    </AuroraSvg>
  );
}

/** Sales & Distribution (SD) — outbound arrow through a packet. */
export function SalesDistributionIcon(props: AuroraIconProps) {
  return (
    <AuroraSvg title="Sales and distribution" {...props}>
      <path d="M3 7h11l3 4v6H6a3 3 0 0 1-3-3V7Z" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15.5" cy="18" r="1.5" />
      <path d="m17 5 4 3-4 3" />
      <path d="M17 8h-5" />
    </AuroraSvg>
  );
}

/** Human Resources (HR) — figure with an ID badge tile. */
export function HrEmployeeIcon(props: AuroraIconProps) {
  return (
    <AuroraSvg title="Human resources" {...props}>
      <circle cx="12" cy="7" r="3" />
      <path d="M5 21c.5-4 3.5-7 7-7s6.5 3 7 7" />
      <rect x="14" y="3" width="5" height="3.5" rx="0.5" />
    </AuroraSvg>
  );
}

/** GL Account — ledger lines with a leading totals bar. */
export function GlAccountIcon(props: AuroraIconProps) {
  return (
    <AuroraSvg title="General ledger account" {...props}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 9h18" />
      <path d="M7 13h10M7 16h6" />
      <path d="M3 4v16" strokeWidth={2.5} />
    </AuroraSvg>
  );
}

/** Company Code — tall building with a defined street line. */
export function CompanyCodeIcon(props: AuroraIconProps) {
  return (
    <AuroraSvg title="Company code" {...props}>
      <path d="M6 20V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v15" />
      <path d="M3 20h18" />
      <path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1" />
      <path d="M11 20v-4h2v4" />
    </AuroraSvg>
  );
}

/** Plant — factory with pitched roofline and chimney. */
export function PlantIcon(props: AuroraIconProps) {
  return (
    <AuroraSvg title="Plant" {...props}>
      <path d="M3 20V11l5 3v-3l5 3v-3l5 3v6" />
      <path d="M3 20h18" />
      <path d="M18 11V6h2v5" />
      <path d="M8 17h1M12 17h1M16 17h1" />
    </AuroraSvg>
  );
}

/** Storage Location — warehouse shelves. */
export function StorageLocationIcon(props: AuroraIconProps) {
  return (
    <AuroraSvg title="Storage location" {...props}>
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <path d="M3 10h18M3 16h18" />
      <path d="M7 4v16M17 4v16" />
      <path d="M10 7h4M10 13h4M10 18h4" />
    </AuroraSvg>
  );
}

/** Sales Area — a plotted region with a marker. */
export function SalesAreaIcon(props: AuroraIconProps) {
  return (
    <AuroraSvg title="Sales area" {...props}>
      <path d="M3 6v13l6-2 6 2 6-2V4l-6 2-6-2-6 2Z" />
      <path d="M9 4v15M15 6v15" />
      <path d="M18 13a2 2 0 1 0-4 0c0 1.6 2 3.5 2 3.5s2-1.9 2-3.5Z" />
    </AuroraSvg>
  );
}

/** Purchasing Organisation — cart shaped like a contract document. */
export function PurchasingOrgIcon(props: AuroraIconProps) {
  return (
    <AuroraSvg title="Purchasing organisation" {...props}>
      <path d="M4 5h3l2 10h9l2-7H8" />
      <circle cx="10" cy="19" r="1.5" />
      <circle cx="17" cy="19" r="1.5" />
      <path d="M12 7v3M12 7l-1.5 1.5M12 7l1.5 1.5" />
    </AuroraSvg>
  );
}

/** Workflow Node — diamond flow glyph with inbound/outbound vertices. */
export function WorkflowNodeIcon(props: AuroraIconProps) {
  return (
    <AuroraSvg title="Workflow node" {...props}>
      <path d="m12 3 9 9-9 9-9-9 9-9Z" />
      <path d="M3 12h4M17 12h4M12 3v4M12 17v4" />
    </AuroraSvg>
  );
}

/** Exported catalogue — keep in sync with §10 of the spec. */
export const auroraSapIcons = {
  businessPartner: BusinessPartnerIcon,
  materialMaster: MaterialMasterIcon,
  financeLedger: FinanceLedgerIcon,
  salesDistribution: SalesDistributionIcon,
  hrEmployee: HrEmployeeIcon,
  glAccount: GlAccountIcon,
  companyCode: CompanyCodeIcon,
  plant: PlantIcon,
  storageLocation: StorageLocationIcon,
  salesArea: SalesAreaIcon,
  purchasingOrg: PurchasingOrgIcon,
  workflowNode: WorkflowNodeIcon,
} as const;

export type AuroraSapIconName = keyof typeof auroraSapIcons;
