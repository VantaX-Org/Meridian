# Meridian Logo Assets

Place the following logo files in this directory:

- `Meridian-Logo-Transparent.png` — for use on light/coloured backgrounds (sidebar, cards)
- `Meridian-Logo-White-1.png` — for use on dark/green backgrounds (chat bubble, splash screens)

These files are referenced in:
- `components/ask-meridian.tsx` — chat bubble header (can switch to Image component once files are present)
- `app/(dashboard)/layout.tsx` — sidebar logo area (currently uses ShieldCheck icon fallback)
