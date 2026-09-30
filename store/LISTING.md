# Chrome Web Store listing

Paste-ready text for the developer dashboard. Keep it in sync with what the
extension actually does.

## Store listing tab

**Name:** BetterMobius

**Summary** (from `manifest.json`, 132 characters max):
Unofficial helper for Möbius lectures: playback speed, jump between sentences, drawing tools and a calculator.

**Category:** Education

**Language:** English

**Description:**

BetterMobius adds the controls Möbius lecture slides are missing.

PLAYBACK SPEED
• A gear in the player bar sets the narration speed from 0.5x to 3x
• The current speed shows right beside the gear
• Each player on a page keeps its own speed

JUMP BETWEEN SENTENCES
• Shift + Left / Right skips back or forward one sentence
• Pauses are found automatically from the audio, so it works on any narrated slide

DRAW ON THE PAGE
• Black, red and blue pens, an eraser, undo and redo
• Marks stay on the words you drew over as you scroll
• Nothing is saved; closing the toolbox clears everything

CALCULATOR
• Type whole expressions like a phone calculator, with a live answer preview
• Scientific mode: brackets, trig (degrees), logs, powers, roots, factorial and Ans
• Works with the keyboard, and can be dragged anywhere on screen

PRIVATE BY DESIGN
• Collects no data, stores nothing and asks for no permissions
• Runs only on mobius.cloud pages

Fully usable with a keyboard and screen reader.

BetterMobius is an unofficial tool, not affiliated with, endorsed by or connected to DigitalEd or Möbius.

Source code: https://github.com/zuxu4n/BetterMobius

**Graphics** (rendered by `scripts/screenshots.sh` into `store/`):
- Store icon: `icons/icon128.png`
- Screenshots (1280×800): `store/screenshot-1-speed.png`, `store/screenshot-2-draw.png`, `store/screenshot-3-calculator.png`
- Small promo tile (440×280): `store/promo-tile.png`

## Privacy practices tab

**Single purpose:**
Adds study controls to Möbius lecture pages: narration playback speed, jumping between sentences, on-page drawing and a calculator.

**Host permission justification** (for `*://*.mobius.cloud/*`):
The extension's only job is to add controls to Möbius lecture pages, so it runs on mobius.cloud and nowhere else. It reads each slide's narration audio from the page to find the pauses between sentences; this happens locally and nothing is sent anywhere.

**Remote code:** No, I am not using remote code. All code is in the package.

**Data usage:** tick none of the data types. Then certify all three statements (not sold to third parties, not used for unrelated purposes, not used for creditworthiness).

**Privacy policy URL:**
https://github.com/zuxu4n/BetterMobius/blob/main/PRIVACY.md

## Distribution tab

**Visibility:** Unlisted to start (only people with the link), Public once it's ready to be found in search.

**Regions:** All regions.

## Sharing links

Tag each link you post so the dashboard shows where installs came from:
`<store link>?utm_source=reddit`, `?utm_source=discord`, `?utm_source=resume`
