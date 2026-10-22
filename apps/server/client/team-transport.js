/* Loaded before the reused GUI scripts. Team scope is explicit and tab-local. */
(function () {
  "use strict";
  var teamId = new URL(window.location.href).searchParams.get("team");
  var nativeFetch = window.fetch.bind(window);
  var controllers = new Set();
  var leaving = false;
  // The shared editor persists a draft in sessionStorage; keep it private to its team.
  if (typeof Storage !== "undefined") ["getItem", "setItem", "removeItem"].forEach(function (method) {
    var original = Storage.prototype[method];
    Storage.prototype[method] = function (key, value) {
      var scoped = this === window.sessionStorage && key === "wpstarter.typographyDraft" ? "wpstarter.team." + teamId + ".typographyDraft" : key;
      return method === "setItem" ? original.call(this, scoped, value) : original.call(this, scoped);
    };
  });
  function teamUrl(input) {
    var url = new URL(input, window.location.href);
    if (url.origin !== window.location.origin) return input;
    if (url.pathname.indexOf("/download/") === 0) url.pathname = "/api/builds/by-file/" + url.pathname.slice("/download/".length) + "/download";
    if (url.pathname === "/api/auth/quota") url.pathname = "/api/quota";
    if (url.pathname.indexOf("/api/") === 0 && !/^\/api\/(auth|admin|teams)(\/|$)/.test(url.pathname)) {
      if (!teamId) throw new Error("Choose a team before using the library.");
      url.pathname = "/api/teams/" + encodeURIComponent(teamId) + url.pathname.slice(4);
    }
    return url.href;
  }
  window.WPTeam = {
    id: teamId,
    url: teamUrl,
    switchTo: function (id) {
      leaving = true;
      controllers.forEach(function (controller) { controller.abort(); });
      var url = new URL("/", window.location.origin);
      if (id) url.searchParams.set("team", id);
      window.location.assign(id ? url.href : "/teams.html");
    }
  };
  window.fetch = function (input, init) {
    if (leaving) return Promise.reject(new DOMException("Team changed", "AbortError"));
    var request = input instanceof Request ? input : null;
    var options = Object.assign({}, init || {});
    var url = teamUrl(request ? request.url : String(input));
    var controller = new AbortController();
    var signal = options.signal || (request && request.signal);
    var abort = function () { controller.abort(); };
    if (signal) { if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true }); }
    controllers.add(controller);
    options.signal = controller.signal;
    var method = String(options.method || (request && request.method) || "GET").toUpperCase();
    if (new URL(url).origin === window.location.origin && new URL(url).pathname.indexOf("/api/") === 0 && !["GET", "HEAD", "OPTIONS"].includes(method)) {
      options.headers = new Headers(options.headers || (request && request.headers) || {});
      var csrf = document.cookie.split(";").map(function (part) { return part.trim(); }).find(function (part) { return part.indexOf("wp_starter_csrf=") === 0; });
      if (csrf && !options.headers.has("X-CSRF-Token")) options.headers.set("X-CSRF-Token", decodeURIComponent(csrf.slice("wp_starter_csrf=".length)));
    }
    return nativeFetch(request ? new Request(url, request) : url, options).then(function (response) {
      if (leaving) throw new DOMException("Team changed", "AbortError");
      if (response.status === 401) window.location.replace("/login.html");
      return response;
    }).finally(function () { controllers.delete(controller); if (signal) signal.removeEventListener("abort", abort); });
  };
  // Images and download anchors are created by the shared GUI without fetch().
  function scopeLinks(root) {
    if (!teamId) return;
    root.querySelectorAll("a[href], img[src]").forEach(function (element) {
      var attribute = element.tagName === "A" ? "href" : "src";
      var value = element.getAttribute(attribute);
      if (value && (value.indexOf("/api/") === 0 || value.indexOf("/download/") === 0)) element.setAttribute(attribute, teamUrl(value));
    });
  }
  document.addEventListener("DOMContentLoaded", function () {
    scopeLinks(document);
    new MutationObserver(function () { scopeLinks(document); }).observe(document.body, { childList: true, subtree: true });
  });
})();
