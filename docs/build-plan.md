# Dearlly — Build Plan

Oct 29, 2026 · @josh

## Product summary

Dearlly lets people create and send romantic experiences — love notes, date invitations, vacation invitations and gift reveals — as an animated private link or a downloadable picture/PDF, and play two-player romantic games with a partner. It is fully separate from Statabet: own repo, own server, own accounts.

- **Who it's for:** adults 18+ in Nigeria, with Lagos and Abuja as the focus (curated places, marketing). The rest of Nigeria works from day one with free-text places.
- **Why it's not Valentine-only:** the brand is year-round (anniversaries, birthdays, proposals, apologies). Valentine's Day 2027 is the launch campaign.
- **Target:** v1 live by **15 January 2027**, four weeks of marketing before 14 February.
- **Money:** free at launch. Paid premium cards and restaurant partners come after launch (see Money plan).
- **Process:** same as the playbook. Advisor (this chat) plans and explains. Builder (Claude Code in VS Code) builds through PRs. Merge only when CI is green. Main auto-deploys.

## Brand and design: "Love letter post office"

Every screen follows one idea: Dearlly is a love-letter post office. Sending seals an envelope, receiving breaks a wax seal, photos become postage stamps.

| Token | Hex | Use |
| --- | --- | --- |
| Paper | #F3EADB | Main background (with a faint paper grain) |
| Ink | #1F2A6B | Text, outlines, airmail stripes (never a page background) |
| Stamp red | #D7392B | Main action buttons, seals, postmarks |
| Kraft | #C89B6D | Envelopes, secondary surfaces, borders |

**Fonts:** Gloock for headings, Figtree for body and buttons, Homemade Apple for handwritten touches (signatures, postcard backs). All free on Google Fonts, self-hosted for speed.

**Signature animations (built in Rive, page motion in Framer Motion/GSAP):**

1. Send: the letter folds, the envelope seals, and a postmark lands with a thud and a short phone vibration.
2. Open: the recipient cracks the wax seal and the letter slides out.
3. Accept: a signature draws itself in ink, then confetti made of tiny stamps.
4. Gift reveal: scratch the stamp to see the gift.
5. Games: questions are dealt like letters, and answers flip over together on reveal.
6. Community: photos shown as tilted stamps that flip like postcards.

**Make it look human, not AI-made:** commission one Nigerian illustrator for about 15 hand-drawn pieces (envelope, stamps, seal, a postman mascot, empty states). Avoid purple-blue gradients, frosted glass, Inter, sparkle icons, 3D blobs and hearts on everything.

**Mobile-first rules:** bottom navigation in thumb reach, tap targets 48px or more, works on cheap Android phones and slow data (first page under 200 KB of script, images compressed, animations loaded only when needed), respects "reduce motion", always on cream paper (no dark mode).

## Features at launch

All four experience types run on one engine: one `experiences` table with a `type` field, and a type registry in `config/experience_types.yaml`. A new type (anniversary, proposal) is a new form and animation, not a rebuild.

### Experiences

| Type | Fields after name, lover's name, lover's title |
| --- | --- |
| Love note (quote) | Quote title, quote text (pick from the library or tap Generate with AI), theme |
| Date | Date type, kind of place (restaurant, hotel, cinema, garden), place (curated suggestions pop up; free text always allowed), date and time |
| Vacation | Country/destination (suggestions shown, free text allowed), dates, message |
| Gift reveal | Personal message, gift photo upload, reveal style (unwrap, scratch, unlock at a set time) |

**Sending:** live preview, then share link (WhatsApp, copy, Instagram), email (verified accounts only), download (PNG for WhatsApp status or PDF, with a QR code to the animated page), or schedule (for example 00:00 on 14 February).

**Recipient:** invitation page (wax seal opens) → Yes / No (the playful runaway No button) → acceptance page with add to calendar (.ics), directions, a short reply note and a countdown. The sender sees Opened and Accepted on their profile.

**Secret admirer mode:** the recipient doesn't see the sender's name until the sender chooses to reveal it. Dearlly always knows who sent it. Tighter limits: 3 per day, the recipient can block with one tap, no photos.

**Accounts:** create without signing up; sign up (magic-link email code) to send by email, save, and see responses. Username public, email never shown, 18+ gate: a required "I'm 18 or older" tick at sign-up (no date of birth collected).

