const $ = (s) => document.querySelector(s);
let state = null;
let currentReport = null;
let currentEditingProfileFile = "";
const titles = {
  overview: ["Overview", "Your local WordPress starter workspace."],
  packages: ["Packages", "Manage versioned WordPress, theme, and plugin ZIPs."],
  configs: ["Configurations", "Reference-site exports and their package requirements."],
  profiles: ["Profiles", "Manage reusable, version-pinned build profiles."],
  build: ["Build", "Choose exact package versions and generate a complete offline WordPress ZIP."],
  builds: ["Build History", "Review, download, rebuild, or remove generated distributions."]
};

function flash(message, error = false) {
  const el = $("#flash");
  el.textContent = message;
  el.className = `flash${error ? " error" : ""}`;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => el.classList.add("hidden"), 5500);
}
async function request(url, options = {}) {
  const res = await fetch(url, options);
  let data;
  try { data = await res.json(); } catch { data = { message: await res.text() }; }
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}
function fmtBytes(n) { if (n < 1024) return `${n} B`; if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`; return `${(n / 1024 ** 2).toFixed(1)} MB`; }
function esc(s) { return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[m])); }
function escAttr(s) { return esc(s); }
function safeUiName(s) { return String(s).replace(/^snapshot-/, "starter-").replace(/[^A-Za-z0-9._-]+/g, "-"); }
function compareVersions(a, b) { return String(b).localeCompare(String(a), undefined, { numeric: true, sensitivity: "base" }); }
function packageVariant(p) { return p.variant || p.locale || (p.kind === "wordpress" ? "en_US" : "default"); }
function displayName(records) { const ascii = records.find(r => /^[\x20-\x7E]+$/.test(r.name || "")); return (ascii || records[records.length - 1] || records[0]).name; }
function groups(kind = null) {
  const map = new Map();
  for (const p of state.packages.filter(p => !kind || p.kind === kind)) {
    const key = `${p.kind}:${p.slug}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  return [...map.values()].map(rs => rs.sort((a, b) => compareVersions(a.version, b.version) || packageVariant(a).localeCompare(packageVariant(b))));
}

async function refresh() { state = await request("/api/state"); render(); }

function renderPackages() {
  const html = groups().map(records => {
    const p = records[0];
    const versions = records.map(r => {
      const label = r.kind === "wordpress" ? `${r.version} · ${packageVariant(r)}` : r.version;
      return `<span class="version-pill">${esc(label)}</span>`;
    }).join("");
    const actions = records.map(r => {
      const label = r.kind === "wordpress" ? `${r.version} ${packageVariant(r)}` : r.version;
      return `<button class="tiny danger remove-package" data-kind="${escAttr(r.kind)}" data-slug="${escAttr(r.slug)}" data-version="${escAttr(r.version)}" data-variant="${escAttr(r.kind === "wordpress" ? packageVariant(r) : "")}" title="Remove ${escAttr(label)}">Remove ${esc(label)}</button>`;
    }).join("");
    return `<tr><td><span class="badge ${p.kind}">${p.kind}</span></td><td>${esc(displayName(records))}</td><td><code>${esc(p.slug)}</code></td><td><div class="version-list">${versions}</div></td><td><div class="action-list">${actions}</div></td></tr>`;
  }).join("");
  $("#packages-body").innerHTML = html || `<tr><td colspan="5" class="empty">No packages yet.</td></tr>`;
  document.querySelectorAll(".remove-package").forEach(btn => btn.onclick = () => removePackage(btn));
}

