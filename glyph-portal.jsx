/**
 * Glyph Portal © 2026 Christian Katzmann. MIT.
 * Origin: UsefulPortal.astro on https://ktzm.dk → UsefulPortal.tsx → ClarityPortal.tsx.
 * A scroll-driven camera through live type. Keep this notice with copies.
 * Ported to plain JSX (no TypeScript) for this project.
 */
const { useId, useLayoutEffect, useRef } = React;

const clamp = (n, a = 0, b = 1) => Math.min(b, Math.max(a, n));
const smooth = (a, b, n) => { const t = clamp((n - a) / (b - a)); return t * t * (3 - 2 * t); };
const DEFAULT_FONT = '"Arial Black", "Arial", sans-serif';

/** Largest opaque square, in linear time. Unlike a stem guess, it works in O, S and Ø. */
function interior(context, char, font) {
  const canvas = context.canvas;
  context.font = font;
  const m = context.measureText(char);
  const pad = 8;
  const left = Math.ceil(m.actualBoundingBoxLeft);
  const ascent = Math.ceil(m.actualBoundingBoxAscent);
  canvas.width = Math.max(1, Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + pad * 2);
  canvas.height = Math.max(1, Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + pad * 2);
  context.font = font;
  context.fontKerning = "none";
  context.fillText(char, pad + left, pad + ascent);
  const { width, height } = canvas;
  const pixels = context.getImageData(0, 0, width, height).data;
  const rows = new Uint16Array(width + 1);
  let size = 0, bx = 0, by = 0;
  for (let y = 0; y < height; y++) {
    let diagonal = 0;
    for (let x = 0; x < width; x++) {
      const above = rows[x + 1];
      rows[x + 1] = pixels[(y * width + x) * 4 + 3] > 245 ? Math.min(above, rows[x], diagonal) + 1 : 0;
      diagonal = above;
      if (rows[x + 1] > size) { size = rows[x + 1]; bx = x; by = y; }
    }
  }
  if (size < 3) return null;
  // Scan at 3× SVG size. Inscribe a disk in the square, with room for raster disagreement.
  return { x: (bx + 1 - size / 2 - pad - left) / 3, y: (by + 1 - size / 2 - pad - ascent) / 3, radius: (size / 2 - 1) / 3 };
}

function scrollParent(element) {
  const viewport = document.scrollingElement || document.documentElement;
  const pageScrolls = viewport !== document.body && viewport.scrollHeight > viewport.clientHeight;
  for (let p = element.parentElement; p; p = p.parentElement) {
    if (!/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowY)) continue;
    if (p === document.documentElement) continue;
    // Some hosts scroll <body> itself; treat it as the scroller only when the page does not scroll.
    if (p === document.body) { if (pageScrolls || p.scrollHeight <= p.clientHeight) continue; return p; }
    return p;
  }
  return null;
}

