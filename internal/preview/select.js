// Injected by Terra's preview proxy. Hover + sticky selection highlights
// (max 3) via an overlay layer so app CSS can't wipe the color. Click
// empty page chrome (html/body) clears; parent can post terra:clear-selection.
(() => {
  if (window.__terraSelect) return;
  window.__terraSelect = true;

  const MAX = 3;
  const COLOR = "#f5c518";
  const GLOW = "0 0 0 6px rgba(245, 197, 24, 0.22)";

  let picking = true;
  let hovered = null;
  /** @type {{ el: Element, desc: object }[]} */
  const selected = [];

  const layer = document.createElement("div");
  layer.id = "__terra-select-layer";
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "2147483646",
    overflow: "hidden",
  });

  const hoverBox = document.createElement("div");
  const selectBoxes = [0, 1, 2].map(() => document.createElement("div"));
  for (const box of [hoverBox, ...selectBoxes]) {
    Object.assign(box.style, {
      position: "fixed",
      display: "none",
      pointerEvents: "none",
      boxSizing: "border-box",
      border: `2px solid ${COLOR}`,
      borderRadius: "2px",
    });
    layer.appendChild(box);
  }
  hoverBox.style.boxShadow = "none";
  for (const box of selectBoxes) box.style.boxShadow = GLOW;

  function mountLayer() {
    if (!layer.isConnected) document.documentElement.appendChild(layer);
  }
  mountLayer();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountLayer, { once: true });
  }

  /** One-shot frontend design transforms per selected element. */
  /** @type {WeakMap<Element, Set<string>>} */
  const appliedTf = new WeakMap();
  const TF_CSS = `
    .tf-space { padding: 24px !important; gap: 16px !important; transition: padding .45s, gap .45s; }
    .tf-accent { background: #fff9ea !important; border-color: #f5c518 !important; transition: background .45s, border-color .45s; }
    .tf-hover { transition: transform .2s, box-shadow .2s; }
    .tf-hover:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(0,0,0,.14); }
    .tf-hover:active { transform: translateY(0); }
    .tf-type, .tf-type b, .tf-type h1, .tf-type h2, .tf-type h3, .tf-type h4, .tf-type p {
      font-size: 1.12em !important; letter-spacing: -0.02em; transition: font-size .45s;
    }
    .tf-round { border-radius: 20px !important; transition: border-radius .45s; }
    .tf-polish { padding: 20px !important; border-radius: 16px !important; box-shadow: 0 8px 24px rgba(0,0,0,.1) !important; }
    .tf-pulse { outline: 2px solid #f5c518; outline-offset: 3px; }
  `;

  function ensureTfStyle() {
    if (document.getElementById("__terra-tf-style")) return;
    const s = document.createElement("style");
    s.id = "__terra-tf-style";
    s.textContent = TF_CSS;
    document.head.appendChild(s);
  }

  function applyTransform(cls) {
    if (!cls || selected.length === 0) return false;
    ensureTfStyle();
    let any = false;
    for (const { el } of selected) {
      if (!(el instanceof Element)) continue;
      let used = appliedTf.get(el);
      if (!used) {
        used = new Set();
        appliedTf.set(el, used);
      }
      if (used.has(cls)) continue;
      el.classList.add(cls, "tf-pulse");
      setTimeout(() => el.classList.remove("tf-pulse"), 650);
      used.add(cls);
      any = true;
    }
    return any;
  }

  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "terra:mode") {
      picking = !!d.picking;
      if (!picking) {
        hovered = null;
        paint();
      }
    }
    if (d.type === "terra:clear-selection") clearAll();
    if (d.type === "terra:transform") {
      const ok = applyTransform(d.cls);
      parent.postMessage({ type: "terra:transform-result", cls: d.cls, ok }, "*");
    }
  });

  function isSelected(el) {
    return selected.some((s) => s.el === el);
  }

  function place(box, el) {
    if (!(el instanceof Element) || !el.isConnected) {
      box.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    box.style.left = `${Math.round(r.left)}px`;
    box.style.top = `${Math.round(r.top)}px`;
    box.style.width = `${Math.round(r.width)}px`;
    box.style.height = `${Math.round(r.height)}px`;
  }

  function paint() {
    mountLayer();
    if (picking && hovered && !isSelected(hovered)) place(hoverBox, hovered);
    else hoverBox.style.display = "none";

    for (let i = 0; i < selectBoxes.length; i++) {
      const entry = selected[i];
      if (entry) place(selectBoxes[i], entry.el);
      else selectBoxes[i].style.display = "none";
    }
  }

  function postSelections() {
    parent.postMessage(
      {
        type: "terra:selection",
        items: selected.map((s) => s.desc),
      },
      "*",
    );
  }

  function clearAll() {
    hovered = null;
    selected.length = 0;
    paint();
    postSelections();
  }

  function pickTarget(t) {
    return t instanceof Element ? t : t && t.parentElement;
  }

  function toggleSelect(el) {
    const idx = selected.findIndex((s) => s.el === el);
    if (idx >= 0) {
      selected.splice(idx, 1);
      paint();
      postSelections();
      return;
    }
    if (selected.length >= MAX) selected.shift();
    selected.push({ el, desc: describe(el) });
    paint();
    postSelections();
  }

  document.addEventListener(
    "mouseover",
    (e) => {
      if (!picking) return;
      const t = pickTarget(e.target);
      if (!t || t === document.documentElement || t === document.body) {
        hovered = null;
        paint();
        return;
      }
      if (t === hovered) return;
      if (t.id === "__terra-select-layer" || layer.contains(t)) return;
      hovered = t;
      paint();
    },
    true,
  );

  document.addEventListener(
    "mouseout",
    (e) => {
      if (!picking || !hovered) return;
      const to = pickTarget(e.relatedTarget);
      if (to && hovered.contains(to)) return;
      hovered = null;
      paint();
    },
    true,
  );

  document.addEventListener(
    "click",
    (e) => {
      if (!picking) return;
      e.preventDefault();
      e.stopPropagation();
      const t = pickTarget(e.target);
      if (!t || t === document.documentElement || t === document.body) {
        clearAll();
        return;
      }
      if (t.id === "__terra-select-layer" || layer.contains(t)) return;
      toggleSelect(t);
    },
    true,
  );

  window.addEventListener("scroll", paint, true);
  window.addEventListener("resize", paint);

  function fiberOf(el) {
    for (let n = el; n; n = n.parentElement) {
      for (const k in n) {
        if (k.startsWith("__reactFiber$")) return n[k];
      }
    }
    return null;
  }

  function describe(el) {
    const out = {
      tag: el.tagName ? el.tagName.toLowerCase() : "",
      text: (el.textContent || "").trim().slice(0, 120),
    };
    let fiber = fiberOf(el);
    const chain = [];
    let file = null;
    let line = null;
    while (fiber && chain.length < 5) {
      const t = fiber.type;
      if (typeof t === "function") {
        const name = t.displayName || t.name;
        if (name) chain.push(name);
        if (!file) {
          const src = fiber._debugSource;
          if (src && src.fileName) {
            file = src.fileName;
            line = src.lineNumber || null;
          } else if (fiber._debugStack) {
            const m = String(fiber._debugStack.stack || fiber._debugStack).match(
              /https?:\/\/[^\s):]+\/(src\/[^\s):?]+?)(?:\?[^\s):]*)?:(\d+)/,
            );
            if (m) {
              file = m[1];
              line = +m[2];
            }
          }
        }
      }
      fiber = fiber.return;
    }
    if (chain.length) {
      out.name = chain[0];
      out.ownerChain = chain;
    }
    if (file) {
      out.file = file;
      out.line = line;
    }
    return out;
  }
})();