### AI

- **Love notes:** a free library of original quotes. AI runs only when someone taps Generate.
- **AI date planner:** inputs city, budget, date, vibe (chill, adventurous, luxury), indoor or outdoor, food preferences, things they like. Output: 3 plans with a timeline, built from curated places, each with a "Use this plan" button that fills the date form.
- **Rules:** server-side only, small fast model, rate-limited, short outputs, output filtered for explicit or abusive text, monthly spend cap in the provider dashboard.

### Games (free)

1. Create game: pick a game and intensity, or write your own questions.
2. Invite: 6-character code (no O/0 or I/1), QR code, or WhatsApp link.
3. Lobby: both players appear, both tap Ready.
4. Rounds: both answer privately, answers reveal together, match or score shows, next question.
5. End: summary card ("You matched 7/10") shareable as a stamp.

| Intensity | For | Content rule |
| --- | --- | --- |
| Friendship | Friends | Mild, fun |
| Talking stage | Getting to know each other | Playful, red flag / green flag |
| Mid romantic | Couples | Memories, love languages, future plans |
| Intense | Couples, both 18+ and both opt in | Deep and flirty, never explicit |

**Formats:** How well do you know me, Same page, This or that (timed), Would you rather, Finish my sentence, Deep talk (no score, skip tokens), Couples truth or dare, Love language quiz.

**Keeping questions fresh:**

- About 2,000 questions at launch, tagged by intensity, category, depth (1–5), format and flavour (including a Nigerian/Pidgin pack).
- Templates with variables multiply the bank ("Would you rather {A} or {B}", partner names inserted).
- The server deals one question at a time and remembers what each pair has seen. No repeats until the bank runs out.
- Rounds follow a shape: warm-up, deeper, peak, cool-down, with formats mixed.
- AI drafts new questions in batches, you approve them in an admin page. No live AI per game.
- Each question's skip rate and thumbs up/down are tracked; weak ones are retired.
- Seasonal packs (Valentine, Detty December).

**Fixes over Viberoom:** the server runs the game (not the browser), the question bank never goes to the browser, and seen questions live in the database (not localStorage).

### Community ("Our Stamp")

- Photos of dates and places shown as postage stamps: perforated edges, postmark with the couple's initials, date and city, a wax-seal monogram, and the couple's own stamp colour. The frame is drawn by the app, so new frames (cinema ticket, boarding pass) can come later.
- Feed is a tilted wall of stamps. Tap to flip to the postcard back with the caption and the place tag.
- A post goes live only when **both** partners approve. Visibility: public, followers, or just us.
- Reactions instead of likes: Aww, Goals, Saving this idea. No open comments at launch.
- Place tags link to curated place pages ("moments here").
- Safety: photo location data removed, homes never tagged, optional face blur, automatic nudity check, report and block.
- **Phase A at launch:** private albums and shareable stamps. **Phase B (March 2027):** public feed, once moderation is proven.

### Pages

Home, Create (one step-by-step form for all types), AI planner, Invitation, Acceptance, Games (library, lobby, play, results), Community, Profile (sent experiences, Opened/Accepted, albums, settings), Romantic ideas, Love quotes, Blog (these three are public pages for Google search traffic, such as "50 date ideas in Lagos"), plus Terms, Privacy, Safety and Partner with us.

## Stages

Eleven weeks (2 November 2026 to 15 January 2027) cover Stages 0–9. Unlike Statabet, the production server goes live early (Stage 3), so every later stage deploys to the real site and there is no rush at the end.

