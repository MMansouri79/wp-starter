import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../public/ui.js", import.meta.url), "utf8");
function primitives() {
  const context = { module: { exports: {} } };
  vm.runInNewContext(source, context);
  return context.module.exports;
}
test("theme preferences fall back to system and resolve independently of a saved override", () => {
  const ui = primitives();
  assert.equal(ui.resolveTheme(null, true), "dark");
  assert.equal(ui.resolveTheme("unknown", false), "light");
  assert.equal(ui.resolveTheme("light", true), "light");
  assert.equal(ui.resolveTheme("dark", false), "dark");
});
test("theme is applied before DOM ready and storage failures preserve a usable system theme", () => {
  const events = {};
  const document = { documentElement: { dataset: {}, style: {} }, addEventListener: (name, callback) => { events[name] = callback; } };
  let changed;
  const window = { matchMedia: () => ({ matches: true, addEventListener: (_, callback) => { changed = callback; } }), addEventListener() {} };
  const localStorage = { getItem() { throw new Error("unavailable"); } };
  vm.runInNewContext(source, { window, document, localStorage });
  assert.equal(document.documentElement.dataset.theme, "dark");
  assert.equal(document.documentElement.style.colorScheme, "dark");
  assert.equal(typeof events.DOMContentLoaded, "function");
  assert.equal(typeof changed, "function");
});
test("library search is case-insensitive and trims accidental spaces", () => {
  const ui = primitives();
  assert.equal(ui.matchesSearch("Elementor Pro 3.2", "  ELEMENTOR  "), true);
  assert.equal(ui.matchesSearch("Elementor", "WordPress"), false);
  assert.equal(ui.matchesSearch("Theme", ""), true);
});
