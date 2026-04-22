/**
 * Aurora WS2 primitives — barrel.
 *
 * Consumers import from `@/components/aurora` (top-level barrel). These
 * primitives compose into the Aurora Data primitives (WS3), Shell (WS4),
 * and signature moments (WS5).
 */

export { Text } from "./text";
export type { TextProps, TextTone, TextVariant } from "./text";

export { Icon } from "./icon";
export type { IconProps, IconSize } from "./icon";

export { Stack, Divider } from "./stack";
export type {
  DividerProps,
  StackAlign,
  StackDirection,
  StackGap,
  StackJustify,
  StackProps,
} from "./stack";

export { Button } from "./button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./button";

export { Field, Input, Select, Textarea } from "./forms";
export type {
  FieldProps,
  InputProps,
  SelectOption,
  SelectProps,
  TextareaProps,
} from "./forms";

export { Combobox } from "./combobox";
export type { ComboboxProps } from "./combobox";

export { Chip } from "./chip";
export type { ChipProps, ChipTone } from "./chip";

export { Avatar } from "./avatar";
export type { AvatarProps, AvatarSize } from "./avatar";

export { Banner } from "./banner";
export type { BannerProps, BannerTone } from "./banner";