| Stage | What | Done when |
| --- | --- | --- |
| 0 | Plan doc, accounts, buy dearlly domain | Accounts exist, domain on Cloudflare, `docs/build-plan.md` in repo |
| 1 | Foundation: repo, Docker Compose, FastAPI, Postgres, Redis, Celery, Next.js, CI and security scans, Dependabot, design tokens and fonts | CI all green; `docker compose up` shows a Dearlly-styled home page |
| 2 | Accounts: magic-link login, sessions, Turnstile, rate limits, 18+ gate, username, profile basics | Sign up, log in, log out and rate limits pass tests; sign-up refused without the 18+ tick |
| 3 | Production early: VPS, hardening, Cloudflare Full (strict), secrets, auto-deploy, backups to R2, Sentry, UptimeRobot, Resend, Zoho | Merge to main is live in 5 minutes; restore tested; login email lands in inbox |
| 4 | Experience engine + love note + invitation/acceptance pages + share link, WhatsApp, email, PNG/PDF download, scheduled send, Opened/Accepted | A love note can be sent, opened, accepted and downloaded on a phone |
| 5 | Date, vacation and gift reveal types; `cities.yaml` with curated Lagos and Abuja places; photo upload to R2; secret admirer mode | All four types work end to end; 50+ curated places loaded |
| 6 | AI: Generate quote, AI date planner, AI question drafting in admin | Planner returns 3 plans from curated places; spend cap set |
| 7 | Games: real-time rooms, codes and QR, lobby, 8 formats, 2,000-question bank, seen-question tracking, admin | Two phones play a full game with no repeat on a second game |
| 8 | Community Phase A: stamp frames, private albums, both-partner approval, reactions, moderation and reports | A couple can post a stamp only after both approve; report and block work |
| 9 | Public pages: romantic ideas, love quotes, blog, Terms, Privacy, Safety; load test with k6 | Pages indexed; site holds the expected Feb 14 traffic in the load test |
| 10 | Launch and growth: user guide, demo video, social posts, influencer and restaurant outreach | Live 15 January 2027; campaign running |
| Later | Community Phase B (public feed), payments, partners, long-distance game mode | Decided after Valentine results |

## Tech stack and architecture

The stack is the Statabet stack, plus WebSockets for games and Rive for animations. Firebase is not used.

```
Phone browser (PWA)
      |
  Cloudflare  (CDN, firewall, caches invitation pages)
      |
  Hostinger VPS, Docker Compose
      |-- Next.js web   (pages, animations)
      |-- FastAPI API   (HTTP + game WebSockets) --> PostgreSQL 16 (saved data), Redis (live games, limits)
      |-- Celery worker (emails, AI, timers)       --> Cloudflare R2 (photos), Resend (email), AI model API
```

Cloudflare sits in front of everything, so the server only accepts Cloudflare traffic and cached invitation pages absorb spikes.

| Part | Choice |
| --- | --- |
| API | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 (async), Alembic |
| Real-time games | FastAPI WebSockets + Redis pub/sub; the server holds the game state and deals questions |
| Background jobs | Celery + Redis: emails, scheduled sends, photo checks, AI batches |
| Database | PostgreSQL 16 |
| Web app | Next.js + TypeScript + Tailwind, Framer Motion, GSAP, Rive, installable as a phone app (PWA) |
| Downloads | PNG/PDF made in the user's browser, not on the server |
| Files | Cloudflare R2 for photos (private bucket, signed links) |
| Config registries | `experience_types.yaml`, `cities.yaml`, `game_formats.yaml` |
| Everything else | Same as playbook: Docker Compose, GitHub Actions, Sentry, UptimeRobot, Resend, Zoho, Cloudflare |

**Built for traffic spikes:** invitation pages are small and cached at Cloudflare, so a 14 February rush mostly hits Cloudflare, not the server. The API is stateless, so a second server can be added later behind Cloudflare. Games keep live state in Redis.

**Built to grow city by city:** a new city is one entry in `cities.yaml` (currency, timezone, language, curated places, partners). All text lives in translation files from day one.

```
backend/    app/ (api, core, db, models, services, games, worker.py), migrations/, tests/, config/*.yaml
frontend/   Next.js app, design tokens, Rive files in public/rive/
deploy/     server setup notes, deploy.sh, set-secret.sh, backup scripts
scripts/    question-bank import and checks, demo seed (refuses production)
docs/       build-plan.md, runbooks
.github/    ci.yml, codeql.yml, deploy.yml, dependabot.yml
```

## Security, privacy and safety

The playbook's security standard (OWASP ASVS Level 2, section 3) applies in full: secure cookies, CSRF, Turnstile, Redis rate limits, security headers, production refuses insecure settings, `/docs` off in production, hardened containers, secrets only through `set-secret.sh`. These rules are added for Dearlly:

**Login:** three ways in — emailed code (single-use, expires in 10 minutes, rate-limited by email and IP), an optional password (Argon2id, breached-password check, Turnstile, rate limits) and "Continue with Google".

