"""One branded layout for every email Meridian sends.

Inline styles only: Outlook desktop and several webmail clients strip <head> styles. Colours
and type follow frontend/design/tokens.css (the Instrument): cobalt accent, near-black ink,
cool slate canvas, sentence case, no all-caps eyebrows. Ember and gradients stay in the app's
hero zones; email is a plain sheet so it reads the same in every client and in dark mode.
"""

from __future__ import annotations

import html
from datetime import date
from typing import Iterable, Sequence

ACCENT = "#4F46E5"
ACCENT_SOFT = "#EEF0FD"
INK = "#15171C"
INK_2 = "#4B5160"
INK_3 = "#7A8191"
LINE = "#E3E6EB"
CANVAS = "#F5F6F8"
SHEET = "#FFFFFF"
RAISED = "#F9FAFB"
CRITICAL = "#C2410C"
PASS = "#15803D"
FONT = "'Public Sans','Segoe UI',Helvetica,Arial,sans-serif"
MONO = "'JetBrains Mono',Menlo,Consolas,monospace"

TONE = {"critical": CRITICAL, "pass": PASS, None: INK}


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def paragraph(text: str, *, muted: bool = False, raw: bool = False) -> str:
    """Body copy. `raw` keeps markup the caller already escaped."""
    colour = INK_2 if muted else INK
    return (f'<p style="margin:0 0 14px;font-family:{FONT};font-size:14px;line-height:21px;color:{colour};">'
            f'{text if raw else esc(text)}</p>')


def greeting(name: str) -> str:
    return (f'<p style="margin:0 0 14px;font-family:{FONT};font-size:15px;line-height:22px;font-weight:600;color:{INK};">'
            f'Hi {esc(name)},</p>')


def button(label: str, href: str) -> str:
    return (f'<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:6px 0 18px;"><tr>'
            f'<td style="background:{ACCENT};border-radius:6px;">'
            f'<a href="{esc(href)}" style="display:inline-block;padding:11px 20px;font-family:{FONT};font-size:14px;'
            f'font-weight:600;line-height:18px;color:#FFFFFF;text-decoration:none;">{esc(label)}</a>'
            f'</td></tr></table>')


def link_fallback(href: str) -> str:
    return (f'<p style="margin:0 0 14px;font-family:{FONT};font-size:12px;line-height:16px;color:{INK_3};">'
            f'If the button does not open, copy this link:<br>'
            f'<span style="font-family:{MONO};font-size:11px;color:{INK_2};word-break:break-all;">{esc(href)}</span></p>')


def note(text: str, *, raw: bool = False) -> str:
    """A tinted note with the 3px accent bar, like the app's Notice."""
    return (f'<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 16px;"><tr>'
            f'<td style="width:3px;background:{ACCENT};border-radius:2px 0 0 2px;"></td>'
            f'<td style="padding:10px 14px;background:{ACCENT_SOFT};border-radius:0 6px 6px 0;font-family:{FONT};'
            f'font-size:13px;line-height:18px;color:{INK};">{text if raw else esc(text)}</td></tr></table>')


def stat(label: str, value: object, *, tone: str | None = None, hint: str | None = None) -> str:
    """One KPI tile cell; place several inside `stats`."""
    hint_html = (f'<div style="margin-top:4px;font-family:{FONT};font-size:12px;line-height:16px;color:{INK_3};">{esc(hint)}</div>'
                 if hint else "")
    return (f'<td style="padding:12px 16px;background:{RAISED};border:1px solid {LINE};border-radius:10px;vertical-align:top;">'
            f'<div style="font-family:{FONT};font-size:12px;line-height:16px;color:{INK_3};">{esc(label)}</div>'
            f'<div style="margin-top:2px;font-family:{FONT};font-size:26px;line-height:30px;font-weight:600;'
            f'letter-spacing:-0.02em;color:{TONE.get(tone, INK)};font-variant-numeric:tabular-nums;">{esc(value)}</div>'
            f'{hint_html}</td>')


def stats(cells: Iterable[str]) -> str:
    return ('<table role="presentation" cellspacing="0" cellpadding="0" border="0" '
            'style="width:100%;margin:0 0 18px;border-collapse:separate;border-spacing:8px 0;"><tr>'
            + "".join(cells) + "</tr></table>")


def table(headers: Sequence[str], rows: Iterable[Sequence[object]], *, numeric_last: bool = False) -> str:
    """A plain data table: hairline rows, meta-sized header, no zebra."""
    th = "".join(
        f'<th style="padding:8px 10px;text-align:{"right" if numeric_last and i == len(headers) - 1 else "left"};'
        f'font-family:{FONT};font-size:12px;line-height:16px;font-weight:500;color:{INK_3};border-bottom:1px solid {LINE};">{esc(h)}</th>'
        for i, h in enumerate(headers))
    body = ""
    for row in rows:
        cells = list(row)
        body += "<tr>" + "".join(
            f'<td style="padding:8px 10px;text-align:{"right" if numeric_last and i == len(cells) - 1 else "left"};'
            f'font-family:{FONT};font-size:13px;line-height:18px;color:{INK};border-bottom:1px solid {LINE};'
            f'{"font-family:" + MONO + ";font-size:12px;" if i == 0 else ""}">{esc(c)}</td>'
            for i, c in enumerate(cells)) + "</tr>"
    return (f'<table cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;margin:0 0 18px;">'
            f'<thead><tr>{th}</tr></thead><tbody>{body}</tbody></table>')


def section(title: str) -> str:
    return (f'<h3 style="margin:18px 0 8px;font-family:{FONT};font-size:15px;line-height:20px;font-weight:600;color:{INK};">'
            f'{esc(title)}</h3>')


def render_email(*, title: str, blocks: Sequence[str], tenant: str | None = None, preheader: str = "",
                 footer: str | None = None) -> str:
    """The sheet: wordmark lockup, tenant, title, the blocks, a quiet footer."""
    year = date.today().year
    foot = footer or "Automated message from Meridian. SAP data never leaves your environment."
    tenant_html = (f'<td align="right" style="font-family:{FONT};font-size:13px;line-height:18px;color:{INK_2};">{esc(tenant)}</td>'
                   if tenant else "")
    pre = (f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{esc(preheader)}</div>'
           if preheader else "")
    return f"""<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:{CANVAS};">
{pre}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:{CANVAS};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;width:100%;">
      <tr><td style="padding:0 4px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr>
          <td style="width:32px;vertical-align:middle;">
            <div style="width:26px;height:26px;border:3px solid {INK};border-top-color:transparent;border-radius:50%;box-sizing:border-box;"></div>
          </td>
          <td style="vertical-align:middle;font-family:{FONT};font-size:17px;line-height:24px;font-weight:600;letter-spacing:-0.01em;color:{INK};">Meridian</td>
          {tenant_html}
        </tr></table>
      </td></tr>
      <tr><td style="background:{SHEET};border:1px solid {LINE};border-radius:10px;padding:28px 28px 20px;">
        <h1 style="margin:0 0 16px;font-family:{FONT};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.01em;color:{INK};">{esc(title)}</h1>
        {"".join(blocks)}
      </td></tr>
      <tr><td style="padding:16px 4px 0;font-family:{FONT};font-size:12px;line-height:16px;color:{INK_3};">
        {esc(foot)} &middot; &copy; {year} VantaX
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>"""
