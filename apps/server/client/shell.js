/*
 * Server overlay for the shared Builder UI.
 *
 * The Builder front end is reused unchanged; this script adds the parts that
 * only make sense for a multi-account deployment:
 *   1. a current-user panel with role, storage usage, admin link, and sign-out
 *   2. the session-bound CSRF header on every mutating API call
 *   3. owner badges and disabled controls for items another account created
 */
(function () {
  "use strict";

  var CSRF_COOKIE = "wp_starter_csrf";
  var MUTATING_SELECTOR = [
    ".remove-package",
    ".remove-font",
    ".edit-resource",
    ".delete-resource",
    ".delete-template",
    ".delete-config",
    ".edit-profile",
    ".delete-profile",
    ".delete-build",
    "[data-delete]",
    "[data-edit]",
    "[data-edit-term]",
    "[data-edit-global]",
    "[data-save-asset]"
  ].join(",");

  var ID_ATTRIBUTES = ["data-id", "data-edit", "data-edit-term", "data-edit-global", "data-save-asset"];

  var session = null;

  function readCookie(name) {
    var parts = String(document.cookie || "").split(";");
    for (var i = 0; i < parts.length; i += 1) {
      var pair = parts[i].trim();
      if (pair.indexOf(name + "=") === 0) return decodeURIComponent(pair.slice(name.length + 1));
    }
    return "";
  }

  function formatBytes(value) {
    var bytes = Number(value) || 0;
    if (bytes < 1024) return bytes + " B";
    var units = ["KiB", "MiB", "GiB", "TiB"];
    var index = -1;
    do {
      bytes /= 1024;
      index += 1;
    } while (bytes >= 1024 && index < units.length - 1);
    return (bytes >= 10 ? bytes.toFixed(0) : bytes.toFixed(1)) + " " + units[index];
  }

  /* --------------------------------------------------------------- transport */

  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var options = init ? Object.assign({}, init) : {};
    var method = String(options.method || "GET").toUpperCase();
    var isApi = url.indexOf("/api/") === 0 || url.indexOf(window.location.origin + "/api/") === 0;
    var mutating = isApi && method !== "GET" && method !== "HEAD" && method !== "OPTIONS";

    if (mutating) {
      options.headers = new Headers(options.headers || {});
      var token = readCookie(CSRF_COOKIE);
      if (token && !options.headers.has("X-CSRF-Token")) options.headers.set("X-CSRF-Token", token);
      if (!options.credentials) options.credentials = "same-origin";
    }

    return nativeFetch(input, options).then(function (response) {
      if (response.status === 401 && isApi) {
        window.location.replace("/login.html");
      }
      return response;
    });
  };

  /* ------------------------------------------------------------ account panel */

  function renderAccountPanel() {
    if (!session || !session.authenticated) return;
    var foot = document.querySelector(".sidebar-foot");
    if (!foot || document.getElementById("ws-account")) return;

    var user = session.user;
    var quota = session.quota || { usedBytes: 0, limitBytes: 1 };
    var percent = Math.min(100, Math.round((quota.usedBytes / Math.max(1, quota.limitBytes)) * 100));

    var panel = document.createElement("div");
    panel.className = "ws-account";
    panel.id = "ws-account";

    var row = document.createElement("div");
    row.className = "ws-account-row";

    var name = document.createElement("span");
    name.className = "ws-account-name";
    name.textContent = user.displayName || user.email;
    name.title = user.email;

    var badge = document.createElement("span");
    badge.className = "ws-role-badge ws-role-" + user.role;
    badge.textContent = user.role;

    row.appendChild(name);
    row.appendChild(badge);
    panel.appendChild(row);

    var quotaLabel = document.createElement("div");
    quotaLabel.className = "ws-quota";
    quotaLabel.textContent = formatBytes(quota.usedBytes) + " of " + formatBytes(quota.limitBytes) + " storage used";

    var bar = document.createElement("div");
    bar.className = "ws-quota-bar" + (percent >= 100 ? " ws-quota-full" : percent >= 80 ? " ws-quota-warn" : "");
    var fill = document.createElement("span");
    fill.style.width = percent + "%";
    bar.appendChild(fill);
    quotaLabel.appendChild(bar);
    panel.appendChild(quotaLabel);

    var actions = document.createElement("div");
    actions.className = "ws-account-actions";

    if (user.role === "admin") {
      var adminLink = document.createElement("a");
      adminLink.href = "/admin";
      adminLink.textContent = "Admin";
      actions.appendChild(adminLink);
    }

    var signOut = document.createElement("button");
    signOut.type = "button";
    signOut.textContent = "Sign out";
    signOut.addEventListener("click", function () {
      signOut.disabled = true;
      fetch("/api/auth/logout", { method: "POST" }).then(function () {
        window.location.replace("/login.html");
      });
    });
    actions.appendChild(signOut);

    panel.appendChild(actions);
    foot.appendChild(panel);
  }

  /* ------------------------------------------------------- ownership marking */

  function currentState() {
    try {
      return typeof state !== "undefined" && state ? state : null;
    } catch (error) {
      return null;
    }
  }

  function buildIndex() {
    var index = {};
    var data = currentState();
    if (!data) return index;

    function put(key, item) {
      if (key && item && !index[key]) index[key] = item;
    }

    (data.packages || []).forEach(function (item) {
      put("id:" + item.id, item);
      put("pkg:" + [item.kind, item.slug, item.version, item.variant || ""].join(":"), item);
      put("pkg:" + [item.kind, item.slug, item.version].join(":"), item);
    });
    (data.configs || []).forEach(function (item) {
      put("id:" + item.id, item);
    });
    (data.profiles || []).forEach(function (item) {
      put("file:" + item.file, item);
    });
    (data.fonts || []).forEach(function (item) {
      put("id:" + item.id, item);
    });
    ["typography", "colors", "designSystems", "templates"].forEach(function (kind) {
      (((data.vnext || {})[kind]) || []).forEach(function (item) {
        put("id:" + item.id, item);
      });
    });
    (data.elementorTemplates || []).forEach(function (item) {
      put("id:" + item.id, item);
    });
    (data.builds || []).forEach(function (item) {
      put("id:" + item.id, item);
      put("file:" + item.file, item);
    });
    ["content", "terms", "attributes", "assets"].forEach(function (kind) {
      (((data.sampleContent || {})[kind]) || []).forEach(function (item) {
        put("id:" + item.id, item);
      });
    });

    return index;
  }

  function lookup(control, index) {
    for (var i = 0; i < ID_ATTRIBUTES.length; i += 1) {
      var id = control.getAttribute(ID_ATTRIBUTES[i]);
      if (id && index["id:" + id]) return index["id:" + id];
    }

    var file = control.getAttribute("data-file");
    if (file && index["file:" + file]) return index["file:" + file];

    var slug = control.getAttribute("data-slug");
    if (slug) {
      var full = "pkg:" + [control.getAttribute("data-kind") || "", slug, control.getAttribute("data-version") || "", control.getAttribute("data-variant") || ""].join(":");
      if (index[full]) return index[full];
      var loose = "pkg:" + [control.getAttribute("data-kind") || "", slug, control.getAttribute("data-version") || ""].join(":");
      if (index[loose]) return index[loose];
    }

    return null;
  }

  function containerOf(control) {
    return (
      control.closest("tr, .card, .profile-card, .sample-card, li, .ws-panel") ||
      control.parentElement ||
      control
    );
  }

  function ownerLabel(record) {
    if (record.createdBy === null || record.createdBy === undefined) return "Unowned";
    return "Shared by " + (record.ownerName || "another account");
  }

  function applyBadge(container, record) {
    if (!container || container.querySelector(".ws-shared-badge")) return;
    var readOnly = record.canEdit === false;
    var badge = document.createElement("span");
    badge.className = "ws-shared-badge" + (readOnly ? " ws-readonly-badge" : "");
    badge.textContent = readOnly ? ownerLabel(record) + " · read-only" : ownerLabel(record) + " · admin managed";
    container.appendChild(badge);
  }

  function markReadOnly(control, record) {
    if (control.dataset.wsReadonly === "1") return;
    control.dataset.wsReadonly = "1";
    control.classList.add("ws-control-readonly");
    control.setAttribute("aria-disabled", "true");
    control.title = "Read-only: " + ownerLabel(record) + ".";
    control.addEventListener(
      "click",
      function (event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (typeof flash === "function") flash("Read-only: " + ownerLabel(record) + ".", true);
      },
      true
    );
    if (control.tagName === "BUTTON") control.disabled = true;
  }

  function annotate() {
    var index = buildIndex();
    if (!Object.keys(index).length) return;

    var controls = document.querySelectorAll(MUTATING_SELECTOR);
    var readOnlyCount = 0;

    Array.prototype.forEach.call(controls, function (control) {
      var record = lookup(control, index);
      if (!record) return;

      if (record.canEdit === false) {
        readOnlyCount += 1;
        markReadOnly(control, record);
        applyBadge(containerOf(control), record);
        return;
      }

      if (!record.ownedByCurrentUser) applyBadge(containerOf(control), record);
    });

    updateReadOnlyNote(readOnlyCount);
  }

  function updateReadOnlyNote(count) {
    var view = document.querySelector(".view.active");
    var existing = document.getElementById("ws-readonly-note");

    if (!count || !view) {
      if (existing) existing.remove();
      return;
    }
    if (existing && existing.parentElement === view) return;
    if (existing) existing.remove();

    var note = document.createElement("p");
    note.className = "ws-readonly-note";
    note.id = "ws-readonly-note";
    note.textContent =
      count +
      " item" +
      (count === 1 ? "" : "s") +
      " on this page belong to another account. You can read, use, and duplicate them, but only their owner can change or delete them.";
    view.insertBefore(note, view.firstChild);
  }

  /* ------------------------------------------------------------------ wiring */

  function afterRender() {
    renderAccountPanel();
    annotate();
  }

  function wrapRefresh() {
    if (typeof window.refresh !== "function" || window.refresh.__wsWrapped) return;
    var original = window.refresh;
    window.refresh = function () {
      return Promise.resolve(original.apply(this, arguments)).then(function (value) {
        afterRender();
        return value;
      });
    };
    window.refresh.__wsWrapped = true;
  }

  function boot() {
    wrapRefresh();

    fetch("/api/auth/session")
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        session = data;
        if (!session || !session.authenticated) {
          window.location.replace("/login.html");
          return;
        }
        return fetch("/api/auth/quota")
          .then(function (response) {
            return response.ok ? response.json() : null;
          })
          .catch(function () {
            return null;
          })
          .then(function (quota) {
            if (quota) session.quota = quota;
            afterRender();
            // `refresh()` runs once on load; annotate again afterwards.
            setTimeout(afterRender, 250);
          });
      })
      .catch(function () {
        /* Leave the page as-is; API calls will redirect on 401. */
      });

    var main = document.querySelector("main");
    if (main && typeof MutationObserver === "function") {
      var pending = false;
      new MutationObserver(function () {
        if (pending) return;
        pending = true;
        setTimeout(function () {
          pending = false;
          annotate();
        }, 120);
      }).observe(main, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