**Private links:** unguessable tokens (at least 128 bits), `noindex` on every invitation page, optional PIN and expiry, link can be revoked by the sender.

**Messages to people who didn't sign up:**

- Every invitation and email has Report and "Stop messages from this sender", plus a global "Never email me again".
- Email sending only from verified accounts, with a daily cap (10 a day at start). Link sharing has no cap.
- Recipient emails are used only to deliver that one experience, never for marketing.
- Secret admirer: 3 a day, no photos, one-tap block, sender always recorded.

**Photos:** private R2 bucket, signed links, GPS data stripped on upload, size and type checks, automatic nudity check before anything is shown, optional face blur.

**Games:** server-authoritative, so no cheating; the question bank never reaches the browser; room codes expire after 24 hours; Intense level needs both players 18+ and both opted in.

**Community:** both partners approve before a post goes live, either partner can remove it at any time, report and block on every post, admin moderation queue.

**Law:** Nigeria Data Protection Act 2023 (privacy notice, consent, data deletion on request, breach plan). GDPR rules are added when the UK/EU diaspora is targeted. AI quotes and the question bank are original content (no copied poems or lyrics).

## Services and costs

Running costs at launch are about ₦13,000–₦20,000 a month plus yearly items, because most services stay on free tiers. Figures are approximate, based on Statabet's real costs; confirm prices when buying.

| Service | Use | Cost |
| --- | --- | --- |
| Hostinger KVM 2 VPS (own server, Ubuntu 24.04, EU) | Everything runs here | About ₦11,000/month on a 24-month term |
| Domain on Cloudflare | dearlly domain (check .app, .ng, .love) | Yearly, varies by ending |
| Cloudflare (DNS, CDN, WAF, Turnstile, R2) | Speed, protection, photo storage | Free tier (R2 free up to 10 GB) |
| Zoho Mail Lite (new organisation) | hello@ and partners@ inbox | About ₦11,500/year |
| Resend | Login codes and experience emails | Free tier at start; paid plan when volume grows |
| Sentry, UptimeRobot | Errors and uptime | Free tiers |
| GitHub Pro | Enforced branch protection | About $4/month (already covered if the same GitHub account has Pro) |
| AI model API | Quotes, planner, question drafts | Pay as you go with a hard monthly cap (start at $20) |
| Rive | Animations | Free plan to start |
| Illustrator (one-off) | About 15 hand-drawn pieces | One-off fee; agree a price before work starts |

**Not used at launch, to save money:** Google Places (curated list instead; add later with a budget alert), SMS (email codes instead), paid hosting for images (R2 has no download fees).

## Money plan (after launch)

Everything is free at launch to grow fast. Payments (Paystack) are added after Valentine's Day 2027, once usage is known. The code keeps a `plan` field and server-side feature checks from Stage 1, so turning on paid features is a small change.

| Option | Price idea | What they get |
| --- | --- | --- |
| Free | ₦0 | Basic themes, small Dearlly mark on downloads, link and WhatsApp sharing, standard games |
| Premium card | ₦500–₦1,500 per experience | Premium themes, music, no mark, HD download, scheduled send, special reveal animations |
| Season bundle | About ₦2,500 | Unlimited premium until the end of the season (for example 28 February) |
| Game packs | Small one-off fee | Extra intensity packs and seasonal packs |
| Restaurant and hotel partners | Monthly fee | Featured placement in the date form and AI planner, a "moments here" page |
| Later | Commission | Booking deposits, flowers and cake delivery through partners |

Honesty rules from the playbook apply: featured partners are always labelled "Featured", and the AI planner says when a place is a paid partner.

## Accounts to create first

Create these before Stage 1, in this order. Save every password and recovery code in your password manager and turn on two-factor login everywhere. Never paste a key into chat.

- [ ] **Dedicated email for Dearlly admin** (a new Gmail, for example dearlly.admin@…), used to sign up to everything below so Dearlly stays separate from Statabet
- [ ] **Cloudflare:** new account with that email → search and buy the Dearlly domain
- [ ] **GitHub:** new private repo `dearlly` (same GitHub account is fine; it keeps Pro) → add the builder
- [ ] **Hostinger:** new KVM 2 VPS, Ubuntu 24.04, France or Germany, 24-month term (needed by Stage 3)
- [ ] **Resend:** new account (domain added in Stage 3)
- [ ] **Sentry** and **UptimeRobot:** new accounts (connected in Stage 3)
- [ ] **AI provider account** with a hard monthly cap (needed by Stage 6)
- [ ] **Rive:** free account for the animations
- [ ] **Zoho Mail Lite:** new organisation for the Dearlly domain (Stage 3)
- [ ] **Paystack:** later, when payments start

