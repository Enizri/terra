// Node 25 defines its own stub `localStorage` global, and it shadows the real
// Storage jsdom installs — every call would hit a method that does not exist.
// Hand the tests a working one.
import { JSDOM } from "jsdom";

Object.defineProperty(globalThis, "localStorage", {
  value: new JSDOM("", { url: "http://localhost:3000/" }).window.localStorage,
  configurable: true,
});
