import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../client/shell.js", import.meta.url), "utf8");

// Minimal DOM boundary: execute the actual overlay, keeping selectors and event handlers observable.
function overlay(state = {}, controls = []) {
  let boot;
  const calls = [];
  const redirects = [];
  const view = { firstChild: null, insertBefore() {} };
  const document = {
    readyState: "loading", cookie: "wp_starter_csrf=test-token",
    addEventListener: (name, callback) => { if (name === "DOMContentLoaded") boot = callback; },
    getElementById: () => null,
    querySelector: (selector) => selector === ".view.active" ? view : null,
    querySelectorAll: (selector) => controls.filter((control) => selector.split(",").some((part) =>
      part.startsWith(".") ? control.classes.includes(part.slice(1)) : control.getAttribute(part.slice(1, -1)) !== null)),
    createElement: () => ({ style: {}, appendChild() {}, remove() {} })
  };
  const context = {
    document, state, Headers, Promise, setTimeout: () => {},
    refresh: async () => {},
    location: { origin: "https://builder.example.test", replace: (url) => redirects.push(url) },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { status: url === "/api/expired" ? 401 : 200, ok: true,
        json: async () => url === "/api/auth/session" ? { authenticated: true, user: { role: "member" } } : {} };
    }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return { context, calls, redirects, boot: () => boot() };
}
function control(classes, attributes) {
  const badgeContainer = { badge: null, querySelector() { return this.badge; }, appendChild(badge) { this.badge = badge; } };
  return { classes, attributes, dataset: {}, tagName: "BUTTON", disabled: false,
    classList: { add() {} }, getAttribute: (key) => attributes[key] ?? null,
    setAttribute(key, value) { attributes[key] = value; },
    addEventListener(name, callback) { this.click = callback; }, closest: () => badgeContainer, badgeContainer };
}

test("overlay sends CSRF only on same-origin API mutations and redirects expired sessions", async () => {
  const { context, calls, redirects } = overlay();
  await context.fetch("/api/packages", { method: "POST" });
  assert.equal(calls.at(-1).options.headers.get("X-CSRF-Token"), "test-token");
  assert.equal(calls.at(-1).options.credentials, "same-origin");
  await context.fetch("/api/packages");
  assert.equal(calls.at(-1).options.headers, undefined);
  await context.fetch("https://other.example.test/api/packages", { method: "POST" });
  assert.equal(calls.at(-1).options.headers, undefined);
  await context.fetch("/api/packages", { method: "DELETE", headers: { "X-CSRF-Token": "explicit" } });
  assert.equal(calls.at(-1).options.headers.get("X-CSRF-Token"), "explicit");
  await context.fetch("/api/expired");
  assert.deepEqual(redirects, ["/login.html"]);
});

test("overlay disables foreign edits/deletes, preserves owned controls and permits duplication/building", async () => {
  const foreign = control(["delete-resource"], { "data-id": "foreign" });
  const own = control(["edit-resource"], { "data-id": "own" });
  const duplicate = control(["duplicate-resource"], { "data-id": "foreign" });
  const build = control(["build-profile"], { "data-file": "foreign.json" });
  const resource = { id: "foreign", createdBy: "alice", ownerName: "Alice", canEdit: false, ownedByCurrentUser: false };
  const { context, boot } = overlay({ vnext: { colors: [resource, { id: "own", canEdit: true, ownedByCurrentUser: true }] } }, [foreign, own, duplicate, build]);
  boot();
  await context.refresh();
  assert.equal(foreign.disabled, true);
  assert.equal(foreign.attributes["aria-disabled"], "true");
  assert.match(foreign.badgeContainer.badge.textContent, /Shared by Alice.*read-only/);
  assert.equal(own.disabled, false);
  assert.equal(duplicate.disabled, false);
  assert.equal(build.disabled, false);
  let prevented = false;
  foreign.click({ preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
  assert.equal(prevented, true);
});
