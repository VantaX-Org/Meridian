// frontend/design/icons/index.tsx
//
// Meridian's own icon set. One language for every glyph in the product: a 24 grid, a 1.6 stroke,
// round caps and joins, `currentColor`, no fills except a dot or a hub, nothing drawn outside 2.5..21.5.
// Icons stand for a place or an action, never for decoration. Add a glyph here, never import a
// third-party icon library (eslint rejects `lucide-react`).
import type { CSSProperties, JSX, ReactNode, SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "ref" | "children"> & {
  /** Rendered width and height in px. */
  size?: number;
  /** Stroke on the 24 grid. 1.6 reads as one crisp pixel at 16px. */
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
};

export type Icon = (props: IconProps) => JSX.Element;

function glyph(name: string, children: ReactNode): Icon {
  const Component = ({ size = 16, strokeWidth = 1.6, ...rest }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      {...rest}
    >
      {children}
    </svg>
  );
  Component.displayName = `Icon${name[0]!.toUpperCase()}${name.slice(1)}`;
  return Component;
}

/** A filled point: the hub of a gauge, the pupil of a pip, the stop of an "i". */
const Dot = ({ cx, cy, r = 0.9 }: { cx: number; cy: number; r?: number }) => (
  <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
);

/** An eight-tooth gear, generated so the teeth and valleys share one geometry. */
function gearPath(teeth = 8, outer = 9.6, inner = 7.4): string {
  const pt = (r: number, deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
  };
  const step = 360 / teeth;
  const parts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    parts.push(`${i === 0 ? "M" : "L"}${pt(inner, a - step * 0.28)}`, `L${pt(outer, a - step * 0.15)}`, `L${pt(outer, a + step * 0.15)}`, `L${pt(inner, a + step * 0.28)}`);
  }
  return `${parts.join(" ")} Z`;
}

/* ------------------------------------------------------------------ places (navigation) */

