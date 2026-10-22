import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../client/team-transport.js", import.meta.url), "utf8");
function transport(team = "team-a", native) {
  const calls = [], navigations = [], storage = new Map(); let ready;
  class Storage {
    getItem(key) { return storage.get(key) || null; }
    setItem(key, value) { storage.set(key, value); }
    removeItem(key) { storage.delete(key); }
  }
  const links = [];
  const document = { cookie: "wp_starter_csrf=test-token", body: {}, querySelectorAll: () => links, addEventListener: (_, handler) => { ready = handler; } };
  const context = { URL, Request, Headers, AbortController, DOMException, Set, Storage, sessionStorage: new Storage(), document,
    MutationObserver: class { observe() {} },
    location: { href: `https://builder.example.test/?team=${team}`, origin: "https://builder.example.test", assign: url => navigations.push(url), replace: url => navigations.push(url) },
    fetch: native || (async (url, options) => { calls.push({ url, options }); return { status: 200 }; }) };
  context.window = context; vm.runInNewContext(source, context);
  return { context, calls, navigations, storage, links, ready: () => ready() };
}
test("team transport scopes resource URLs, preserves auth/admin and avoids adding CSRF to other origins", async () => {
  const { context, calls } = transport();
  await context.fetch("/api/packages", { method: "POST" });
  assert.equal(new URL(calls.at(-1).url).pathname, "/api/teams/team-a/packages"); assert.equal(calls.at(-1).options.headers.get("X-CSRF-Token"), "test-token");
  for (const path of ["/api/auth/session", "/api/admin/teams", "/api/teams/team-b/members"]) { await context.fetch(path); assert.equal(new URL(calls.at(-1).url).pathname, path); }
  await context.fetch("/api/auth/quota"); assert.equal(new URL(calls.at(-1).url).pathname, "/api/teams/team-a/quota");
  await context.fetch("https://other.example.test/api/packages", { method: "POST" }); assert.equal(calls.at(-1).options.headers, undefined);
  const input = new Request("https://builder.example.test/api/sample-content", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
  await context.fetch(input); assert.equal(calls.at(-1).url.url, "https://builder.example.test/api/teams/team-a/sample-content");
});
test("transport scopes download anchors, sample images and the saved draft", () => {
  const { context, links, storage, ready } = transport();
  const attributes = { href: "/download/starter.zip" };
  links.push({ tagName: "A", getAttribute: key => attributes[key], setAttribute: (key, value) => { attributes[key] = value; } });
  ready(); assert.equal(attributes.href, "https://builder.example.test/api/teams/team-a/builds/by-file/starter.zip/download");
  assert.equal(context.WPTeam.url("/api/sample-content/assets/asset-a"), "https://builder.example.test/api/teams/team-a/sample-content/assets/asset-a");
  context.sessionStorage.setItem("wpstarter.typographyDraft", "private draft"); assert.equal(storage.get("wpstarter.team.team-a.typographyDraft"), "private draft"); assert.equal(storage.has("wpstarter.typographyDraft"), false);
  context.sessionStorage.removeItem("wpstarter.typographyDraft"); assert.equal(storage.size, 0);
});
test("switching teams aborts pending requests, rejects stale responses and navigates to a clean document", async () => {
  let complete, signal;
  const { context, navigations } = transport("team-a", (_url, options) => { signal = options.signal; return new Promise(resolve => { complete = resolve; }); });
  const pending = context.fetch("/api/state");
  context.WPTeam.switchTo("team-b"); assert.equal(signal.aborted, true);
  complete({ status: 200 }); await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(navigations, ["https://builder.example.test/?team=team-b"]);
  await assert.rejects(context.fetch("/api/state"), { name: "AbortError" });
});
test("separate tabs use their own explicit team URL", async () => {
  const a = transport("team-a"), b = transport("team-b");
  await Promise.all([a.context.fetch("/api/state"), b.context.fetch("/api/state")]);
  assert.equal(new URL(a.calls[0].url).pathname, "/api/teams/team-a/state"); assert.equal(new URL(b.calls[0].url).pathname, "/api/teams/team-b/state");
});
