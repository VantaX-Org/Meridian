/**
 * Aurora density tiers — §5.4.1.
 *
 * Three user-selectable tiers. Density affects row heights, padding within
 * cards, and the default type size in tables. Nothing else. Information
 * architecture is identical across tiers.
 */

export type DensityTier = "compact" | "default" | "comfortable";

export interface DensitySpec {
  rowHeight: number; // px — table row / list item
  cardPadding: number; // px — inner padding on cards
  tableTypeSize: number; // px — default body text in tables
  description: string;
}

export const density: Record<DensityTier, DensitySpec> = {
  compact: {
    rowHeight: 28,
    cardPadding: 12,
    tableTypeSize: 13,
    description: "Power analysts, large monitors",
  },
  default: {
    rowHeight: 36,
    cardPadding: 16,
    tableTypeSize: 14,
    description: "Default for most users",
  },
  comfortable: {
    rowHeight: 44,
    cardPadding: 24,
    tableTypeSize: 14,
    description: "Executive surfaces, first-time users",
  },
};

/** Localstorage key for the user's density preference. */
export const DENSITY_STORAGE_KEY = "aurora:density";

export const DEFAULT_DENSITY: DensityTier = "default";
