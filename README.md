# GinIQ — Live Poker Advisor (PWA)

A standalone, installable, **fully-offline** mobile poker decision advisor. Set your hand, board, position, stack, situation, and the villain's style/position — GinIQ returns the recommended play with the math behind it. Everything runs **100% on your device**; nothing is uploaded.

## What the engine does (honestly)
- **Range-aware Monte Carlo equity** — your hand vs the villain's *actual* range (style × position), with a 95% confidence interval, not vs a random hand.
- **Exact outs** — counts the real cards that bring you to two-pair-or-better / a completed straight or flush, with the true probability to hit.
- **GTO-based preflop ranges** — standard open / vs-raise / 3-bet reference charts by position, plus short-stack Nash push/fold under ~15 BB.
- **Calibrated postflop recommendation** — equity-vs-range thresholds with draw context.

It is **not** a full GTO solver (those require server-scale precomputation). It's a strong, honest equity-and-range study tool that works offline.

## Files
- `index.html` — app shell + mobile UI
- `engine.js` — the poker engine (equity, outs, charts, recommendation)
- `app.js` — touch-scroll card UI + interaction
- `manifest.webmanifest`, `sw.js`, `icon-*.png` — PWA install + offline

## Deploy on GitHub Pages (install on your phone)
1. Create a new GitHub repo (e.g. `giniq`) and upload **all** files in this folder to the root.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**, pick `main` / `/root`, Save.
3. Wait ~1 minute. Your app is live at `https://<your-username>.github.io/giniq/`.
4. Open that URL on your phone (HTTPS is required for PWAs — GitHub Pages provides it).
5. **iPhone (Safari):** Share → *Add to Home Screen*. **Android (Chrome):** menu → *Install app* / *Add to Home Screen*.
6. After the first load it works fully offline — open it from the home-screen icon with no connection.

No build step, no server, no API keys. It's pure static files.

## Using it
- **Cards:** drag a card up/down to change rank, left/right (or double-tap) to change suit. Tap the top/bottom half to step. Mouse wheel works on desktop.
- **Board:** leave blank for a preflop spot; set 3 for flop, 4 for turn, 5 for river.
- **Villain:** pick a style (Tight / Balanced / Loose / Maniac) and position — this defines the range your equity is computed against.
- Tap **Analyze spot**.
