import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  ARROW_PATH,
  POINTER_FILL,
  POINTER_REST,
  hoverCursorTarget,
  isClickableElement,
  nativeCursorTarget,
} from "./pointerArrow.ts";

test("the Codex-style cursor is a taupe pointer whose tip is the hotspot", () => {
  const tip = ARROW_PATH.reduce((best, p) => (p.y < best.y ? p : best));
  assert.ok(Math.abs(tip.x) < 2);
  assert.ok(Math.abs(tip.y) < 0.2);
  assert.ok(ARROW_PATH.length > 20, "uses the recovered contour, not a 4-point dart");
  const xs = ARROW_PATH.map((p) => p.x);
  const ys = ARROW_PATH.map((p) => p.y);
  assert.ok(Math.max(...xs) > 12, "classic pointer has a right-hand tail");
  assert.ok(Math.max(...ys) > 14, "the body hangs below the tip");
  assert.match(POINTER_FILL, /97,92,89/);
});

test("the pointer stays at a fixed 180° tilt", () => {
  assert.ok(POINTER_REST > 1.8 && POINTER_REST < 2.5);
});

test("buttons show the native pointer; plain text does not", () => {
  const { document } = new JSDOM("<!doctype html><html><body></body></html>").window;
  const button = document.createElement("button");
  button.textContent = "Go";
  document.body.append(button);
  assert.equal(isClickableElement(button), true);

  const span = document.createElement("span");
  button.append(span);
  assert.equal(isClickableElement(span), true);

  button.disabled = true;
  assert.equal(isClickableElement(span), false);

  const plain = document.createElement("p");
  document.body.append(plain);
  assert.equal(isClickableElement(plain), false);
});

test("the pressable bits of the Ask Terra card count as buttons", () => {
  const { document } = new JSDOM("<!doctype html><html><body></body></html>").window;
  document.body.innerHTML = `
    <div class="sh-replica">
      <div data-sel="post-btn" data-sel-label="Post button"><span>Post</span></div>
      <p class="rp-copy">plain replica copy</p>
    </div>
    <button class="sh-terra-chat__hint">Show the evidence</button>
    <a href="/pricing">Pricing</a>
    <a class="sh-anchor">no href</a>`;
  const q = (sel: string) => document.querySelector(sel)!;
  assert.equal(isClickableElement(q("[data-sel] span")), true, "replica pick target");
  assert.equal(isClickableElement(q(".sh-terra-chat__hint")), true, "ask chip");
  assert.equal(isClickableElement(q("a[href]")), true, "plain link");
  assert.equal(isClickableElement(q(".rp-copy")), false);
  assert.equal(isClickableElement(q(".sh-anchor")), false, "anchor with no href");
});

test("press targets and fields mark the tip; paper keeps the resting glyph", () => {
  const { document } = new JSDOM("<!doctype html><html><body></body></html>").window;
  document.body.innerHTML = `
    <button id="go">Go</button>
    <input id="ask" type="text" />
    <input id="send" type="submit" />
    <label id="pick" for="agree"><input id="agree" type="checkbox" /> Agree</label>
    <p id="copy">paper</p>`;
  const q = (id: string) => document.getElementById(id)!;
  const kind = (id: string) => hoverCursorTarget(q(id))?.kind ?? null;
  assert.equal(kind("go"), "pointer");
  assert.equal(kind("ask"), "text");
  assert.equal(kind("send"), "pointer", "submit is a press target");
  assert.equal(kind("agree"), "pointer", "checkbox in a label is not a field");
  assert.equal(kind("pick"), "pointer");
  assert.equal(kind("copy"), null, "custom glyph stays on plain copy");
  q("go").setAttribute("aria-disabled", "true");
  assert.equal(kind("go"), null, "a dead button keeps the resting glyph");

  // The hit rides the press target itself, not the span you happened to
  // be over — that is what keeps clickable detection accurate.
  const inner = q("go").appendChild(document.createElement("span"));
  q("go").removeAttribute("aria-disabled");
  assert.equal(hoverCursorTarget(inner)?.target, q("go"));
  // Alias kept so older call sites still resolve.
  assert.equal(nativeCursorTarget(inner)?.target, q("go"));
});