function render() {
  const previousConfig = $("#build-config")?.value ?? "";
  const previousProfile = $("#profile-select")?.value ?? "";
  $("#version").textContent = `GUI ${state.version}`;
  $("#library").textContent = state.library;
  $("#stat-packages").textContent = state.packages.length;
  $("#stat-configs").textContent = state.configs.length;
  $("#stat-profiles").textContent = state.profiles.length;
  $("#stat-builds").textContent = state.builds.length;
  renderPackages();

  $("#configs-list").innerHTML = state.configs.map(c => `<div class="card"><div><strong>${esc(c.name)}</strong><small>${esc(c.id)} · WP ${esc(c.wordpressVersion)} · ${esc(c.locale)} · ${esc(c.theme.slug)}@${esc(c.theme.version)} · ${c.plugins.length} plugins</small></div><button class="secondary check-config" data-id="${escAttr(c.id)}">Check packages</button></div>`).join("") || `<div class="empty">No configuration snapshots yet. You can still create package-only builds.</div>`;

  const configOpts = [`<option value="">No snapshot — packages only</option>`, ...state.configs.map(c => `<option value="${escAttr(c.id)}">${esc(c.name)} (${esc(c.id)})</option>`)].join("");
  $("#build-config").innerHTML = configOpts;
  if (["", ...state.configs.map(c => c.id)].includes(previousConfig)) $("#build-config").value = previousConfig;

  const profileOpts = state.profiles.map(p => `<option value="${escAttr(p.file)}">${esc(p.name)} · ${esc(p.locale)} · ${p.plugins} plugins</option>`).join("");
  $("#profile-select").innerHTML = profileOpts || `<option value="">No profiles created</option>`;
  if (state.profiles.some(p => p.file === previousProfile)) $("#profile-select").value = previousProfile;

  $("#profiles-manager").innerHTML = state.profiles.map(p => `<div class="profile-card"><div class="profile-main"><strong>${esc(p.name)}</strong><small>${esc(p.locale)} · WP ${esc(p.wordpress)} · ${esc(p.theme)} · ${p.plugins} plugins</small><small>${p.config ? `Snapshot: ${esc(p.config)}` : "Packages only"}${p.updatedAt ? ` · Updated ${new Date(p.updatedAt).toLocaleString()}` : ""}</small></div><div class="profile-card-actions"><button class="tiny edit-profile" data-file="${escAttr(p.file)}">Edit</button><button class="tiny duplicate-profile" data-file="${escAttr(p.file)}">Duplicate</button><button class="tiny primary-ish build-profile-now" data-file="${escAttr(p.file)}">Build</button><button class="tiny danger delete-profile" data-file="${escAttr(p.file)}">Delete</button></div></div>`).join("") || `<div class="empty">No profiles yet. Create one from the Build page.</div>`;

  const buildCard = (b, compact = false) => `<div class="build-card"><div><strong>${esc(b.file)}</strong><small>${b.profile ? `Profile: ${esc(b.profile)} · ` : ""}${b.locale ? `${esc(b.locale)} · ` : ""}${b.configurationEnabled ? "Snapshot" : "Packages only"} · ${fmtBytes(b.size)} · ${new Date(b.modifiedAt).toLocaleString()}</small>${!compact && b.sha256 ? `<code class="hash">${esc(b.sha256)}</code>` : ""}</div><div class="build-card-actions"><a class="tiny primary-ish" href="/download/${encodeURIComponent(b.file)}">Download</a>${b.profileFile ? `<button class="tiny rebuild" data-profile="${escAttr(b.profileFile)}">Build again</button>` : ""}${compact ? "" : `<button class="tiny danger delete-build" data-file="${escAttr(b.file)}">Delete</button>`}</div></div>`;
  $("#recent-builds").innerHTML = state.builds.slice(0, 5).map(b => buildCard(b, true)).join("") || `<div class="empty">No builds yet.</div>`;
  $("#build-history").innerHTML = state.builds.map(b => buildCard(b, false)).join("") || `<div class="empty">No builds yet.</div>`;

  document.querySelectorAll(".check-config").forEach(btn => btn.onclick = () => checkConfig(btn.dataset.id));
  document.querySelectorAll(".edit-profile").forEach(btn => btn.onclick = () => loadProfileIntoEditor(btn.dataset.file, false));
  document.querySelectorAll(".duplicate-profile").forEach(btn => btn.onclick = () => loadProfileIntoEditor(btn.dataset.file, true));
  document.querySelectorAll(".delete-profile").forEach(btn => btn.onclick = () => deleteProfile(btn.dataset.file));
  document.querySelectorAll(".build-profile-now").forEach(btn => btn.onclick = () => buildProfileFile(btn.dataset.file));
  document.querySelectorAll(".rebuild").forEach(btn => btn.onclick = () => buildProfileFile(btn.dataset.profile));
  document.querySelectorAll(".delete-build").forEach(btn => btn.onclick = () => deleteBuild(btn.dataset.file));
  loadBuildSelection($("#build-config").value);
}