export const IconHome = glyph("home", <><path d="M4.5 11 12 4.5l7.5 6.5" /><path d="M6.5 10v9.5h11V10" /><path d="M10 19.5v-5h4v5" /></>);
export const IconServer = glyph("server", <><rect x="4" y="4" width="16" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="16" height="6.5" rx="1.5" /><Dot cx={7.5} cy={7.25} r={1} /><Dot cx={7.5} cy={16.75} r={1} /><path d="M11.5 7.25h5" /><path d="M11.5 16.75h5" /></>);
export const IconImport = glyph("import", <><path d="M4 14.5v3.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.5" /><path d="M12 4v10.5" /><path d="m8.5 11 3.5 3.5 3.5-3.5" /></>);
export const IconMigration = glyph("migration", <><path d="M4 8.5h13" /><path d="m14 5.5 3 3-3 3" /><path d="M20 15.5H7" /><path d="m10 12.5-3 3 3 3" /></>);
export const IconCube = glyph("cube", <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="m4 7.5 8 4.5 8-4.5" /><path d="M12 12v9" /></>);
export const IconHistory = glyph("history", <><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" /><path d="M3.5 3.5v4.4h4.4" /><path d="M12 7.5V12l3 2" /></>);
export const IconEraser = glyph("eraser", <><path d="M13.6 5.6a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L11.6 19.2H8.2l-4.4-4.4a2 2 0 0 1 0-2.8Z" /><path d="m9.4 8.6 6 6" /><path d="M12.4 19.2H20" /></>);
export const IconBranch = glyph("branch", <><circle cx="7" cy="5.5" r="2.25" /><circle cx="7" cy="18.5" r="2.25" /><circle cx="17" cy="9" r="2.25" /><path d="M7 7.75v8.5" /><path d="M7 14c0-3 2.5-3.5 5-3.5h2.75" /></>);
export const IconInbox = glyph("inbox", <><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20" /><path d="M4 13V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6" /><path d="M4 13v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>);
export const IconShield = glyph("shield", <path d="M12 3l7 2.8v5.4c0 4.4-3 7.8-7 9.8-4-2-7-5.4-7-9.8V5.8Z" />);
export const IconShieldAlert = glyph("shieldAlert", <><path d="M12 3l7 2.8v5.4c0 4.4-3 7.8-7 9.8-4-2-7-5.4-7-9.8V5.8Z" /><path d="M12 8.5v4" /><Dot cx={12} cy={15.5} /></>);
export const IconChart = glyph("chart", <><path d="M3.5 20.5h17" /><rect x="5" y="12" width="3.5" height="6" rx=".75" /><rect x="10.25" y="6" width="3.5" height="12" rx=".75" /><rect x="15.5" y="9.5" width="3.5" height="8.5" rx=".75" /></>);
export const IconGauge = glyph("gauge", <><path d="M4 16.5a8 8 0 1 1 16 0" /><path d="m12 16.5 3.6-6" /><Dot cx={12} cy={16.5} r={1.2} /></>);
export const IconTrend = glyph("trend", <><path d="m3.5 16.5 5.5-5.5 3.5 3.5 8-8" /><path d="M15.5 6.5h5v5" /></>);
export const IconCompass = glyph("compass", <><circle cx="12" cy="12" r="8.5" /><path d="m15.2 8.8-1.8 5.2-4.6 1.2 1.8-5.2z" /></>);
export const IconFlag = glyph("flag", <><path d="M5.5 21V4" /><path d="M5.5 4.5H16l-1.5 4 1.5 4H5.5" /></>);
export const IconPeople = glyph("people", <><circle cx="9" cy="8" r="3.25" /><path d="M3.25 19.5a5.75 5.75 0 0 1 11.5 0" /><path d="M15.5 5.1a3.25 3.25 0 0 1 0 5.8" /><path d="M17 14a5.75 5.75 0 0 1 3.75 5.5" /></>);
export const IconProcess = glyph("process", <><rect x="3" y="4" width="6" height="5" rx="1.25" /><rect x="15" y="4" width="6" height="5" rx="1.25" /><rect x="9" y="15" width="6" height="5" rx="1.25" /><path d="M6 9v2a1.5 1.5 0 0 0 1.5 1.5H12V15" /><path d="M18 9v2a1.5 1.5 0 0 1-1.5 1.5H12" /></>);
export const IconDatabase = glyph("database", <><ellipse cx="12" cy="6" rx="7.5" ry="2.75" /><path d="M4.5 6v12c0 1.5 3.4 2.75 7.5 2.75s7.5-1.25 7.5-2.75V6" /><path d="M4.5 12c0 1.5 3.4 2.75 7.5 2.75S19.5 13.5 19.5 12" /></>);
export const IconLayers = glyph("layers", <><path d="m12 3 8 4.5-8 4.5-8-4.5z" /><path d="m4 12 8 4.5 8-4.5" /><path d="m4 16.5 8 4.5 8-4.5" /></>);
export const IconBook = glyph("book", <><path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v16.5H7.5A2.5 2.5 0 0 0 5 21z" /><path d="M5 18.5A2.5 2.5 0 0 1 7.5 16H19" /><path d="M9.5 6.5h6" /><path d="M9.5 10h4" /></>);
export const IconMerge = glyph("merge", <><circle cx="9" cy="12" r="5.5" /><circle cx="15" cy="12" r="5.5" /></>);
export const IconSliders = glyph("sliders", <><path d="M4 7h8.5" /><path d="M17.5 7H20" /><circle cx="15" cy="7" r="2.25" /><path d="M4 17h3.5" /><path d="M12.5 17H20" /><circle cx="10" cy="17" r="2.25" /></>);
export const IconRules = glyph("rules", <><path d="m3.5 6.5 1.75 1.75L8.5 5" /><path d="M11.5 6.5h9" /><path d="m3.5 13 1.75 1.75L8.5 11.5" /><path d="M11.5 13h9" /><path d="M4 19.5h3.5" /><path d="M11.5 19.5h9" /></>);
export const IconContract = glyph("contract", <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="m8.5 15 2 2 4-4.5" /></>);
export const IconDraft = glyph("draft", <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M8.5 12.5h7" /><path d="M8.5 16h3.5" /></>);
export const IconUserShield = glyph("userShield", <><circle cx="9.5" cy="7.5" r="3.5" /><path d="M3.5 20a6 6 0 0 1 9.5-4.9" /><path d="m17.5 12.5 3.5 1.3v2.4c0 2.1-1.4 3.6-3.5 4.5-2.1-.9-3.5-2.4-3.5-4.5v-2.4Z" /></>);
export const IconLog = glyph("log", <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6" /><path d="M9 12h6" /></>);
export const IconGear = glyph("gear", <><path d={gearPath()} /><circle cx="12" cy="12" r="3" /></>);
export const IconFunnel = glyph("funnel", <path d="M3.5 5h17l-6.5 7.5v5.5l-4 2v-7.5z" />);
export const IconMapping = glyph("mapping", <><path d="M4 7h5" /><path d="M15 7h5" /><path d="M4 17h5" /><path d="M15 17h5" /><path d="m9 7 6 10" /><path d="m9 17 6-10" /></>);
export const IconModel = glyph("model", <><circle cx="6" cy="12" r="2.25" /><circle cx="18" cy="6" r="2.25" /><circle cx="18" cy="18" r="2.25" /><path d="m8 11 8-4" /><path d="m8 13 8 4" /></>);
export const IconBell = glyph("bell", <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>);
export const IconActivity = glyph("activity", <path d="M3 12h3.5l2.5-7 4 14 2.5-7H21" />);
export const IconList = glyph("list", <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h9" /></>);
export const IconKey = glyph("key", <><circle cx="8" cy="15" r="4.5" /><path d="m11.2 11.8 8.3-8.3" /><path d="m16.5 6.5 2.5 2.5" /><path d="m14 9 2.5 2.5" /></>);

/* ------------------------------------------------------------------ actions and controls */

export const IconCheck = glyph("check", <path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconClose = glyph("close", <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>);
export const IconChevronDown = glyph("chevronDown", <path d="m6 9.5 6 6 6-6" />);
export const IconChevronUp = glyph("chevronUp", <path d="m6 14.5 6-6 6 6" />);
export const IconChevronLeft = glyph("chevronLeft", <path d="m14.5 6-6 6 6 6" />);
export const IconChevronRight = glyph("chevronRight", <path d="m9.5 6 6 6-6 6" />);
export const IconArrowUp = glyph("arrowUp", <><path d="M12 19.5v-15" /><path d="m5.5 11 6.5-6.5 6.5 6.5" /></>);
export const IconArrowDown = glyph("arrowDown", <><path d="M12 4.5v15" /><path d="m5.5 13 6.5 6.5 6.5-6.5" /></>);
export const IconArrowRight = glyph("arrowRight", <><path d="M4.5 12h15" /><path d="m13 5.5 6.5 6.5-6.5 6.5" /></>);
export const IconArrowUpRight = glyph("arrowUpRight", <><path d="M7 17 17 7" /><path d="M8.5 7H17v8.5" /></>);
export const IconMore = glyph("more", <><Dot cx={5.5} cy={12} r={1.4} /><Dot cx={12} cy={12} r={1.4} /><Dot cx={18.5} cy={12} r={1.4} /></>);
export const IconPlus = glyph("plus", <><path d="M12 5v14" /><path d="M5 12h14" /></>);
export const IconMinus = glyph("minus", <path d="M5 12h14" />);
export const IconTrash = glyph("trash", <><path d="M4.5 6.5h15" /><path d="M9 6.5V4.5h6v2" /><path d="m6.5 6.5.8 12.5a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12.5" /><path d="M10 10.5v6" /><path d="M14 10.5v6" /></>);
export const IconPencil = glyph("pencil", <><path d="M4 20h4L19 9a1.7 1.7 0 0 0 0-2.4l-1.6-1.6a1.7 1.7 0 0 0-2.4 0L4 16z" /><path d="m13.5 6.5 4 4" /></>);
export const IconEye = glyph("eye", <><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>);
export const IconEyeOff = glyph("eyeOff", <><path d="m3.5 3.5 17 17" /><path d="M10.6 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.4 16.4 0 0 1-2.3 3" /><path d="M6.6 6.6C3.8 8.6 2.5 12 2.5 12s3.5 6.5 9.5 6.5a9 9 0 0 0 3.4-.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>);
export const IconSun = glyph("sun", <><circle cx="12" cy="12" r="4" /><path d="M12 2.5V5" /><path d="M12 19v2.5" /><path d="M2.5 12H5" /><path d="M19 12h2.5" /><path d="m5.3 5.3 1.8 1.8" /><path d="m16.9 16.9 1.8 1.8" /><path d="m5.3 18.7 1.8-1.8" /><path d="m16.9 7.1 1.8-1.8" /></>);
export const IconMoon = glyph("moon", <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />);
export const IconMonitor = glyph("monitor", <><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M8.5 20.5h7" /><path d="M12 16.5v4" /></>);
export const IconSearch = glyph("search", <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>);
export const IconHelp = glyph("help", <><circle cx="12" cy="12" r="8.5" /><path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.7-2.5 2-2.5 3.5" /><Dot cx={12} cy={16.5} /></>);
export const IconInfo = glyph("info", <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><Dot cx={12} cy={7.75} /></>);
export const IconLock = glyph("lock", <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5v-3a4 4 0 0 1 8 0v3" /></>);
export const IconLogOut = glyph("logOut", <><path d="M9.5 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3.5" /><path d="m15 16.5 4.5-4.5L15 7.5" /><path d="M19.5 12h-10" /></>);
export const IconPanel = glyph("panel", <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>);
export const IconGrid = glyph("grid", <><rect x="3.5" y="3.5" width="7" height="7" rx="1.25" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.25" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.25" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.25" /></>);

/** Every icon by name, for the gallery sheet and for lookups by string. */
export const ICONS: Readonly<Record<string, Icon>> = {
  home: IconHome, server: IconServer, import: IconImport, migration: IconMigration, cube: IconCube, history: IconHistory,
  eraser: IconEraser, branch: IconBranch, inbox: IconInbox, shield: IconShield, shieldAlert: IconShieldAlert, chart: IconChart,
  gauge: IconGauge, trend: IconTrend, compass: IconCompass, flag: IconFlag, people: IconPeople, process: IconProcess,
  database: IconDatabase, layers: IconLayers, book: IconBook, merge: IconMerge, sliders: IconSliders, rules: IconRules,
  contract: IconContract, draft: IconDraft, userShield: IconUserShield, log: IconLog, gear: IconGear, funnel: IconFunnel,
  mapping: IconMapping, model: IconModel, bell: IconBell, activity: IconActivity, list: IconList, key: IconKey,
  check: IconCheck, close: IconClose, chevronDown: IconChevronDown, chevronUp: IconChevronUp, chevronLeft: IconChevronLeft,
  chevronRight: IconChevronRight, arrowUp: IconArrowUp, arrowDown: IconArrowDown, arrowRight: IconArrowRight,
  arrowUpRight: IconArrowUpRight, more: IconMore, plus: IconPlus, minus: IconMinus, trash: IconTrash, pencil: IconPencil,
  eye: IconEye, eyeOff: IconEyeOff, sun: IconSun, moon: IconMoon, monitor: IconMonitor, search: IconSearch, help: IconHelp,
  info: IconInfo, lock: IconLock, logOut: IconLogOut, panel: IconPanel, grid: IconGrid,
};
