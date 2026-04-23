/**
 * Aurora WS4 shell primitives — barrel.
 *
 * Consumers import from `@/components/aurora`. The shell primitives
 * (AppShell, WorkspaceSwitcher, CommandPalette, Tabs, Breadcrumb, Drawer)
 * frame every workspace.
 */

export { AppShell } from "./app-shell";
export type { AppShellProps } from "./app-shell";

export { WorkspaceSwitcher } from "./workspace-switcher";
export type {
  WorkspaceId,
  WorkspaceSwitcherItem,
  WorkspaceSwitcherProps,
} from "./workspace-switcher";

export { CommandPalette } from "./command-palette";
export type { CommandPaletteCommand, CommandPaletteProps } from "./command-palette";

export { Tabs } from "./tabs";
export type { TabsItem, TabsProps } from "./tabs";

export { Breadcrumb } from "./breadcrumb";
export type { BreadcrumbItem, BreadcrumbProps } from "./breadcrumb";

export { Drawer } from "./drawer";
export type { DrawerProps } from "./drawer";

export { useDrawerParam } from "./use-drawer-param";
export type { UseDrawerParamResult } from "./use-drawer-param";