Also start now: find the illustrator (brief: love-letter post office, Nigerian characters, paper texture, palette from the Brand section) and a list of 50+ romantic places in Lagos and Abuja (name, area, type, price range, photo you may use).

## Launch checklist

- [ ] All stages' "done when" met; CI green on `main`; GitHub Pro + `main` ruleset enforced
- [ ] Production refuses insecure settings; `/docs` off in production
- [ ] Cloudflare Full (strict), Origin certificate, Authenticated Origin Pulls, firewall allows only Cloudflare
- [ ] All secrets set on the server; none in the repo (gitleaks clean)
- [ ] Backups running and a restore tested; backup key in password manager
- [ ] Sentry receiving errors; UptimeRobot green; alert email works
- [ ] Email SPF, DKIM, DMARC pass; login and experience emails land in the inbox, not spam
- [ ] Invitation pages are `noindex`, cached at Cloudflare, and load in under 2 seconds on a cheap Android phone on 3G
- [ ] Load test passed at the expected 14 February peak
- [ ] Report, block, "stop messages" and "never email me" all work; moderation queue staffed
- [ ] Photo checks (nudity, GPS removal) working; secret admirer limits working
- [ ] Games: two phones complete every format; no repeated question across 3 games for the same pair
- [ ] AI spend cap set; AI output filter tested
- [ ] Terms, Privacy, Safety pages live; 18+ gate works; NDPA privacy notice in place
- [ ] No demo data in production
- [ ] User guide, demo video and launch posts ready

## Where we are

