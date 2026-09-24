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
that drills into a rate picker: 0.5x up to 3x. A small blue dot on the gear
means that player isn't at 1x.

Each player on a page keeps its own rate, and the rate resets to 1x whenever the
page reloads — nothing is stored.

**Jumping between sentences.** `Shift` + `→` skips to the start of the next
sentence in the clip that's playing; `Shift` + `←` goes back. Both are ignored
while typing in a text field. `Esc` closes the settings panel.

**Subtitles.** Present in the menu but greyed out and switched off — hovering
explains that they're still being worked on. See below.

**Drawing and a calculator.** A round purple button sits under the page title,
near the right. Clicking it drops two separate panels: right under the button,
its own narrow panel with the draw tools stacked in a column — three pen
colors (black, red, blue), an arrow ("unselect"), an eraser, and undo/redo
as a side-by-side pair underneath — and below that a calculator (the four operations, a sign toggle, backspace and a running
display — also usable from the keyboard while the panel has focus). A small
**fx**/**123** button in its corner switches it into scientific mode: the
panel widens and a second column of function keys appears — sin, cos, tan,
log, ln, √, x², xʸ, π and e (trig in degrees). Toggling back to basic shrinks
it again; reopening the toolbox always starts back in basic mode.

The calculator can be dragged by its top strip (where the fx/123 button
sits) to anywhere on screen, and hovering that strip specifically (not the
calculator in general) fades in a light gray ring around the whole panel so
it's clear it's grabbable. Once moved it becomes a floating window - fixed to the
viewport rather than the page, so it stays where you put it as you scroll -
independent of the draw-tools panel, which stays docked under the launcher.
It snaps back under the launcher the next time the toolbox is opened. Toggling
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
redo. The drawing layer never paints over the launcher button itself, no
matter how a stroke crosses it, so it always stays visible and clickable.

The toolbar is part of the page rather than pinned to the window, so it scrolls
out of sight along with the title above it, same as the launcher button.

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
calculator and draw-tools panels are placed the same way, anchored to the
launcher and moving together — until the calculator is dragged, at which point
it switches from document coordinates to `position: fixed` and stops being
repositioned by anything but the drag itself; the draw panel keeps following
the launcher regardless.

The toolbar is inserted as a plain `div` between the page header (`#top`) and the
body columns (`#inner`), which are siblings inside `#main` — in normal flow, the
same width as the content, overlapping nothing. It's only added when the page
really has that shape, so an unfamiliar page type gets no toolbar rather than a
broken layout.

The drawing layer is a viewport-sized canvas, but the strokes are stored in
document coordinates and replayed when the page scrolls, so a mark stays on the
content it was drawn over. Choosing "unselect" doesn't remove the canvas — it
just sets the canvas to `pointer-events: none`, so existing marks stay visible
but clicks and scrolling pass straight through to the page.

The launcher button sits below the canvas in z-index, so without special
handling a stroke could paint right over it (and swallow the click meant for
it). Every paint call clips a hole over the launcher's current screen rect
first — two overlapping canvas rects with the `evenodd` fill rule — so ink
can never land there, however fast or far a stroke crosses it.

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
`TOOLBOX_PANEL_GAP` (space between the calculator and draw-tools panels),
`PEN_COLORS`, `PEN_WIDTH`, `ERASER_WIDTH`, and for the calculator `CALC_KEY_W`
(every key's width, basic or scientific - the two panel widths are derived
from it, not set separately) and `CALC_HOVER_RING`.
