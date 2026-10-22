import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../client/plugin-updates.js", import.meta.url), "utf8");
async function ui(role) {
  const nodes = [];
  function node(tag) {
    const item = { tag, children: [], handlers: {}, style: {},
      appendChild(child) { this.children.push(child); return child; },
      replaceChildren() { this.children = []; },
      setAttribute(key, value) { this[key] = value; },
      addEventListener(key, fn) { this.handlers[key] = fn; },
      querySelectorAll(selector) { return this.children.flatMap(child => [...(child.tag === "input" && child.checked && selector === "input:checked" ? [child] : []), ...child.querySelectorAll(selector)]); }
    };
    nodes.push(item); return item;
  }
  const target = node("section"), calls = [], intervals = [];
  const data = { enabled: false, paused: false, lastCheck: null, running: false, plugins: [{ slug: "alpha", confirmed: false }], results: [] };
  let saveOK = true;
  const context = { document: { getElementById: () => target, createElement: node, createTextNode: text => Object.assign(node("text"), { textContent: text }) },
    window: { WPTeam: { id: "team" } },
    setInterval(fn) { intervals.push(fn); },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/auth/session") return { json: async () => ({ teams: [{ id: "team", role }] }) };
      if (options?.method === "PUT") {
        if (!saveOK) return { ok: false };
        const saved = JSON.parse(options.body); data.enabled = saved.enabled; data.plugins[0].confirmed = saved.slugs.includes("alpha");
      }
      return { ok: true, json: async () => structuredClone(data) };
    }
  };
  vm.runInNewContext(source, context);
  await new Promise(setImmediate);
  return { nodes, data, calls, intervals, failSave() { saveOK = false; } };
}

test("plugin update controls preserve unsaved selections during polling and submit the team policy", async () => {
  const { nodes, calls, intervals } = await ui("owner");
  const form = nodes.find(item => item.tag === "form");
  const button = nodes.find(item => item.tag === "button");
  const inputs = nodes.filter(item => item.tag === "input");
  assert.equal(button.disabled, false);
  assert.equal(inputs[1].disabled, false);
  inputs[0].checked = inputs[1].checked = true;
  form.handlers.change();
  const before = calls.length;
  await intervals[0](); await new Promise(setImmediate);
  assert.equal(calls.length, before, "polling does not overwrite a dirty form");
  await form.handlers.submit({ preventDefault() {} });
  const saved = calls.find(call => call.options?.method === "PUT");
  assert.deepEqual(JSON.parse(saved.options.body), { enabled: true, slugs: ["alpha"] });
  assert.equal(button.disabled, false);
});

test("editors and viewers can read status but cannot edit the update policy", async () => {
  for (const role of ["editor", "viewer"]) {
    const { nodes } = await ui(role);
    assert.equal(nodes.find(item => item.tag === "button").disabled, true);
    assert.ok(nodes.filter(item => item.tag === "input").every(input => input.disabled));
  }
});

test("failed saves keep the form retryable and display an accessible error", async () => {
  const view = await ui("admin");
  view.failSave();
  const form = view.nodes.find(item => item.tag === "form");
  await form.handlers.submit({ preventDefault() {} });
  assert.equal(view.nodes.find(item => item.tag === "button").disabled, false);
  assert.match(view.nodes.find(item => item.role === "status").textContent, /Could not save/);
});
