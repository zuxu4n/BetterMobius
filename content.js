// Möbius+
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

  const TOOLBAR_ID = "mobius-tools-bar";
  const PEN_WIDTH = 3;
  const ERASER_WIDTH = 24; // wider than the pen, as a real eraser is
  const LAUNCHER_SIZE = 44; // the round purple button that opens the toolbox
  const SWATCH_SIZE = 28; // the color/unselect/eraser circles under the calculator
  const TOOLBOX_PANEL_GAP = 8; // gap between the calculator and the draw-tools panel
  const TOOLBOX_PURPLE = "#802a8f"; // matches the extension's own icon tile
  // Solid (not translucent) so "unselect" and the eraser stay visible however
  // the page underneath is colored, now that they float free of a card.
  const TOOLBOX_NEUTRAL = "rgba(51, 51, 51, 0.95)";
  const PEN_COLORS = ["#1a1a1a", "#ef4444", "#3b82f6"]; // black, red, blue

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

  function updateLabels() {
    // Each gear carries a dot whenever its own player isn't at 1x, since the
    // rate is otherwise only visible once that player's menu is open.
    document.querySelectorAll(BAR_SELECTOR).forEach((bar) => {
      const dot = bar.querySelector(".mobius-speed-dot");
      if (dot) {
        dot.style.display =
          Math.abs(rateFor(bar) - 1) < 0.001 ? "none" : "block";
      }
    });
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

  // The dark rounded panel the settings menu, the calculator and the drawing
  // controls all share.
  function panelStyle(el) {
    Object.assign(el.style, {
      position: "absolute",
      zIndex: String(PANEL_Z),
      background: "rgba(51, 51, 51, 0.9)",
      color: "#fff",
      borderRadius: "7px",
      boxShadow: "0 2px 14px rgba(0,0,0,0.5)",
      fontFamily: "Arial, Helvetica, sans-serif",
      fontSize: "13px",
      lineHeight: "1.2",
      userSelect: "none",
    });
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
        position: "absolute",
        zIndex: String(PANEL_Z), // same layer as the menu, but appended after it
        background: "#f7f7f7",
        color: "#1a1a1a",
        border: "1px solid rgba(0,0,0,0.25)",
        borderRadius: "4px",
        padding: "3px 7px",
        font: "12px/1.3 system-ui, -apple-system, Segoe UI, Arial, sans-serif",
        boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
        whiteSpace: "nowrap",
        pointerEvents: "none", // never steals the hover that summoned it
      });
      document.documentElement.appendChild(tipEl);
    }
    tipEl.textContent = text; // several buttons share the one node
    // Below and right of the pointer, as the browser's own tooltip sits, pulled
    // back inside the window when it would otherwise overflow.
    const left = Math.min(x + 14, window.innerWidth - tipEl.offsetWidth - 4);
    const top = Math.min(y + 20, window.innerHeight - tipEl.offsetHeight - 4);
    tipEl.style.left = Math.round(Math.max(4, left) + window.scrollX) + "px";
    tipEl.style.top = Math.round(Math.max(4, top) + window.scrollY) + "px";
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
        closeMenu();
        setRate(scope, rate);
      });
      row.style.padding = "7px 20px 7px 14px";
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
    menuEl.textContent = "";
    menuEl.appendChild(menuView === "speed" ? buildSpeedView() : buildRootView());
    positionMenu(recomputePlacement);
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

  function openMenu(anchor) {
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
  }

  function toggleMenu(anchor) {
    if (menuAnchor === anchor) closeMenu();
    else openMenu(anchor);
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

  // The canvas only covers the viewport, so scrolling has to replay the strokes
  // at their new screen positions. Throttled to a frame, and only while the
  // layer is open. Capture phase, since scroll doesn't bubble.
  window.addEventListener(
    "scroll",
    () => {
      if (!drawCanvas || drawRedrawQueued) return;
      drawRedrawQueued = true;
      requestAnimationFrame(() => {
        drawRedrawQueued = false;
        redrawStrokes();
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
      const overflow = btnLeft + GEAR_SIZE + BADGE_GAP - volumeLeft;
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
      Object.assign(btn.style, {
        position: "absolute",
        width: GEAR_SIZE + "px",
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

      const dot = document.createElement("span");
      dot.className = "mobius-speed-dot";
      Object.assign(dot.style, {
        position: "absolute",
        top: "1px",
        right: "1px",
        width: "5px",
        height: "5px",
        borderRadius: "50%",
        background: ACCENT,
        display: Math.abs(rateFor(bar) - 1) < 0.001 ? "none" : "block",
      });
      btn.appendChild(dot);

      btn.addEventListener("mouseenter", () => {
        btn.style.opacity = "1";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.opacity = "0.85";
      });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMenu(btn);
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
  // unfamiliar page shape gets no toolbar rather than a broken layout. Being in
  // flow, it scrolls away with the header it sits under.
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
      display: "flex",
      justifyContent: "flex-end",
      padding: "6px 12px 6px 0", // nudged in from the bar's/content's right edge
    });

    const launcher = document.createElement("div");
    launcher.className = "mobius-toolbox-launcher";
    launcher.title = "Drawing and calculator";
    Object.assign(launcher.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
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
    });

    bar.appendChild(launcher);
    main.insertBefore(bar, inner);
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
    });
    if (icon) btn.appendChild(icon);

    const show = (e) => showTip(tip, e.clientX, e.clientY);
    btn.addEventListener("mouseenter", show);
    btn.addEventListener("mousemove", show);
    btn.addEventListener("mouseleave", hideTip);
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
    btn.style.boxShadow = active
      ? "0 0 0 2px #fff, 0 0 0 4px " + TOOLBOX_PURPLE + ", 0 1px 3px rgba(0,0,0,0.35)"
      : "0 1px 3px rgba(0,0,0,0.35)";
  }

  // --- The toolbox: a calculator panel and, separate from it, a draw-tools
  // panel (three colors, "unselect", eraser - stacked in a column). One click
  // on the launcher opens both together, anchored to it and placed in document
  // coordinates like the settings menu, so page scrolling moves them natively.
  // Closing them discards any drawing, same as the old standalone drawing
  // layer: this is a transient annotation tool, not a saved one.
  let calcPanelEl = null;
  let drawPanelEl = null;
  let toolboxAnchor = null;
  const swatchButtons = []; // { el, tool, color }

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
    calcPanelEl.style.position = "fixed";
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
    if (calcPanelEl) closeToolbox();
    else openToolbox(anchor);
  }

  function openToolbox(anchor) {
    closeToolbox();
    toolboxAnchor = anchor;
    anchor.style.boxShadow = "0 0 0 3px rgba(128,42,143,0.4), 0 2px 8px rgba(0,0,0,0.35)";

    calcReset();
    calcScientific = false; // always reopens in basic mode
    openDrawSurface();

    calcPanelEl = document.createElement("div");
    calcPanelEl.className = "mobius-calculator";
    panelStyle(calcPanelEl);
    Object.assign(calcPanelEl.style, {
      padding: CALC_PANEL_PAD + "px",
      outline: "none",
      borderRadius: "14px", // a softer, friendlier panel than the settings menu
      transition: "box-shadow 0.12s ease-in", // fades the hover ring in/out
      // Explicit rather than inherited: the host page's own CSS may reset
      // box-sizing globally, and CALC_WIDTH_BASIC/SCI above are computed
      // assuming border-box.
      boxSizing: "border-box",
    });
    calcPanelEl.tabIndex = -1;
    calcPanelEl.addEventListener("keydown", onCalcKeydown);
    calcManualPos = false; // reopens docked under the launcher, not wherever it was left

    calcPanelEl.appendChild(buildModeToggle());
    renderCalcBody();
    document.documentElement.appendChild(calcPanelEl);

    drawPanelEl = buildDrawPanel();
    document.documentElement.appendChild(drawPanelEl);

    updateCalcDisplay();
    positionToolbox();
    calcPanelEl.focus({ preventScroll: true });
  }

  function closeToolbox() {
    stopCalcDrag(); // harmless if nothing was in progress
    if (toolboxAnchor) toolboxAnchor.style.boxShadow = "0 2px 8px rgba(0,0,0,0.35)";
    if (calcPanelEl) calcPanelEl.remove();
    if (drawPanelEl) drawPanelEl.remove();
    calcPanelEl = null;
    drawPanelEl = null;
    toolboxAnchor = null;
    swatchButtons.length = 0;
    undoBtnEl = null;
    redoBtnEl = null;
    closeDrawSurface();
    hideTip();
  }

  function positionToolbox() {
    if (!calcPanelEl || !toolboxAnchor) return;
    const rect = toolboxAnchor.getBoundingClientRect();
    const drawHeight = drawPanelEl ? drawPanelEl.offsetHeight : 0;
    const calcHeight = calcPanelEl.offsetHeight;
    // Once dragged, the calculator is off on its own; only the draw panel is
    // still anchored under the launcher, and its height alone decides
    // whether that fits below or above.
    const totalHeight = calcManualPos
      ? drawHeight
      : drawHeight + (drawPanelEl ? TOOLBOX_PANEL_GAP : 0) + calcHeight;

    // Scrolled past the launcher: hidden rather than left floating over
    // unrelated content, and back as soon as the launcher is. A dragged
    // calculator is exempt - it's fixed to the viewport, not the launcher, so
    // the page scrolling past the (now irrelevant) anchor shouldn't hide it.
    const offScreen =
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth;
    const visibility = offScreen ? "hidden" : "visible";
    if (!calcManualPos) calcPanelEl.style.visibility = visibility;
    if (drawPanelEl) drawPanelEl.style.visibility = visibility;
    // Deliberately no early return here even while offscreen: top/left are
    // still recomputed below. Skipping that left a stale position behind
    // whenever something changed (like toggling scientific mode, which
    // changes the calculator's width) while the launcher was scrolled out of
    // view - it would reappear wherever it was last visible instead of where
    // it now belongs, since nothing else was around to correct it until the
    // 1.5s fallback interval next ran.

    // Below the button, where the toolbar sits near the top of the page; above
    // it only when there genuinely isn't room below.
    const below =
      rect.bottom + MENU_GAP + totalHeight <= window.innerHeight ||
      rect.top - totalHeight - MENU_GAP < 4;
    const top = below
      ? rect.bottom + window.scrollY + MENU_GAP
      : rect.top + window.scrollY - totalHeight - MENU_GAP;
    const clampedTop = Math.round(Math.max(0, top));

    // Both panels align to the launcher's own right edge (the calculator's
    // right edge always equals the launcher's when it's still docked, so the
    // draw panel can use this directly rather than reading it off the
    // calculator, which might by now be sitting somewhere else entirely).
    const docWidth = document.documentElement.scrollWidth;
    const anchorRight = rect.right + window.scrollX;

    if (drawPanelEl) {
      const drawWidth = drawPanelEl.offsetWidth;
      const drawLeft = Math.max(
        4,
        Math.min(anchorRight - drawWidth, docWidth - drawWidth - 4)
      );
      drawPanelEl.style.top = clampedTop + "px";
      drawPanelEl.style.left = Math.round(drawLeft) + "px";
    }

    if (!calcManualPos) {
      const calcWidth = calcPanelEl.offsetWidth;
      const calcLeft = Math.max(
        4,
        Math.min(anchorRight - calcWidth, docWidth - calcWidth - 4)
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

  // The draw-tools panel: three color circles, an "unselect" pointer that
  // hands clicks back to the page, and the eraser - stacked in a column, with
  // undo/redo as a side-by-side pair underneath. Its own panel, separate from
  // the calculator.
  function buildDrawPanel() {
    swatchButtons.length = 0;

    const panel = document.createElement("div");
    panel.className = "mobius-draw-tools";
    // panelStyle() for position/z-index only - overridden right after so the
    // circles float free rather than sitting on a card of their own.
    panelStyle(panel);
    Object.assign(panel.style, {
      background: "none",
      boxShadow: "none",
      padding: "8px",
      display: "flex",
      flexDirection: "column",
      // flex-end, not center: the undo/redo row is wider than a single
      // circle, so centering would leave every circle adrift in the middle
      // of that extra width instead of flush against the same right edge
      // the calculator and launcher share.
      alignItems: "flex-end",
      gap: "6px",
    });

    PEN_COLORS.forEach((color) => {
      const btn = circleToolButton(SWATCH_SIZE, color, null, "Draw", () =>
        setDrawTool("pen", color)
      );
      swatchButtons.push({ el: btn, tool: "pen", color: color });
      panel.appendChild(btn);
    });

    const divider = document.createElement("span");
    Object.assign(divider.style, {
      width: "18px",
      height: "1px",
      margin: "2px 0",
      background: "rgba(255,255,255,0.25)",
    });
    panel.appendChild(divider);

    const unselect = circleToolButton(
      SWATCH_SIZE,
      TOOLBOX_NEUTRAL,
      cursorIcon(14),
      "Stop drawing",
      () => setDrawTool("none", null)
    );
    swatchButtons.push({ el: unselect, tool: "none", color: null });
    panel.appendChild(unselect);

    const eraser = circleToolButton(
      SWATCH_SIZE,
      TOOLBOX_NEUTRAL,
      eraserIcon(15),
      "Eraser",
      () => setDrawTool("eraser", null)
    );
    swatchButtons.push({ el: eraser, tool: "eraser", color: null });
    panel.appendChild(eraser);

    // Undo/redo, side by side rather than stacked with the rest - a pair of
    // actions rather than another tool to pick.
    const undoRedoRow = document.createElement("div");
    Object.assign(undoRedoRow.style, { display: "flex", gap: "6px" });
    undoBtnEl = circleToolButton(
      SWATCH_SIZE,
      TOOLBOX_NEUTRAL,
      undoIcon(14),
      "Undo",
      undoStroke
    );
    redoBtnEl = circleToolButton(
      SWATCH_SIZE,
      TOOLBOX_NEUTRAL,
      redoIcon(14),
      "Redo",
      redoStroke
    );
    undoRedoRow.append(undoBtnEl, redoBtnEl);
    panel.appendChild(undoRedoRow);
    refreshUndoRedo();

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
  // the toolbox throws the marks away. Strokes are held in document
  // coordinates and replayed when the page scrolls, so a mark stays on the
  // words it was drawn over rather than sliding across the viewport with the
  // canvas. "Unselect" leaves the marks in place but hands clicks back to the
  // page, rather than removing the layer, so scrolling and reading still work
  // without having to close the whole toolbox.
  let drawCanvas = null;
  let drawCtx = null;
  let drawTool = "none"; // "none" | "pen" | "eraser"
  let drawColor = PEN_COLORS[0];
  let drawStrokes = [];
  let drawRedoStack = []; // popped strokes, ready for redo until a new one is drawn
  let drawStroke = null; // the stroke being drawn right now
  let drawRedrawQueued = false;
  let undoBtnEl = null;
  let redoBtnEl = null;

  function openDrawSurface() {
    if (drawCanvas) return;
    drawStrokes = [];
    drawRedoStack = [];
    drawStroke = null;
    drawTool = "none";
    drawColor = PEN_COLORS[0];

    drawCanvas = document.createElement("canvas");
    drawCanvas.className = "mobius-draw-layer";
    Object.assign(drawCanvas.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      zIndex: String(PANEL_Z - 1), // below the toolbox panel, above the page
      cursor: "default",
      pointerEvents: "none", // "unselect" is the default: the page stays usable
      touchAction: "none", // a finger or pen draws here instead of scrolling
    });
    document.documentElement.appendChild(drawCanvas);
    drawCtx = drawCanvas.getContext("2d");
    sizeDrawCanvas();

    drawCanvas.addEventListener("pointerdown", onDrawStart);
    drawCanvas.addEventListener("pointermove", onDrawMove);
    drawCanvas.addEventListener("pointerup", onDrawEnd);
    drawCanvas.addEventListener("pointercancel", onDrawEnd);
  }

  function closeDrawSurface() {
    if (!drawCanvas) return;
    drawCanvas.remove();
    drawCanvas = null;
    drawCtx = null;
    drawStroke = null;
    drawStrokes = [];
    drawRedoStack = [];
    drawTool = "none";
  }

  // Backing store in device pixels so strokes aren't blurry on a HiDPI screen,
  // with the context scaled so the drawing code can work in CSS pixels. Setting
  // width/height clears the canvas, hence the replay.
  function sizeDrawCanvas() {
    if (!drawCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    drawCanvas.width = Math.round(window.innerWidth * dpr);
    drawCanvas.height = Math.round(window.innerHeight * dpr);
    drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCtx.lineCap = "round";
    drawCtx.lineJoin = "round";
    redrawStrokes();
  }

  function docPoint(e) {
    return { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
  }

  function strokeStyleFor(stroke) {
    // The eraser cuts holes in the layer instead of painting over it, so it
    // works whatever the page underneath looks like.
    drawCtx.globalCompositeOperation =
      stroke.tool === "eraser" ? "destination-out" : "source-over";
    drawCtx.strokeStyle = stroke.color;
    drawCtx.fillStyle = stroke.color;
    drawCtx.lineWidth = stroke.width;
  }

  // Keeps the launcher paint-free and clickable: a clip region with a hole
  // punched over its current screen rect (the two overlapping rects plus the
  // "evenodd" fill rule is what makes the inner one a hole rather than just
  // more area to paint). Read fresh each time rather than cached, since the
  // launcher's viewport position changes as the page scrolls. Callers must
  // wrap this in their own save()/restore() - it only sets up the clip, it
  // doesn't undo it.
  function clipOutLauncher() {
    if (!toolboxAnchor) return;
    const r = toolboxAnchor.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    drawCtx.beginPath();
    drawCtx.rect(0, 0, window.innerWidth, window.innerHeight);
    drawCtx.rect(r.left, r.top, r.width, r.height);
    drawCtx.clip("evenodd");
  }

  function paintDot(stroke, point) {
    drawCtx.save();
    clipOutLauncher();
    drawCtx.beginPath();
    drawCtx.arc(
      point.x - window.scrollX,
      point.y - window.scrollY,
      stroke.width / 2,
      0,
      Math.PI * 2
    );
    drawCtx.fill();
    drawCtx.restore();
  }

  // Only the newest segment, so an ordinary drag doesn't repaint everything.
  function paintLastSegment(stroke) {
    const pts = stroke.points;
    strokeStyleFor(stroke);
    if (pts.length === 1) {
      paintDot(stroke, pts[0]); // a tap with no movement still leaves a mark
      return;
    }
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    drawCtx.save();
    clipOutLauncher();
    drawCtx.beginPath();
    drawCtx.moveTo(a.x - window.scrollX, a.y - window.scrollY);
    drawCtx.lineTo(b.x - window.scrollX, b.y - window.scrollY);
    drawCtx.stroke();
    drawCtx.restore();
  }

  function redrawStrokes() {
    if (!drawCtx) return;
    drawCtx.globalCompositeOperation = "source-over";
    drawCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    drawStrokes.forEach((stroke) => {
      const pts = stroke.points;
      strokeStyleFor(stroke);
      if (pts.length === 1) {
        paintDot(stroke, pts[0]); // already excludes the launcher itself
        return;
      }
      drawCtx.save();
      clipOutLauncher();
      drawCtx.beginPath();
      pts.forEach((p, i) => {
        const x = p.x - window.scrollX;
        const y = p.y - window.scrollY;
        if (i === 0) drawCtx.moveTo(x, y);
        else drawCtx.lineTo(x, y);
      });
      drawCtx.stroke();
      drawCtx.restore();
    });
    drawCtx.globalCompositeOperation = "source-over";
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
    if (drawCanvas.setPointerCapture) drawCanvas.setPointerCapture(e.pointerId);
    paintLastSegment(drawStroke);
  }

  function onDrawMove(e) {
    if (!drawStroke) return;
    e.preventDefault();
    drawStroke.points.push(docPoint(e));
    paintLastSegment(drawStroke);
  }

  function onDrawEnd() {
    drawStroke = null;
  }

  function undoStroke() {
    if (!drawStrokes.length) return;
    drawRedoStack.push(drawStrokes.pop());
    redrawStrokes();
    refreshUndoRedo();
  }

  function redoStroke() {
    if (!drawRedoStack.length) return;
    drawStrokes.push(drawRedoStack.pop());
    redrawStrokes();
    refreshUndoRedo();
  }

  // Dimmed rather than removed when there's nothing to do, same idea as a
  // disabled button - undoStroke()/redoStroke() already no-op on an empty
  // stack, so this is purely the visual signal.
  function refreshUndoRedo() {
    if (undoBtnEl) undoBtnEl.style.opacity = drawStrokes.length ? "1" : "0.35";
    if (redoBtnEl) redoBtnEl.style.opacity = drawRedoStack.length ? "1" : "0.35";
  }

  // Picking "unselect" leaves the canvas in place (marks stay visible) but
  // gives up the pointer, so scrolling and clicking the page work normally.
  // Picking a color or the eraser takes the pointer back and starts capturing
  // strokes in that color/mode.
  function setDrawTool(tool, color) {
    drawTool = tool;
    if (tool === "pen" && color) drawColor = color;
    if (drawCanvas) {
      drawCanvas.style.pointerEvents = tool === "none" ? "none" : "auto";
      drawCanvas.style.cursor = tool === "eraser" ? "cell" : "crosshair";
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
  const CALC_OP_FOR = { "÷": "/", "×": "*", "−": "-", "+": "+" };
  const CALC_GLYPH = { "/": "÷", "*": "×", "-": "−", "+": "+", "^": "^" };
  // Two columns of function keys, added beside the ordinary keypad in
  // scientific mode - sized to exactly match its five rows.
  const SCI_KEYS = [
    ["sin", "cos"],
    ["tan", "log"],
    ["ln", "√"],
    ["x²", "xʸ"],
    ["π", "e"],
  ];
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
  const SCI_COLS = 2; // the extra function-key column
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
    "-": "−",
    "+": "+",
    "=": "=",
    Enter: "=",
    Backspace: "⌫",
    c: "C",
    C: "C",
  };
  const CALC_MAX_DIGITS = 14; // as many as the display holds

  let calcDisplay = null;
  let calcPendingEl = null;

  let calcAcc = null; // the running value
  let calcOp = null; // the operator waiting on the next entry
  let calcEntry = "0"; // what the display shows
  let calcFresh = true; // the next digit starts a new number
  let calcScientific = false; // whether the function-key column is showing

  // The one button that was left after the header came off: switches between
  // the plain keypad and the wider scientific layout.
  // Doubles as the drag handle: the empty space left of the toggle button is
  // most of the row, so dragging from "the top of the calculator" is dragging
  // this.
  function buildModeToggle() {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      justifyContent: "flex-end",
      marginBottom: "4px",
      minHeight: "18px", // a real grab target even before anything's in it
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
      fontSize: "10px",
      fontWeight: "bold",
      padding: "3px 7px",
      borderRadius: "4px",
      background: "rgba(255,255,255,0.14)",
      color: "#fff",
      cursor: "pointer",
      userSelect: "none",
    });
    const renderLabel = () => {
      btn.textContent = calcScientific ? "123" : "fx";
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
      if (calcPanelEl) calcPanelEl.focus({ preventScroll: true });
    });

    row.addEventListener("pointerdown", (e) => {
      if (e.target === btn || btn.contains(e.target)) return; // its own click
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      startCalcDrag(e);
    });

    row.appendChild(btn);
    return row;
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
      borderRadius: "5px",
      padding: "4px 7px 6px",
      marginBottom: "5px",
      textAlign: "right",
    });
    calcPendingEl = document.createElement("div");
    Object.assign(calcPendingEl.style, {
      fontSize: "10px",
      opacity: "0.55",
      minHeight: "13px",
      whiteSpace: "nowrap",
      overflow: "hidden",
    });
    calcDisplay = document.createElement("div");
    Object.assign(calcDisplay.style, {
      fontSize: "20px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
    wrap.append(calcPendingEl, calcDisplay);
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
    const isEquals = key === "=";
    const tinted = !!CALC_OP_FOR[key] || key === "C" || key === "⌫" || key === "±";
    const base = isEquals
      ? ACCENT
      : tinted
      ? "rgba(255,255,255,0.18)"
      : "rgba(255,255,255,0.1)";

    const btn = document.createElement("div");
    btn.textContent = key;
    Object.assign(btn.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "30px",
      borderRadius: "5px",
      background: base,
      color: isEquals ? "#1a1a1a" : "#fff",
      fontSize: "14px",
      cursor: "pointer",
    });
    if (key === "0") btn.style.gridColumn = "span 2";

    btn.addEventListener("mouseenter", () => {
      btn.style.background = isEquals ? "#63b8ff" : "rgba(255,255,255,0.28)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = base;
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      calcKey(key);
      updateCalcDisplay();
      if (calcPanelEl) calcPanelEl.focus({ preventScroll: true });
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
      borderRadius: "5px",
      background: base,
      color: "#fff",
      fontSize: "12px",
      cursor: "pointer",
    });
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "rgba(255,255,255,0.3)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = base;
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      sciKey(label);
      updateCalcDisplay();
      if (calcPanelEl) calcPanelEl.focus({ preventScroll: true });
    });
    return btn;
  }

  // Degrees, not radians - what most people expect typing 30 into "sin".
  const DEG_TO_RAD = Math.PI / 180;

  function sciKey(label) {
    // Same recovery as calcKey(): any key but a reset starts over from a
    // failed calculation.
    if (calcEntry === "Error") calcReset();
    switch (label) {
      case "sin":
        calcUnary((v) => Math.sin(v * DEG_TO_RAD));
        break;
      case "cos":
        calcUnary((v) => Math.cos(v * DEG_TO_RAD));
        break;
      case "tan":
        calcUnary((v) => Math.tan(v * DEG_TO_RAD));
        break;
      case "log":
        calcUnary((v) => Math.log10(v));
        break;
      case "ln":
        calcUnary((v) => Math.log(v));
        break;
      case "√":
        calcUnary((v) => Math.sqrt(v));
        break;
      case "x²":
        calcUnary((v) => v * v);
        break;
      case "xʸ":
        // A binary op, same infrastructure as +/-/×/÷: pressed now, applied
        // once the exponent is typed and "=" (or the next op) is pressed.
        calcOperator("^");
        break;
      case "π":
        calcConstant(Math.PI);
        break;
      case "e":
        calcConstant(Math.E);
        break;
    }
  }

  // Applied immediately to whatever's on screen - like pressing "=" on a
  // single operand, the result becomes the new entry.
  function calcUnary(fn) {
    calcEntry = calcFormat(fn(Number(calcEntry)));
    calcFresh = true;
  }

  // Drops a constant onto the display in place of whatever was there,
  // exactly as if it had just been typed.
  function calcConstant(value) {
    calcEntry = calcFormat(value);
    calcFresh = true;
  }

  function onCalcKeydown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = /^[0-9.]$/.test(e.key) ? e.key : CALC_KEY_FOR[e.key];
    if (!key) return; // Escape and everything else is left to the page
    e.preventDefault();
    e.stopPropagation();
    calcKey(key);
    updateCalcDisplay();
  }

  function calcKey(key) {
    // Any key but a reset starts over from a failed sum.
    if (calcEntry === "Error" && key !== "C") calcReset();
    if (/^[0-9]$/.test(key)) calcDigit(key);
    else if (key === ".") calcDecimal();
    else if (CALC_OP_FOR[key]) calcOperator(CALC_OP_FOR[key]);
    else if (key === "=") calcEquals();
    else if (key === "C") calcReset();
    else if (key === "⌫") calcBackspace();
    else if (key === "±") calcNegate();
  }

  function calcReset() {
    calcAcc = null;
    calcOp = null;
    calcEntry = "0";
    calcFresh = true;
  }

  function calcDigit(d) {
    if (calcFresh) {
      calcEntry = d;
      calcFresh = false;
    } else if (calcEntry === "0") {
      calcEntry = d;
    } else if (calcEntry.replace(/[^0-9]/g, "").length < CALC_MAX_DIGITS) {
      calcEntry += d;
    }
  }

  function calcDecimal() {
    if (calcFresh) {
      calcEntry = "0.";
      calcFresh = false;
    } else if (calcEntry.indexOf(".") < 0) {
      calcEntry += ".";
    }
  }

  function calcNegate() {
    if (calcEntry === "0") return;
    calcEntry =
      calcEntry.charAt(0) === "-" ? calcEntry.slice(1) : "-" + calcEntry;
  }

  function calcBackspace() {
    if (calcFresh) return; // nothing typed yet to take back
    calcEntry = calcEntry.slice(0, -1);
    if (calcEntry === "" || calcEntry === "-") {
      calcEntry = "0";
      calcFresh = true;
    }
  }

  function calcOperator(op) {
    if (!calcFresh) {
      // A number is waiting: fold it into the running value, so 2+3+ shows 5.
      calcAcc =
        calcOp === null
          ? Number(calcEntry)
          : calcApply(calcAcc, calcOp, Number(calcEntry));
      calcEntry = calcFormat(calcAcc);
    } else if (calcAcc === null) {
      calcAcc = Number(calcEntry); // chaining straight on from a result
    }
    // Pressing another operator with nothing entered just changes this one.
    calcOp = calcEntry === "Error" ? null : op;
    calcFresh = true;
  }

  function calcEquals() {
    if (calcOp === null) {
      calcFresh = true;
      return;
    }
    calcEntry = calcFormat(calcApply(calcAcc, calcOp, Number(calcEntry)));
    calcAcc = null;
    calcOp = null;
    calcFresh = true;
  }

  function calcApply(a, op, b) {
    switch (op) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        return b === 0 ? NaN : a / b;
      case "^":
        return Math.pow(a, b);
    }
    return b;
  }

  function calcFormat(n) {
    if (!isFinite(n)) return "Error";
    // Round off float noise (0.1 + 0.2) without touching legitimate precision.
    const rounded = Math.round(n * 1e10) / 1e10;
    return String(isFinite(rounded) ? rounded : n);
  }

  function updateCalcDisplay() {
    if (!calcDisplay) return;
    calcDisplay.textContent = calcEntry;
    calcPendingEl.textContent =
      calcOp && calcAcc !== null
        ? calcFormat(calcAcc) + " " + CALC_GLYPH[calcOp]
        : "";
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
    else positionToolbox();
  }, 1500);

  // The seek bar is fluid, so the docked controls need re-laying-out.
  window.addEventListener("resize", () => {
    dockIntoPlayerBar();
    positionMenu(true); // viewport height changed, so re-test above vs. below
    positionToolbox();
    sizeDrawCanvas(); // a new viewport size needs a new backing store
  });

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        closeMenu();
        closeToolbox();
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
