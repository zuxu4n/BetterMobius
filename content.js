// BetterMobius - an unofficial helper for Möbius lecture pages.
// Applies a chosen playback rate to every <audio>/<video> element on the page
// (Mobius narrates slides with per-slide HTML5 <audio> elements via jPlayer).
// Docks a gear button into the jPlayer bar, to the right of the current-time/
// duration readout, with both sitting just past the seek bar. Clicking it opens
// a YouTube-style settings panel that drills into a playback-speed picker.
// Each player on a page keeps its own rate. Also detects the pauses between
// sentences in each slide's narration, to jump between them with
// Shift+Left/Right. Separately, adds a toolbar under the page header holding a
// freehand drawing layer and a calculator.

(function () {
  "use strict";

  const MIN_RATE = 0.5;
  const MAX_RATE = 3.0;
  const DEFAULT_RATE = 1.0;
  const MENU_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const PROGRESS_GAP = 12; // space between the end of the seek bar and the time readout
  const GEAR_SIZE = 22; // the settings button is square
  const GEAR_NUDGE_Y = -1; // fine-tune the gear's height; positive moves it down
  const BADGE_GAP = 6;
  const MENU_GAP = 7; // vertical space between the button and the menu above it
  const MENU_EDGE_INSET = 4; // how far the menu's right edge sits inside the bar's
  const ACCENT = "#3ea6ff";

  // Just below Mobius's own fixed #assignmentButtons bar (z-index 9001) so that
  // bar stays on top where they overlap during scroll. Still well above ordinary
  // page content, which sets no z-index of its own.
  const PANEL_Z = 9000;

  // One look across every panel: the menu, calculator and tooltip share a
  // font, panels share one corner radius, and the controls inside them
  // (keys, display, small buttons) share a smaller one.
  const FONT = "Arial, Helvetica, sans-serif";
  const PANEL_RADIUS = 10;
  const CONTROL_RADIUS = 5;
  const PANEL_FADE_MS = 120; // how long a panel takes to fade in when opened
  const FOCUSABLE_CLASS = "mobius-focusable"; // gets the keyboard focus ring

  const TOOLBAR_ID = "mobius-tools-bar";
  const PEN_WIDTH = 3;
  const ERASER_WIDTH = 24; // wider than the pen, as a real eraser is
  const LAUNCHER_SIZE = 44; // the round purple button that opens the toolbox
  const TOOLBAR_PAD_Y = 6; // space above and below the launcher in the toolbar
  const TOOLBAR_PAD_RIGHT = 12; // nudged in from the bar's/content's right edge
  const LAUNCHER_MARGIN_GAP = 16; // from the content's right edge, when in the margin
  const SWATCH_SIZE = 28; // every circle in the draw-tools column
  const TOOL_ICON_SIZE = 18; // the icon inside each of those circles
  const TOOL_GAP = 8; // between circles in that column
  // Launcher to the column's first circle: roomier than TOOL_GAP, since the
  // open launcher's 3px ring eats into it and the launcher is a different kind
  // of button from the tools under it.
  const LAUNCHER_TOOLS_GAP = 12;
  const TOOLBOX_PANEL_GAP = 8; // gap between the calculator and the draw-tools panel
  const TOOLBOX_PURPLE = "#802a8f"; // matches the extension's own icon tile
  // Solid (not translucent) so "unselect" and the eraser stay visible however
  // the page underneath is colored, now that they float free of a card.
  const TOOLBOX_NEUTRAL = "rgba(51, 51, 51, 0.95)";
  const PEN_COLORS = ["#1a1a1a", "#ef4444", "#3b82f6"]; // black, red, blue
  const PEN_NAMES = ["Black pen", "Red pen", "Blue pen"]; // tooltips and labels

  const BAR_SELECTOR = ".jp-gui.jp-interface";

  // Rate is per player, so two videos on one page stay independent. A "scope" is
  // the thing a rate belongs to: normally a player bar, or PAGE_SCOPE for media
  // no bar claims, which has no control of its own and stays at the default.
  const PAGE_SCOPE = {};
  const scopeRates = new WeakMap(); // scope -> rate
  const mediaScope = new WeakMap(); // media element -> its scope
  const trackedElements = new WeakSet();

  function clamp(rate) {
    return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(rate * 100) / 100));
  }

  function formatRate(rate) {
    return rate.toFixed(2).replace(/\.?0+$/, "") + "x";
  }

  function rateName(rate) {
    return Math.abs(rate - 1) < 0.001 ? "Normal" : formatRate(rate);
  }

  function rateFor(scope) {
    const rate = scopeRates.get(scope);
    return typeof rate === "number" ? rate : DEFAULT_RATE;
  }

  function scopeOf(el) {
    return mediaScope.get(el) || PAGE_SCOPE;
  }

  function applyRateToElement(el) {
    const rate = rateFor(scopeOf(el));
    try {
      if (el.playbackRate !== rate) {
        el.playbackRate = rate;
      }
    } catch (e) {
      /* ignore elements that reject the rate */
    }
  }

  // Which media each bar drives: the nearest enclosing element holding media no
  // earlier bar has taken. With one player per wrapper - the usual jPlayer
  // layout - that resolves to the player's own media. If several players share a
  // wrapper, each bar takes only the media nearest it in document order.
  function assignMediaToBars() {
    const claimed = new Set();
    document.querySelectorAll(BAR_SELECTOR).forEach((bar) => {
      for (let node = bar; node; node = node.parentElement) {
        const free = Array.prototype.filter.call(
          node.querySelectorAll("audio, video"),
          (m) => !claimed.has(m)
        );
        if (!free.length) continue;
        const share = node.querySelectorAll(BAR_SELECTOR).length > 1;
        const mine = share ? [nearestInDocument(bar, node, free)] : free;
        mine.forEach((m) => {
          claimed.add(m);
          mediaScope.set(m, bar);
        });
        return;
      }
    });
  }

  function nearestInDocument(bar, root, candidates) {
    const order = Array.prototype.slice.call(
      root.querySelectorAll("audio, video, " + BAR_SELECTOR)
    );
    const barIndex = order.indexOf(bar);
    let best = candidates[0];
    let bestDistance = Infinity;
    candidates.forEach((m) => {
      const distance = Math.abs(order.indexOf(m) - barIndex);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = m;
      }
    });
    return best;
  }

  function applyRateToAll() {
    assignMediaToBars();
    document.querySelectorAll("audio, video").forEach((el) => {
      trackElement(el);
      applyRateToElement(el);
    });
  }

  function trackElement(el) {
    if (trackedElements.has(el)) return;
    trackedElements.add(el);
    // jPlayer (and similar players) reset playbackRate to 1 whenever a new
    // source is loaded or playback (re)starts, so reapply on those events.
    ["loadedmetadata", "play", "playing", "canplay"].forEach((evt) => {
      el.addEventListener(evt, () => applyRateToElement(el));
    });
    applyRateToElement(el);
    watchForPauses(el);
  }

  function setRate(scope, newRate) {
    scopeRates.set(scope, clamp(newRate));
    applyRateToAll();
    updateLabels();
  }

  function setSpeedLabel(label, rate) {
    const text = Math.abs(rate - 1) < 0.001 ? "" : formatRate(rate);
    // Only touched when it changes: a text change is a child-list mutation,
    // which would wake the observer.
    if (label.textContent !== text) label.textContent = text;
    label.style.display = text ? "inline" : "none";
  }

  function updateLabels() {
    document.querySelectorAll(BAR_SELECTOR).forEach((bar) => {
      const label = bar.querySelector(".mobius-speed-label");
      if (label) setSpeedLabel(label, rateFor(bar));
    });
    dockIntoPlayerBar(); // the gear just changed width, so re-clear the volume control
  }

  // --- Icons ---
  const SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
    return el;
  }

  function makeIcon(size, parts) {
    const svg = svgEl("svg", {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
    });
    parts.forEach((p) => svg.appendChild(p));
    svg.style.display = "block";
    svg.style.flex = "0 0 auto";
    return svg;
  }

  function gearIcon(size) {
    return makeIcon(size, [
      svgEl("path", {
        fill: "currentColor",
        d:
          "M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.48.48 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.47.47 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z",
      }),
    ]);
  }

  function speedIcon(size) {
    return makeIcon(size, [
      svgEl("circle", {
        cx: 12,
        cy: 12,
        r: 8.5,
        stroke: "currentColor",
        "stroke-width": 1.8,
      }),
      svgEl("path", {
        d: "M12 12l4.6-3.6",
        stroke: "currentColor",
        "stroke-width": 1.8,
        "stroke-linecap": "round",
      }),
      svgEl("circle", { cx: 12, cy: 12, r: 1.7, fill: "currentColor" }),
    ]);
  }

  function captionsIcon(size) {
    return makeIcon(size, [
      svgEl("rect", {
        x: 2.5,
        y: 5,
        width: 19,
        height: 14,
        rx: 2.5,
        stroke: "currentColor",
        "stroke-width": 1.8,
      }),
      svgEl("path", {
        d: "M10.5 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6",
        stroke: "currentColor",
        "stroke-width": 1.6,
        "stroke-linecap": "round",
      }),
    ]);
  }

  function chevronIcon(size, dir) {
    return makeIcon(size, [
      svgEl("path", {
        d: dir === "left" ? "M14.5 5.5 8 12l6.5 6.5" : "M9.5 5.5 16 12l-6.5 6.5",
        stroke: "currentColor",
        "stroke-width": 1.8,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    ]);
  }

  // A toolbox: the launcher icon for the combined drawing + calculator panel.
  function toolboxIcon(size) {
    return makeIcon(size, [
      svgEl("path", {
        d: "M9 7V5.5A2.5 2.5 0 0 1 11.5 3h1A2.5 2.5 0 0 1 15 5.5V7",
        stroke: "currentColor",
        "stroke-width": 1.7,
        "stroke-linecap": "round",
      }),
      svgEl("rect", {
        x: 3.5,
        y: 7,
        width: 17,
        height: 12,
        rx: 2.2,
        stroke: "currentColor",
        "stroke-width": 1.7,
      }),
      svgEl("path", {
        d: "M3.5 12.5h17",
        stroke: "currentColor",
        "stroke-width": 1.7,
      }),
      svgEl("rect", {
        x: 10.3,
        y: 11,
        width: 3.4,
        height: 3,
        rx: 0.8,
        fill: "currentColor",
      }),
    ]);
  }

  // A mouse-pointer arrow: the "unselect" tool that hands clicks back to the
  // page instead of drawing.
  function cursorIcon(size) {
    return makeIcon(size, [
      svgEl("path", {
        d: "M6 3.5l12 8.2-5.1 1.1 2.6 5-2.3 1.2-2.6-5-3.6 3.9V3.5Z",
        fill: "currentColor",
        stroke: "currentColor",
        "stroke-width": 0.6,
        "stroke-linejoin": "round",
      }),
    ]);
  }

  function eraserIcon(size) {
    return makeIcon(size, [
      svgEl("path", {
        d: "M9.4 19.5H19M9.4 19.5H7.3l-3-3a1.8 1.8 0 0 1 0-2.6l8.2-8.2a1.8 1.8 0 0 1 2.6 0l4 4a1.8 1.8 0 0 1 0 2.6l-7.2 7.2Z",
        stroke: "currentColor",
        "stroke-width": 1.7,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
      svgEl("path", {
        d: "M8.4 10.4l5.3 5.3",
        stroke: "currentColor",
        "stroke-width": 1.5,
      }),
    ]);
  }

  // A counter-clockwise "rotate back" arrow for undo, and its mirror for redo.
  function undoIcon(size) {
    return makeIcon(size, [
      svgEl("path", {
        d: "M1 4v6h6",
        stroke: "currentColor",
        "stroke-width": 1.8,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
      svgEl("path", {
        d: "M3.51 15a9 9 0 1 0 2.13-9.36L1 10",
        stroke: "currentColor",
        "stroke-width": 1.8,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    ]);
  }

  function redoIcon(size) {
    return makeIcon(size, [
      svgEl("path", {
        d: "M23 4v6h-6",
        stroke: "currentColor",
        "stroke-width": 1.8,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
      svgEl("path", {
        d: "M20.49 15a9 9 0 1 1-2.12-9.36L23 10",
        stroke: "currentColor",
        "stroke-width": 1.8,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    ]);
  }

  // A small calculator glyph: a body, a display line, and a grid of keys.
  function calculatorIcon(size) {
    return makeIcon(size, [
      svgEl("rect", {
        x: 5,
        y: 2,
        width: 14,
        height: 20,
        rx: 2,
        stroke: "currentColor",
        "stroke-width": 1.8,
      }),
      svgEl("path", {
        d: "M8 6.2h8",
        stroke: "currentColor",
        "stroke-width": 1.8,
        "stroke-linecap": "round",
      }),
      svgEl("path", {
        d: "M8 11h0M12 11h0M16 11h0M8 15h0M12 15h0M16 15h0M8 19h0M12 19h0",
        stroke: "currentColor",
        "stroke-width": 2.2,
        "stroke-linecap": "round",
      }),
    ]);
  }

  // The dark rounded panel the settings menu, the calculator and the drawing
  // controls all share.
  function panelStyle(el) {
    Object.assign(el.style, {
      position: "absolute",
      zIndex: String(PANEL_Z),
      background: "rgba(51, 51, 51, 0.9)",
      color: "#fff",
      borderRadius: PANEL_RADIUS + "px",
      boxShadow: "0 2px 14px rgba(0,0,0,0.5)",
      fontFamily: FONT,
      fontSize: "13px",
      lineHeight: "1.2",
      userSelect: "none",
    });
  }

  // Keyboard and screen-reader access for the extension's div buttons:
  // reachable with Tab, announced as a button, and pressed with Enter or
  // Space like a real one. Enter/Space are stopped here so they don't also
  // reach a parent's own key handling (the calculator reads Enter as "=").
  function makeAccessible(el, label) {
    el.setAttribute("role", "button");
    if (label) el.setAttribute("aria-label", label);
    el.tabIndex = 0;
    el.classList.add(FOCUSABLE_CLASS);
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      el.click();
    });
  }

  // Inline styles can't express :focus-visible, so the focus ring is the one
  // rule the extension puts in a stylesheet. Keyboard focus only - a mouse
  // click doesn't leave a ring behind.
  function ensureStyles() {
    if (document.getElementById("mobius-styles")) return;
    const style = document.createElement("style");
    style.id = "mobius-styles";
    style.textContent =
      "." + FOCUSABLE_CLASS + ":focus{outline:none}" +
      "." + FOCUSABLE_CLASS + ":focus-visible{outline:2px solid " + ACCENT +
      " !important;outline-offset:2px !important}";
    (document.head || document.documentElement).appendChild(style);
  }

  // A short fade and slide as a panel opens, so it doesn't just pop into
  // place. Web Animations rather than a CSS transition, so it can't collide
  // with the inline styles the positioning code rewrites on every pass.
  function animateIn(el, fromY) {
    if (!el || !el.animate) return;
    el.animate(
      [
        { opacity: 0, transform: "translateY(" + fromY + "px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: PANEL_FADE_MS, easing: "ease-out" }
    );
  }

  // --- Settings menu (YouTube-style panel above the gear button) ---
  // Lives on documentElement rather than inside the player bar: as a fixed-
  // position child of the root it can't be clipped by the bar's bounds, and its
  // coordinates stay valid even if the player sits inside a transformed or
  // scaled container.
  let menuEl = null;
  let menuAnchor = null;
  let menuScope = PAGE_SCOPE; // the player whose rate this menu reads and sets
  let menuView = "root"; // "root" = settings list, "speed" = the rate picker
  let menuPlacement = "above"; // which side of the button the panel sits on

  let tipEl = null;

  function closeMenu() {
    if (menuEl) menuEl.remove();
    menuEl = null;
    menuAnchor = null;
    menuScope = PAGE_SCOPE;
    menuView = "root";
    hideTip();
  }

  function hideTip() {
    if (tipEl) tipEl.remove();
    tipEl = null;
  }

  // Looks like the tooltip the browser shows for a title attribute, but appears
  // the moment the pointer arrives instead of after a pause.
  function showTip(text, x, y) {
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "mobius-speed-tip";
      Object.assign(tipEl.style, {
        // Fixed, not absolute: a fixed element never adds to the page's
        // scrollable area, so a tip near the right edge can't summon a
        // horizontal scrollbar that shifts the whole layout (and the
        // toolbox with it) on hover.
        position: "fixed",
        zIndex: String(PANEL_Z), // same layer as the menu, but appended after it
        background: "#f7f7f7",
        color: "#1a1a1a",
        border: "1px solid rgba(0,0,0,0.25)",
        borderRadius: CONTROL_RADIUS + "px",
        padding: "3px 7px",
        font: "12px/1.3 " + FONT,
        boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
        whiteSpace: "nowrap",
        pointerEvents: "none", // never steals the hover that summoned it
      });
      document.documentElement.appendChild(tipEl);
    }
    tipEl.textContent = text; // several buttons share the one node
    // Below and right of the pointer, as the browser's own tooltip sits, pulled
    // back inside the window when it would otherwise overflow. clientWidth/
    // clientHeight rather than innerWidth/innerHeight, which include the
    // scrollbars and so would let the tip slide underneath them.
    const root = document.documentElement;
    const left = Math.min(x + 14, root.clientWidth - tipEl.offsetWidth - 4);
    const top = Math.min(y + 20, root.clientHeight - tipEl.offsetHeight - 4);
    tipEl.style.left = Math.round(Math.max(4, left)) + "px";
    tipEl.style.top = Math.round(Math.max(4, top)) + "px";
  }

  // Without an onClick the row is inert: dimmed, no hover, nothing to press.
  function menuRow(onClick) {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "9px 14px",
      cursor: onClick ? "pointer" : "default",
      whiteSpace: "nowrap",
    });
    if (!onClick) {
      row.style.opacity = "0.45";
      row.setAttribute("aria-disabled", "true");
      return row;
    }
    makeAccessible(row);
    row.addEventListener("mouseenter", () => {
      row.style.background = "rgba(255,255,255,0.12)";
    });
    row.addEventListener("mouseleave", () => {
      row.style.background = "transparent";
    });
    row.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return row;
  }

  // A YouTube-style on/off slider: a pill track with a round knob that overhangs
  // it. The knob sits outside the flow, so the track alone sets the row height.
  function makeSwitch(on) {
    const track = document.createElement("span");
    Object.assign(track.style, {
      position: "relative",
      flex: "0 0 auto",
      width: "34px",
      height: "14px",
      borderRadius: "7px",
      marginLeft: "26px",
      background: on ? "rgba(62,166,255,0.5)" : "rgba(255,255,255,0.3)",
    });
    const knob = document.createElement("span");
    Object.assign(knob.style, {
      position: "absolute",
      top: "-3px",
      left: on ? "14px" : "0px",
      width: "20px",
      height: "20px",
      borderRadius: "50%",
      background: on ? "#3ea6ff" : "#f1f1f1",
      boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
    });
    track.appendChild(knob);
    return track;
  }

  function buildRootView() {
    const frag = document.createDocumentFragment();

    // Shown with its switch off but inert: the timing wasn't good enough to turn
    // on yet, and the row's tooltip says so.
    const subtitlesRow = menuRow(null);
    const tip = (e) => showTip("Subtitles are still being worked on", e.clientX, e.clientY);
    subtitlesRow.addEventListener("mouseenter", tip);
    subtitlesRow.addEventListener("mousemove", tip);
    subtitlesRow.addEventListener("mouseleave", hideTip);
    subtitlesRow.setAttribute("role", "switch");
    subtitlesRow.setAttribute("aria-checked", "false");
    subtitlesRow.appendChild(captionsIcon(17));
    const subtitlesLabel = document.createElement("span");
    subtitlesLabel.textContent = "Subtitles";
    subtitlesLabel.style.flex = "1 1 auto";
    subtitlesRow.append(subtitlesLabel, makeSwitch(false));
    frag.appendChild(subtitlesRow);

    const row = menuRow(() => {
      menuView = "speed";
      renderMenu();
    });
    row.appendChild(speedIcon(17));

    const label = document.createElement("span");
    label.textContent = "Playback speed";
    label.style.flex = "1 1 auto";

    const value = document.createElement("span");
    value.textContent = rateName(rateFor(menuScope));
    Object.assign(value.style, { opacity: "0.72", marginLeft: "26px" });

    row.appendChild(label);
    row.appendChild(value);
    row.appendChild(chevronIcon(15, "right"));

    frag.appendChild(row);
    return frag;
  }

  function buildSpeedView() {
    const frag = document.createDocumentFragment();

    const header = menuRow(() => {
      menuView = "root";
      renderMenu();
    });
    header.setAttribute("aria-label", "Back");
    header.style.borderBottom = "1px solid rgba(255,255,255,0.18)";
    header.style.marginBottom = "4px";
    header.appendChild(chevronIcon(15, "left"));
    const title = document.createElement("span");
    title.textContent = "Playback speed";
    title.style.flex = "1 1 auto";
    header.appendChild(title);
    frag.appendChild(header);

    MENU_RATES.forEach((rate) => {
      const active = Math.abs(rate - rateFor(menuScope)) < 0.001;

      const scope = menuScope; // captured now; closeMenu() clears it before setRate
      const row = menuRow(() => {
        const anchor = menuAnchor;
        const hadFocus = menuEl.contains(document.activeElement);
        closeMenu();
        setRate(scope, rate);
        if (hadFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
      });
      row.style.padding = "7px 20px 7px 14px";
      row.setAttribute("aria-pressed", String(active));
      if (active) row.style.fontWeight = "bold";

      const tick = document.createElement("span");
      tick.textContent = active ? "✓" : "";
      Object.assign(tick.style, { flex: "0 0 12px", fontSize: "12px" });

      const label = document.createElement("span");
      label.textContent = rateName(rate);

      row.appendChild(tick);
      row.appendChild(label);
      frag.appendChild(row);
    });

    return frag;
  }

  // recomputePlacement only on the first render: holding the side across view
  // switches is what keeps the button-adjacent edge pinned as the panel grows.
  function renderMenu(recomputePlacement) {
    if (!menuEl) return;
    hideTip(); // the row it belongs to is about to be replaced
    // Keyboard focus is on a row that's about to be replaced; it moves to
    // the new view's first row rather than being dropped.
    const hadFocus = menuEl.contains(document.activeElement);
    menuEl.textContent = "";
    menuEl.appendChild(menuView === "speed" ? buildSpeedView() : buildRootView());
    positionMenu(recomputePlacement);
    if (hadFocus) focusFirstMenuRow();
  }

  function focusFirstMenuRow() {
    const first = menuEl && menuEl.querySelector("." + FOCUSABLE_CLASS);
    if (first) first.focus({ preventScroll: true });
  }

  // Placed in document coordinates rather than viewport ones, so ordinary page
  // scrolling moves the panel natively - no JS runs per frame and it can't lag
  // behind the player. Whether it sits above or below the button is decided when
  // the panel is built and then held, so scrolling slides it along rather than
  // making it flip sides mid-gesture.
  function positionMenu(recomputePlacement) {
    if (!menuEl || !menuAnchor) return;
    const rect = menuAnchor.getBoundingClientRect();
    const width = menuEl.offsetWidth;
    const height = menuEl.offsetHeight;

    // Scrolled past the player: keep the panel open (scrolling back brings it
    // straight into view) but don't leave it floating over unrelated content.
    const offScreen =
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth;
    menuEl.style.visibility = offScreen ? "hidden" : "visible";
    if (offScreen) return;

    if (recomputePlacement) {
      menuPlacement = rect.top - height - MENU_GAP < 4 ? "below" : "above";
    }

    const docTop = rect.top + window.scrollY;

    // Above the button, the panel's bottom edge is what's pinned, so switching
    // between the two views grows it upward and the button-adjacent edge stays.
    const top =
      menuPlacement === "below"
        ? docTop + rect.height + MENU_GAP
        : docTop - height - MENU_GAP;

    // Right-aligned to the player bar, not centred on the gear, so the panel
    // sits flush with the player's edge. Falls back to the gear itself if the
    // button somehow isn't inside a bar.
    const alignTo =
      menuScope && menuScope.getBoundingClientRect
        ? menuScope.getBoundingClientRect()
        : rect;
    let left = alignTo.right + window.scrollX - width - MENU_EDGE_INSET;

    // Clamped against the document rather than the viewport: a scroll-dependent
    // clamp would drag the panel sideways as the page scrolls.
    const docWidth = document.documentElement.scrollWidth;
    left = Math.max(4, Math.min(left, docWidth - width - 4));

    menuEl.style.top = Math.round(Math.max(0, top)) + "px";
    menuEl.style.left = Math.round(left) + "px";
  }

  // viaKeyboard: opened with Enter/Space, so focus goes into the menu too.
  function openMenu(anchor, viaKeyboard) {
    closeMenu();
    menuAnchor = anchor;
    menuScope = anchor.closest(BAR_SELECTOR) || PAGE_SCOPE;
    menuEl = document.createElement("div");
    menuEl.className = "mobius-speed-menu";
    panelStyle(menuEl);
    Object.assign(menuEl.style, {
      top: "0px",
      left: "0px",
      padding: "6px 0",
      maxHeight: "70vh",
      overflowY: "auto",
    });
    document.documentElement.appendChild(menuEl);
    renderMenu(true);
    animateIn(menuEl, menuPlacement === "below" ? -4 : 4); // slides away from the gear
    if (viaKeyboard) focusFirstMenuRow();
  }

  function toggleMenu(anchor, viaKeyboard) {
    if (menuAnchor === anchor) closeMenu();
    else openMenu(anchor, viaKeyboard);
  }

  // Dismiss on any click outside the menu or its button. Capture phase, so it
  // still fires even though the button's own handler stops propagation.
  document.addEventListener(
    "click",
    (e) => {
      if (!menuEl) return;
      if (menuEl.contains(e.target)) return;
      if (menuAnchor && menuAnchor.contains(e.target)) return;
      closeMenu();
    },
    true
  );

  // Page scrolling is handled natively by the panel's document-space position.
  // This only matters when the player sits in its own scrollable container,
  // where the button moves within the document and the panel has to be
  // re-anchored. Capture phase, since scroll doesn't bubble.
  let repositionQueued = false;
  window.addEventListener(
    "scroll",
    () => {
      if (!menuEl || repositionQueued) return;
      repositionQueued = true;
      requestAnimationFrame(() => {
        repositionQueued = false;
        positionMenu();
      });
    },
    true
  );

  // --- Dock the control into the jPlayer bar, next to the time readout ---

  // Offset of el in the coordinate space `ancestor` establishes - i.e. the space
  // timeHolder's own `left`/`top` are resolved in. The seek bar and the volume
  // control may sit at a different nesting depth than the readout, so their raw
  // offsetLeft/offsetTop are not necessarily comparable to it.
  function offsetWithin(el, ancestor, prop) {
    let total = 0;
    for (let node = el; node && node !== ancestor; node = node.offsetParent) {
      total += node[prop];
    }
    return total;
  }

  // Lay the time readout out just past the end of the seek bar, and the gear
  // button just past the readout. Runs on every dock pass (not just once) so the
  // pair stays aligned with the seek bar, whose width is fluid.
  function layOutControls(bar, timeHolder, btn) {
    // The bar (and the readout inside it) can briefly exist in the DOM with no
    // real layout yet - e.g. mid-transition between slides, before jPlayer has
    // sized/positioned it. Leave things alone until the real layout settles.
    if (bar.offsetWidth < 100 || timeHolder.offsetWidth < 10) return false;

    const origin = timeHolder.offsetParent || bar;
    const progress = bar.querySelector(".jp-progress, .jp-seek-bar");
    const volumeBar = bar.querySelector(".jp-volume-bar");

    let timeLeft = timeHolder.offsetLeft;
    if (progress && progress.offsetWidth > 10) {
      timeLeft =
        offsetWithin(progress, origin, "offsetLeft") +
        progress.offsetWidth +
        PROGRESS_GAP;
    }
    timeHolder.style.setProperty("left", timeLeft + "px", "important");
    timeHolder.style.setProperty("right", "auto", "important");

    let btnLeft = timeLeft + timeHolder.offsetWidth + BADGE_GAP;
    // If that pushes the button into the volume control, pull the pair back left
    // by just enough to clear it.
    if (volumeBar && volumeBar.offsetWidth > 0) {
      const volumeLeft = offsetWithin(volumeBar, origin, "offsetLeft");
      // The real width, not GEAR_SIZE: the speed label widens the button.
      const overflow = btnLeft + btn.offsetWidth + BADGE_GAP - volumeLeft;
      if (overflow > 0) {
        timeLeft = Math.max(0, timeLeft - overflow);
        timeHolder.style.setProperty("left", timeLeft + "px", "important");
        btnLeft = timeLeft + timeHolder.offsetWidth + BADGE_GAP;
      }
    }

    // Center on the seek bar rather than the readout: the readout's box is
    // sized by its line height, so its center sits above the row's true
    // centerline, which the seek bar, play button and volume all share.
    const rowRef =
      progress && progress.offsetHeight > 0
        ? progress
        : volumeBar && volumeBar.offsetHeight > 0
        ? volumeBar
        : timeHolder;
    const centerY =
      offsetWithin(rowRef, origin, "offsetTop") + rowRef.offsetHeight / 2;

    btn.style.left = btnLeft + "px";
    let btnTop = Math.round(centerY - GEAR_SIZE / 2);
    btn.style.top = btnTop + "px";

    // Those offsets assume the button's absolute `top` resolves in the same
    // space they were measured in, which depends on markup we don't control.
    // Rather than trust that, compare what actually rendered against the row
    // reference and correct the difference (in local px, so a CSS-scaled player
    // doesn't throw the correction off). Corrected first, nudged after, so the
    // nudge stays a deliberate offset from true center instead of being
    // cancelled out on the next pass.
    const refRect = rowRef.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const scale = btn.offsetHeight > 0 ? btnRect.height / btn.offsetHeight : 1;
    const drift =
      refRect.top + refRect.height / 2 - (btnRect.top + btnRect.height / 2);
    if (scale > 0 && Math.abs(drift) > 0.5) {
      btnTop = Math.round(btnTop + drift / scale);
    }

    btn.style.top = btnTop + GEAR_NUDGE_Y + "px";
    return true;
  }

  function dockIntoPlayerBar() {
    let docked = false;
    document.querySelectorAll(BAR_SELECTOR).forEach((bar) => {
      const timeHolder = bar.querySelector(".time-holder");
      if (!timeHolder) return;

      const existing = bar.querySelector(".mobius-speed-badge");
      if (existing) {
        layOutControls(bar, timeHolder, existing);
        docked = true;
        return;
      }

      if (bar.offsetWidth < 100 || timeHolder.offsetWidth < 10) return;

      const btn = document.createElement("div");
      btn.className = "mobius-speed-badge";
      btn.title = "Settings - playback speed";
      makeAccessible(btn, "Settings - playback speed");
      Object.assign(btn.style, {
        position: "absolute",
        minWidth: GEAR_SIZE + "px",
        height: GEAR_SIZE + "px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        opacity: "0.85",
        cursor: "pointer",
        userSelect: "none",
        zIndex: "10",
        boxSizing: "border-box",
      });
      btn.appendChild(gearIcon(GEAR_SIZE - 6));

      // The current speed, right beside the gear whenever it isn't 1x - the
      // rate is otherwise only visible once the menu is open.
      const speedLabel = document.createElement("span");
      speedLabel.className = "mobius-speed-label";
      Object.assign(speedLabel.style, {
        marginLeft: "2px",
        color: ACCENT,
        fontFamily: FONT,
        fontSize: "11px",
        fontWeight: "bold",
        lineHeight: GEAR_SIZE + "px",
        whiteSpace: "nowrap",
      });
      btn.appendChild(speedLabel);
      setSpeedLabel(speedLabel, rateFor(bar));

      btn.addEventListener("mouseenter", () => {
        btn.style.opacity = "1";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.opacity = "0.85";
      });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMenu(btn, e.detail === 0); // detail 0: Enter/Space, not a mouse
      });
      bar.appendChild(btn);
      layOutControls(bar, timeHolder, btn);
      docked = true;
    });
    return docked;
  }

  // --- Header toolbar: a purple launcher for drawing + calculator ---
  // Mobius's header (#top) and its two-column body (#inner) are siblings inside
  // #main, so the toolbar goes between them: in normal flow, the same width as
  // the content, overlapping nothing. Guarded like the player docking - an
  // unfamiliar page shape gets no toolbar rather than a broken layout. The bar
  // itself only holds the launcher's place: the launcher is pinned to the
  // viewport where that place sits at the top of the page, so it stays on
  // screen however far down the page is scrolled.
  function ensureToolbar() {
    if (document.getElementById(TOOLBAR_ID)) return;
    const main = document.getElementById("main");
    const top = document.getElementById("top");
    const inner = document.getElementById("inner");
    if (!main || !top || !inner) return;
    if (top.parentElement !== main || inner.parentElement !== main) return;

    const bar = document.createElement("div");
    bar.id = TOOLBAR_ID;
    Object.assign(bar.style, {
      height: LAUNCHER_SIZE + 2 * TOOLBAR_PAD_Y + "px",
      boxSizing: "border-box",
    });

    const launcher = document.createElement("div");
    launcher.className = "mobius-toolbox-launcher";
    launcher.title = "Drawing and calculator";
    makeAccessible(launcher, "Drawing and calculator");
    launcher.setAttribute("aria-expanded", "false");
    Object.assign(launcher.style, {
      position: "fixed",
      // Above the drawing layer too, so it stays clickable mid-stroke.
      zIndex: String(PANEL_Z),
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxSizing: "border-box",
      width: LAUNCHER_SIZE + "px",
      height: LAUNCHER_SIZE + "px",
      borderRadius: "50%",
      background: TOOLBOX_PURPLE,
      color: "#fff",
      cursor: "pointer",
      boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
      transition: "transform 0.1s ease",
    });
    launcher.appendChild(toolboxIcon(22));
    launcher.addEventListener("mouseenter", () => {
      launcher.style.transform = "scale(1.07)";
    });
    launcher.addEventListener("mouseleave", () => {
      launcher.style.transform = "scale(1)";
    });
    launcher.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleToolbox(launcher);
      // The panels live at the end of the document, so from the keyboard
      // (detail 0) focus is carried over to them rather than left for Tab
      // to reach only after the whole page.
      if (e.detail === 0 && drawPanelEl) {
        const first = [...drawPanelEl.querySelectorAll("." + FOCUSABLE_CLASS)].find(
          (el) => el.getAttribute("aria-disabled") !== "true"
        );
        if (first) first.focus({ preventScroll: true });
      }
    });

    bar.appendChild(launcher);
    main.insertBefore(bar, inner);
    placeLauncher();
  }

  // Fixed at the spot the bar reserves when the page is scrolled to the top,
  // read in document coordinates so it lands in the same place whatever the
  // scroll position is when this runs. Re-run on resize and on the fallback
  // interval, since the header's height or the content's width can change.
  //
  // Out in the page margin beside the content when the window is wide enough,
  // so the pinned toolbox never sits on top of the lecture as it scrolls
  // past; the bar then has nothing to hold and collapses. Only on a window
  // too narrow for that does it tuck inside the content's right edge.
  function placeLauncher() {
    const bar = document.getElementById(TOOLBAR_ID);
    const launcher = bar && bar.firstElementChild;
    if (!launcher) return;
    const inner = document.getElementById("inner");
    const contentRight = (inner || bar).getBoundingClientRect().right;
    const marginLeft = contentRight + LAUNCHER_MARGIN_GAP;
    const inMargin =
      marginLeft + LAUNCHER_SIZE + LAUNCHER_MARGIN_GAP <=
      document.documentElement.clientWidth;
    const barHeight = inMargin ? "0px" : LAUNCHER_SIZE + 2 * TOOLBAR_PAD_Y + "px";
    if (bar.style.height !== barHeight) bar.style.height = barHeight;

    const rect = bar.getBoundingClientRect();
    const top = rect.top + window.scrollY + TOOLBAR_PAD_Y;
    const left =
      (inMargin ? marginLeft : contentRight - TOOLBAR_PAD_RIGHT - LAUNCHER_SIZE) +
      window.scrollX;
    launcher.style.top = Math.round(top) + "px";
    launcher.style.left = Math.round(left) + "px";
    positionToolbox();
  }

  // A round button for the draw-tool row: a color swatch, the "unselect"
  // pointer, or the eraser. Selecting one draws a white ring around it, same
  // idea as a Khan-Academy-style tool tray.
  function circleToolButton(size, background, icon, tip, onClick) {
    const btn = document.createElement("div");
    Object.assign(btn.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: size + "px",
      height: size + "px",
      borderRadius: "50%",
      background: background,
      color: "#fff",
      cursor: "pointer",
      boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
      boxSizing: "border-box",
      transition: "transform 0.1s ease, filter 0.1s ease",
    });
    if (icon) btn.appendChild(icon);
    makeAccessible(btn, tip);

    const show = (e) => showTip(tip, e.clientX, e.clientY);
    btn.addEventListener("mouseenter", (e) => {
      show(e);
      // Same small lift the launcher gives on hover - but not for a button
      // that's currently disabled (undo/redo with nothing to do).
      if (btn.getAttribute("aria-disabled") === "true") return;
      btn.style.transform = "scale(1.1)";
      btn.style.filter = "brightness(1.2)";
    });
    btn.addEventListener("mousemove", show);
    btn.addEventListener("mouseleave", () => {
      hideTip();
      btn.style.transform = "";
      btn.style.filter = "";
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideTip();
      onClick();
    });
    return btn;
  }

  // The active ring is drawn entirely in box-shadow (never a border), so an
  // inactive swatch has nothing framing it - a border-box border would still
  // take up layout space even at 0 width, and a transparent one lets the dark
  // panel behind it show through as an unwanted ring around every circle.
  function setSwatchActive(btn, active) {
    btn.setAttribute("aria-pressed", String(active));
    btn.style.boxShadow = active
      ? "0 0 0 2px #fff, 0 0 0 4px " + TOOLBOX_PURPLE + ", 0 1px 3px rgba(0,0,0,0.35)"
      : "0 1px 3px rgba(0,0,0,0.35)";
  }

  // --- The toolbox: a draw-tools panel, opened by the launcher, with a
  // calculator button of its own that opens the (separate) calculator panel
  // on demand. Both are position: fixed, hanging off the launcher, which is
  // pinned to the viewport - so they stay put as the page scrolls under them
  // while the drawing itself moves with the page. Closing the toolbox discards
  // any drawing, same as the old standalone drawing layer: this is a
  // transient annotation tool, not a saved one.
  let calcPanelEl = null;
  let calcOpen = false; // whether calcPanelEl is currently shown, not just built
  let drawPanelEl = null;
  let toolboxAnchor = null;
  let calcBtnEl = null;
  const swatchButtons = []; // { el, tool, color }

  function refreshCalcButton() {
    if (calcBtnEl) setSwatchActive(calcBtnEl, calcOpen);
  }

  // Dragging the calculator by its top strip detaches it from the launcher:
  // it becomes a plain floating window, fixed to the viewport wherever it's
  // dropped, and positionToolbox() stops moving/resizing it from then on. The
  // draw panel stays docked to the launcher either way.
  let calcManualPos = false;
  let calcDragOffsetX = 0;
  let calcDragOffsetY = 0;

  function startCalcDrag(e) {
    if (!calcPanelEl) return;
    const rect = calcPanelEl.getBoundingClientRect();
    calcManualPos = true;
    calcPanelEl.style.top = rect.top + "px";
    calcPanelEl.style.left = rect.left + "px";
    calcDragOffsetX = e.clientX - rect.left;
    calcDragOffsetY = e.clientY - rect.top;
    document.body.style.cursor = "grabbing";

    document.addEventListener("pointermove", onCalcDragMove);
    document.addEventListener("pointerup", stopCalcDrag);
    document.addEventListener("pointercancel", stopCalcDrag);
  }

  function onCalcDragMove(e) {
    if (!calcPanelEl) return;
    const width = calcPanelEl.offsetWidth;
    const height = calcPanelEl.offsetHeight;
    // Kept fully on screen, same idea as the settings menu's own clamping.
    const left = Math.max(
      0,
      Math.min(e.clientX - calcDragOffsetX, window.innerWidth - width)
    );
    const top = Math.max(
      0,
      Math.min(e.clientY - calcDragOffsetY, window.innerHeight - height)
    );
    calcPanelEl.style.left = Math.round(left) + "px";
    calcPanelEl.style.top = Math.round(top) + "px";
  }

  function stopCalcDrag() {
    document.body.style.cursor = "";
    document.removeEventListener("pointermove", onCalcDragMove);
    document.removeEventListener("pointerup", stopCalcDrag);
    document.removeEventListener("pointercancel", stopCalcDrag);
  }

  function toggleToolbox(anchor) {
    if (drawPanelEl) closeToolbox();
    else openToolbox(anchor);
  }

  function openToolbox(anchor) {
    closeToolbox();
    toolboxAnchor = anchor;
    anchor.style.boxShadow = "0 0 0 3px rgba(128,42,143,0.4), 0 2px 8px rgba(0,0,0,0.35)";
    anchor.setAttribute("aria-expanded", "true");

    openDrawSurface();
    drawPanelEl = buildDrawPanel();
    document.documentElement.appendChild(drawPanelEl);

    positionToolbox();
    animateIn(drawPanelEl, -4);
  }

  function closeToolbox() {
    closeCalcPanel();
    if (toolboxAnchor) {
      toolboxAnchor.style.boxShadow = "0 2px 8px rgba(0,0,0,0.35)";
      toolboxAnchor.setAttribute("aria-expanded", "false");
    }
    if (drawPanelEl) drawPanelEl.remove();
    drawPanelEl = null;
    toolboxAnchor = null;
    swatchButtons.length = 0;
    undoBtnEl = null;
    redoBtnEl = null;
    calcBtnEl = null;
    closeDrawSurface();
    hideTip();
  }

  // The calculator: its own on/off, separate from the draw-tools panel -
  // opened by the calculator button under the eraser, not automatically with
  // the rest of the toolbox. The first click builds it; every click after
  // that just shows/hides the same element, so the display, mode and
  // (if dragged) position all survive being toggled off and back on. Only
  // closing the whole toolbox throws that away - see closeCalcPanel().
  function toggleCalcPanel() {
    if (!calcPanelEl) {
      openCalcPanel();
      return;
    }
    calcOpen = !calcOpen;
    calcPanelEl.style.display = calcOpen ? "" : "none";
    refreshCalcButton();
    if (calcOpen) {
      positionToolbox();
      animateIn(calcPanelEl, -4);
      calcPanelEl.focus({ preventScroll: true });
    } else {
      stopCalcDrag(); // harmless if nothing was in progress
      hideTip();
    }
  }

  function openCalcPanel() {
    if (calcPanelEl) return;
    calcReset();
    calcScientific = false; // always opens in basic mode
    calcManualPos = false; // opens docked under the launcher, not wherever it was left
    calcOpen = true;

    calcPanelEl = document.createElement("div");
    calcPanelEl.className = "mobius-calculator";
    panelStyle(calcPanelEl);
    Object.assign(calcPanelEl.style, {
      position: "fixed", // docked to the launcher, which is fixed too
      padding: CALC_PANEL_PAD + "px",
      outline: "none",
      transition: "box-shadow 0.12s ease-in", // fades the hover ring in/out
      // Explicit rather than inherited: the host page's own CSS may reset
      // box-sizing globally, and CALC_WIDTH_BASIC/SCI above are computed
      // assuming border-box.
      boxSizing: "border-box",
    });
    calcPanelEl.tabIndex = -1;
    calcPanelEl.addEventListener("keydown", onCalcKeydown);

    calcPanelEl.appendChild(buildModeToggle());
    renderCalcBody();
    document.documentElement.appendChild(calcPanelEl);

    updateCalcDisplay();
    positionToolbox();
    animateIn(calcPanelEl, -4);
    calcPanelEl.focus({ preventScroll: true });
    refreshCalcButton();
  }

  // The real teardown - only called when the whole toolbox closes. Resets
  // everything, matching "nothing is stored" once the toolbox itself is gone.
  function closeCalcPanel() {
    if (!calcPanelEl) return;
    stopCalcDrag(); // harmless if nothing was in progress
    calcPanelEl.remove();
    calcPanelEl = null;
    calcOpen = false;
    refreshCalcButton();
  }

  function positionToolbox() {
    if (!toolboxAnchor) return;
    // Its own untransformed box, read from the top/left placeLauncher() set,
    // not getBoundingClientRect(): that includes the hover scale, and the
    // launcher is always hovered at the moment it's clicked open - so the
    // panels would be placed ~1.5px off, then jump back on the next pass
    // once the pointer had moved away and it shrank again.
    const anchorTop = parseFloat(toolboxAnchor.style.top) || 0;
    const anchorLeft = parseFloat(toolboxAnchor.style.left) || 0;
    const rect = {
      top: anchorTop,
      left: anchorLeft,
      right: anchorLeft + toolboxAnchor.offsetWidth,
      bottom: anchorTop + toolboxAnchor.offsetHeight,
    };
    const drawHeight = drawPanelEl ? drawPanelEl.offsetHeight : 0;
    const calcHeight = calcPanelEl && calcOpen ? calcPanelEl.offsetHeight : 0;
    // Once dragged, the calculator is off on its own; only the draw panel is
    // still anchored under the launcher, and its height alone decides
    // whether that fits below or above. Same when the calculator isn't open
    // (built but hidden, or never built at all) - there's nothing of its to
    // add.
    const totalHeight =
      calcManualPos || !calcPanelEl || !calcOpen
        ? drawHeight
        : drawHeight + (drawPanelEl ? TOOLBOX_PANEL_GAP : 0) + calcHeight;

    // Viewport coordinates throughout: the launcher is pinned to the viewport,
    // so the panels hanging off it are too, and scrolling moves none of them.
    // Below the button, where the toolbar sits near the top of the page; above
    // it only when there genuinely isn't room below.
    const below =
      rect.bottom + LAUNCHER_TOOLS_GAP + totalHeight <= window.innerHeight ||
      rect.top - totalHeight - LAUNCHER_TOOLS_GAP < 4;
    const top = below
      ? rect.bottom + LAUNCHER_TOOLS_GAP
      : rect.top - totalHeight - LAUNCHER_TOOLS_GAP;
    const clampedTop = Math.round(Math.max(0, top));

    // Both panels align to the launcher's own right edge (the calculator's
    // right edge always equals the launcher's when it's still docked, so the
    // draw panel can use this directly rather than reading it off the
    // calculator, which might by now be sitting somewhere else entirely).
    const viewWidth = window.innerWidth;
    const anchorRight = rect.right;

    if (drawPanelEl) {
      const drawWidth = drawPanelEl.offsetWidth;
      const drawLeft = Math.max(
        4,
        Math.min(anchorRight - drawWidth, viewWidth - drawWidth - 4)
      );
      drawPanelEl.style.top = clampedTop + "px";
      drawPanelEl.style.left = Math.round(drawLeft) + "px";
    }

    if (!calcPanelEl || !calcOpen) return; // nothing more to position

    if (!calcManualPos) {
      const calcWidth = calcPanelEl.offsetWidth;
      const calcLeft = Math.max(
        4,
        Math.min(anchorRight - calcWidth, viewWidth - calcWidth - 4)
      );
      // The calculator hangs below the draw-tools row (or right under the
      // launcher if there's no draw panel), right-aligned the same way.
      calcPanelEl.style.top =
        clampedTop + (drawPanelEl ? drawHeight + TOOLBOX_PANEL_GAP : 0) + "px";
      calcPanelEl.style.left = Math.round(calcLeft) + "px";
    } else {
      // Detached: stays exactly where it was dropped, but a size change
      // while parked near an edge (toggling scientific mode is wider) could
      // otherwise push part of it off-screen with nothing to pull it back,
      // since dragging itself is the only other thing that clamps position.
      const calcWidth = calcPanelEl.offsetWidth;
      const calcPanelHeight = calcPanelEl.offsetHeight;
      const fixedRect = calcPanelEl.getBoundingClientRect();
      const fixedLeft = Math.max(
        0,
        Math.min(fixedRect.left, window.innerWidth - calcWidth)
      );
      const fixedTop = Math.max(
        0,
        Math.min(fixedRect.top, window.innerHeight - calcPanelHeight)
      );
      calcPanelEl.style.left = Math.round(fixedLeft) + "px";
      calcPanelEl.style.top = Math.round(fixedTop) + "px";
    }
  }

  // The draw-tools panel, one column: undo above redo, then three color
  // circles, an "unselect" pointer that hands clicks back to the page, the
  // eraser and the calculator button. Its own panel, separate from the
  // calculator.
  function buildDrawPanel() {
    swatchButtons.length = 0;

    const panel = document.createElement("div");
    panel.className = "mobius-draw-tools";
    // panelStyle() for position/z-index only - overridden right after so the
    // circles float free rather than sitting on a card of their own.
    panelStyle(panel);
    Object.assign(panel.style, {
      position: "fixed", // docked to the launcher, which is fixed too
      background: "none",
      boxShadow: "none",
      // No vertical padding, so the launcher-to-first-circle gap is exactly
      // LAUNCHER_TOOLS_GAP; the sides keep the column centred under the launcher.
      padding: "0 8px",
      display: "flex",
      flexDirection: "column",
      // flex-end: every circle flush against the same right edge the
      // calculator and launcher share.
      alignItems: "flex-end",
      gap: TOOL_GAP + "px",
    });

    // Undo above redo, at the top of the column: actions rather than tools
    // to pick, so they sit apart from the colors below.
    undoBtnEl = circleToolButton(
      SWATCH_SIZE,
      TOOLBOX_NEUTRAL,
      undoIcon(TOOL_ICON_SIZE),
      "Undo",
      undoStroke
    );
    redoBtnEl = circleToolButton(
      SWATCH_SIZE,
      TOOLBOX_NEUTRAL,
      redoIcon(TOOL_ICON_SIZE),
      "Redo",
      redoStroke
    );
    panel.append(undoBtnEl, redoBtnEl);
    refreshUndoRedo();

    PEN_COLORS.forEach((color, i) => {
      const btn = circleToolButton(SWATCH_SIZE, color, null, PEN_NAMES[i], () =>
        setDrawTool("pen", color)
      );
      swatchButtons.push({ el: btn, tool: "pen", color: color });
      panel.appendChild(btn);
    });

    const unselect = circleToolButton(
      SWATCH_SIZE,
      TOOLBOX_NEUTRAL,
      cursorIcon(TOOL_ICON_SIZE),
      "Stop drawing",
      () => setDrawTool("none", null)
    );
    swatchButtons.push({ el: unselect, tool: "none", color: null });
    panel.appendChild(unselect);

    const eraser = circleToolButton(
      SWATCH_SIZE,
      TOOLBOX_NEUTRAL,
      eraserIcon(TOOL_ICON_SIZE),
      "Eraser",
      () => setDrawTool("eraser", null)
    );
    swatchButtons.push({ el: eraser, tool: "eraser", color: null });
    panel.appendChild(eraser);

    // Not a draw tool, so not in swatchButtons - its own on/off, toggled by
    // whether the calculator panel exists rather than by drawTool.
    calcBtnEl = circleToolButton(
      SWATCH_SIZE,
      TOOLBOX_NEUTRAL,
      calculatorIcon(TOOL_ICON_SIZE),
      "Calculator",
      toggleCalcPanel
    );
    panel.appendChild(calcBtnEl);
    refreshCalcButton();

    refreshSwatches();
    return panel;
  }

  function refreshSwatches() {
    swatchButtons.forEach((entry) => {
      const active =
        entry.tool === drawTool &&
        (entry.tool !== "pen" || entry.color === drawColor);
      setSwatchActive(entry.el, active);
    });
  }

  // --- Drawing overlay ---
  // A transient annotation layer over the page: nothing is saved, and closing
  // the toolbox throws the marks away. The marks are an SVG placed in document
  // coordinates, so the browser scrolls them with the page itself - replaying
  // them onto a viewport-fixed canvas from a scroll handler always trailed the
  // page by a frame or more. Input is caught separately by an invisible
  // viewport-fixed layer, which has nothing to show and so can't visibly lag.
  // "Unselect" leaves the marks in place but hands clicks back to the page,
  // rather than removing the layer, so scrolling and reading still work
  // without having to close the whole toolbox.
  let drawInputEl = null;
  let drawSvgEl = null;
  let drawTool = "none"; // "none" | "pen" | "eraser"
  let drawColor = PEN_COLORS[0];
  let drawStrokes = [];
  let drawRedoStack = []; // popped strokes, ready for redo until a new one is drawn
  let drawStroke = null; // the stroke being drawn right now
  let undoBtnEl = null;
  let redoBtnEl = null;

  function openDrawSurface() {
    if (drawInputEl) return;
    drawStrokes = [];
    drawRedoStack = [];
    drawStroke = null;
    drawTool = "none";
    drawColor = PEN_COLORS[0];

    // A 1px box at the document origin whose strokes overflow it visibly:
    // unlike a box sized to the document, it can't keep the page scrollable
    // past its real end if the content later gets shorter.
    drawSvgEl = svgEl("svg", { class: "mobius-draw-layer", width: "1", height: "1" });
    Object.assign(drawSvgEl.style, {
      position: "absolute",
      left: "0",
      top: "0",
      overflow: "visible",
      zIndex: String(PANEL_Z - 1), // below the toolbox panel, above the page
      pointerEvents: "none",
    });
    document.documentElement.appendChild(drawSvgEl);

    drawInputEl = document.createElement("div");
    drawInputEl.className = "mobius-draw-input";
    Object.assign(drawInputEl.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      zIndex: String(PANEL_Z - 1),
      cursor: "default",
      pointerEvents: "none", // "unselect" is the default: the page stays usable
      touchAction: "none", // a finger or pen draws here instead of scrolling
    });
    document.documentElement.appendChild(drawInputEl);

    drawInputEl.addEventListener("pointerdown", onDrawStart);
    drawInputEl.addEventListener("pointermove", onDrawMove);
    drawInputEl.addEventListener("pointerup", onDrawEnd);
    drawInputEl.addEventListener("pointercancel", onDrawEnd);
  }

  function closeDrawSurface() {
    if (!drawInputEl) return;
    drawInputEl.remove();
    drawSvgEl.remove();
    drawInputEl = null;
    drawSvgEl = null;
    drawStroke = null;
    drawStrokes = [];
    drawRedoStack = [];
    drawTool = "none";
  }

  function docPoint(e) {
    return { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
  }

  // A lone point becomes a zero-length segment, which round caps render as a
  // dot, so a tap with no movement still leaves a mark.
  function strokePathData(points) {
    const d = points.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y);
    if (points.length === 1) d.push("L" + points[0].x + " " + points[0].y);
    return d.join(" ");
  }

  function strokePath(stroke, color) {
    return svgEl("path", {
      d: strokePathData(stroke.points),
      fill: "none",
      stroke: color,
      "stroke-width": stroke.width,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
  }

  // Rebuilt from the stroke list whenever it changes shape (a new stroke,
  // undo, redo); extending the stroke in progress only rewrites its own path.
  // The eraser only removes marks, never the page: each eraser stroke becomes
  // a mask over everything drawn before it, so later pen strokes still show
  // on top of an erased patch, same as painting over it would.
  function renderStrokes() {
    if (!drawSvgEl) return;
    drawSvgEl.textContent = "";
    const defs = svgEl("defs", {});
    drawSvgEl.appendChild(defs);
    const root = document.documentElement;
    const box = {
      x: -100,
      y: -100,
      width: root.scrollWidth + 200,
      height: root.scrollHeight + 200,
    };
    let group = svgEl("g", {});
    drawStrokes.forEach((stroke, i) => {
      if (stroke.tool !== "eraser") {
        stroke.el = strokePath(stroke, stroke.color);
        group.appendChild(stroke.el);
        return;
      }
      const id = "mobius-erase-" + i;
      const mask = svgEl("mask", Object.assign({ id, maskUnits: "userSpaceOnUse" }, box));
      mask.appendChild(svgEl("rect", Object.assign({ fill: "#fff" }, box)));
      stroke.el = strokePath(stroke, "#000");
      mask.appendChild(stroke.el);
      defs.appendChild(mask);
      const masked = svgEl("g", { mask: "url(#" + id + ")" });
      masked.appendChild(group);
      group = masked;
    });
    drawSvgEl.appendChild(group);
  }

  function onDrawStart(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    drawStroke = {
      tool: drawTool,
      color: drawColor,
      width: drawTool === "eraser" ? ERASER_WIDTH : PEN_WIDTH,
      points: [docPoint(e)],
    };
    drawStrokes.push(drawStroke);
    drawRedoStack = []; // a fresh stroke retires whatever could have been redone
    refreshUndoRedo();
    // Captured, so a stroke that leaves the window still ends cleanly.
    if (drawInputEl.setPointerCapture) drawInputEl.setPointerCapture(e.pointerId);
    renderStrokes();
  }

  function onDrawMove(e) {
    if (!drawStroke) return;
    e.preventDefault();
    drawStroke.points.push(docPoint(e));
    drawStroke.el.setAttribute("d", strokePathData(drawStroke.points));
  }

  function onDrawEnd() {
    drawStroke = null;
  }

  function undoStroke() {
    if (!drawStrokes.length) return;
    drawRedoStack.push(drawStrokes.pop());
    renderStrokes();
    refreshUndoRedo();
  }

  function redoStroke() {
    if (!drawRedoStack.length) return;
    drawStrokes.push(drawRedoStack.pop());
    renderStrokes();
    refreshUndoRedo();
  }

  // Dimmed rather than removed when there's nothing to do, same idea as a
  // disabled button - undoStroke()/redoStroke() already no-op on an empty
  // stack, so this is purely the visual signal.
  function refreshUndoRedo() {
    setToolEnabled(undoBtnEl, drawStrokes.length > 0);
    setToolEnabled(redoBtnEl, drawRedoStack.length > 0);
  }

  // Disabled looks and acts the part: dimmed, an ordinary cursor instead of
  // the pointing hand, no hover lift, and announced as unavailable.
  function setToolEnabled(btn, enabled) {
    if (!btn) return;
    btn.style.opacity = enabled ? "1" : "0.35";
    btn.style.cursor = enabled ? "pointer" : "default";
    btn.setAttribute("aria-disabled", String(!enabled));
    if (!enabled) {
      btn.style.transform = "";
      btn.style.filter = "";
    }
  }

  // Picking "unselect" leaves the layer in place (marks stay visible) but
  // gives up the pointer, so scrolling and clicking the page work normally.
  // Picking a color or the eraser takes the pointer back and starts capturing
  // strokes in that color/mode.
  function setDrawTool(tool, color) {
    drawTool = tool;
    if (tool === "pen" && color) drawColor = color;
    if (drawInputEl) {
      drawInputEl.style.pointerEvents = tool === "none" ? "none" : "auto";
      drawInputEl.style.cursor = tool === "eraser" ? "cell" : "crosshair";
    }
    refreshSwatches();
  }

  // --- Calculator ---
  const CALC_KEYS = [
    ["C", "⌫", "±", "÷"],
    ["7", "8", "9", "×"],
    ["4", "5", "6", "−"],
    ["1", "2", "3", "+"],
    ["0", ".", "="],
  ];
  // Three columns of function keys, added beside the ordinary keypad in
  // scientific mode - sized to exactly match its five rows.
  const SCI_KEYS = [
    ["(", ")", "Ans"],
    ["sin", "cos", "tan"],
    ["log", "ln", "√"],
    ["x²", "xʸ", "1/x"],
    ["π", "e", "n!"],
  ];
  // What each scientific key types into the expression. Functions open their
  // own parenthesis, as "sin(" does on a real scientific calculator.
  const CALC_TOKEN_FOR = {
    sin: "sin(",
    cos: "cos(",
    tan: "tan(",
    log: "log(",
    ln: "ln(",
    "√": "√(",
    "x²": "²",
    "xʸ": "^",
    "1/x": "⁻¹",
    "n!": "!",
  };
  // Spoken names for keys whose label isn't a word a screen reader says well.
  const CALC_KEY_NAMES = {
    C: "Clear",
    "⌫": "Backspace",
    "±": "Change sign",
    "÷": "Divide",
    "×": "Multiply",
    "−": "Minus",
    "+": "Plus",
    "=": "Equals",
    ".": "Decimal point",
    "√": "Square root",
    "x²": "Square",
    "xʸ": "Power",
    "1/x": "Reciprocal",
    "n!": "Factorial",
    "π": "Pi",
    "(": "Open bracket",
    ")": "Close bracket",
  };
  const CALC_BINARY = ["+", "−", "×", "÷", "^"];
  const CALC_POSTFIX = ["²", "⁻¹", "!"];
  const CALC_CONSTANTS = ["π", "e", "Ans"];
  // Every key is this many px wide, basic or scientific, so switching modes
  // only adds columns - it never changes the size of a key that was already
  // there. The panel widths below are derived from it rather than guessed,
  // so the two grids' keys always end up identically sized.
  // The hover ring on the calculator's top strip: the panel's own gray
  // (51, 51, 51 - matches panelStyle()'s background), at a lower opacity than
  // the panel itself, so it reads as a light gray outline rather than a dark
  // one against most page backgrounds.
  const CALC_HOVER_RING = "0 0 0 5px rgba(51, 51, 51, 0.2)";
  const CALC_KEY_W = 44;
  const CALC_GRID_GAP = 3;
  const CALC_COLS = 4; // the ordinary keypad
  const SCI_COLS = 3; // the extra function-key columns
  const CALC_PANEL_PAD = 7; // matches calcPanelEl's own padding, below
  // calcPanelEl is set to boxSizing: border-box (Mobius's page CSS can't be
  // trusted not to reset that itself), so its declared width has to include
  // the panel's own padding, not just the keys - otherwise the padding eats
  // into the grid's space and the rightmost column gets clipped.
  const CALC_WIDTH_BASIC =
    CALC_COLS * CALC_KEY_W +
    (CALC_COLS - 1) * CALC_GRID_GAP +
    CALC_PANEL_PAD * 2;
  const CALC_WIDTH_SCI =
    CALC_WIDTH_BASIC +
    SCI_COLS * CALC_KEY_W +
    (SCI_COLS - 1) * CALC_GRID_GAP +
    CALC_GRID_GAP; // plus the gap between the two grids themselves
  // Typing works too, but only while the panel has focus, so the page keeps its
  // own keys everywhere else.
  const CALC_KEY_FOR = {
    "/": "÷",
    "*": "×",
    x: "×",
    "-": "−",
    "+": "+",
    "^": "xʸ",
    "(": "(",
    ")": ")",
    "!": "n!",
    "=": "=",
    Enter: "=",
    Backspace: "⌫",
    Delete: "C",
    c: "C",
    C: "C",
  };
  const CALC_MAX_DIGITS = 14; // per number, about as many as the display holds

  let calcDisplay = null; // the expression being typed, or a result
  let calcHistoryEl = null; // above it: the expression a result came from
  let calcPreviewEl = null; // below it: the result of what's typed so far

  // Typed the way a phone or scientific calculator takes it: the whole
  // expression builds up on screen and is only worked out on "=", with the
  // usual precedence. Kept as tokens rather than a string so ⌫ takes back
  // exactly one key press - "sin(" all at once, a number one digit at a time.
  let calcTokens = [];
  let calcAns = 0; // the last result, for the Ans key
  let calcResult = null; // { value, expr } while a result is on screen
  let calcError = null; // the expression that failed, while "Error" shows
  let calcScientific = false; // whether the function-key columns are showing

  // The one button that was left after the header came off: switches between
  // the plain keypad and the wider scientific layout.
  // Doubles as the drag handle: the empty space left of the toggle button is
  // most of the row, so dragging from "the top of the calculator" is dragging
  // this.
  function buildModeToggle() {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "5px",
      minHeight: "22px", // a real grab target even before anything's in it
      cursor: "grab",
    });

    // The ring surrounds the whole panel, but only appears while hovering
    // this strip - the part that's actually draggable - not the calculator
    // in general. mouseenter/mouseleave (unlike mouseover/mouseout) don't
    // re-fire for the toggle button nested inside, so hovering it doesn't
    // flicker the ring off and on.
    const calcBaseShadow = calcPanelEl.style.boxShadow;
    row.addEventListener("mouseenter", () => {
      calcPanelEl.style.boxShadow = CALC_HOVER_RING + ", " + calcBaseShadow;
    });
    row.addEventListener("mouseleave", () => {
      calcPanelEl.style.boxShadow = calcBaseShadow;
    });

    const btn = document.createElement("div");
    Object.assign(btn.style, {
      fontSize: "12px",
      fontWeight: "bold",
      padding: "4px 10px",
      borderRadius: CONTROL_RADIUS + "px",
      background: "rgba(255,255,255,0.14)",
      color: "#fff",
      cursor: "pointer",
      userSelect: "none",
    });
    makeAccessible(btn);
    const renderLabel = () => {
      btn.textContent = calcScientific ? "123" : "fx";
      btn.setAttribute(
        "aria-label",
        calcScientific ? "Switch to basic" : "Switch to scientific"
      );
    };
    renderLabel();

    const show = (e) =>
      showTip(
        calcScientific ? "Switch to basic" : "Switch to scientific",
        e.clientX,
        e.clientY
      );
    btn.addEventListener("mouseenter", (e) => {
      btn.style.background = "rgba(255,255,255,0.28)";
      show(e);
    });
    btn.addEventListener("mousemove", show);
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "rgba(255,255,255,0.14)";
      hideTip();
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideTip();
      // Captured before the width changes below: while docked, resizing
      // already keeps the right edge fixed (it's computed off the launcher's
      // own right edge every time); once dragged there's no anchor to
      // recompute from, so the old right edge has to be remembered here and
      // restored after, or the panel would grow/shrink from its left edge
      // instead and visibly drift right each time it's made narrower.
      const prevRight =
        calcManualPos && calcPanelEl
          ? calcPanelEl.getBoundingClientRect().right
          : null;
      calcScientific = !calcScientific;
      renderLabel();
      renderCalcBody();
      updateCalcDisplay();
      if (prevRight !== null) {
        const newWidth = calcPanelEl.offsetWidth;
        const newLeft = Math.max(
          0,
          Math.min(prevRight - newWidth, window.innerWidth - newWidth)
        );
        calcPanelEl.style.left = Math.round(newLeft) + "px";
      }
      positionToolbox(); // repositions the draw panel; re-clamps the calculator
      // Back to the panel after a mouse click, so typing keeps working. From
      // the keyboard (detail 0) focus stays on the rebuilt toggle instead.
      if (calcPanelEl && e.detail) calcPanelEl.focus({ preventScroll: true });
    });

    row.addEventListener("pointerdown", (e) => {
      if (e.target === btn || btn.contains(e.target)) return; // its own click
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      startCalcDrag(e);
    });

    row.append(gripIcon(), btn);
    return row;
  }

  // Six dots at the strip's left end - the usual sign that it can be dragged.
  function gripIcon() {
    const svg = svgEl("svg", { width: "14", height: "9", viewBox: "0 0 14 9" });
    [1.5, 7, 12.5].forEach((x) => {
      [1.5, 7.5].forEach((y) => {
        svg.appendChild(svgEl("circle", { cx: x, cy: y, r: "1.4", fill: "currentColor" }));
      });
    });
    svg.style.opacity = "0.45";
    svg.style.flex = "0 0 auto";
    return svg;
  }

  // Rebuilds everything under the mode toggle - called on first open and
  // again whenever that toggle flips. Kept separate from openToolbox() so
  // both paths share one rebuild instead of two copies of this layout.
  function renderCalcBody() {
    if (!calcPanelEl) return;
    while (calcPanelEl.children.length > 1) {
      calcPanelEl.removeChild(calcPanelEl.lastChild);
    }
    calcPanelEl.style.width =
      (calcScientific ? CALC_WIDTH_SCI : CALC_WIDTH_BASIC) + "px";

    calcPanelEl.appendChild(buildCalcDisplay());

    const keysRow = document.createElement("div");
    Object.assign(keysRow.style, {
      display: "flex",
      gap: CALC_GRID_GAP + "px",
    });
    if (calcScientific) keysRow.appendChild(buildSciKeys());
    keysRow.appendChild(buildCalcKeys());
    calcPanelEl.appendChild(keysRow);
  }

  function buildCalcDisplay() {
    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      background: "rgba(0,0,0,0.35)",
      borderRadius: CONTROL_RADIUS + "px",
      padding: "4px 7px 6px",
      marginBottom: "5px",
      textAlign: "right",
    });
    const smallLine = () => {
      const line = document.createElement("div");
      Object.assign(line.style, {
        fontSize: "11px",
        opacity: "0.55",
        minHeight: "14px", // held open even when empty, so the panel doesn't jump
        whiteSpace: "nowrap",
        overflow: "hidden",
      });
      return line;
    };
    calcHistoryEl = smallLine();
    calcPreviewEl = smallLine();
    calcDisplay = document.createElement("div");
    Object.assign(calcDisplay.style, {
      height: "26px",
      lineHeight: "26px",
      whiteSpace: "nowrap",
      overflow: "hidden", // scrolled to its end in code, so the newest input shows
    });
    wrap.append(calcHistoryEl, calcDisplay, calcPreviewEl);
    return wrap;
  }

  function buildCalcKeys() {
    const grid = document.createElement("div");
    Object.assign(grid.style, {
      display: "grid",
      // Fixed px, not 1fr: a fluid column would resize every key whenever
      // the scientific grid joins or leaves, which is exactly what shouldn't
      // happen - only the panel should grow, not the keys already on it.
      gridTemplateColumns: `repeat(${CALC_COLS}, ${CALC_KEY_W}px)`,
      gap: CALC_GRID_GAP + "px",
      flexShrink: "0", // never compressed below that fixed size as a flex item
    });
    CALC_KEYS.forEach((row) => {
      row.forEach((key) => grid.appendChild(calcKeyButton(key)));
    });
    return grid;
  }

  function calcKeyButton(key) {
    // Four kinds, told apart at a glance: "=" in the accent, the operators
    // tinted with it, the editing keys (C ⌫ ±) a lighter grey than digits.
    const isEquals = key === "=";
    const isOperator = CALC_BINARY.includes(key);
    const isEdit = key === "C" || key === "⌫" || key === "±";
    const base = isEquals
      ? ACCENT
      : isOperator
      ? "rgba(62,166,255,0.24)"
      : isEdit
      ? "rgba(255,255,255,0.18)"
      : "rgba(255,255,255,0.1)";
    const hover = isEquals
      ? "#63b8ff"
      : isOperator
      ? "rgba(62,166,255,0.4)"
      : "rgba(255,255,255,0.28)";

    const btn = document.createElement("div");
    btn.textContent = key;
    Object.assign(btn.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "30px",
      borderRadius: CONTROL_RADIUS + "px",
      background: base,
      color: isEquals ? "#1a1a1a" : "#fff",
      fontSize: "14px",
      cursor: "pointer",
    });
    if (key === "0") btn.style.gridColumn = "span 2";
    makeAccessible(btn, CALC_KEY_NAMES[key]);

    btn.addEventListener("mouseenter", () => {
      btn.style.background = hover;
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = base;
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      calcKey(key);
      updateCalcDisplay();
      // After a mouse click only: from the keyboard, focus stays on the key.
      if (calcPanelEl && e.detail) calcPanelEl.focus({ preventScroll: true });
    });
    return btn;
  }

  // The scientific column: same row height as the ordinary keypad (five
  // rows), so the two grids sit flush side by side.
  function buildSciKeys() {
    const grid = document.createElement("div");
    Object.assign(grid.style, {
      display: "grid",
      // Same fixed key width as the basic grid.
      gridTemplateColumns: `repeat(${SCI_COLS}, ${CALC_KEY_W}px)`,
      gap: CALC_GRID_GAP + "px",
      flexShrink: "0",
    });
    SCI_KEYS.forEach((row) => {
      row.forEach((label) => grid.appendChild(sciKeyButton(label)));
    });
    return grid;
  }

  function sciKeyButton(label) {
    const base = "rgba(255,255,255,0.18)";
    const btn = document.createElement("div");
    btn.textContent = label;
    Object.assign(btn.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "30px",
      borderRadius: CONTROL_RADIUS + "px",
      background: base,
      color: "#fff",
      fontSize: "12px",
      cursor: "pointer",
    });
    makeAccessible(btn, CALC_KEY_NAMES[label]);
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "rgba(255,255,255,0.3)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = base;
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      calcKey(label);
      updateCalcDisplay();
      if (calcPanelEl && e.detail) calcPanelEl.focus({ preventScroll: true });
    });
    return btn;
  }

  // Degrees, not radians - what most people expect typing 30 into "sin".
  // Rounded so sin(180) is 0 rather than 1.2e-16, and so tan(90) divides by
  // an exact 0 and reports an error instead of a huge number.
  const DEG_TO_RAD = Math.PI / 180;
  const calcTrig = (fn) => (deg) => Math.round(fn(deg * DEG_TO_RAD) * 1e12) / 1e12;
  const CALC_FUNCTIONS = {
    "(": (v) => v,
    "sin(": calcTrig(Math.sin),
    "cos(": calcTrig(Math.cos),
    "tan(": (v) => calcTrig(Math.sin)(v) / calcTrig(Math.cos)(v),
    "log(": Math.log10,
    "ln(": Math.log,
    "√(": Math.sqrt,
  };

  function onCalcKeydown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = /^[0-9.]$/.test(e.key) ? e.key : CALC_KEY_FOR[e.key];
    if (!key) return; // Escape and everything else is left to the page
    e.preventDefault();
    e.stopPropagation();
    calcKey(key);
    updateCalcDisplay();
  }

  const calcIsDigit = (t) => /^[0-9.]$/.test(t);
  // A carried-over result too long for digit tokens, like "1.5e-7".
  const calcIsLiteral = (t) => /^[0-9.]+e/.test(t);
  const calcLast = () => calcTokens[calcTokens.length - 1];

  // Whether what's typed so far ends in something an operator can follow.
  function calcEndsWithValue() {
    const t = calcLast();
    return (
      t !== undefined &&
      (calcIsDigit(t) ||
        calcIsLiteral(t) ||
        t === ")" ||
        CALC_POSTFIX.includes(t) ||
        CALC_CONSTANTS.includes(t))
    );
  }

  function calcOpenParens() {
    let open = 0;
    calcTokens.forEach((t) => {
      if (t.endsWith("(")) open++;
      else if (t === ")") open--;
    });
    return open;
  }

  function calcTrailingNumber() {
    let i = calcTokens.length;
    while (i > 0 && calcIsDigit(calcTokens[i - 1])) i--;
    return calcTokens.slice(i);
  }

  // A result as tokens to keep typing after. Negatives are bracketed so a
  // following x² or xʸ applies to the whole number, as it did on screen.
  function calcValueTokens(value, bracketNegative) {
    const text = String(value);
    const neg = text.charAt(0) === "-";
    const body = neg ? text.slice(1) : text;
    const digits = body.indexOf("e") >= 0 ? [body] : body.split("");
    if (!neg) return digits;
    return bracketNegative ? ["(", "−"].concat(digits, [")"]) : ["−"].concat(digits);
  }

  // A key pressed while a result is showing: operators and x², 1/x, n! carry
  // on from the result, a function wraps it, anything else starts afresh.
  // Returns true if that already took care of the key.
  function calcLeaveResult(token) {
    if (!calcResult) return false;
    const ans = calcValueTokens(calcResult.value, true);
    calcResult = null;
    calcTokens = [];
    if (CALC_BINARY.includes(token) || CALC_POSTFIX.includes(token)) {
      calcTokens = ans;
    } else if (token.endsWith("(") && token !== "(") {
      calcTokens = [token].concat(ans, [")"]);
      return true;
    }
    return false;
  }

  function calcKey(label) {
    if (calcError !== null) {
      // Any key clears the error; C and ⌫ do nothing more than that.
      calcError = null;
      calcTokens = [];
      if (label === "C" || label === "⌫") return;
    }
    if (/^[0-9]$/.test(label)) return calcTypeDigit(label);
    if (label === ".") return calcTypeDecimal();
    if (label === "=") return calcEquals();
    if (label === "⌫") return calcBackspace();
    if (label === "±") return calcNegate();
    if (label === "C") {
      calcTokens = [];
      calcResult = null;
      return; // Ans is kept, as a real calculator keeps it
    }
    const token = CALC_TOKEN_FOR[label] || label;
    if (calcLeaveResult(token)) return;
    if (CALC_BINARY.includes(token)) calcTypeOperator(token);
    else if (CALC_POSTFIX.includes(token)) {
      if (calcEndsWithValue()) calcTokens.push(token);
    } else if (token === ")") {
      if (calcOpenParens() > 0 && calcEndsWithValue()) calcTokens.push(token);
    } else {
      // "(", a function or a constant. Straight after a value it means
      // multiplication, so 2π types as 2×π.
      if (calcEndsWithValue()) calcTokens.push("×");
      calcTokens.push(token);
    }
  }

  function calcTypeDigit(d) {
    calcLeaveResult(d);
    const last = calcLast();
    if (last !== undefined && !calcIsDigit(last) && calcEndsWithValue()) {
      calcTokens.push("×"); // after ")", π, x² and so on
    }
    const num = calcTrailingNumber();
    if (num.join("") === "0") calcTokens[calcTokens.length - 1] = d; // no leading zeros
    else if (num.filter((c) => c !== ".").length < CALC_MAX_DIGITS) calcTokens.push(d);
  }

  function calcTypeDecimal() {
    calcLeaveResult(".");
    const num = calcTrailingNumber();
    if (num.indexOf(".") >= 0) return;
    if (!num.length) {
      if (calcEndsWithValue()) calcTokens.push("×");
      calcTokens.push("0");
    }
    calcTokens.push(".");
  }

  // A second operator replaces the first, so a mistyped + can be corrected
  // by just pressing ×. The exception is a minus after ×, ÷, ^ or an opening
  // bracket, which makes the next number negative instead.
  function calcTypeOperator(op) {
    const last = calcLast();
    if (op === "−" && (last === undefined || last.endsWith("(") || /^[×÷^]$/.test(last))) {
      calcTokens.push(op);
      return;
    }
    while (CALC_BINARY.includes(calcLast())) calcTokens.pop();
    if (calcEndsWithValue()) calcTokens.push(op);
  }

  // ⌫ on a result turns it back into something editable, digit by digit.
  function calcBackspace() {
    if (calcResult) {
      calcTokens = calcValueTokens(calcResult.value, false);
      calcResult = null;
    }
    calcTokens.pop();
  }

  // Where the operand ending at `end` starts: a number, a constant, or a
  // whole bracket, with any x²/1/x/n! after it. `end` itself means there's
  // no operand there yet.
  function calcOperandStart(end) {
    let i = end;
    while (i > 0 && CALC_POSTFIX.includes(calcTokens[i - 1])) i--;
    const t = calcTokens[i - 1];
    if (t === undefined) return end;
    if (calcIsDigit(t)) {
      while (i > 0 && calcIsDigit(calcTokens[i - 1])) i--;
      return i;
    }
    if (calcIsLiteral(t) || CALC_CONSTANTS.includes(t)) return i - 1;
    if (t === ")") {
      let depth = 0;
      for (let j = i - 1; j >= 0; j--) {
        if (calcTokens[j] === ")") depth++;
        else if (calcTokens[j].endsWith("(") && --depth === 0) return j;
      }
    }
    return end;
  }

  // Flips the sign of the number being typed, as ± does on a real
  // calculator, rather than of the whole expression.
  function calcNegate() {
    if (calcResult) {
      calcResult = { value: -calcResult.value, expr: null };
      calcAns = calcResult.value;
      return;
    }
    const end = calcTokens.length;
    const start = calcOperandStart(end);
    const last = calcLast();
    if (start === end) {
      // Nothing to flip yet: start the next number off negative (or undo that).
      if (last === "−" && calcOperandStart(end - 1) === end - 1) calcTokens.pop();
      else if (last === undefined || last.endsWith("(") || CALC_BINARY.includes(last)) {
        calcTokens.push("−");
      }
      return;
    }
    const prev = calcTokens[start - 1];
    const before = calcTokens[start - 2];
    const unary =
      prev === "−" &&
      (before === undefined || before.endsWith("(") || CALC_BINARY.includes(before));
    if (unary) calcTokens.splice(start - 1, 1);
    else if (prev === "−") calcTokens[start - 1] = "+";
    else if (prev === "+") calcTokens[start - 1] = "−";
    else calcTokens.splice(start, 0, "−");
  }

  // What "=" works out: a trailing operator or empty bracket is ignored, and
  // unclosed brackets are closed, so "5+" gives 5 and "√(9" gives 3.
  function calcCompleted() {
    const tokens = calcTokens.slice();
    while (
      tokens.length &&
      (CALC_BINARY.includes(tokens[tokens.length - 1]) ||
        tokens[tokens.length - 1].endsWith("("))
    ) {
      tokens.pop();
    }
    let open = 0;
    tokens.forEach((t) => {
      if (t.endsWith("(")) open++;
      else if (t === ")") open--;
    });
    for (; open > 0; open--) tokens.push(")");
    return tokens;
  }

  function calcEquals() {
    if (calcResult || !calcTokens.length) return;
    const tokens = calcCompleted();
    if (!tokens.length) return;
    const expr = tokens.join("");
    const value = calcEvaluate(tokens);
    if (value === null) {
      calcError = expr;
      return;
    }
    calcAns = value;
    calcResult = { value, expr };
    calcTokens = [];
  }

  function calcFactorial(n) {
    if (n < 0 || n > 170 || !Number.isInteger(n)) return NaN;
    let out = 1;
    for (let i = 2; i <= n; i++) out *= i;
    return out;
  }

  // Recursive descent over the tokens, loosest-binding first: + −, then × ÷,
  // then a leading minus, then ^ (right to left, so 2^3^2 is 2^9), then x²,
  // 1/x and n!. So −2² is −4 and 2+3×4 is 14, as on a scientific calculator.
  // Returns null for anything that doesn't come out as a finite number.
  function calcEvaluate(tokens) {
    const items = [];
    let digits = "";
    tokens.forEach((t) => {
      if (calcIsDigit(t)) {
        digits += t;
        return;
      }
      if (digits) items.push(Number(digits));
      digits = "";
      items.push(calcIsLiteral(t) ? Number(t) : t);
    });
    if (digits) items.push(Number(digits));

    let pos = 0;
    const peek = () => items[pos];
    const sum = () => {
      let v = product();
      while (peek() === "+" || peek() === "−") {
        const op = items[pos++];
        const r = product();
        v = op === "+" ? v + r : v - r;
      }
      return v;
    };
    const product = () => {
      let v = signed();
      while (peek() === "×" || peek() === "÷") {
        const op = items[pos++];
        const r = signed();
        v = op === "×" ? v * r : v / r;
      }
      return v;
    };
    const signed = () => {
      if (peek() !== "−") return power();
      pos++;
      return -signed();
    };
    const power = () => {
      const base = postfix();
      if (peek() !== "^") return base;
      pos++;
      return Math.pow(base, signed());
    };
    const postfix = () => {
      let v = primary();
      while (CALC_POSTFIX.includes(peek())) {
        const op = items[pos++];
        v = op === "²" ? v * v : op === "⁻¹" ? 1 / v : calcFactorial(v);
      }
      return v;
    };
    const primary = () => {
      const t = items[pos++];
      if (typeof t === "number") return t;
      if (t === "π") return Math.PI;
      if (t === "e") return Math.E;
      if (t === "Ans") return calcAns;
      if (CALC_FUNCTIONS[t]) {
        const v = sum();
        if (items[pos++] !== ")") return NaN;
        return CALC_FUNCTIONS[t](v);
      }
      return NaN;
    };

    const value = sum();
    if (pos !== items.length || !isFinite(value)) return null;
    // 15 significant digits: every digit a double holds exactly, while still
    // cleaning float noise like 0.1+0.2 up to 0.3.
    return Number(value.toPrecision(15));
  }

  function calcReset() {
    calcTokens = [];
    calcAns = 0;
    calcResult = null;
    calcError = null;
  }

  function calcFormat(n) {
    return String(n).replace(/-/g, "−");
  }

  function updateCalcDisplay() {
    if (!calcDisplay) return;
    let main;
    let history = "";
    let preview = "";
    let unclosed = 0;
    if (calcError !== null) {
      main = "Error";
      history = calcError;
    } else if (calcResult) {
      main = calcFormat(calcResult.value);
      if (calcResult.expr !== null) history = calcResult.expr + " =";
    } else {
      main = calcTokens.join("") || "0";
      unclosed = Math.max(0, calcOpenParens());
      // A plain number previews as itself, which would just be noise.
      const done = calcCompleted();
      if (done.length && !done.every(calcIsDigit)) {
        const value = calcEvaluate(done);
        if (value !== null) preview = "= " + calcFormat(value);
      }
    }
    calcHistoryEl.textContent = history;
    calcPreviewEl.textContent = preview;
    calcDisplay.textContent = main;
    // Brackets "=" will close for you, shown faintly so it's clear they're
    // implied rather than typed.
    if (unclosed) {
      const ghost = document.createElement("span");
      ghost.textContent = ")".repeat(unclosed);
      ghost.style.opacity = "0.35";
      calcDisplay.appendChild(ghost);
    }
    // Shrinks a little before running out of room, then keeps the end of
    // the expression - the part being typed - in view.
    calcDisplay.style.fontSize = "20px";
    if (calcDisplay.scrollWidth > calcDisplay.clientWidth) {
      calcDisplay.style.fontSize = "15px";
    }
    calcDisplay.scrollLeft = calcDisplay.scrollWidth;
  }

  // --- Pause detection: jump between sentences ---
  // Finds the pauses in a slide's narration by decoding a separate, read-only
  // copy of its audio and scanning for quiet stretches. The live <audio>
  // element's own playback is never touched or rerouted.
  const PAUSE_WINDOW_SEC = 0.05; // loudness is measured over windows this long
  const PAUSE_SILENCE_RMS = 0.02; // a window quieter than this counts as silent
  const PAUSE_MIN_SEC = 0.5; // shorter quiet runs are gaps within/between words

  const pauseCache = new Map(); // audio URL -> pauses array, or a Promise of one
  let pauseDecoder = null;
  let analysisQueue = Promise.resolve();
  let activeAudioEl = null; // the slide the shortcuts follow

  // One context reused for every decode. Offline rather than a live
  // AudioContext: detection starts on page load, before any click, and Chrome's
  // autoplay policy suspends a live context created then (and warns about it).
  function getPauseDecoder() {
    if (!pauseDecoder) pauseDecoder = new OfflineAudioContext(1, 1, 44100);
    return pauseDecoder;
  }

  function findPauses(samples, sampleRate) {
    const windowSize = Math.max(1, Math.round(sampleRate * PAUSE_WINDOW_SEC));
    const windowSec = windowSize / sampleRate;
    const windowCount = Math.floor(samples.length / windowSize);
    const pauses = [];
    let runStart = -1;
    for (let w = 0; w < windowCount; w++) {
      let sum = 0;
      for (let i = w * windowSize, end = i + windowSize; i < end; i++) {
        sum += samples[i] * samples[i];
      }
      if (Math.sqrt(sum / windowSize) < PAUSE_SILENCE_RMS) {
        if (runStart < 0) runStart = w;
        continue;
      }
      if (runStart >= 0) {
        // A quiet run from 0 is lead-in before the first sentence, not a break
        // between two. A run still open when the loop ends is trailing silence,
        // and is dropped too - jumping there would run the slide off its end.
        const long = (w - runStart) * windowSec >= PAUSE_MIN_SEC - 1e-9;
        if (runStart > 0 && long) {
          pauses.push({ startSec: runStart * windowSec, endSec: w * windowSec });
        }
        runStart = -1;
      }
    }
    return pauses;
  }

  // currentSrc stays empty until the browser has picked a source, which for a
  // preload="none" clip isn't until playback - so fall back to the attribute,
  // letting a not-yet-played slide be analyzed as soon as it's discovered.
  function audioUrl(audioEl) {
    return audioEl.currentSrc || audioEl.src;
  }

  function detectPauses(audioEl) {
    const src = audioUrl(audioEl);
    if (!src) return Promise.resolve([]);
    const cached = pauseCache.get(src);
    if (cached) return Promise.resolve(cached);

    // One clip at a time: a decoded clip is tens of MB of raw samples, and every
    // slide's audio is discovered at once when the page loads.
    const job = analysisQueue.then(() =>
      fetch(src)
        .then((res) => {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.arrayBuffer();
        })
        .then((data) => getPauseDecoder().decodeAudioData(data))
        .then((audio) => findPauses(audio.getChannelData(0), audio.sampleRate))
    );
    analysisQueue = job.catch(() => {});
    const pending = job.then(
      (pauses) => {
        pauseCache.set(src, pauses);
        return pauses;
      },
      () => {
        pauseCache.delete(src); // let a later load/play event retry
        return [];
      }
    );
    pauseCache.set(src, pending);
    return pending;
  }

  function cachedPauses(audioEl) {
    const value = pauseCache.get(audioUrl(audioEl));
    return Array.isArray(value) ? value : null;
  }

  function setActiveAudio(el) {
    activeAudioEl = el;
  }

  function watchForPauses(el) {
    if (el.tagName !== "AUDIO") return; // never download a whole video to scan it
    el.addEventListener("loadedmetadata", () => {
      // Other slides' clips can load in the background, so a load only takes
      // over when nothing is active or the active clip has played and stopped.
      // Otherwise a preloading slide would steal the shortcuts mid-playback.
      const current = activeAudioEl;
      if (
        !current ||
        !current.isConnected ||
        (current.played.length > 0 && current.paused)
      ) {
        setActiveAudio(el);
      }
      detectPauses(el);
    });
    el.addEventListener("play", () => {
      setActiveAudio(el);
      detectPauses(el);
    });
    // Discovered after its metadata already loaded, so that event won't come.
    if (!activeAudioEl && el.readyState >= 1) setActiveAudio(el);
    detectPauses(el);
  }

  // Returns whether the key was used, so the caller only swallows it then.
  function jumpToPause(direction) {
    const el = activeAudioEl;
    const pauses = el && el.isConnected && cachedPauses(el);
    if (!pauses || !pauses.length) return false;
    const now = el.currentTime;
    if (direction > 0) {
      // A small lead, so a press right after landing on a pause moves past it.
      const next = pauses.find((p) => p.endSec > now + 0.25);
      if (next) el.currentTime = next.endSec; // none left: stay put
    } else {
      // Like "previous track": within a second of a sentence's start, go back one
      // more, so repeated presses keep moving instead of re-landing here.
      let target = 0;
      for (const p of pauses) {
        if (p.endSec < now - 1) target = p.endSec;
        else break;
      }
      el.currentTime = target;
    }
    return true;
  }

  function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      target.isContentEditable
    );
  }

  // --- Watch for dynamically-added media elements / player bars ---
  const observer = new MutationObserver((mutations) => {
    let mediaFound = false;
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches("audio, video")) mediaFound = true;
        if (node.querySelectorAll) {
          if (node.querySelectorAll("audio, video").length) mediaFound = true;
        }
      });
    }
    if (mediaFound) applyRateToAll();
    dockIntoPlayerBar();
    ensureToolbar();
  });

  function startObserving() {
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });
  }

  // Defensive fallback in case some mutation is missed.
  setInterval(() => {
    applyRateToAll();
    dockIntoPlayerBar();
    ensureToolbar();
    // The gear the menu is anchored to goes away on a slide change.
    if (menuAnchor && !menuAnchor.isConnected) closeMenu();
    else positionMenu(); // catches layout shifts that aren't scroll or resize
    if (toolboxAnchor && !toolboxAnchor.isConnected) closeToolbox();
    else placeLauncher(); // catches header/content layout shifts
  }, 1500);

  // The seek bar is fluid, so the docked controls need re-laying-out.
  window.addEventListener("resize", () => {
    dockIntoPlayerBar();
    positionMenu(true); // viewport height changed, so re-test above vs. below
    placeLauncher(); // also repositions the toolbox under it
  });

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        // Focus goes back to the button that opened what's closing, rather
        // than being dropped to the top of the page along with it.
        const active = document.activeElement;
        const inToolbox = [drawPanelEl, calcPanelEl].some((p) => p && p.contains(active));
        const returnTo =
          (menuEl && menuEl.contains(active) && menuAnchor) ||
          (inToolbox && toolboxAnchor) ||
          null;
        closeMenu();
        closeToolbox();
        if (returnTo) returnTo.focus({ preventScroll: true });
        return;
      }
      const arrow = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (
        arrow &&
        e.shiftKey &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !isTypingTarget(e.target) &&
        jumpToPause(arrow)
      ) {
        // Swallowed so the page doesn't also act on it (e.g. its own slide keys).
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  function init() {
    ensureStyles();
    applyRateToAll();
    ensureToolbar();
    startObserving();

    // Poll briefly while the player loads, so the gear appears promptly rather
    // than waiting on the 1.5s interval below. Bars that show up later are
    // still picked up by that interval and the mutation observer.
    let attempts = 0;
    const tryDock = setInterval(() => {
      attempts += 1;
      if (dockIntoPlayerBar() || attempts >= 20) clearInterval(tryDock);
    }, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