function GlyphPortal(props) {
  const word = props.word || "MATIZ";
  const focusChar = props.focusChar;
  const interactive = props.interactive !== false;
  const fontFamily = props.fontFamily || DEFAULT_FONT;
  const annotations = !!props.annotations;
  const enterLabel = props.enterLabel || "Entrar";
  const uid = "gp-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const clipId = uid + "-clip";
  const sectionRef = useRef(null);
  const text = (word.trim().normalize("NFC")) || "MATIZ";
  let characterOffset = 0;
  const characters = Array.from(text, (char) => { const index = characterOffset; characterOffset += char.length; return { char, index }; });
  const length = Number.isFinite(+props.scrollLength) ? clamp(+props.scrollLength, 1, 8) : 2.4;
  // Vertical anchor of the word inside the pinned frame (fraction of its height).
  const wordY = Number.isFinite(+props.wordY) ? clamp(+props.wordY, 0.15, 0.7) : 0.46;
  const weight = Number.isFinite(+props.fontWeight) ? clamp(+props.fontWeight, 1, 1000) : 900;
  const q = ":where(#" + uid + ")";

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const pin = section.querySelector("[data-gp-pin]");
    const field = section.querySelector("[data-gp-field]");
    const art = section.querySelector("[data-gp-art]");
    const clip = section.querySelector("#" + CSS.escape(clipId));
    const glyph = section.querySelector("[data-gp-glyph]");
    const marks = section.querySelector("[data-gp-marks]");
    const choices = section.querySelector("[data-gp-choices]");
    const buttons = Array.from(choices.querySelectorAll("button"));
    const picker = section.querySelector("[data-gp-select]");
    const root = scrollParent(section);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let disposed = false, raf = 0, dirty = true, active = true, ready = false;
    const mountedAt = performance.now();
    let browserFrameSeen = false, stalled = false;
    let W = 1, H = 1, travel = 1, startScale = 1, endScale = 1;
    let center = { x: 0, y: 0 }, target = null;
    let lastProgress = -1;
    let candidates = [], letters = [];
    let choosing = false;
    let bounds = { x: 0, y: 0, width: 1, height: 1 };
    let fontDirty = true;

    // Freeze an available face for this mount. Late font swaps move the ink under the camera.
    // Re-run once webfonts settle so a pending face doesn't permanently disable the camera.
    const freezeFont = () => {
      glyph.style.fontFamily = fontFamily;
      const computedFamily = getComputedStyle(glyph).fontFamily;
      const families = computedFamily.match(/(?:[^,"']+|"[^"]*"|'[^']*')+/g) || [];
      const available = families.filter((family) => {
        try { return document.fonts.check(weight + " 100px " + family.trim(), text); } catch (e) { return false; }
      });
      glyph.style.fontFamily = available.concat([DEFAULT_FONT]).join(",");
      // Only treat the mount as stalled when no face at all is measurable yet.
      stalled = available.length === 0;
      fontDirty = true;
    };
    freezeFont();

    const readInk = () => {
      if (!context) return false;
      const font = getComputedStyle(glyph);
      const scanFont = font.fontWeight + " 300px " + font.fontFamily;
      context.font = font.fontWeight + " 100px " + font.fontFamily;
      context.fontKerning = "none";
      const metrics = context.measureText(text);
      const advances = Array.from({ length: text.length }, (_, i) => context.measureText(text.slice(0, i)).width);
      bounds = { x: -metrics.actualBoundingBoxLeft, y: -metrics.actualBoundingBoxAscent,
        width: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
        height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent };
      if (!bounds.width || !bounds.height) return false;
      center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      const requested = focusChar ? text.indexOf(focusChar.normalize("NFC")) : -1;
      let offset = 0;
      candidates = []; letters = [];
      for (const char of Array.from(text)) {
        context.font = font.fontWeight + " 100px " + font.fontFamily;
        const m = context.measureText(char);
        letters.push({ index: offset, x: advances[offset] - m.actualBoundingBoxLeft, y: -m.actualBoundingBoxAscent,
          width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight, height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent });
        const found = interior(context, char, scanFont);
        if (found) candidates.push({ x: found.x + advances[offset], y: found.y, radius: found.radius, index: offset });
        offset += char.length;
      }
      target = candidates.find((c) => c.index === requested) ||
        candidates.slice().sort((a, b) => b.radius - a.radius || Math.abs(a.x - center.x) - Math.abs(b.x - center.x))[0] || null;
      return true;
    };

    const select = (next) => {
      target = next;
      endScale = target ? Math.max(startScale, Math.hypot(W, H) / (target.radius * 1.35)) : startScale;
      section.dataset.gpFocus = target ? Array.from(text.slice(target.index))[0] : "";
      section.dataset.gpFocusIndex = String(target ? target.index : -1);
      for (const button of buttons) {
        const selected = Number(button.dataset.gpLetter) === (target ? target.index : -1);
        button.disabled = !candidates.some((c) => c.index === Number(button.dataset.gpLetter));
        button.setAttribute("aria-checked", String(selected));
        button.tabIndex = selected ? 0 : -1;
      }
      if (picker.value !== "") picker.value = String(target ? target.index : -1);
      for (const option of Array.from(picker.options)) option.disabled = option.value === "" || !candidates.some((c) => c.index === Number(option.value));
      const u = 1 / startScale;
      const y = bounds.y + bounds.height + 25 * u;
      const x = bounds.x;
      const right = x + bounds.width;
      const cross = target ? "M" + (target.x - 9 * u) + " " + target.y + "h" + (18 * u) + "M" + target.x + " " + (target.y - 9 * u) + "v" + (18 * u) : "";
      const annotationPath = marks.querySelector("path");
      annotationPath.setAttribute("d", "M" + x + " " + y + "H" + right + "M" + x + " " + (y - 5 * u) + "v" + (10 * u) + "M" + right + " " + (y - 5 * u) + "v" + (10 * u) + cross);
      annotationPath.setAttribute("stroke-width", String(u));
    };

    const position = () => {
      const origin = root ? root.getBoundingClientRect().top + root.clientTop : 0;
      return clamp((origin - section.getBoundingClientRect().top) / travel);
    };

    const paint = (progress) => {
      const isStatic = motion.matches || stalled || !target;
      const p = isStatic ? 0 : progress;
      const t = clamp(p / 0.78);
      const eased = t < 0.5 ? 4 * Math.pow(t, 3) : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const scale = Math.exp(Math.log(startScale) + Math.log(endScale / startScale) * eased);
      const blend = endScale === startScale ? 0 : (1 / scale - 1 / startScale) / (1 / endScale - 1 / startScale);
      const cx = center.x + ((target ? target.x : center.x) - center.x) * blend;
      const cy = center.y + ((target ? target.y : center.y) - center.y) * blend;
      const roll = -4 * smooth(0.06, 0.5, t) * (1 - smooth(0.62, 0.92, t));
      const transform = "translate(" + (W / 2) + " " + (H * wordY + H * 0.04 * eased) + ") scale(" + scale + ") rotate(" + roll + ") translate(" + (-cx) + " " + (-cy) + ")";
      const radians = roll * Math.PI / 180;
      const dx = W / 2 / scale, dy = (H * wordY + H * 0.04 * eased) / scale;
      clip.setAttribute("transform", "scale(" + scale + ") rotate(" + roll + ")");
      glyph.setAttribute("transform", "translate(" + (Math.cos(radians) * dx + Math.sin(radians) * dy - cx) + " " + (-Math.sin(radians) * dx + Math.cos(radians) * dy - cy) + ")");
      marks.setAttribute("transform", transform);
      marks.style.opacity = String(1 - smooth(0.015, 0.17, p));
      choosing = interactive && !isStatic && p < 0.04;
      choices.inert = !choosing;
      section.dataset.gpChoosing = String(choosing);
      field.style.clipPath = t >= 1 ? "none" : "url(#" + clipId + ")";
      // The frame reads as fully ink once the zoomed interior (the largest opaque square) spans the frame.
      section.dataset.gpFilled = String(!isStatic && (t >= 1 || (!!target && target.radius * scale >= Math.max(W, H) / 2 * 0.9)));
      section.style.setProperty("--gp-caption", String(1 - smooth(0.01, 0.16, p)));
      section.style.setProperty("--gp-reveal", String(isStatic ? 1 : smooth(0.78, 0.9, p)));
      section.style.setProperty("--gp-field-scale", String(1 + 0.16 * smooth(0, 0.82, p)));
      section.style.setProperty("--gp-caption-hit", p < 0.08 ? "auto" : "none");
      section.dataset.gpEntered = String(p >= 0.9);
      section.dataset.gpProgress = p.toFixed(5);
      if (p !== lastProgress) { lastProgress = p; if (props.onProgress) props.onProgress(p); }
    };

    const layout = () => {
      if (!section.clientWidth) return;
      W = pin.clientWidth;
      const smallViewport = section.querySelector("[data-gp-viewport]").offsetHeight;
      const viewportHeight = Math.max(1, Math.min(root ? root.clientHeight : smallViewport, smallViewport));
      // A sticky header above the portal eats into the pinned frame; pin below it.
      let offset = Number(props.stickyOffset) || 0;
      if (!offset) {
        // Fall back to measuring a sticky/fixed page header ourselves.
        for (const candidate of Array.from(document.querySelectorAll("header, [data-gp-sticky-header]"))) {
          const cs = getComputedStyle(candidate);
          if ((cs.position === "sticky" || cs.position === "fixed") && candidate.getBoundingClientRect().top <= 1) {
            offset = Math.max(offset, candidate.getBoundingClientRect().height);
          }
        }
      }
      // Floor so the pinned frame tucks under a fractional-height header instead of leaving a 1px seam.
      offset = Math.floor(Math.max(0, Math.min(viewportHeight * 0.4, offset)));
      section.style.setProperty("--gp-offset", offset + "px");
      H = motion.matches ? Math.min(viewportHeight * 0.75, 480) : viewportHeight - offset;
      section.style.setProperty("--gp-height", H + "px");
      travel = H * length;
      art.setAttribute("viewBox", "0 0 " + W + " " + H);
      if (fontDirty) { ready = readInk(); fontDirty = false; }
      if (!ready) return;
      startScale = Math.min(W * 0.84 / bounds.width, H * 0.38 / bounds.height);
      select(target);
      for (const button of buttons) {
        const letter = letters.find((item) => item.index === Number(button.dataset.gpLetter));
        if (!letter) continue;
        Object.assign(button.style, {
          left: (W / 2 + (letter.x - center.x) * startScale) + "px",
          top: (H * wordY + (letter.y - center.y) * startScale - Math.max(0, 44 - letter.height * startScale) / 2) + "px",
          width: Math.max(1, letter.width * startScale) + "px",
          height: Math.max(44, letter.height * startScale) + "px"
        });
      }
      section.style.setProperty("--gp-word-top", (H * wordY - bounds.height * startScale / 2) + "px");
      section.style.setProperty("--gp-word-bottom", (H * wordY + bounds.height * startScale / 2) + "px");
      section.dataset.gpReady = "true";
      section.dataset.gpMotion = !motion.matches && !stalled && target ? "on" : "off";
    };

    const frame = (time) => {
      raf = 0;
      if (disposed) return;
      if (time !== undefined && !browserFrameSeen) {
        browserFrameSeen = true; dirty = true;
      }
      if (dirty) { dirty = false; layout(); }
      if (ready) paint(position());
    };
    const schedule = () => { if (!raf && active) raf = requestAnimationFrame(frame); };
    // Some embedded previews throttle rAF. Paint straight from the scroll event until
    // a real animation frame proves the loop is running.
    const resize = () => { cancelAnimationFrame(raf); dirty = true; frame(); };
    const scroll = () => { schedule(); if (!browserFrameSeen && ready) paint(position()); };
    const choose = (event) => {
      if (!choosing || position() >= 0.04) return;
      const button = event.target.closest ? event.target.closest("[data-gp-letter]") : null;
      const next = candidates.find((c) => c.index === Number(button && button.dataset.gpLetter));
      if (!next || next === target) return;
      select(next); paint(position());
    };
    const navigate = (event) => {
      if (!choosing || ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].indexOf(event.key) < 0) return;
      event.preventDefault();
      const current = candidates.indexOf(target);
      const index = event.key === "Home" ? 0 : event.key === "End" ? candidates.length - 1
        : (current + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + candidates.length) % candidates.length;
      const btn = buttons.find((b) => Number(b.dataset.gpLetter) === candidates[index].index);
      if (btn) btn.focus({ preventScroll: true });
    };
    const pick = () => {
      if (!choosing || position() >= 0.04) return;
      const next = candidates.find((c) => c.index === Number(picker.value));
      if (next) { select(next); paint(position()); }
    };
    choices.addEventListener("pointerover", choose);
    choices.addEventListener("click", choose);
    choices.addEventListener("focusin", choose);
    choices.addEventListener("keydown", navigate);
    picker.addEventListener("change", pick);
    const observer = new ResizeObserver(resize);
    observer.observe(section);
    if (root) observer.observe(root);
    const visibility = new IntersectionObserver((entries) => {
      active = entries[0].isIntersecting;
      if (active) { dirty = true; schedule(); }
      else if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }, { root: root, rootMargin: "100% 0px" });
    visibility.observe(section);
    (root || window).addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", resize);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
    motion.addEventListener("change", resize);
    frame();
    schedule();
    // A ResizeObserver burst during streaming can cancel the timestamped frame; confirm
    // the browser is painting with a one-shot rAF of our own.
    requestAnimationFrame(() => { if (!disposed) { browserFrameSeen = true; dirty = true; frame(); } });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!disposed) { freezeFont(); resize(); } });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      visibility.disconnect();
      (root || window).removeEventListener("scroll", scroll);
      window.removeEventListener("resize", resize);
      if (window.visualViewport) window.visualViewport.removeEventListener("resize", resize);
      motion.removeEventListener("change", resize);
      choices.removeEventListener("pointerover", choose);
      choices.removeEventListener("click", choose);
      choices.removeEventListener("focusin", choose);
      choices.removeEventListener("keydown", navigate);
      picker.removeEventListener("change", pick);
    };
  }, [text, focusChar, interactive, fontFamily, weight, length, wordY, clipId, props.stickyOffset]);

  const css = `
    ${q}{--gp-paper:#fff;--gp-ink:#000;--gp-field:#000;--gp-foreground:#fff;position:relative;isolation:isolate;background:var(--gp-paper);color:var(--gp-ink);}
    ${q}>[data-gp-viewport]{position:absolute;inset:0 auto auto 0;height:100vh;height:100svh;width:0;pointer-events:none;visibility:hidden;}
    ${q} [data-gp-pin]{position:relative;height:var(--gp-height,100svh);overflow:clip;isolation:isolate;container-type:size;}
    ${q} [data-gp-field]{position:absolute;inset:0;background:var(--gp-field);opacity:0;pointer-events:none;}
    ${q}[data-gp-ready] [data-gp-field]{opacity:1;}
    ${q} [data-gp-art]{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;}
    ${q} [data-gp-marks]{fill:none;stroke:var(--gp-ink);opacity:.6;}
    ${q} [data-gp-choices]{position:absolute;inset:0;visibility:hidden;pointer-events:none;}
    ${q}[data-gp-choosing=true] [data-gp-choices]{visibility:visible;}
    ${q} [data-gp-letter]{box-sizing:border-box;position:absolute;border:0;padding:0;margin:0;background:transparent;cursor:pointer;pointer-events:auto;touch-action:pan-y;}
    ${q} [data-gp-letter]:disabled{pointer-events:none;}
    ${q} [data-gp-letter]:focus-visible{outline:2px solid var(--gp-ink);outline-offset:5px;}
    ${q} [data-gp-touch-picker]{display:none;position:absolute;top:calc(var(--gp-word-bottom,50%) + 38px);left:50%;transform:translateX(-50%);align-items:center;gap:12px;visibility:hidden;}
    ${q}[data-gp-choosing=true] [data-gp-touch-picker]{visibility:visible;}
    ${q} [data-gp-select]{min-height:44px;min-width:104px;border:1px solid #788389;background:var(--gp-paper);color:var(--gp-ink);padding:0 10px;font:inherit;font-size:12px;}
    ${q} [data-gp-select]:focus-visible{outline:2px solid var(--gp-ink);outline-offset:4px;}
    @media(any-pointer:coarse){${q} [data-gp-touch-picker]{display:flex;}}
    ${q} [data-gp-fallback]{position:absolute;inset:0;display:none;place-items:center;font-size:min(calc(100cqw / var(--gp-characters)),38cqh);line-height:1;color:var(--gp-field);}
    ${q}[data-gp-ready] [data-gp-fallback]{visibility:hidden;}
    ${q} [data-gp-front]{position:absolute;inset:0;opacity:var(--gp-caption,1);pointer-events:none;}
    ${q} [data-gp-front] a,${q} [data-gp-front] button{pointer-events:var(--gp-caption-hit,auto);}
    ${q} [data-gp-eyebrow]{position:absolute;inset:auto 24px calc(100% - var(--gp-word-top,35%) + 28px);margin:0;text-align:center;font-size:clamp(12px,1.1vw,14px);font-weight:600;letter-spacing:.02em;color:var(--gp-ink);}
    ${q} [data-gp-support]{position:absolute;inset:calc(var(--gp-word-bottom,50%) + 26px) 24px auto;margin:0;text-align:center;font-size:clamp(14px,1.3vw,18px);line-height:1.5;color:var(--gp-ink);}
    ${q} [data-gp-caption]{position:absolute;inset:auto 8% 7%;display:flex;align-items:center;justify-content:center;gap:1rem;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;opacity:var(--gp-caption,1);pointer-events:var(--gp-caption-hit,auto);}
    ${q} [data-gp-enter]{display:inline-flex;align-items:center;gap:14px;min-height:44px;color:var(--gp-ink);text-decoration:none;}
    ${q} [data-gp-enter]:focus-visible{outline:2px solid currentColor;outline-offset:5px;}
    ${q} [data-gp-caption]:focus-within{opacity:1;pointer-events:auto;}
    ${q} [data-gp-content]{box-sizing:border-box;position:relative;min-height:var(--gp-height,100svh);padding:clamp(32px,6%,88px) clamp(20px,5vw,64px);display:grid;align-content:center;color:var(--gp-foreground);background:var(--gp-field);}
    ${q}[data-gp-motion=on] [data-gp-pin]{position:sticky;top:var(--gp-offset,0px);}
    ${q}[data-gp-motion=off] [data-gp-hint]{display:none;}
    ${q}[data-gp-motion=on] [data-gp-content]{margin-top:calc((var(--gp-length) - 1) * var(--gp-height));background:transparent;opacity:var(--gp-reveal,0);pointer-events:none;}
    ${q}[data-gp-motion=on][data-gp-entered=true] [data-gp-content]{pointer-events:auto;}
    ${q}[data-gp-motion=on]:has([data-gp-content]:focus-within) [data-gp-field]{clip-path:none!important;}
    ${q}[data-gp-motion=on] [data-gp-content]:focus-within{opacity:1;pointer-events:auto;}
    ${q}:has([data-gp-content]:focus-within) [data-gp-caption],${q}:has([data-gp-content]:focus-within) [data-gp-marks]{opacity:0;}
    @media(prefers-reduced-motion:reduce){${q} [data-gp-pin]{position:relative!important;} ${q} [data-gp-content]{margin-top:0!important;opacity:1!important;background:var(--gp-field)!important;min-height:0;padding-block:64px;} ${q} [data-gp-caption]{opacity:1!important;}}
  `;

  return (
    <section ref={sectionRef} id={uid} aria-label={text} style={Object.assign({ "--gp-length": length, "--gp-characters": Array.from(text).length }, props.style || {})}>
      <style>{css}</style>
      <noscript><style>{`${q} [data-gp-fallback]{display:grid}${q} [data-gp-hint]{display:none}`}</style></noscript>
      <div data-gp-viewport aria-hidden="true" />
      <div data-gp-pin>
        <div data-gp-field aria-hidden="true" inert="">
          <div style={{ position: "absolute", inset: 0, background: "var(--gp-field)" }} />
        </div>
        <svg data-gp-art aria-hidden="true" focusable="false">
          <defs>
            <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
              <text data-gp-glyph x="0" y="0" style={{ fontFamily: fontFamily, fontWeight: weight, fontSize: 100, fontKerning: "none", fontVariantLigatures: "none", letterSpacing: 0 }}>{text}</text>
            </clipPath>
          </defs>
          <g data-gp-marks style={{ visibility: annotations ? "visible" : "hidden" }}><path /></g>
        </svg>
        <div data-gp-choices role="radiogroup" aria-label="Elegí la letra por la que querés entrar" inert="">
          {characters.map(({ char, index }, i) => (
            <button type="button" role="radio" aria-checked="false" tabIndex={-1} data-gp-letter={index} key={index} aria-label={char + ", letra " + (i + 1) + " de " + characters.length} />
          ))}
        </div>
        <label data-gp-touch-picker>
          <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>Letra de entrada</span>
          <select data-gp-select defaultValue="">
            <option value="" disabled>Elegí una letra</option>
            {characters.map(({ char, index }, i) => <option key={index} value={index}>{(i + 1) + " · " + char}</option>)}
          </select>
        </label>
        <div data-gp-front>
          {props.eyebrow ? <p data-gp-eyebrow>{props.eyebrow}</p> : null}
          {props.support ? <p data-gp-support>{props.support}</p> : null}
        </div>
        <span data-gp-fallback aria-hidden="true" style={{ fontFamily: fontFamily, fontWeight: weight }}>{text}</span>
        <div data-gp-caption>
          <a data-gp-enter href={"#" + uid + "-content"}>{enterLabel}<span aria-hidden="true">↓</span></a>
        </div>
      </div>
      <div data-gp-content id={uid + "-content"} tabIndex={-1}>{props.children}</div>
    </section>
  );
}

module.exports = { GlyphPortal };
