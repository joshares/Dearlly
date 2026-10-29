"""Branded HTML email: cream love-letter paper, airmail stripes, the wax-seal "D".

Email apps ignore most modern CSS (no web fonts, gradients, SVG or flexbox in Gmail and Outlook),
so this is built the old way: nested tables, inline styles, Georgia standing in for Gloock, and
the airmail stripes made from small coloured table cells. Every dynamic value is HTML-escaped.
"""

import html
from dataclasses import dataclass

PAPER = "#F3EADB"
SHEET = "#FBF6EE"
INK = "#1F2A6B"
STAMP = "#D7392B"
KRAFT = "#C89B6D"
MUTED = "#3D4680"

SERIF = "Georgia, 'Times New Roman', serif"
SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"

# Red, paper, ink, paper: one airmail stripe repeat.
_STRIPE_COLOURS = (STAMP, PAPER, INK, PAPER)
_STRIPE_CELLS = 40


def _airmail_stripe() -> str:
    cells = "".join(
        f'<td width="15" height="8" style="background:{_STRIPE_COLOURS[i % 4]};font-size:0;'
        f'line-height:0">&nbsp;</td>'
        for i in range(_STRIPE_CELLS)
    )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="table-layout:fixed"><tr>{cells}</tr></table>'
    )


def _seal_and_wordmark() -> str:
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td width="44" height="44" align="center" valign="middle" style="background:{STAMP};'
        f"border:2px solid {INK};border-radius:22px;color:{PAPER};font-family:{SERIF};"
        'font-size:24px;line-height:44px">D</td>'
        f'<td style="padding-left:12px;font-family:{SERIF};font-size:30px;color:{INK}">Dearlly</td>'
        "</tr></table>"
    )


@dataclass(frozen=True)
class Paragraph:
    text: str
    small: bool = False


def letter_email(
    *,
    title: str,
    preheader: str,
    greeting: str,
    heading: str,
    paragraphs: list[Paragraph],
    highlight: str | None = None,
    sign_off: str = "Yours, always — Dearlly",
    footer: str,
) -> str:
    """One email, laid out as a letter on cream paper inside an airmail border."""
    esc = html.escape
    body = "".join(
        f'<p style="margin:0 0 16px;font-family:{SANS};'
        f"font-size:{14 if p.small else 16}px;line-height:1.6;"
        f'color:{MUTED if p.small else INK}">{esc(p.text)}</p>'
        for p in paragraphs
    )
    code_block = ""
    if highlight:
        boxes = "".join(
            f'<td align="center" style="width:44px;height:56px;background:{PAPER};'
            # Sans-serif digits sit level (Georgia's old-style 3, 4, 9 drop below the line).
            f"border:2px solid {INK};border-radius:8px;font-family:{SANS};font-weight:bold;"
            "font-size:28px;"
            f'color:{INK}">{esc(char)}</td><td style="width:6px">&nbsp;</td>'
            for char in highlight
        )
        code_block = (
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
            f'style="margin:8px 0 24px"><tr>{boxes}</tr></table>'
        )

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>{esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:{PAPER}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">{esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{PAPER}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:{SHEET};border:2px solid {INK}">
<tr><td>{_airmail_stripe()}</td></tr>
<tr><td style="padding:28px 32px 8px">{_seal_and_wordmark()}</td></tr>
<tr><td style="padding:20px 28px 8px 20px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="border-left:2px solid {STAMP};padding:4px 0 0 18px">
<p style="margin:0 0 6px;font-family:{SERIF};font-style:italic;font-size:18px;color:{INK}">{esc(greeting)}</p>
<h1 style="margin:0 0 18px;font-family:{SERIF};font-weight:normal;font-size:30px;line-height:1.15;color:{INK}">{esc(heading)}</h1>
{code_block}{body}
<p style="margin:8px 0 24px;font-family:{SERIF};font-style:italic;font-size:17px;color:{INK}">{esc(sign_off)}</p>
</td></tr></table>
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:2px dashed {KRAFT}">
<p style="margin:0;font-family:{SANS};font-size:12px;line-height:1.6;color:{MUTED}">{esc(footer)}</p>
</td></tr>
<tr><td>{_airmail_stripe()}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""
