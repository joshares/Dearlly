# Dearlly brand — "Love letter post office"

Every screen follows one idea: sending seals an envelope, receiving breaks a wax seal, photos become postage stamps.

## Chosen look (29 Oct 2026)

- **Logo:** red wax seal with a "D", next to "Dearlly" in Gloock. The same seal cracks open on invitations.
- **Background:** red-and-blue airmail stripes framing every screen, over ruled love-letter paper with a red margin line.
- **Touches:** handwritten opener ("My dearest,") and sign-off ("Yours, always — Dearlly"); experience types as tilted, perforated stamps; postmarks with city and date.
- Drawn in code for now (`frontend/src/components/brand.tsx`); the illustrator's artwork replaces these pieces.
- **Emails** use the same letter design (`backend/app/services/email_templates.py`): cream paper, airmail stripes top and bottom,
  the seal "D" and wordmark, a red margin line, "My dearest," and "Yours, always — Dearlly". Built with tables and inline
  styles so Gmail, Outlook and phone mail apps show it properly; Georgia stands in for Gloock, which email apps can't load.

## Colours

| Token | Hex | Use |
| --- | --- | --- |
| Paper | `#F3EADB` | Main background (faint paper grain) |
| Ink | `#1F2A6B` | Text, outlines, airmail stripes (never a page background) |
| Stamp red | `#D7392B` | Main buttons, seals, postmarks |
| Kraft | `#C89B6D` | Envelopes, secondary surfaces, borders |

No dark mode: Dearlly is always on cream love-letter paper, even when the phone is set to dark mode (decided 29 Oct 2026).

## Fonts (Google Fonts, self-hosted)

- **Gloock** — headings
- **Figtree** — body text and buttons
- **Homemade Apple** — handwritten touches only (signatures, postcard backs)

## Signature animations

1. **Send:** letter folds → envelope seals → postmark lands with a thud + short vibration.
2. **Open:** recipient cracks the wax seal; the letter slides out.
3. **Accept:** a signature draws itself in ink; confetti made of tiny stamps.
4. **Gift reveal:** scratch the stamp to see the gift.
5. **Games:** questions dealt like letters; answers flip together on reveal.
6. **Community:** photos as tilted postage stamps (perforated edges, postmark with initials, date, city,
   wax-seal monogram, couple's stamp colour) that flip like postcards.

## Avoid (the "AI look")

Purple-blue gradients, frosted glass, Inter, sparkle icons, 3D blobs, hearts on everything.

## Illustrator brief (one-off job, ~15 pieces)

> Dearlly is a Nigerian romantic-experiences app themed as a love-letter post office. We need about 15
> hand-drawn illustrations in a warm, slightly imperfect ink-and-paper style using only these colours:
> Paper #F3EADB, Ink #1F2A6B, Stamp red #D7392B, Kraft #C89B6D. Pieces: closed envelope, open envelope,
> wax seal (whole and cracked), 3 postage-stamp frames, postmark, a friendly Nigerian postman mascot
> (3 poses), a couple (2 poses), and 4 empty-state scenes (no messages, no games, no photos, error).
> Deliver as SVG (and layered source files) with full commercial rights.
