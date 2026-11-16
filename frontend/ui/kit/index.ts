import "./kit.css";

export { AletheiaSheet, type AletheiaLabels, type ChatAction, type ChatMessage } from "./AletheiaSheet";
export { AletheiaProvider, useAletheia, useAletheiaScope, type AletheiaAnswer, type AletheiaScope } from "./aletheia";
export { Sheet } from "./Sheet";
export { useStacked } from "./useStacked";
export { AppShell, type ShellMenuItem, type ShellSection } from "./AppShell";
export { Button, type ButtonVariant } from "./Button";
export { Card } from "./Card";
export { DetailPanel } from "./DetailPanel";
export { DimensionBars, type DimensionItem } from "./DimensionBars";
export { DqsPair, type PairRow } from "./DqsPair";
export { FieldChip } from "./FieldChip";
export { MasterList, type MasterRow } from "./MasterList";
export { PageHeader } from "./PageHeader";
export { ScoreRing } from "./ScoreRing";
export { SeverityStrip, type Severity, type SeverityTile } from "./SeverityStrip";
export { EmptyState, ErrorState, Skeleton } from "./states";
export { StatTile } from "./StatTile";
export { Tabs, type TabItem } from "./Tabs";
export { TrendArea, type TrendPoint } from "./TrendArea";

// Spec names (section 3) for the pieces that already match one to one.
export { PageHeader as Page } from "./PageHeader";
export { StatTile as Tile } from "./StatTile";
export { EmptyState as Empty } from "./states";
export { DqsPair as PairBars } from "./DqsPair";
export { SeverityStrip as SegBar } from "./SeverityStrip";
export { TrendArea as AreaSpark } from "./TrendArea";
export { FieldChip as Code } from "./FieldChip";
