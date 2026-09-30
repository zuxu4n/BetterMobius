# Working in this project

An unpacked Chrome extension (MV3) for Möbius lecture pages. One content script,
no build step, no dependencies, no package.json. It's a git repo pushed to
https://github.com/zuxu4n/BetterMobius (remote `bettermobius`), so uncommitted
edits are the only copy of themselves — commit before anything risky. `README.md` covers what the extension does and how it works.

## Verifying a change

There is no test framework. After editing:

```
node --check content.js
python3 -m json.tool manifest.json > /dev/null
```

The real site needs a login, so behaviour is checked against **mock pages** that
imitate Möbius's markup:

1. Write an HTML page that inlines `content.js` inside a `<script>` tag, with a
   player bar shaped like Möbius's (see "Real page facts" below).
2. Serve it. Static servers need **HTTP Range support** or Chrome can't seek
   audio; `python3 -m http.server` doesn't have it. Put the server in a
   temporary `.claude/launch.json` and start it with `preview_start`.
3. Drive the page with JavaScript: click the gear, set a rate, seek the audio,
   read back `playbackRate`, element positions and so on. Check the console for
   errors, and take a screenshot for anything visual.
4. **Delete `.claude/launch.json` and any mock files from this folder when
   done.** Keep mock pages and generated audio in the scratchpad instead.

For self-contained logic (pause detection and the like), pulling the function
out of `content.js` by name and running it under `node` is faster than the
browser, and lets you measure accuracy against generated audio with known
answers.

## Publishing (Chrome Web Store)

- `./scripts/package.sh` checks the code and the store's manifest limits
  (description ≤ 132 characters, version format, icons present), then builds
  `dist/bettermobius-<version>.zip` with only `manifest.json`, `content.js`
  and `icons/`. Raise `version` before every upload.
- `./scripts/screenshots.sh` renders the listing images in `store/` from
  `store/demo.html` (made-up lecture content running the real `content.js`)
  and `store/promo-tile.html`. Re-run it after visible UI changes.
  `store/demo.html` is a kept asset, unlike the throwaway mock pages above.
- `store/LISTING.md` holds the paste-ready listing and privacy-form text, and
  `PRIVACY.md` is the privacy policy the listing links to. Keep both true to
  what the code does. The listing promises that nothing is collected, stored
  or sent anywhere.
- The name is **BetterMobius**, always presented as unofficial. Keep the
  Möbius/DigitalEd logo and real course content out of the listing.

## Gotchas

- **Chrome caches the content script.** Changes need **reload** on the extension
  card at `chrome://extensions`, not just a page refresh. Tell the user this
  whenever you change a file.
- Chrome can read a **half-finished edit**. When removing a feature, delete the
  call sites before the definitions, or the user may catch a broken state.
- The extension's own DOM must stay below Möbius's fixed `#assignmentButtons`
  bar (z-index 9001). The settings menu uses 9000.
- The mutation observer reacts to child-list changes. Anything that rebuilds
  nodes during a layout pass will trigger another one — write styles on every
  pass, but only rebuild nodes when what they show actually changes.
- Buttons are `div`s made accessible by `makeAccessible()` (role, label,
  Tab, Enter/Space). Any new button should go through it too. The focus ring
  is the one rule in the injected `#mobius-styles` stylesheet, since inline
  styles can't express `:focus-visible`. Click handlers that refocus a panel
  check `e.detail` so keyboard presses (detail 0) keep focus where it is.
- Never trust the inherited `box-sizing` on an injected element. Any element
  that combines a declared `width`/`height` with `padding` needs an explicit
  `boxSizing`, because the host page may reset it globally (a common
  `*{box-sizing:border-box}` rule silently ate into the calculator's padding
  and clipped its rightmost keys until this was made explicit). A plain mock
  page won't catch this — it needs a page with that reset applied to surface.
- The toolbox launcher, draw-tools panel and docked calculator are
  `position: fixed`: the launcher is pinned to the viewport and the panels
  hang off it, while drawn strokes are stored in document coordinates and
  scroll with the page. The settings menu is still placed in document
  coordinates. Any panel that hides itself when its anchor scrolls offscreen
  must keep repositioning while hidden, not early-return, or a change made
  offscreen leaves it at a stale position when it scrolls back into view.
  Reproducing that needs an actual scroll between the change and the
  re-appearance — a same-tick test won't catch it.

## Decisions to respect

These came from the user; don't quietly undo them.

- **Nothing is stored.** No `chrome.storage`, no permissions in the manifest.
  Speed resets to 1x on every page load, deliberately.
- **No speed hotkeys.** `=`/`-`/`0` and scroll-to-change were removed on
  request. `Shift`+arrows for sentence jumping and `Esc` to close the menu stay.
- **Subtitles are off**, shown as a greyed row with its switch off and an
  instant tooltip saying they're being worked on. The full implementation lives
  at `../mobius-extension-content-with-subtitles.js`.
- Each player on a page keeps its **own** rate.
- Accent blue `#3ea6ff`, icon tile `#802a8f`, menu `rgba(51,51,51,0.9)`.

## Real page facts

Learned from the live site; expensive to rediscover.

- The player bar is `.jp-gui.jp-interface`, with `.time-holder` for the readout
  and `.seek-bar` inside `.jp-progress`. Note it's `.seek-bar`, not jPlayer's
  usual `.jp-seek-bar`.
- **The seek bar spans the whole lecture**, not one slide. Its `i.marker`
  elements are positioned in percent, one per clip, marking where each clip
  starts along that lecture-long timeline.
- Narration is one `<audio id="jp_audio_N">` per slide, and those elements are
  **not** inside the bar — jPlayer binds them by its own state. One bar is
  reused for all of them.
- Audio file naming varies by lecture: `Slide-02.mp3`, `Slide_02.mp3`,
  `Slide1.mp3`, `Slides5-6.mp3`, and sometimes a name with no slide number at
  all. Don't build anything that depends on one pattern.
- The page header is `#top.assignmentTopMenu` (logo, breadcrumb, module title)
  and the body is `#inner.container` (sidebar + content, ~970px wide). Both are
  children of `#main`, in that order, with nothing between them — that gap is
  where the extension's toolbar goes. Confirmed on a reading page (2.1 Demand);
  assumed but unverified on narrated-slide pages, hence the guard.
- Two header slots that look inviting but aren't: the `#global` strip at the very
  top is 19px of site chrome, and `#assignmentModuleDetails` (the empty column
  beside the title) gets grade and timer content on other page types.
- Transcripts are linked from the page (`/Transcripts/…`), same origin, and
  fetch fine from a content script. Their structure varies: usually
  `<h2>Slide N</h2>` sections, sometimes a merged `Slide 9/10`, sometimes plain
  paragraphs with no headings.
- Transcript math is raw TeX in the fetched HTML. Reading it from the *live*
  page instead gives tripled digits ("303030"), because MathJax has run.
- Audio is same-origin: `fetch` plus `decodeAudioData` works with no CORS
  trouble, and is a separate read-only copy of the audio, so the player is
  unaffected.

## Style

Constants with a short comment sit at the top of `content.js`. Comments explain
*why*, not what. Delete code that's no longer used rather than leaving it
unreachable.
