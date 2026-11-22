# Meridian UI kit

Import everything from `@/ui/kit`. Builders use these instead of writing their own. Every component takes already-translated strings as props (no i18n inside the kit); translate with `t()` at the call site. See every component live at `/kit?fixture=1`. Style only with `--mx-*` tokens.

## Layout and shell
- `AppShell`: `{brand, sections, navLabel, user, userMenuLabel, menu, launcher?, aside?, children}`, the top bar, nav, user menu and Aletheia launcher.
- `PageHeader` (alias `Page`): `{title, context?, actions?}`, the one page h1.
- `Split`: `{left, right, leftLabel?, rightLabel?}`, two columns that stack on phone.
- `Card`: `{title, sub?, action?, children, className?}`.
- `Tabs`: `{idBase, label, items: {id,label,badge?}[], value, onChange}`.
- `DetailPanel`: `{idBase, label, header, tabsLabel, tabs, value, onChange, children}`, header plus tabs plus body.
- `MasterList`: `{rows: MasterRow[], selectedId, onSelect, label}`, the rule list with severity and count.

## Overlays and feedback
- `Sheet`: `{open, onClose, label, closeLabel, children}`, side sheet on desktop, bottom sheet on phone.
- `SheetHost` and `useSheet()`: `SheetHost({sheets: Record<id,{label,render(arg)}>, closeLabel, children})`; `useSheet()` returns `{open(id, arg?), close, current}`. Register sheets in `ui/sheets.ts` (`SHEETS`).
- `ToastHost` and `useToast()`: `ToastHost({children, ms?})`; `useToast()` returns `push(message, tone?: "info"|"good"|"bad")`.
- `Confirm`: `{open, title, children?, confirmLabel, cancelLabel, onConfirm, onCancel, danger?}`, focus starts on Cancel, Escape cancels.
- `CommandPalette`: `{open, onClose, commands: {id,label,hint?,run}[], onAsk, label, placeholder, askLabel(q), emptyLabel}`. Mounted in `Frame` on Cmd or Ctrl+K; the last row asks Aletheia.
- `AletheiaProvider`, `useAletheia()`, `useAletheiaScope()`: the one shared chat. `useAletheia()` gives `{open, setOpen, scope, thread, ask, register}`.
- `AletheiaSheet`: `{labels: AletheiaLabels, ...}`, the chat view. Do not mount a second one; use `useAletheia()`.

## Data display
- `DataTable<T>`: `{columns: {key,label,render?,sort?,align?}[], rows, rowKey, label, selected?, onSelect?, height?, rowHeight?, expand?: {id,height,render}}`, virtualised, sortable, single select, sticky header, Up/Down/Home/End/Enter keys.
- `BarList`: `{items: {id,label,value,display?,sev?}[], label, max?}`.
- `SeverityPill`: `{sev, label}`.
- `SeverityStrip` (alias `SegBar`): `{tiles: {sev,label,rules,records}[], rulesLabel(n)}`.
- `StatTile` (alias `Tile`): `{label, value, note?, bar?, barTone?}`.
- `ScoreRing`: `{value, label, naLabel, size?}`.
- `ScoreRuler`: `{marks: {id, label, shown, measured?, tone?}[], labels, ariaLabel, from?: 0 | 50, width?}`. Gates at 70 and 85; a capped mark shows a hollow tethered mark at the measured score.
- `AletheiaDock`: `{scope, placeholder, inputLabel, send, onAsk, onOpen}`. Pill at the foot of every screen; hands over to the one Aletheia sheet.
- `DimensionBars`: `{items: {key,label,value}[], naLabel}`.
- `DqsPair` (alias `PairBars`): `{rows: {key,label,value,note?}[], naLabel, reasons?}`, source, projected and actual DQS.
- `TrendArea` (alias `AreaSpark`): `{points: {axis,title,value}[], height?, label, emptyLabel}`.
- `FieldChip` (alias `Code`): `{code, description?}`, a code always shows its text beside it.
- `Stepper`: `{steps: {id,label}[], current, label}`.
- `EmptyState` (alias `Empty`): `{heading, body?, action?}`. `ErrorState`: `{heading, body?, retryLabel?, onRetry?}`. `Skeleton`: `{lines?, label}`.

- `Badge`: `{children, tone?: "good"|"bad"}`, a count beside a label; `Tabs` uses it.
- `CodeView` (alias `YamlView`): `{text, label}`. `DiffView`: `{diff, label}`.
- `Timeline`: `{events: {id,at,title,note?}[], label}`, `at` already formatted.
- `Hairline`: `{items: {id,label,meta,pct|null,action?}[], label}`, one thin progress line per job.
- `Graph`: `{nodes, edges, layout: "columns"|"circle", label, onPick?}`.
- `CycleStepper`: `{step, labels, label}` over `CYCLE_STEPS` (pull, clean, upload, score, compare).
- `CommentsPanel`: `{items, listLabel, deleteLabel?, empty, composer?}`.
- `UndoToast`: `{message, actionLabel, onAction}`.

## Inputs
- `Textarea`: native textarea props plus `mono?`. `FileDrop`: `{accept, onFile, label, status}`.
- `Button`: `{variant?: "primary"|"secondary"|"ghost", tone?: "aletheia", href?, ...button props}`.
- `Chip`: `{selected, onClick, children, count?}`, a toggle filter chip.
- `Search`: `{value, onChange, label, clearLabel, placeholder?}`.
- `Field`: `{label, hint?, error?, children}`, wraps one control.
- `Input`: native input props. `Select`: `{options: {value,label}[], ...select props}`.
- `Toggle`: `{label, checked, onChange}`, a switch.

## Hooks
- `useTab(ids, fallback)`: the current tab kept in `?tab=`.
- `useStacked()`: true at 900px wide or less.