**Stage 1 (Foundation) is done** (29 Oct 2026): PRs #1–#8 merged, CI green on `main`, `docker compose up` shows the Dearlly home page. `main` is protected by the "Protect main" ruleset (PR + all checks green + CodeQL, merge commits only, branches auto-deleted).
**Stage 2 (Accounts) is done** (29 Oct 2026): sign-up with the 18+ tick; log in by emailed code, optional password or Google (Google button appears once its keys are set); sessions, rate limits, profiles, "Delete my account", branded emails, and the A+B look (PRs #9–#17).
**Stage 3 (Production) is in progress:** domain `dearlly.app` is on Cloudflare; Hostinger KVM 2 (France, Ubuntu 24.04) hardened; HTTPS through Cloudflare (Full strict + Authenticated Origin Pulls, Caddy); **live at https://dearlly.app** with automatic deploys on merge (health check + rollback). Next: backups, monitoring, Zoho, Google keys.
Stage 0 is partly done: the plan is in the repo; the accounts and domain are being created alongside (needed by Stage 3).
Update this section as each stage finishes.

### Decisions and changes log

| Date | Decision |
| --- | --- |
| 29 Oct 2026 | Name: Dearlly. Design: Direction A, love letter post office. Market: Nigeria, focus on Lagos and Abuja |
| 29 Oct 2026 | Fully separate from Statabet (own server, accounts, repo). Games free at launch; money plan later |
| 29 Oct 2026 | Added Community ("Our Stamp") and Games (2 players, 4 intensity levels). Secret admirer mode included with limits |
| 29 Oct 2026 | GitHub repo `joshares/Dearlly` is **public for now** (founder's choice; to be made private later). Nothing sensitive is committed. Public repos get CodeQL and branch rulesets free |
| 29 Oct 2026 | Local ports are 3100 (web) and 8100 (API), so Dearlly runs next to Statabet on the same Mac |
| 29 Oct 2026 | Frontend starts on TypeScript 6 and ESLint 9 (not 7 / 10): Next.js 16's lint plugins don't support ESLint 10 yet. Upgrade deliberately later |
| 29 Oct 2026 | Python packages are locked as `requirements.in` → `requirements.txt` (with hashes), the layout Dependabot can update. Locks use only releases 14+ days old, except security fixes |
| 29 Oct 2026 | 18+ gate is a required "I'm 18 or older" tick at sign-up, with the time it was ticked stored as the record. **No date of birth is collected** (founder's decision: less personal data to hold). Trade-off: it relies on the user's word, like most dating and social apps; "Intense" games use the same confirmation |
| 29 Oct 2026 | Look chosen from the design board: **A + B mix**: airmail-stripe frame round every screen, ruled love-letter paper with a red margin line, handwritten opener and sign-off, tilted perforated stamp cards. Logo: **wax seal "D" + Gloock wordmark**. Laptop gets a top menu; phones keep the bottom bar |
| 29 Oct 2026 | **No dark mode and no blue page backgrounds:** every screen stays on cream love-letter paper; ink blue is only for text, outlines and the airmail stripes (founder's choice) |
| 29 Oct 2026 | "Delete my account" added in Stage 2 (NDPA right to erasure). Each later stage adds its data to what deletion removes |
| 29 Oct 2026 | **Three ways to log in:** emailed code, optional password, and "Continue with Google". Passwords: Argon2id, 10+ characters, breached-password check (HIBP k-anonymity), Turnstile + rate limits, changing it logs out other devices; "forgot password" = log in with a code, then set a new one. Google arrives behind its keys (button hidden until set). A backup email provider is added in Stage 3 so codes still go out if Resend fails |
| 29 Oct 2026 | Domain: **dearlly.app** (Cloudflare). VPS: Hostinger KVM 2 on a **12-month** term (founder's choice; a little more per month than 24 months). The server IP is kept out of the public repo |
| 29 Oct 2026 | Pages use a per-request CSP nonce, so HTML is rendered per request. Stage 4 decides how invitation pages are cached at Cloudflare without weakening the CSP |

## First prompt for Claude Code (Stage 1)

Before pasting: export this doc as Markdown, and put it and the playbook in the new empty `dearlly` repo folder as `docs/build-plan.md` and `docs/project-playbook.md`. Then open the folder in VS Code and paste this into Claude Code:

```
You are the builder for Dearlly, a new project. Read docs/project-playbook.md (how we work, our security
standard, CI rules, lessons learned) and docs/build-plan.md (this product) fully before doing anything.
Dearlly is completely separate from Statabet: no shared code, server or accounts. Reuse the same
standards and tech stack.

Do Stage 1 (Foundation) only, as small PRs, one concern each, on branches (never push to main):

1. Repo layout exactly as in the build plan (backend/, frontend/, deploy/, scripts/, docs/, .github/),
   README.md, SECURITY.md, .env.example, .gitignore.
2. Docker Compose: api (FastAPI), worker + beat (Celery), postgres 16, redis, web (Next.js).
   Non-root, read-only filesystems, no-new-privileges, dropped capabilities, healthchecks, ports on
   127.0.0.1 only, Debian trixie slim images.
3. Backend skeleton: settings from environment with production refusing insecure config, SecretStr,
   JSON logs with redaction list, request IDs, security headers, TrustedHost, strict CORS, /docs off in
   production, /health (supports HEAD) and /ready. Alembic set up with a first empty migration.
   A `plan` field and a server-side feature-check helper ready for later paid features.
   Empty YAML registries: config/experience_types.yaml, config/cities.yaml, config/game_formats.yaml.
4. Frontend skeleton: Next.js + TypeScript + Tailwind with strict security headers. Design tokens from
   the build plan (Paper #F3EADB, Ink #1F2A6B, Stamp red #D7392B, Kraft #C89B6D, dark mode = ink
   background), fonts Gloock, Figtree and Homemade Apple self-hosted, translation files set up.
   A placeholder home page in the Dearlly style, mobile-first, with bottom navigation.
5. CI exactly as playbook section 5: ruff, mypy, pytest, alembic upgrade head, pip-audit with hashes,
   frontend lint/typecheck/build/tests, npm audit, gitleaks, Semgrep, CodeQL, Trivy >= 0.35.0, all
   actions pinned to commit SHAs, contents: read, persist-credentials: false.
6. Dependabot: weekly, grouped minor/patch, 14-day cooldown, ignore majors of core tools.

For every PR give me a plain-English summary and any manual steps as a numbered list. Tell me if
anything in the plan is unclear rather than guessing. Stop after Stage 1 and tell me what's done.
```

Next stage message after Stage 1 is merged and green: "Stage 1 is merged and green. Start Stage 2 (Accounts) from docs/build-plan.md."
