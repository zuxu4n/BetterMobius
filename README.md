# Möbius+

A Chrome extension that adds playback controls to narrated Möbius (`mobius.cloud`)
lecture slides, which ship with no speed option of their own.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select this folder.
3. Open a lecture page. After any change to the files here, press **reload** on
   the extension card — refreshing the page alone won't pick it up.

## What it does

**Playback speed.** A gear button sits in the player bar, just right of the
time readout. Clicking it opens a settings panel with a **Playback speed** row
that drills into a rate picker: 0.5x up to 3x. Whenever a player isn't at 1x,
its speed (e.g. **1.5x**) shows in blue right beside the gear.

Each player on a page keeps its own rate, and the rate resets to 1x whenever the
page reloads — nothing is stored.

**Jumping between sentences.** `Shift` + `→` skips to the start of the next
sentence in the clip that's playing; `Shift` + `←` goes back. Both are ignored
while typing in a text field. `Esc` closes the settings panel.

**Subtitles.** Present in the menu but greyed out and switched off — hovering
explains that they're still being worked on. See below.

**Drawing and a calculator.** A round purple button sits under the page title,
near the right. Clicking it drops a narrow panel right under the button, with
the draw tools stacked in a column — undo above redo at the top,
then three pen colors (black, red, blue), an arrow ("unselect"), an eraser,
and a calculator button at the bottom. That button opens the calculator as its
own separate panel below. It takes input like a phone or scientific
calculator: the whole expression builds up on screen as you type
(`2+3×4`), with a live preview of the answer under it, and is worked out with
normal precedence when you press `=`. The result then shows large with the
expression above it. After that a digit starts a new calculation, while an
operator carries on from the result. Pressing an operator twice replaces the
first one, except a minus after ×, ÷ or ^, which makes the next number
negative. ± flips the sign of the number being typed, ⌫ takes back one key
press, and C clears everything except Ans. It also works from the keyboard
while the panel has focus: digits, `+ - * / ^ ( ) !`, Enter, Backspace, and
Delete to clear. Clicking the calculator button again hides the panel rather
than throwing it away: what's typed, scientific mode and a dragged-away
position all survive being closed and reopened this way, for as long as the
toolbox itself stays open. A small **fx**/**123** button in its corner switches
it into scientific mode, which widens the panel and adds three columns of
keys: brackets, Ans, sin, cos, tan, log, ln, √, x², xʸ, 1/x, π, e and n! (trig
in degrees). Functions open their own bracket, as in `sin(`, and any brackets
left open are shown faintly and closed for you on `=`. Only closing the
whole toolbox (the launcher again, or `Esc`) actually resets the calculator,
back to basic mode with nothing entered, docked under the launcher again.

The calculator can be dragged by its top strip (marked with a six-dot grip
at its left end, with the fx/123 button at its right) to anywhere on screen,
and hovering that strip specifically (not the calculator in general) fades in
a light gray ring around the whole panel so it's clear it's grabbable. Once moved it becomes a floating window - fixed to the
viewport rather than the page, so it stays where you put it as you scroll -
independent of the draw-tools panel, which stays docked under the launcher.
Toggling
scientific mode after it's been dragged keeps its right edge fixed and
grows/shrinks it to the left, the same edge it's anchored to while docked, so
it doesn't drift across the screen each time it's resized - clamped back onto
the screen if it was parked close enough to an edge that the wider panel
would otherwise run off it.

Picking a color or the eraser covers the page in a transparent drawing layer
and starts capturing strokes in that color/mode. Picking the arrow leaves any
marks on screen but hands clicks back to the page, so you can scroll and read
normally without drawing. Marks are anchored to the page, not the window, so
they stay on the words they were drawn over while you scroll. Nothing is saved
— clicking the launcher again (or `Esc`) closes both panels and throws every
mark away along with them; there's no separate close button on either panel.
**Undo** and **redo** step back and forward through the strokes (pen or
eraser alike) one at a time and dim out once there's nothing left in that
direction; drawing a new stroke after an undo drops whatever was left to
redo. The launcher button sits above the drawing layer, so it always stays
visible and clickable.

The launcher is pinned to the window and stays at the same spot on screen as
you scroll, with the draw-tools panel (and the docked calculator) hanging
under it. Marks, by contrast, scroll with the page. When the window is wide
enough, the launcher sits in the empty margin just right of the lecture
content, so the pinned tools never cover the lecture. On a narrower window it
sits inside the content's right edge, under the page title, instead.

**Look and feel.** Panels fade in quickly as they open. Tool buttons lift
slightly on hover, and undo/redo look and act disabled when there's nothing
to undo or redo. On the calculator, the operators are tinted blue, the editing
keys (C ⌫ ±) are a lighter grey, and digits are the darkest. Panels share one
corner radius and one font.

**Keyboard and screen readers.** Every button (gear, menu rows, launcher,
tools, calculator keys) can be reached with Tab, is announced as a button with
a spoken name ("Red pen", "Backspace", "Square root"), and is pressed with
Enter or Space. A blue focus ring shows where keyboard focus is, but only for
keyboard focus, never after a mouse click. Opening the menu or toolbox from
the keyboard moves focus into it, and `Esc` hands focus back to the button that
opened it.

## How it works

`content.js` runs on every `*.mobius.cloud` page and:

- Finds each player bar (`.jp-gui.jp-interface`) and docks a gear button into
  it, lining the button and the time readout up with the seek bar. The layout is
  recomputed on every pass, since the seek bar's width is fluid.
- Applies the chosen rate to every `<audio>`/`<video>` element, reapplying it on
  `loadedmetadata`, `play`, `playing` and `canplay`, because jPlayer resets the
  rate whenever it loads a new source.
- Works out which clips belong to which player bar, so two players on one page
  keep separate rates.
- Finds the pauses between sentences by fetching a clip's audio a second time
  and decoding it offline — a read-only copy, so the player's own audio is never
  touched. Quiet stretches are found by measuring loudness over 50ms windows;
  runs quieter than 0.02 RMS lasting at least 0.5s count as pauses. Silence at
  the very start and end is ignored, so "next" can't run a slide off its end.

The settings panel is positioned in document coordinates, so it scrolls with the
page rather than being repositioned by script, and it sits just under Möbius's
own fixed `#assignmentButtons` bar (z-index 9001) so that bar stays on top. The
launcher, the calculator and the draw-tools panel are all `position: fixed`
instead, since the launcher is pinned to the viewport and the panels hang off
it — until the calculator is dragged, at which point it stops being
repositioned by anything but the drag itself; the draw panel keeps following
the launcher regardless.

The toolbar is inserted as a plain `div` between the page header (`#top`) and the
body columns (`#inner`), which are siblings inside `#main` — in normal flow, the
same width as the content, overlapping nothing. It's only added when the page
really has that shape, so an unfamiliar page type gets no toolbar rather than a
broken layout. The bar only reserves the launcher's space; the launcher itself
is fixed at the spot that space occupies when the page is scrolled to the top.

The marks are an SVG positioned in document coordinates, so the browser
scrolls them together with the page, with no lag. (An earlier version
repainted a viewport-sized canvas on every scroll event, which always trailed
the page by a frame or more.) The eraser is an SVG mask over the strokes drawn
before it, so it removes ink, never the page, and later strokes still show on
top of an erased patch. Pointer input goes to a separate invisible layer fixed
to the viewport. Choosing "unselect" doesn't remove that layer; it just sets it
to `pointer-events: none`, so existing marks stay visible but clicks and
scrolling pass straight through to the page.

The launcher sits one z-index step above both layers, so ink never covers it
and clicks on it always reach it, even mid-drawing.

## Subtitles: paused, not abandoned

The full implementation is kept at
`../mobius-extension-content-with-subtitles.js`. Drop it over `content.js` to
restore it.

It reads the lecture's Transcript page, splits the transcript between the
lecture's clips by how long each one speaks for, and times each sentence using
the detected pauses. It copes with the things real lectures do: clip names using
hyphens, underscores or no separator at all, clips named after a topic instead
of a slide, merged headings like "Slide 9/10", slides with no audio, transcripts
with no slide headings at all, and unscripted asides at the start of a clip.

It's off because the timing still drifts on real lectures. The transcript is a
script the narrator departs from, so where they ad-lib mid-clip, no amount of
matching text length against clip length recovers the timing. Getting this right
properly needs speech recognition against the audio.

## Files

| | |
|---|---|
| `manifest.json` | Extension manifest (MV3). No permissions requested. |
| `content.js` | Everything above. |
| `icons/` | 16, 48 and 128px icons. |

## Adjusting it

Most of the fiddly numbers are constants at the top of `content.js`:
`MENU_RATES`, `GEAR_SIZE`, `GEAR_NUDGE_Y` (nudges the gear up or down),
`PROGRESS_GAP`, `MENU_GAP` and `MENU_EDGE_INSET` (the panel's gap from the
player), the pause-detection thresholds `PAUSE_WINDOW_SEC`, `PAUSE_SILENCE_RMS`
and `PAUSE_MIN_SEC`, and for the toolbox `LAUNCHER_SIZE`, `SWATCH_SIZE`,
`TOOL_ICON_SIZE` and `TOOL_GAP` (the draw-tools column's circle size, icon size
and spacing, shared by every button in it), `LAUNCHER_TOOLS_GAP` (the larger
gap between the launcher and the first of those buttons),
`LAUNCHER_MARGIN_GAP` (the launcher's distance from the content when it sits
in the margin), `FONT`, `PANEL_RADIUS` and `CONTROL_RADIUS` (the shared font and
corner radii), `PANEL_FADE_MS` (how long panels take to fade in),
`TOOLBOX_PANEL_GAP` (space between the calculator and draw-tools panels),
`PEN_COLORS`, `PEN_WIDTH`, `ERASER_WIDTH`, and for the calculator `CALC_KEY_W`
(every key's width, basic or scientific - the two panel widths are derived
from it, not set separately) and `CALC_HOVER_RING`.