async function uploadFiles(files, kind) {
  for (const file of files) {
    flash(`Importing ${file.name}…`);
    await request(`/api/${kind}?filename=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: file });
  }
  flash(`${files.length} file${files.length === 1 ? "" : "s"} imported.`);
  await refresh();
}
async function removePackage(btn) {
  const label = `${btn.dataset.slug}@${btn.dataset.version}${btn.dataset.variant ? ` (${btn.dataset.variant})` : ""}`;
  if (!confirm(`Remove ${label} from the local package library? Existing profiles pinned to it will stop resolving.`)) return;
  try {
    const q = new URLSearchParams({ kind: btn.dataset.kind, slug: btn.dataset.slug, version: btn.dataset.version });
    if (btn.dataset.variant) q.set("variant", btn.dataset.variant);
    await request(`/api/packages?${q}`, { method: "DELETE" });
    flash(`Removed ${label}.`);
    await refresh();
  } catch (e) { flash(e.message, true); }
}
async function checkConfig(id) {
  try {
    const r = await request(`/api/configs/${encodeURIComponent(id)}/check`);
    const missing = r.requirements.filter(x => x.status === "missing");
    flash(missing.length ? `${r.available} exact reference packages available, ${r.missing} missing: ${missing.map(x => `${x.slug}@${x.version}${x.variant ? ` (${x.variant})` : ""}`).join(", ")}` : `All ${r.available} exact reference packages are available.`, missing.length > 0);
  } catch (e) { flash(e.message, true); }
}

function wordpressPackages() { return state.packages.filter(p => p.kind === "wordpress").sort((a, b) => compareVersions(a.version, b.version) || packageVariant(a).localeCompare(packageVariant(b))); }
function themePackages(slug = null) { return state.packages.filter(p => p.kind === "theme" && (!slug || p.slug === slug)).sort((a, b) => a.slug.localeCompare(b.slug) || compareVersions(a.version, b.version)); }
function pluginPackages(slug) { return state.packages.filter(p => p.kind === "plugin" && p.slug === slug).sort((a, b) => compareVersions(a.version, b.version)); }
function coordinateValue(p) { return JSON.stringify({ version: p.version, variant: packageVariant(p) }); }
function themeCoordinateValue(p) { return JSON.stringify({ slug: p.slug, version: p.version }); }
function decodeCoordinate(value) { try { return JSON.parse(value); } catch { return { version: value, variant: "" }; } }
function decodeTheme(value) { try { return value ? JSON.parse(value) : { slug: "", version: "" }; } catch { return { slug: "", version: value }; } }

function renderWordPressOptions(config = null) {
  const packages = wordpressPackages();
  $("#build-wordpress").innerHTML = packages.map(p => `<option value="${escAttr(coordinateValue(p))}">${esc(p.version)} · ${esc(packageVariant(p))}</option>`).join("") || `<option value="">No WordPress packages</option>`;
  const locale = $("#build-locale").value.trim() || config?.locale || "en_US";
  const preferred = config
    ? packages.find(p => p.version === config.wordpressVersion && packageVariant(p) === locale) || packages.find(p => p.version === config.wordpressVersion && packageVariant(p) === "en_US") || packages.find(p => p.version === config.wordpressVersion) || packages[0]
    : packages.find(p => packageVariant(p) === locale) || packages.find(p => packageVariant(p) === "en_US") || packages[0];
  if (preferred) $("#build-wordpress").value = coordinateValue(preferred);
}

function renderThemeOptions(config = null) {
  const packages = config ? themePackages(config.theme.slug) : themePackages();
  const opts = [
    ...(config ? [] : [`<option value="">Use WordPress default theme</option>`]),
    ...packages.map(p => `<option value="${escAttr(themeCoordinateValue(p))}">${esc(p.name)} · ${esc(p.version)}</option>`)
  ].join("");
  $("#build-theme").innerHTML = opts || `<option value="">No theme packages</option>`;
  if (config) {
    const preferred = packages.find(p => p.version === config.theme.version) || packages[0];
    if (preferred) $("#build-theme").value = themeCoordinateValue(preferred);
  }
}

function pluginChoice(plugin, checked) {
  const available = pluginPackages(plugin.slug);
  const preferred = available.find(p => p.version === plugin.version) || available[0];
  const opts = available.map(p => `<option value="${escAttr(p.version)}" ${preferred && p.version === preferred.version ? "selected" : ""}>${esc(p.version)}</option>`).join("");
  return `<label class="check package-choice"><input type="checkbox" value="${escAttr(plugin.slug)}" ${checked && available.length ? "checked" : ""} ${available.length ? "" : "disabled"}><span class="plugin-name">${esc(plugin.name)}</span><select class="plugin-version" data-slug="${escAttr(plugin.slug)}" ${available.length ? "" : "disabled"}>${opts || `<option>Missing</option>`}</select><span class="meta ${available.length ? "status-ok" : "status-missing"}">${available.length ? `${available.length} version${available.length === 1 ? "" : "s"}` : "missing"}</span></label>`;
}

async function loadBuildSelection(id) {
  try {
    const config = id ? state.configs.find(c => c.id === id) : null;
    currentReport = id ? await request(`/api/configs/${encodeURIComponent(id)}/check`) : null;
    if (!$("#build-name").dataset.changed) $("#build-name").value = config ? safeUiName(config.id) : "package-only";
    if (!$("#build-locale").dataset.changed) $("#build-locale").value = config?.locale || "en_US";
    renderWordPressOptions(config);
    renderThemeOptions(config);

    if (config) {
      $("#build-plugins").innerHTML = config.plugins.map(plugin => pluginChoice(plugin, true)).join("") || `<span class="muted">No plugins in this snapshot.</span>`;
    } else {
      const availablePlugins = groups("plugin").map(records => ({ slug: records[0].slug, name: displayName(records), version: records[0].version }));
      $("#build-plugins").innerHTML = availablePlugins.map(plugin => pluginChoice(plugin, false)).join("") || `<span class="muted">No plugin packages in the library.</span>`;
    }
  } catch (e) { flash(e.message, true); }
}

function selectWordPressForLocale() {
  const config = state.configs.find(c => c.id === $("#build-config").value) || null;
  const locale = $("#build-locale").value.trim();
  const packages = wordpressPackages();
  const preferred = config
    ? packages.find(p => p.version === config.wordpressVersion && packageVariant(p) === locale) || packages.find(p => packageVariant(p) === locale)
    : packages.find(p => packageVariant(p) === locale);
  if (preferred) $("#build-wordpress").value = coordinateValue(preferred);
}

async function createProfile() {
  const configId = $("#build-config").value;
  const included = [...document.querySelectorAll("#build-plugins input:checked")].map(x => x.value);
  const config = state.configs.find(c => c.id === configId) || null;
  const all = (config?.plugins || []).map(p => p.slug);
  const excluded = all.filter(x => !included.includes(x));
  const pluginVersions = {};
  document.querySelectorAll("#build-plugins .plugin-version").forEach(select => { if (included.includes(select.dataset.slug)) pluginVersions[select.dataset.slug] = select.value; });
  const wp = decodeCoordinate($("#build-wordpress").value);
  const theme = decodeTheme($("#build-theme").value);
  const body = {
    configId,
    name: $("#build-name").value.trim() || "starter",
    locale: $("#build-locale").value.trim() || "en_US",
    excludedPlugins: excluded,
    wordpressVersion: wp.version,
    wordpressVariant: wp.variant,
    themeSlug: theme.slug,
    themeVersion: theme.version,
    pluginVersions,
    sourceFile: currentEditingProfileFile
  };
  try {
    setBusy(true);
    const data = await request("/api/profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    flash(`Profile ${data.profile.name} saved${configId ? "." : " without a configuration snapshot."}`);
    currentEditingProfileFile = "";
    $("#cancel-profile-edit").classList.add("hidden");
    $("#create-profile").textContent = "Save Profile";
    await refresh();
    $("#profile-select").value = data.file;
  } catch (e) { flash(e.message, true); } finally { setBusy(false); }
}

function goView(view) {
  document.querySelectorAll(".nav").forEach(x => x.classList.toggle("active", x.dataset.view === view));
  document.querySelectorAll(".view").forEach(x => x.classList.toggle("active", x.id === `view-${view}`));
  $("#title").textContent = titles[view][0];
  $("#subtitle").textContent = titles[view][1];
}

async function loadProfileIntoEditor(file, duplicate = false) {
  try {
    const data = await request(`/api/profiles/${encodeURIComponent(file)}`);
    const profile = data.profile;
    currentEditingProfileFile = duplicate ? "" : file;
    $("#build-config").value = profile.config?.id || "";
    $("#build-name").dataset.changed = "1";
    $("#build-locale").dataset.changed = "1";
    $("#build-name").value = duplicate ? `${profile.name}-copy` : profile.name;
    $("#build-locale").value = profile.locale || "en_US";
    await loadBuildSelection(profile.config?.id || "");

    const wpValue = JSON.stringify({ version: profile.wordpress.version, variant: profile.wordpress.variant || "en_US" });
    if ([...$("#build-wordpress").options].some(o => o.value === wpValue)) $("#build-wordpress").value = wpValue;
    const themeValue = profile.theme ? JSON.stringify({ slug: profile.theme.slug, version: profile.theme.version }) : "";
    if ([...$("#build-theme").options].some(o => o.value === themeValue)) $("#build-theme").value = themeValue;

    const selected = new Map((profile.plugins || []).map(p => [p.slug, p.version]));
    document.querySelectorAll("#build-plugins .package-choice").forEach(row => {
      const input = row.querySelector('input[type="checkbox"]');
      const select = row.querySelector(".plugin-version");
      const version = selected.get(input.value);
      input.checked = !!version;
      if (version && [...select.options].some(o => o.value === version)) select.value = version;
    });

    $("#cancel-profile-edit").classList.toggle("hidden", duplicate);
    $("#create-profile").textContent = duplicate ? "Save Copy" : "Save Changes";
    goView("build");
    flash(duplicate ? `Duplicating ${profile.name}. Choose a new name and save.` : `Editing ${profile.name}.`);
  } catch (e) { flash(e.message, true); }
}

function resetProfileEditor() {
  currentEditingProfileFile = "";
  $("#build-name").dataset.changed = "";
  $("#build-locale").dataset.changed = "";
  $("#build-config").value = "";
  $("#cancel-profile-edit").classList.add("hidden");
  $("#create-profile").textContent = "Save Profile";
  loadBuildSelection("");
}

async function deleteProfile(file) {
  const profile = state.profiles.find(p => p.file === file);
  if (!confirm(`Delete profile ${profile?.name || file}? Generated build ZIPs will not be deleted.`)) return;
  try {
    await request(`/api/profiles/${encodeURIComponent(file)}`, { method: "DELETE" });
    if (currentEditingProfileFile === file) resetProfileEditor();
    flash(`Deleted ${profile?.name || file}.`);
    await refresh();
  } catch (e) { flash(e.message, true); }
}

async function deleteBuild(file) {
  if (!confirm(`Delete generated build ${file}?`)) return;
  try {
    await request(`/api/builds?file=${encodeURIComponent(file)}`, { method: "DELETE" });
    flash(`Deleted ${file}.`);
    await refresh();
  } catch (e) { flash(e.message, true); }
}

async function buildProfileFile(file) {
  if (!state.profiles.some(p => p.file === file)) return flash("That profile no longer exists.", true);
  goView("build");
  $("#profile-select").value = file;
  await build();
}

function showBuildProgress(percent, message, status = "running", detail = "") {
  const box = $("#build-progress");
  box.classList.remove("hidden", "failed", "complete");
  if (status === "failed") box.classList.add("failed");
  if (status === "complete") box.classList.add("complete");
  const bounded = Math.max(0, Math.min(100, Number(percent) || 0));
  $("#build-progress-bar").style.width = `${bounded}%`;
  $("#build-progress-percent").textContent = `${Math.round(bounded)}%`;
  $("#build-progress-label").textContent = message || "Building…";
  $("#build-progress-detail").textContent = detail || (status === "running" ? "The Builder is working locally. You can keep this window open." : "");
}

async function pollBuildJob(id) {
  while (true) {
    const job = await request(`/api/build-jobs/${encodeURIComponent(id)}`);
    const detail = job.total ? `${job.current || 0} of ${job.total}` : job.stage;
    showBuildProgress(job.percent, job.message, job.status, detail);
    if (job.status === "complete") return job.result;
    if (job.status === "failed") throw new Error(job.error?.message || job.message || "Build failed.");
    await new Promise(resolve => setTimeout(resolve, 350));
  }
}

async function build() {
  const profileFile = $("#profile-select").value;
  if (!profileFile) return flash("Create a profile first.", true);
  try {
    $("#build-button").disabled = true;
    $("#build-result").classList.add("hidden");
    showBuildProgress(0, "Starting build…");
    const started = await request("/api/build-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileFile }) });
    const data = await pollBuildJob(started.id);
    const r = $("#build-result");
    r.innerHTML = `<strong>Build complete</strong><br>${esc(data.file)}<br><small>SHA-256: ${esc(data.sha256)}</small><br><br><a href="${data.download}">Download build ZIP</a>`;
    r.classList.remove("hidden");
    flash("Build completed successfully.");
    await refresh();
    showBuildProgress(100, "Build complete.", "complete", data.file);
  } catch (e) {
    showBuildProgress(Number($("#build-progress-percent").textContent.replace("%", "")) || 0, e.message, "failed", "Check the error and try again.");
    flash(e.message, true);
  } finally {
    $("#build-button").disabled = false;
  }
}
function setBusy(on) { document.body.classList.toggle("busy", on); }

document.querySelectorAll(".nav").forEach(btn => btn.onclick = () => goView(btn.dataset.view));
$("#refresh").onclick = () => refresh().catch(e => flash(e.message, true));
$("#package-file").onchange = e => uploadFiles([...e.target.files], "packages").catch(e => flash(e.message, true));
$("#config-file").onchange = e => uploadFiles([...e.target.files], "configs").catch(e => flash(e.message, true));
const dz = $("#package-drop");
["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", e => uploadFiles([...e.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith(".zip")), "packages").catch(e => flash(e.message, true)));
$("#build-config").onchange = e => loadBuildSelection(e.target.value);
$("#build-name").oninput = e => e.target.dataset.changed = "1";
$("#build-locale").oninput = e => { e.target.dataset.changed = "1"; selectWordPressForLocale(); };
$("#create-profile").onclick = createProfile;
$("#cancel-profile-edit").onclick = resetProfileEditor;
$("#new-profile").onclick = () => { resetProfileEditor(); goView("build"); };
$("#build-button").onclick = build;
refresh().catch(e => flash(e.message, true));
