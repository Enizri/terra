// The Power of Terra capability drawer — "Ask Terra" and the rows under it.
// Only the button is pressable; the row around it is scaffolding, so the
// button's own box has to carry the row's height.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const route = import.meta.dirname;
const showcaseCss = readFileSync(path.join(route, "styles/showcase.css"), "utf8");
const powerSource = readFileSync(path.join(route, "sections/PowerSection.tsx"), "utf8");

const block = (selector: string) => {
  const at = showcaseCss.indexOf(`${selector} {`);
  assert.ok(at >= 0, `${selector} exists`);
  return showcaseCss.slice(at, showcaseCss.indexOf("}", at));
};

const px = (css: string, prop: string) => {
  const m = css.match(new RegExp(`${prop}:\\s*(-?[\\d.]+)px`));
  assert.ok(m, `${prop} is a px value`);
  return Number(m![1]);
};

test("the press target carries the row, not the row around it", () => {
  const btn = px(block(".sh-power-list__btn"), "padding");
  const item = px(block(".sh-power-list__item"), "padding");
  // One 21px line at line-height 1.2 is ~25px; the padding roughly doubles it.
  assert.ok(btn >= 8, "the button pads itself into a full-row target");
  assert.ok(btn > item, "more of the row is button than gap");
  // The row still has to breathe, or neighbouring targets touch and a press
  // near a border is ambiguous.
  assert.ok(item >= 3, "rows stay separated");
});

test("only the button takes the press", () => {
  // The row is `role="presentation"` scaffolding with no handler, so padding
  // it would have grown the row without growing anything pressable.
  assert.match(powerSource, /role="presentation"/);
  assert.match(powerSource, /className="sh-power-list__btn"\s*\n\s*onClick=/);
});

test("the active marker still sits with its label", () => {
  // The button's padding moved the label down; a marker left at the old offset
  // would float above it.
  assert.equal(px(block(".sh-power-list__mark"), "top"), 17);
});
