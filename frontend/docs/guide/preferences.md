# Preferences

Preferences is how Meridian looks and reads for you, where it starts, and what it tells you about. It belongs to you, not to the tenant. Open it from your account menu, **Preferences**, or with `?open=preferences`. Every change is saved at once.

## What is in it

- **Display**: **Theme** (Light, Dark or System; Light is the default, and the account menu switches between light and dark too) and **Row density** (Compact, Default or Comfortable).
- **Language and region**: **Number and date format** (Browser default or a locale such as en-ZA or de-DE) and **Time zone** (UTC by default). A sample line shows the result: "Dates read 16 Oct 2026, 05:17, scores 71.8, counts 1,234,567."
- **Start screen**: **Open Meridian as** your role's default or another role's start screen. "It changes the next step on the landscape and the work it shows first. Your access does not change."
- **Keyboard**: "Show keyboard hints beside menu items and places".
- **Notifications**: the digest of your open items (Off, Daily, Weekly), "Tell me at once about critical findings" and "Also email me". **Inbox and triage settings** opens triage.
- **What you hear about**: the events that reach your inbox, such as run finished, score drop, new critical breach, batch waiting and mentions, each on or off.
- **Out of office**: set from People, Out of office, or `?open=away`.

## The numbers and where they come from

Nothing here changes a number. The locale changes how numbers and dates are written; the time zone changes the times shown; scores and counts stay the same.

## What you can do, by role

Everyone sets their own preferences. The tenant's default digest and alert channels are set by an administrator under Administration, Default digest and Alerts.

## Keyboard

- `Tab` moves through the settings, `Space` toggles a switch.
- `Esc` closes the panel.

## When something is wrong

- **Dates show in UTC**: set your time zone here.
- **No email arrives**: "Also email me" is off, or the deployment has no email backend (Administration, Platform and updates, Health checks).
- **The start screen did not change**: the start screen is kept in this browser; another browser keeps its own.
