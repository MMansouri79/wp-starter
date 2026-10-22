(function () {
  "use strict";
  var panel, form, enabled, list, status, save, lastCheck, sourceKey, formVersion = 0, manager = false, busy = false, loading = false;
  function element(tag, text, parent) {
    var node = document.createElement(tag);
    if (text) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }
  async function load() {
    if (busy || loading) return;
    loading = true;
    var version = formVersion;
    try {
      var response = await fetch("/api/plugin-updates");
      if (!response.ok) throw new Error("Could not load plugin update settings.");
      var data = await response.json();
      if (busy || version !== formVersion) return;
      enabled.checked = data.enabled;
      var nextSourceKey = JSON.stringify(data.plugins);
      if (sourceKey !== nextSourceKey) {
        list.replaceChildren();
        element("legend", "Confirmed WordPress.org plugins", list);
        data.plugins.forEach(function (plugin) {
          var row = element("label", "", list);
          var check = element("input", "", row);
          check.type = "checkbox";
          check.value = plugin.slug;
          check.checked = plugin.confirmed;
          check.disabled = !manager;
          row.appendChild(document.createTextNode(" " + plugin.slug + " — " + (plugin.confirmed ? "WordPress.org source confirmed" : "Unconfirmed; skipped")));
        });
        sourceKey = nextSourceKey;
      }
      status.replaceChildren();
      if (data.paused) element("p", "Automatic updates are paused because the authorizing manager no longer has access. A current team owner or administrator can save these settings to resume.", status);
      element("p", data.running ? "Checking for updates…" : data.lastCheck ? "Last checked: " + new Date(data.lastCheck).toLocaleString() : "No update check yet.", status);
      data.results.forEach(function (result) {
        element("p", result.slug + ": " + (result.status === "added" ? "Downloaded " + result.version : result.status === "current" ? "Already current" : result.status === "skipped" ? "Skipped: its version cannot be compared automatically." : "Update failed (" + result.code + "). Will retry at the next check."), status);
      });
      if (lastCheck !== data.lastCheck && data.results.some(function (result) { return result.status === "added"; }) && typeof window.refresh === "function") await window.refresh();
      lastCheck = data.lastCheck;
    } finally { loading = false; }
  }
  async function boot() {
    var target = document.getElementById("view-packages");
    if (!target) return;
    panel = element("div", "", target);
    panel.className = "panel ws-plugin-updates";
    element("h2", "Automatic plugin updates", panel);
    element("p", "Download new WordPress.org releases into this team’s library every 12 hours while the server runs. Enabling starts a check on the next background pass. Existing profiles keep their selected versions. Premium and private plugins are excluded.", panel);
    form = element("form", "", panel);
    var label = element("label", "", form);
    enabled = element("input", "", label);
    enabled.type = "checkbox";
    label.appendChild(document.createTextNode(" Automatically update plugins from WordPress.org"));
    element("p", "Confirm only plugins obtained from WordPress.org. A matching plugin name alone does not confirm its source.", form);
    list = element("fieldset", "", form);
    save = element("button", "Save update settings", form);
    save.type = "submit";
    enabled.disabled = save.disabled = true;
    status = element("div", "", panel);
    status.setAttribute("role", "status");
    var session = await (await fetch("/api/auth/session")).json();
    var team = (session.teams || []).find(function (item) { return window.WPTeam && item.id === window.WPTeam.id; });
    manager = !!team && (team.role === "owner" || team.role === "admin");
    enabled.disabled = save.disabled = !manager;
    if (!manager) element("p", "A team owner or administrator can change these settings.", form);
    form.addEventListener("change", function () { busy = true; formVersion++; });
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      formVersion++;
      busy = true;
      save.disabled = true;
      enabled.disabled = list.disabled = true;
      try {
        var slugs = Array.from(list.querySelectorAll("input:checked")).map(function (input) { return input.value; });
        var response = await fetch("/api/plugin-updates", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: enabled.checked, slugs: slugs }) });
        if (!response.ok) throw new Error("Could not save settings. Check your team permissions and try again.");
        busy = false;
        await load();
        element("p", "Settings saved.", status);
      } catch (error) { status.textContent = error.message; }
      finally { enabled.disabled = list.disabled = save.disabled = !manager; }
    });
    await load();
    setInterval(function () { load().catch(function () { status.textContent = "Could not refresh update status."; }); }, 15_000);
  }
  boot().catch(function () { if (status) status.textContent = "Could not load plugin update settings. Reload to retry."; });
})();
