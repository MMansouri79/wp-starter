const $ = (s) => document.querySelector(s);
let state = null;
let currentReport = null;
let currentEditingProfileFile = "";
let currentElementorSelection = null;
let currentElementorRoots = null;
let typographyDraft = null;
let activeTypeDevice = "desktop";
let colorDraft = null;
let bindingDraft = {};
let templateMappingDraft = {};
const titles = {
  overview: ["Overview", "Your local WordPress starter workspace."],
  packages: ["Packages", "Manage versioned WordPress, theme, and plugin ZIPs."],
  fonts: ["Fonts", "Manage reusable WOFF2 font profiles for Elementor Pro."],
  typography: ["Typography", "Manage Builder-owned semantic typography profiles."],
  colors: ["Colors", "Manage Builder-owned Elementor and semantic color profiles."],
  "design-systems": ["Design Systems", "Compose vNext design-system resources and portable templates."],
  configs: ["Configurations", "Reference-site exports and their package requirements."],
  "elementor-templates": ["Elementor Templates", "Browse source-aware templates from every imported configuration snapshot."],
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

function fontWeightLabel(weight) {
  const labels = {
    100: "Thin",
    200: "Extra Light",
    300: "Light",
    400: "Regular",
    500: "Medium",
    600: "Semi Bold",
    700: "Bold",
    800: "Extra Bold",
    900: "Black"
  };
  return labels[Number(weight)] || `Weight ${weight}`;
}

function renderFonts() {
  const systems = state.fonts || [];
  $("#fonts-list").innerHTML = systems.map(system => {
    const legacy = (system.faces || []).some(face => face.format !== "woff2");
    const faceRows = (system.faces || []).map(face => `
      <div class="font-face-row">
        <code class="font-face-file">${esc(face.filename)}</code>
        <span class="font-face-weight"><b>${esc(face.weight)}</b><small>CSS weight</small></span>
        <span class="font-face-label"><b>${esc(fontWeightLabel(face.weight))}</b><small>Detected label</small></span>
        <span class="font-face-style"><b>${esc(face.style)}</b><small>Style</small></span>
      </div>`).join("");
    const skipped = (system.skipped || []).length ? `<details class="inspect-details"><summary>Ignored WOFF2 files <span>${system.skipped.length}</span></summary>${(system.skipped || []).map(item => `<div class="kv-row"><code>${esc(item.filename)}</code><span>${esc(item.reason)}</span></div>`).join("")}</details>` : "";
    const legacyNote = legacy ? `<small class="field-help">Legacy multi-format profile. Re-import the original ZIP with this Builder to replace it with clean WOFF2-only family profiles.</small>` : "";
    return `<div class="card font-card"><div class="font-card-main"><strong>${esc(system.name)}</strong><small><code>${esc(system.id)}</code> · ${system.faces.length} WOFF2 face${system.faces.length === 1 ? "" : "s"}</small>${legacyNote}<div class="font-face-map"><div class="font-face-head"><span>Font file</span><span>Weight</span><span>Name</span><span>Style</span></div>${faceRows}</div>${skipped}</div><div class="action-list"><button class="tiny danger remove-font" data-id="${escAttr(system.id)}">Remove</button></div></div>`;
  }).join("") || `<div class="empty">No font profiles yet. Import one ZIP containing one or more WOFF2 font families. Each detected family becomes its own profile automatically.</div>`;
  document.querySelectorAll(".remove-font").forEach(btn => btn.onclick = () => removeFontSystem(btn.dataset.id));
}

function renderFontSystemOptions(previous = "") {
  const systems = state.fonts || [];
  $("#build-font-system").innerHTML = [`<option value="">No font profile</option>`, ...systems.map(system => `<option value="${escAttr(system.id)}">${esc(system.name)} · ${system.faces.length} faces</option>`)].join("");
  if (systems.some(system => system.id === previous)) $("#build-font-system").value = previous;
}

function renderDesignSystemOptions(previous = "") {
  const systems = state.vnext?.designSystems || [];
  $("#build-design-system").innerHTML = [`<option value="">No design system</option>`, ...systems.map(system => `<option value="${escAttr(system.id)}">${esc(system.name)}</option>`)].join("");
  if (systems.some(system => system.id === previous)) $("#build-design-system").value = previous;
  syncFontSelectors();
}
function syncFontSelectors() {
  const hasDesignSystem = Boolean($("#build-design-system").value);
  $("#build-font-system").disabled = hasDesignSystem;
  if (hasDesignSystem) $("#build-font-system").value = "";
  $("#build-design-system").disabled = Boolean($("#build-font-system").value);
}

function legacyRenderVNext() {
  const resources = state.vnext || { typography: [], colors: [], designSystems: [], templates: [] };
  const renderCards = (items, kind, empty) => items.length ? items.map(item => `<div class="card"><div><strong>${esc(item.name || item.id)}</strong><small><code>${esc(item.id)}</code></small></div><div class="action-list"><button class="tiny edit-resource" data-kind="${kind}" data-id="${escAttr(item.id)}">Edit</button><button class="tiny duplicate-resource" data-kind="${kind}" data-id="${escAttr(item.id)}">Duplicate</button><button class="tiny danger delete-resource" data-kind="${kind}" data-id="${escAttr(item.id)}">Delete</button></div></div>`).join("") : `<div class="empty">${empty}</div>`;
  $("#typography-list").innerHTML = renderCards(resources.typography, "typography", "No typography profiles yet.");
  $("#colors-list").innerHTML = renderCards(resources.colors, "colors", "No color profiles yet.");
  $("#design-systems-list").innerHTML = renderCards(resources.designSystems, "designSystems", "No design systems yet.");
  $("#ds-typography").innerHTML = resources.typography.map(item => `<option value="${escAttr(item.id)}">${esc(item.name)}</option>`).join("");
  $("#ds-colors").innerHTML = resources.colors.map(item => `<option value="${escAttr(item.id)}">${esc(item.name)}</option>`).join("");
  $("#ds-font-profile").innerHTML = (state.fonts || []).map(item => `<option value="${escAttr(item.id)}">${esc(item.name)}</option>`).join("");
  renderTypographyDraft(); renderSemanticDraft(); renderBindingDraft();
  document.querySelectorAll(".edit-resource").forEach(button => button.onclick = () => editResource(button.dataset.kind, button.dataset.id, false));
  document.querySelectorAll(".duplicate-resource").forEach(button => button.onclick = () => editResource(button.dataset.kind, button.dataset.id, true));
  document.querySelectorAll(".delete-resource").forEach(button => button.onclick = () => deleteResource(button.dataset.kind, button.dataset.id));
}

function responsiveInput(property, breakpoint) { return document.querySelector(`[data-type-property="${property}"][data-type-breakpoint="${breakpoint}"]`); }
function responsiveValue(property) {
  const result = {}; for (const bp of ["desktop", "tablet", "mobile"]) { const value = responsiveInput(property, bp).value.trim(); if (value) result[bp] = value; }
  return result.desktop ? result : undefined;
}
function legacyRenderTypographyDraft() {
  const rows = [...Object.entries(typographyDraft.roles), ...Object.entries(typographyDraft.custom).map(([key, value]) => [`custom:${key}`, value])];
  $("#type-token-list").innerHTML = rows.map(([key, token]) => `<div class="card"><div><strong>${esc(key)}</strong><small>${esc(token.fontRole)} · ${token.weight} ${esc(token.style || "normal")}</small></div><button class="tiny danger remove-type-token" data-key="${escAttr(key)}">Remove</button></div>`).join("") || `<div class="empty">Add at least one typography role.</div>`;
  document.querySelectorAll(".remove-type-token").forEach(button => button.onclick = () => { const [prefix, name] = button.dataset.key.split(":"); if (prefix === "custom") delete typographyDraft.custom[name]; else delete typographyDraft.roles[prefix]; renderTypographyDraft(); });
}
function renderSemanticDraft() {
  $("#color-semantic-list").innerHTML = Object.entries(semanticDraft).map(([name, value]) => `<div class="card"><div><strong>${esc(name)}</strong><small>${esc(value)}</small></div><button class="tiny danger remove-semantic" data-name="${escAttr(name)}">Remove</button></div>`).join("") || `<div class="empty">Semantic colors are optional.</div>`;
  document.querySelectorAll(".remove-semantic").forEach(button => button.onclick = () => { delete semanticDraft[button.dataset.name]; renderSemanticDraft(); });
}
function legacyRenderBindingDraft() {
  $("#ds-binding-list").innerHTML = Object.entries(bindingDraft).map(([role, id]) => `<div class="card"><div><strong>${esc(role)}</strong><small>Font Profile: ${esc(id)}</small></div><button class="tiny danger remove-binding" data-role="${escAttr(role)}">Remove</button></div>`).join("") || `<div class="empty">Bind every font role used by the selected typography profile.</div>`;
  document.querySelectorAll(".remove-binding").forEach(button => button.onclick = () => { delete bindingDraft[button.dataset.role]; renderBindingDraft(); });
}
function legacyResetTypographyEditor() { typographyDraft = { roles: {}, custom: {} }; $("#type-id").value = ""; $("#type-name").value = ""; renderTypographyDraft(); }
function legacyResetColorEditor() { semanticDraft = {}; $("#color-id").value = ""; $("#color-name").value = ""; renderSemanticDraft(); }
function legacyResetDesignEditor() { bindingDraft = {}; $("#ds-id").value = ""; $("#ds-name").value = ""; renderBindingDraft(); }
function legacyEditResource(kind, id, duplicate) {
  const item = (state.vnext?.[kind] || []).find(entry => entry.id === id); if (!item) return;
  if (kind === "typography") { typographyDraft = structuredClone({ roles: item.roles || {}, custom: item.custom || {} }); $("#type-id").value = duplicate ? `${item.id}-copy` : item.id; $("#type-name").value = duplicate ? `${item.name} Copy` : item.name; goView("typography"); renderTypographyDraft(); }
  if (kind === "colors") { semanticDraft = structuredClone(item.semantic || {}); $("#color-id").value = duplicate ? `${item.id}-copy` : item.id; $("#color-name").value = duplicate ? `${item.name} Copy` : item.name; for (const role of ["primary", "secondary", "text", "accent"]) $(`#color-${role}`).value = item.elementor[role]; goView("colors"); renderSemanticDraft(); }
  if (kind === "designSystems") { bindingDraft = structuredClone(item.fontBindings || {}); $("#ds-id").value = duplicate ? `${item.id}-copy` : item.id; $("#ds-name").value = duplicate ? `${item.name} Copy` : item.name; $("#ds-typography").value = item.typographyProfileId; $("#ds-colors").value = item.colorProfileId; goView("design-systems"); renderBindingDraft(); }
}
async function saveResource(kind, value) { try { const saved=await request(`/api/vnext/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }); flash(`Saved ${value.name}.`); await refresh(); return saved; } catch (error) { flash(error.message, true); return null; } }
async function deleteResource(kind, id) { if (!confirm(`Delete resource ${id}?`)) return; try { await request(`/api/vnext/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" }); flash(`Deleted ${id}.`); await refresh(); } catch (error) { flash(error.message, true); } }

function legacyTemplateKey(template) { return `${template.snapshotId}\u0000${template.templateId}`; }
function legacyTemplateSelectionFromDom() {
  return [...document.querySelectorAll("#build-elementor-templates input.elementor-template")]
    .filter(input => input.checked)
    .map(input => ({ snapshotId: input.dataset.snapshotId, templateId: input.dataset.templateId }));
}

function legacyElementorTemplatesForBuild() {
  return Array.isArray(state.elementorTemplates) ? state.elementorTemplates : [];
}

function legacyRenderElementorChecklist() {
  const container = $("#build-elementor-templates");
  const help = $("#build-elementor-help");
  const baseId = $("#build-config").value;
  const templates = elementorTemplatesForBuild();
  if (!baseId) {
    container.innerHTML = `<label class="check template-choice"><input type="checkbox" disabled><span class="muted">Elementor template selection is disabled until a base configuration snapshot is selected.</span></label>`;
    help.textContent = "Choose a base snapshot to select templates from all imported snapshots.";
    return;
  }
  if (!templates.length) {
    container.innerHTML = `<span class="muted">No Elementor templates were found in the imported snapshots.</span>`;
    help.textContent = "Import another configuration snapshot to add templates to this library.";
    return;
  }

  const selected = new Set((currentElementorSelection || templates.map(templateKey)).map(item => typeof item === "string" ? item : templateKey(item)));
  const roots = [...selected];
  const locked = new Set();
  const missingDependencies = [];
  const byKey = new Map(templates.map(template => [templateKey(template), template]));
  const bySnapshotAndId = new Map(templates.map(template => [`${template.snapshotId}\u0000${template.templateId}`, template]));
  const queue = [...roots];
  for (let index = 0; index < queue.length; index++) {
    const template = byKey.get(queue[index]);
    if (!template) continue;
    for (const dependencyId of template.dependencies || []) {
      const dependency = bySnapshotAndId.get(`${template.snapshotId}\u0000${dependencyId}`);
      if (!dependency) {
        missingDependencies.push(`${template.name} → ${dependencyId}`);
        continue;
      }
      const dependencyKey = templateKey(dependency);
      if (!selected.has(dependencyKey)) {
        selected.add(dependencyKey);
        queue.push(dependencyKey);
      }
      locked.add(dependencyKey);
    }
  }
  currentElementorSelection = [...selected].map(key => { const template = byKey.get(key); return template ? { snapshotId: template.snapshotId, templateId: template.templateId } : null; }).filter(Boolean);
  const grouped = new Map();
  for (const template of templates) {
    const domain = template.sourceDomain || "Unknown — legacy export";
    if (!grouped.has(domain)) grouped.set(domain, []);
    grouped.get(domain).push(template);
  }
  container.innerHTML = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([domain, rows]) => `
    <fieldset class="template-source-group"><legend>${esc(domain)}</legend>${rows.map(template => {
      const key = templateKey(template);
      const isLocked = locked.has(key);
      return `<label class="check template-choice"><input class="elementor-template" type="checkbox" data-snapshot-id="${escAttr(template.snapshotId)}" data-template-id="${escAttr(template.templateId)}" ${selected.has(key) ? "checked" : ""} ${isLocked ? "disabled" : ""}><span class="plugin-name"><strong>${esc(template.name)}</strong><small>${esc(template.type)} · ${esc(template.snapshotName)}</small></span><span class="meta">${isLocked ? "Required dependency · locked" : esc(template.snapshotId)}</span></label>`;
    }).join("")}</fieldset>`).join("");
  help.textContent = missingDependencies.length ? `Missing dependencies: ${missingDependencies.join(", ")}` : "Templates are selected by source snapshot. Required same-snapshot dependencies are selected and locked automatically.";
  container.querySelectorAll("input.elementor-template").forEach(input => input.onchange = () => {
    currentElementorSelection = templateSelectionFromDom();
    renderElementorChecklist();
    syncElementorRequirement();
  });
}

function legacySyncElementorRequirement() {
  const required = templateSelectionFromDom().length > 0;
  document.querySelectorAll("#build-plugins input.plugin-selection").forEach(input => {
    if (input.dataset.slug !== "elementor") return;
    input.disabled = required || input.dataset.available !== "1";
    if (required) input.checked = true;
  });
}

function legacyRenderElementorLibrary() {
  const rows = elementorTemplatesForBuild();
  $("#elementor-templates-body").innerHTML = rows.map(template => `<tr><td><strong>${esc(template.name)}</strong><br><code>${esc(template.templateId)}</code></td><td>${esc(template.type)}</td><td>${esc(template.sourceDomain || "Unknown — legacy export")}</td><td>${esc(template.snapshotName)}<br><code>${esc(template.snapshotId)}</code></td><td>${esc(template.exportDate ? new Date(template.exportDate).toLocaleString() : "—")}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No Elementor templates in imported configuration snapshots.</td></tr>`;
}

const TYPE_ROLES = [["body","Body"],["links","Links"],["h1","H1"],["h2","H2"],["h3","H3"],["h4","H4"],["h5","H5"],["h6","H6"],["buttons","Buttons"],["formFields","Form Fields"]];
const TYPE_DIMENSIONS = [["size","Font size",["px","em","rem","vw"]],["lineHeight","Line height",["","px","em","rem","lh","rlh"]],["letterSpacing","Letter spacing",["px","em","rem"]],["wordSpacing","Word spacing",["px","em","rem"]]];
const defaultSize = { body:16,links:16,h1:48,h2:40,h3:34,h4:28,h5:22,h6:18,buttons:16,formFields:16 };
function freshTypographyDraft() {
  const roles = {};
  for (const [id] of TYPE_ROLES) roles[id] = { fontRole: id.startsWith("h") ? "heading" : "body", weight: id.startsWith("h") ? 700 : 400, style:"normal", textTransform:"none", textDecoration:"none", size:{desktop:{value:defaultSize[id],unit:"px"}}, lineHeight:{desktop:{value:id.startsWith("h") ? 1.2 : 1.5,unit:""}} };
  return { roles, custom:{}, fontSlots:{ body:{name:"Body font"}, heading:{name:"Heading font"}, accent:{name:"Accent font"} }, customRoleNames:{} };
}
function restoreTypeDraft() { if (typographyDraft) return; try { typographyDraft = JSON.parse(sessionStorage.getItem("wpstarter.typographyDraft")) || freshTypographyDraft(); } catch { typographyDraft = freshTypographyDraft(); } if(!typographyDraft.fontSlots) typographyDraft.fontSlots={body:{name:"Body font"},heading:{name:"Heading font"},accent:{name:"Accent font"}}; typographyDraft.custom ||= {}; typographyDraft.customRoleNames ||= {}; for(const [id] of TYPE_ROLES) if(!typographyDraft.roles?.[id]) typographyDraft.roles[id]=freshTypographyDraft().roles[id]; }
function saveTypeDraft() { sessionStorage.setItem("wpstarter.typographyDraft", JSON.stringify(typographyDraft)); }
function dimensionControl(roleId, property, units, token) {
  const current = token[property]?.[activeTypeDevice]; const unit = current?.unit ?? (property === "lineHeight" ? "" : "px");
  return `<div class="dimension-control"><input type="number" step="any" data-role="${escAttr(roleId)}" data-dimension="${property}" value="${current?.value ?? ""}" placeholder="—"><select data-role="${escAttr(roleId)}" data-unit="${property}">${units.map(value => `<option value="${escAttr(value)}" ${value===unit?"selected":""}>${value || "unitless"}</option>`).join("")}</select></div>`;
}
function renderTypographyDraft() {
  restoreTypeDraft(); const slotOptions = Object.entries(typographyDraft.fontSlots || {}).map(([id,slot]) => `<option value="${escAttr(id)}">${esc(slot.name)}</option>`).join("");
  const rows = [...TYPE_ROLES.map(([id,label]) => [id,label,typographyDraft.roles[id],false]), ...Object.entries(typographyDraft.custom || {}).map(([id,token]) => [id,typographyDraft.customRoleNames?.[id] || id,token,true])];
  $("#type-rows").innerHTML = rows.map(([id,label,token,custom]) => `<tr data-type-row="${escAttr(id)}"><td>${custom?`<input class="role-name" data-role-name="${escAttr(id)}" value="${escAttr(label)}">`:`<strong>${esc(label)}</strong>`}</td><td><select data-role="${escAttr(id)}" data-shared="fontRole">${slotOptions}<option value="__add">+ Add slot…</option></select></td><td><select data-role="${escAttr(id)}" data-shared="weight">${[100,200,300,400,500,600,700,800,900].map(w=>`<option ${Number(token.weight)===w?"selected":""}>${w}</option>`).join("")}</select></td><td><select data-role="${escAttr(id)}" data-shared="style">${["normal","italic","oblique"].map(v=>`<option ${token.style===v?"selected":""}>${v}</option>`).join("")}</select></td>${TYPE_DIMENSIONS.map(([property,,units])=>`<td>${dimensionControl(id,property,units,token)}</td>`).join("")}<td><select data-role="${escAttr(id)}" data-shared="textTransform">${["none","uppercase","lowercase","capitalize"].map(v=>`<option ${token.textTransform===v?"selected":""}>${v}</option>`).join("")}</select></td><td><select data-role="${escAttr(id)}" data-shared="textDecoration">${["none","underline","overline","line-through"].map(v=>`<option ${token.textDecoration===v?"selected":""}>${v}</option>`).join("")}</select></td><td>${custom?`<button class="tiny danger remove-custom-type" data-role="${escAttr(id)}">Remove</button>`:""}</td></tr>`).join("");
  for (const [id,,token] of rows) { const slot = document.querySelector(`[data-role="${CSS.escape(id)}"][data-shared="fontRole"]`); if (slot) slot.value = token.fontRole; }
  document.querySelectorAll("#type-rows input,#type-rows select").forEach(input => input.oninput = () => {
    const id=input.dataset.role; if (!id) return; const token=typographyDraft.roles[id]||typographyDraft.custom[id];
    if (input.dataset.shared) { if (input.dataset.shared==="fontRole" && input.value==="__add") { const label=prompt("Name this font slot (for example, Display font):"); if (!label) return renderTypographyDraft(); const slotId=`slot-${Date.now().toString(36)}`; typographyDraft.fontSlots[slotId]={name:label.trim()}; token.fontRole=slotId; renderTypographyDraft(); } else token[input.dataset.shared]=input.dataset.shared==="weight"?Number(input.value):input.value; }
    if (input.dataset.dimension) { token[input.dataset.dimension] ||= {}; const unit=document.querySelector(`[data-role="${CSS.escape(id)}"][data-unit="${input.dataset.dimension}"]`).value; if(input.value==="") delete token[input.dataset.dimension][activeTypeDevice]; else token[input.dataset.dimension][activeTypeDevice]={value:Number(input.value),unit}; }
    if (input.dataset.unit) { const number=document.querySelector(`[data-role="${CSS.escape(id)}"][data-dimension="${input.dataset.unit}"]`); if(number.value!==""){token[input.dataset.unit] ||= {}; token[input.dataset.unit][activeTypeDevice]={value:Number(number.value),unit:input.value};} }
    if(input.dataset.roleName) typographyDraft.customRoleNames[id]=input.value; saveTypeDraft();
  });
  document.querySelectorAll(".remove-custom-type").forEach(button=>button.onclick=()=>{delete typographyDraft.custom[button.dataset.role];delete typographyDraft.customRoleNames[button.dataset.role];saveTypeDraft();renderTypographyDraft();});
}
function freshColorDraft(){return {elementor:{primary:"#4054b2",secondary:"#54595f",text:"#7a7a7a",accent:"#61ce70"},custom:[]};}
function renderColorDraft(){ colorDraft ||= freshColorDraft(); const rows=[...["primary","secondary","text","accent"].map(id=>({id,name:id[0].toUpperCase()+id.slice(1),value:colorDraft.elementor[id],fixed:true})),...(colorDraft.custom||[])]; $("#color-rows").innerHTML=rows.map(row=>`<div class="color-row" data-color-row="${escAttr(row.id)}">${row.fixed?`<strong>${esc(row.name)}</strong>`:`<input data-color-name="${escAttr(row.id)}" value="${escAttr(row.name)}" aria-label="Custom color name">`}<input type="color" data-color-picker="${escAttr(row.id)}" value="${/^#[0-9a-f]{6}$/i.test(row.value)?row.value:"#000000"}"><input class="hex-input" data-color-hex="${escAttr(row.id)}" value="${escAttr(row.value)}" pattern="#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?" aria-label="Hexadecimal color">${row.fixed?"":`<button class="tiny danger remove-custom-color" data-id="${escAttr(row.id)}">Remove</button>`}</div>`).join("");
  const find=(id)=>colorDraft.elementor[id]!==undefined?{get:()=>colorDraft.elementor[id],set:v=>colorDraft.elementor[id]=v}:{get:()=>colorDraft.custom.find(x=>x.id===id)?.value,set:v=>colorDraft.custom.find(x=>x.id===id).value=v};
  document.querySelectorAll("[data-color-picker]").forEach(input=>input.oninput=()=>{const id=input.dataset.colorPicker;find(id).set(input.value);document.querySelector(`[data-color-hex="${CSS.escape(id)}"]`).value=input.value;});
  document.querySelectorAll("[data-color-hex]").forEach(input=>input.oninput=()=>{const valid=/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(input.value);input.classList.toggle("invalid",!valid);if(valid){find(input.dataset.colorHex).set(input.value.toLowerCase());if(input.value.length===7)document.querySelector(`[data-color-picker="${CSS.escape(input.dataset.colorHex)}"]`).value=input.value;}});
  document.querySelectorAll("[data-color-name]").forEach(input=>input.oninput=()=>{colorDraft.custom.find(x=>x.id===input.dataset.colorName).name=input.value;});
  document.querySelectorAll(".remove-custom-color").forEach(button=>button.onclick=()=>{colorDraft.custom=colorDraft.custom.filter(x=>x.id!==button.dataset.id);renderColorDraft();});
}
function renderBindingDraft(){ const type=(state.vnext?.typography||[]).find(item=>item.id===$("#ds-typography").value); const entries=[...Object.entries(type?.roles||{}),...Object.entries(type?.custom||{})]; const tokens=entries.map(([,token])=>token); const slots=[...new Set(tokens.map(token=>token.fontRole).filter(Boolean))]; let hasFaceErrors=false; $("#ds-binding-list").innerHTML=slots.map(slot=>{const label=type?.fontSlots?.[slot]?.name||slot.replace(/[-_]/g," "),current=bindingDraft[slot]||"",font=(state.fonts||[]).find(item=>item.id===current),faces=new Set((font?.faces||[]).map(face=>`${face.weight}:${face.style}`)),missing=entries.filter(([,token])=>token.fontRole===slot&&!faces.has(`${token.weight}:${token.style||"normal"}`)).map(([role,token])=>`${TYPE_ROLES.find(x=>x[0]===role)?.[1]||type?.customRoleNames?.[role]||role} needs ${token.weight} ${token.style||"normal"}`);if(current&&missing.length)hasFaceErrors=true;return `<div class="font-assignment"><label><strong>${esc(label)}</strong><select data-slot="${escAttr(slot)}"><option value="">Choose a Font Profile…</option>${(state.fonts||[]).map(fontOption=>`<option value="${escAttr(fontOption.id)}" ${fontOption.id===current?"selected":""}>${esc(fontOption.name)}</option>`).join("")}</select></label><small class="${missing.length&&current?"status-missing":""}">${!current?"Required":missing.length?esc(missing.join(" · ")):esc((font.faces||[]).map(face=>`${face.weight} ${face.style}`).join(" · "))}</small></div>`;}).join("")||`<div class="empty">Select a Typography Profile first.</div>`;
  document.querySelectorAll("#ds-binding-list select").forEach(select=>select.onchange=()=>{if(select.value)bindingDraft[select.dataset.slot]=select.value;else delete bindingDraft[select.dataset.slot];renderBindingDraft();}); const ready=slots.length>0&&slots.every(slot=>bindingDraft[slot])&&!hasFaceErrors; $("#ds-readiness").className=`readiness ${ready?"ready":""}`;$("#ds-readiness").textContent=ready?"Ready to save. Every requested weight and style is available offline.":hasFaceErrors?"Some typography rows request font faces that the selected Font Profile does not contain.":`${slots.filter(slot=>!bindingDraft[slot]).length} font assignment(s) still required.`; }
function renderVNext(){const resources=state.vnext||{typography:[],colors:[],designSystems:[]};const cards=(items,kind,empty)=>items.length?items.map(item=>`<div class="card"><div><strong>${esc(item.name)}</strong><details class="resource-details"><summary>Details</summary><code>${esc(item.id)}</code></details></div><div class="action-list"><button class="tiny edit-resource" data-kind="${kind}" data-id="${escAttr(item.id)}">Edit</button><button class="tiny duplicate-resource" data-kind="${kind}" data-id="${escAttr(item.id)}">Duplicate</button><button class="tiny danger delete-resource" data-kind="${kind}" data-id="${escAttr(item.id)}">Delete</button></div></div>`).join(""):`<div class="empty">${empty}</div>`;$("#typography-list").innerHTML=cards(resources.typography,"typography","No typography profiles yet.");$("#colors-list").innerHTML=cards(resources.colors,"colors","No color profiles yet.");$("#design-systems-list").innerHTML=cards(resources.designSystems,"designSystems","No design systems yet.");const oldType=$("#ds-typography").value,oldColor=$("#ds-colors").value;$("#ds-typography").innerHTML=`<option value="">Choose typography…</option>`+resources.typography.map(x=>`<option value="${escAttr(x.id)}">${esc(x.name)}</option>`).join("");$("#ds-colors").innerHTML=`<option value="">Choose colors…</option>`+resources.colors.map(x=>`<option value="${escAttr(x.id)}">${esc(x.name)}</option>`).join("");if(resources.typography.some(x=>x.id===oldType))$("#ds-typography").value=oldType;if(resources.colors.some(x=>x.id===oldColor))$("#ds-colors").value=oldColor;renderTypographyDraft();renderColorDraft();renderBindingDraft();document.querySelectorAll(".edit-resource").forEach(b=>b.onclick=()=>editResource(b.dataset.kind,b.dataset.id,false));document.querySelectorAll(".duplicate-resource").forEach(b=>b.onclick=()=>editResource(b.dataset.kind,b.dataset.id,true));document.querySelectorAll(".delete-resource").forEach(b=>b.onclick=()=>deleteResource(b.dataset.kind,b.dataset.id));}
function resetTypographyEditor(force=false){if(!force&&!confirm("Reset the entire typography draft?"))return;typographyDraft=freshTypographyDraft();$("#type-id").value="";$("#type-name").value="";sessionStorage.removeItem("wpstarter.typographyDraft");renderTypographyDraft();}
function resetColorEditor(){if(!confirm("Reset this color profile?"))return;colorDraft=freshColorDraft();$("#color-id").value="";$("#color-name").value="";renderColorDraft();}
function resetDesignEditor(){bindingDraft={};$("#ds-id").value="";$("#ds-name").value="";$("#ds-typography").value="";$("#ds-colors").value="";renderBindingDraft();}
function editResource(kind,id,duplicate){const item=(state.vnext?.[kind]||[]).find(x=>x.id===id);if(!item)return;if(kind==="typography"){typographyDraft=structuredClone({roles:item.roles||{},custom:item.custom||{},fontSlots:item.fontSlots||{},customRoleNames:item.customRoleNames||{}});$("#type-id").value=duplicate?"":item.id;$("#type-name").value=duplicate?`${item.name} Copy`:item.name;saveTypeDraft();goView("typography");renderTypographyDraft();}if(kind==="colors"){colorDraft=structuredClone({elementor:item.elementor,custom:item.custom||Object.entries(item.semantic||{}).map(([id,value])=>({id,name:id.replace(/[-_]/g," "),value}))});$("#color-id").value=duplicate?"":item.id;$("#color-name").value=duplicate?`${item.name} Copy`:item.name;goView("colors");renderColorDraft();}if(kind==="designSystems"){bindingDraft=structuredClone(item.fontBindings||{});$("#ds-id").value=duplicate?"":item.id;$("#ds-name").value=duplicate?`${item.name} Copy`:item.name;$("#ds-typography").value=item.typographyProfileId;$("#ds-colors").value=item.colorProfileId;goView("design-systems");renderBindingDraft();}}
function templateKey(template){return template.id;} function templateSelectionFromDom(){return [...document.querySelectorAll("#build-elementor-templates input.elementor-template")].filter(x=>x.checked).map(x=>x.dataset.id);} function elementorTemplatesForBuild(){return Array.isArray(state.elementorTemplates)?state.elementorTemplates:[];}
function filteredTemplates(){const q=$("#template-search").value.trim().toLowerCase(),source=$("#template-source").value,type=$("#template-type").value;return elementorTemplatesForBuild().filter(t=>(!q||`${t.name} ${t.sourceDomain} ${t.type}`.toLowerCase().includes(q))&&(!source||t.sourceDomain===source)&&(!type||t.type===type));}
function renderElementorChecklist(){const all=elementorTemplatesForBuild(),byId=new Map(all.map(t=>[t.id,t])),roots=new Set(currentElementorRoots||[]),selected=new Set(roots),locked=new Set(),missing=[],queue=[...roots];for(let i=0;i<queue.length;i++){const t=byId.get(queue[i]);for(const dependency of t?.dependencies||[]){if(!byId.has(dependency)){missing.push({template:t,dependency});continue;}if(!selected.has(dependency)){selected.add(dependency);queue.push(dependency);}locked.add(dependency);}}currentElementorSelection=[...selected];const grouped=new Map();for(const t of filteredTemplates()){if(!grouped.has(t.sourceDomain))grouped.set(t.sourceDomain,[]);grouped.get(t.sourceDomain).push(t);}$("#build-elementor-templates").innerHTML=all.length?[...grouped].map(([domain,rows])=>`<fieldset class="template-source-group"><legend>${esc(domain)}</legend>${rows.map(t=>{const isDependency=locked.has(t.id)&&!roots.has(t.id);return `<label class="check template-choice"><input class="elementor-template" type="checkbox" data-id="${escAttr(t.id)}" ${selected.has(t.id)?"checked":""}><span class="plugin-name"><strong>${esc(t.name)}</strong><small>${esc(t.type)} · imported from ${esc(t.snapshotName)}</small></span><span class="meta">${isDependency?"Included automatically · required dependency":""}</span></label>`}).join("")}</fieldset>`).join(""):`<span class="muted">No templates yet. Import an exporter configuration to add them.</span>`;const help=$("#build-elementor-help"),save=$("#create-profile");if(missing.length){const first=missing[0],reference=first.dependency.startsWith("missing-")?first.dependency.slice("missing-".length):first.dependency;help.textContent=`Missing Elementor template dependency: "${first.template.name}" references a template omitted from snapshot "${first.template.snapshotName}" (export reference ${reference}). This is a template, not a plugin or setting. Remove "${first.template.name}" from the selection or re-import the snapshot with that template included. Save Profile will explain this if clicked.`;help.classList.add("status-missing");save.disabled=false;save.title="Click to see why this profile cannot be saved yet.";}else{help.textContent="Templates are durable library assets and can be used in package-only builds. Required dependencies are included automatically; you can still select them directly.";help.classList.remove("status-missing");save.disabled=false;save.removeAttribute("title");}document.querySelectorAll("input.elementor-template").forEach(input=>input.onchange=()=>{const next=new Set(currentElementorRoots||[]);if(input.checked)next.add(input.dataset.id);else if(!locked.has(input.dataset.id))next.delete(input.dataset.id);currentElementorRoots=[...next];renderElementorChecklist();syncElementorRequirement();renderTemplateMappings();});renderTemplateMappings();}
function normalizedName(value){return String(value).toLowerCase().replace(/[^a-z0-9]+/g,"");}
function mappingTargets(){const system=(state.vnext?.designSystems||[]).find(x=>x.id===$("#build-design-system").value),type=(state.vnext?.typography||[]).find(x=>x.id===system?.typographyProfileId),colors=(state.vnext?.colors||[]).find(x=>x.id===system?.colorProfileId);const targets=[];for(const id of Object.keys(colors?.elementor||{}))targets.push({value:`color:${id}`,label:`${id[0].toUpperCase()+id.slice(1)} — selected Design System`});for(const token of colors?.custom||[])targets.push({value:`color:${token.id}`,label:`${token.name} — selected Design System`});for(const [id] of Object.entries(colors?.semantic||{}))targets.push({value:`color:${id}`,label:`${id.replace(/[-_]/g," ")} — selected Design System`});for(const [id] of Object.entries(type?.roles||{}))targets.push({value:`typography:${id}`,label:`${TYPE_ROLES.find(x=>x[0]===id)?.[1]||id} — selected Design System`});for(const [id] of Object.entries(type?.custom||{}))targets.push({value:`typography:${id}`,label:`${type.customRoleNames?.[id]||id} — selected Design System`});for(const id of ["primary","secondary","text","accent"]){targets.push({value:`elementor:color:${id}`,label:`Elementor default color ${id}`});targets.push({value:`elementor:typography:${id}`,label:`Elementor default typography ${id}`});}return targets;}
function renderTemplateMappings(){const selected=new Set(currentElementorSelection||[]),templates=elementorTemplatesForBuild().filter(t=>selected.has(t.id)),targets=mappingTargets(),targetByName=new Map(targets.map(t=>[normalizedName(t.label.split(" — ")[0]),t.value]));const refs=new Map();for(const t of templates)for(const ref of t.globalReferences||[]){if(!refs.has(ref.reference))refs.set(ref.reference,{...ref,templates:[]});refs.get(ref.reference).templates.push(t.name);}const unresolved=[...refs.values()].filter(ref=>{const suffix=ref.reference.split(":").pop();const dsTarget=`${ref.kind}:${suffix}`,defaultTarget=`elementor:${ref.kind}:${suffix}`,automatic=(["primary","secondary","text","accent"].includes(suffix)?(targets.some(t=>t.value===dsTarget)?dsTarget:defaultTarget):targetByName.get(normalizedName(ref.name)));if(automatic&&!templateMappingDraft[ref.reference])templateMappingDraft[ref.reference]=automatic;return !templateMappingDraft[ref.reference];});$("#template-mappings").classList.toggle("hidden",unresolved.length===0);$("#template-mapping-rows").innerHTML=unresolved.map(ref=>`<label class="mapping-row"><span><strong>${esc(ref.name)}</strong><small>${esc(ref.kind)} · used by ${esc(ref.templates.join(", "))}</small></span><select data-reference="${escAttr(ref.reference)}"><option value="">Choose a destination…</option>${targets.filter(t=>t.value.startsWith(ref.kind+":")||t.value.startsWith(`elementor:${ref.kind}:`)).map(t=>`<option value="${escAttr(t.value)}">${esc(t.label)}</option>`).join("")}</select></label>`).join("");document.querySelectorAll("[data-reference]").forEach(select=>select.onchange=()=>{if(select.value)templateMappingDraft[select.dataset.reference]=select.value;else delete templateMappingDraft[select.dataset.reference];renderTemplateMappings();});}
function syncElementorRequirement(){const required=(currentElementorSelection||[]).length>0;document.querySelectorAll("#build-plugins input.plugin-selection").forEach(input=>{if(input.dataset.slug!=="elementor")return;input.disabled=required||input.dataset.available!=="1";if(required)input.checked=true;});}
function renderElementorLibrary(){const rows=elementorTemplatesForBuild();$("#elementor-templates-body").innerHTML=rows.map(t=>`<tr><td><strong>${esc(t.name)}</strong><br><details class="resource-details"><summary>Details</summary><code>${esc(t.id)}</code></details></td><td>${esc(t.type)}</td><td>${esc(t.sourceDomain)}</td><td>${esc(t.snapshotName)}</td><td>${esc(new Date(t.importedAt).toLocaleString())}</td><td><button class="tiny danger delete-template" data-id="${escAttr(t.id)}">Delete</button></td></tr>`).join("")||`<tr><td colspan="6" class="empty">No templates in the independent library.</td></tr>`;document.querySelectorAll(".delete-template").forEach(b=>b.onclick=async()=>{if(!confirm("Delete this template from the library?"))return;try{await request(`/api/elementor-templates/${encodeURIComponent(b.dataset.id)}`,{method:"DELETE"});await refresh();}catch(e){flash(e.message,true);}});const sources=[...new Set(rows.map(t=>t.sourceDomain))],types=[...new Set(rows.map(t=>t.type))];$("#template-source").innerHTML=`<option value="">All source sites</option>`+sources.map(x=>`<option>${esc(x)}</option>`).join("");$("#template-type").innerHTML=`<option value="">All types</option>`+types.map(x=>`<option>${esc(x)}</option>`).join("");}

function render() {
  const previousConfig = $("#build-config")?.value ?? "";
  const previousProfile = $("#profile-select")?.value ?? "";
  const previousFontSystem = $("#build-font-system")?.value ?? "";
  const previousDesignSystem = $("#build-design-system")?.value ?? "";
  const previousCompareLeft = $("#compare-left")?.value ?? "";
  const previousCompareRight = $("#compare-right")?.value ?? "";
  $("#version").textContent = `GUI ${state.version}`;
  $("#library").textContent = state.library;
  $("#stat-packages").textContent = state.packages.length;
  $("#stat-configs").textContent = state.configs.length;
  $("#stat-profiles").textContent = state.profiles.length;
  $("#stat-builds").textContent = state.builds.length;
  renderPackages();
  renderFonts();
  renderVNext();
  renderElementorLibrary();
  renderFontSystemOptions(previousFontSystem);
  renderDesignSystemOptions(previousDesignSystem);

  $("#configs-list").innerHTML = state.configs.map(c => `<div class="card"><div><strong>${esc(c.name)}</strong><small>${esc(c.id)} · WP ${esc(c.wordpressVersion)} · ${esc(c.locale)} · ${esc(c.theme.slug)}@${esc(c.theme.version)} · ${c.plugins.length} plugins</small></div><div class="action-list"><button class="secondary inspect-config" data-id="${escAttr(c.id)}">Inspect</button><button class="secondary check-config" data-id="${escAttr(c.id)}">Check packages</button><button class="tiny danger delete-config" data-id="${escAttr(c.id)}">Delete snapshot</button></div></div>`).join("") || `<div class="empty">No configuration snapshots yet. You can still create package-only builds.</div>`;

  const compareOpts = state.configs.map(c => `<option value="${escAttr(c.id)}">${esc(c.name)} · ${esc(c.generatedAt ? new Date(c.generatedAt).toLocaleString() : c.id)}</option>`).join("");
  $("#compare-left").innerHTML = compareOpts || `<option value="">No snapshots</option>`;
  $("#compare-right").innerHTML = compareOpts || `<option value="">No snapshots</option>`;
  const ids = state.configs.map(c => c.id);
  if (ids.includes(previousCompareLeft)) $("#compare-left").value = previousCompareLeft;
  else if (ids.length) $("#compare-left").value = ids[0];
  if (ids.includes(previousCompareRight) && previousCompareRight !== $("#compare-left").value) $("#compare-right").value = previousCompareRight;
  else if (ids.length > 1) $("#compare-right").value = ids[ids.length - 1];
  else if (ids.length) $("#compare-right").value = ids[0];
  $("#compare-configs").disabled = ids.length < 2;
  $("#compare-help").textContent = ids.length < 2 ? "Import at least two snapshots to compare them." : "Comparison direction is baseline → target. Swap the selections to reverse it.";

  const configOpts = [`<option value="">No snapshot — packages only</option>`, ...state.configs.map(c => `<option value="${escAttr(c.id)}">${esc(c.name)} (${esc(c.id)})</option>`)].join("");
  $("#build-config").innerHTML = configOpts;
  if (["", ...state.configs.map(c => c.id)].includes(previousConfig)) $("#build-config").value = previousConfig;

  const profileOpts = state.profiles.map(p => `<option value="${escAttr(p.file)}">${esc(p.name)} · ${esc(p.locale)} · ${p.plugins} plugins</option>`).join("");
  $("#profile-select").innerHTML = profileOpts || `<option value="">No profiles created</option>`;
  if (state.profiles.some(p => p.file === previousProfile)) $("#profile-select").value = previousProfile;

  $("#profiles-manager").innerHTML = state.profiles.map(p => `<div class="profile-card"><div class="profile-main"><strong>${esc(p.name)}</strong><small>${esc(p.locale)} · WP ${esc(p.wordpress)} · ${esc(p.theme)} · ${p.plugins} plugins</small><small>${p.config ? `Snapshot: ${esc(p.config)}` : "Packages only"}${p.elementorTemplates ? ` · ${p.elementorTemplates} Elementor templates` : ""}${p.fontSystem ? ` · Font: ${esc(p.fontSystem)}` : ""}${p.designSystem ? ` · Design: ${esc(p.designSystem)}` : ""}${p.updatedAt ? ` · Updated ${new Date(p.updatedAt).toLocaleString()}` : ""}</small></div><div class="profile-card-actions"><button class="tiny edit-profile" data-file="${escAttr(p.file)}">Edit</button><button class="tiny duplicate-profile" data-file="${escAttr(p.file)}">Duplicate</button><button class="tiny primary-ish build-profile-now" data-file="${escAttr(p.file)}">Build</button><button class="tiny danger delete-profile" data-file="${escAttr(p.file)}">Delete</button></div></div>`).join("") || `<div class="empty">No profiles yet. Create one from the Build page.</div>`;

  const buildCard = (b, compact = false) => `<div class="build-card"><div><strong>${esc(b.file)}</strong><small>${b.profile ? `Profile: ${esc(b.profile)} · ` : ""}${b.locale ? `${esc(b.locale)} · ` : ""}${b.configurationEnabled ? "Snapshot" : "Packages only"} · ${fmtBytes(b.size)} · ${new Date(b.modifiedAt).toLocaleString()}</small>${b.compatibility?.status === "upgrade-warning" ? `<small class="compatibility-inline">Upgrade warning: ${esc(b.compatibility.warnings.map(w => `${w.slug} ${w.exportedVersion} → ${w.selectedVersion}`).join(", "))}</small>` : ""}${!compact && b.sha256 ? `<code class="hash">${esc(b.sha256)}</code>` : ""}</div><div class="build-card-actions"><a class="tiny primary-ish" href="/download/${encodeURIComponent(b.file)}">Download</a>${b.profileFile ? `<button class="tiny rebuild" data-profile="${escAttr(b.profileFile)}">Build again</button>` : ""}${compact ? "" : `<button class="tiny danger delete-build" data-file="${escAttr(b.file)}">Delete</button>`}</div></div>`;
  $("#recent-builds").innerHTML = state.builds.slice(0, 5).map(b => buildCard(b, true)).join("") || `<div class="empty">No builds yet.</div>`;
  $("#build-history").innerHTML = state.builds.map(b => buildCard(b, false)).join("") || `<div class="empty">No builds yet.</div>`;

  document.querySelectorAll(".inspect-config").forEach(btn => btn.onclick = () => inspectConfig(btn.dataset.id));
  document.querySelectorAll(".check-config").forEach(btn => btn.onclick = () => checkConfig(btn.dataset.id));
  document.querySelectorAll(".delete-config").forEach(btn => btn.onclick = () => deleteConfig(btn.dataset.id));
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

async function removeFontSystem(id) {
  const system = (state.fonts || []).find(item => item.id === id);
  if (!confirm(`Remove font profile ${system?.name || id}? Build profiles using it will stop resolving until another font profile is selected.`)) return;
  try {
    await request(`/api/fonts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    flash(`Removed font profile ${system?.name || id}.`);
    await refresh();
  } catch (e) { flash(e.message, true); }
}

function valueText(value) {
  if (value === null) return "null";
  if (value === "") return '""';
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value); } catch { return String(value); }
}

function renderKeyValues(values) {
  const entries = Object.entries(values || {});
  if (!entries.length) return `<div class="empty compact-empty">No values.</div>`;
  return `<div class="inspector-kv">${entries.map(([key, value]) => `<div class="kv-row"><code>${esc(key)}</code><span>${esc(valueText(value))}</span></div>`).join("")}</div>`;
}

function adapterStatusLabel(status) {
  if (status === "portable") return ["Portable", "portable"];
  if (status === "deferred") return ["Deferred", "deferred"];
  return ["Metadata", "metadata"];
}

function safetyLabel(key) {
  const labels = {
    users_exported: "Users",
    uploads_exported: "Uploads / media",
    arbitrary_options_exported: "Arbitrary wp_options",
    credentials_exported: "Credentials / secrets",
    raw_database_exported: "Raw database",
    site_specific_ids_intentionally_excluded: "Site-specific IDs"
  };
  return labels[key] || key.replaceAll("_", " ");
}

function safetyState(key, value) {
  if (key === "site_specific_ids_intentionally_excluded") return value ? ["Excluded", true] : ["Not excluded", false];
  return value ? ["Included", false] : ["Excluded", true];
}

function bindInspectTabs(root) {
  const buttons = root.querySelectorAll(".inspect-tab");
  const panels = root.querySelectorAll(".inspect-tab-panel");
  buttons.forEach(button => {
    button.onclick = () => {
      const target = button.dataset.tab;
      buttons.forEach(item => item.classList.toggle("active", item === button));
      panels.forEach(panel => panel.classList.toggle("active", panel.dataset.tab === target));
    };
  });
}

function changeChip(kind) {
  const label = kind === "added" ? "Added" : kind === "removed" ? "Removed" : "Changed";
  return `<span class="change-chip ${escAttr(kind)}">${label}</span>`;
}

function coordinateText(value) {
  if (!value) return "—";
  return `${value.name || value.slug || "Package"} ${value.version || ""}${value.variant ? ` · ${value.variant}` : ""}`.trim();
}

function diffValue(value) {
  if (value === undefined) return `<span class="diff-none">—</span>`;
  return `<code>${esc(valueText(value))}</code>`;
}

function diffTable(rows, columns) {
  if (!rows.length) return `<div class="empty compact-empty">No changes in this category.</div>`;
  return `<div class="table-wrap"><table class="diff-table"><thead><tr>${columns.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

async function inspectConfig(id) {
  const dialog = $("#config-inspector");
  $("#inspector-title").textContent = "Loading snapshot…";
  $("#inspector-meta").textContent = id;
  $("#inspector-body").innerHTML = `<div class="empty">Reading exported configuration…</div>`;
  if (!dialog.open) dialog.showModal();
  try {
    const data = await request(`/api/configs/${encodeURIComponent(id)}/inspect`);
    const i = data.inspection;
    const requirements = data.requirements?.requirements || [];
    $("#inspector-title").textContent = i.name;
    $("#inspector-meta").textContent = `${i.snapshotId} · Exporter ${i.exporterVersion} · ${new Date(i.generatedAt).toLocaleString()}`;

    const reqRows = requirements.map(r => `<tr><td><span class="status-chip ${r.status === "available" ? "ok" : "missing"}">${r.status === "available" ? "Available" : "Missing"}</span></td><td>${esc(r.kind)}</td><td><code>${esc(r.slug)}</code></td><td>${esc(r.version)}${r.variant ? ` · ${esc(r.variant)}` : ""}</td></tr>`).join("");
    const pageRows = i.wordpress.pages.map(p => `<span class="entity-pill"><strong>${esc(p.title)}</strong><code>${esc(p.slug)}</code></span>`).join("") || `<span class="muted">No starter pages.</span>`;
    const pluginRows = i.source.plugins.map(p => `<span class="entity-pill"><strong>${esc(p.name)}</strong><code>${esc(p.slug)}@${esc(p.version)}</code></span>`).join("") || `<span class="muted">No source plugins recorded.</span>`;
    const targetPluginRows = (i.source.targetPlugins || []).map(p => `<span class="entity-pill"><strong>${esc(p.name)}</strong><code>${esc(p.slug)}@${esc(p.version)}</code></span>`).join("") || `<span class="muted">No starter target plugins selected.</span>`;

    const adapterCards = i.adapters.map(adapter => {
      const [statusLabel, statusClass] = adapterStatusLabel(adapter.status);
      const sections = adapter.sections.map(section => `<details class="inspect-details"><summary>${esc(section.label)} <span>${section.count}</span></summary>${renderKeyValues(section.values)}</details>`).join("");
      const details = Object.keys(adapter.details || {}).length ? `<details class="inspect-details"><summary>Other metadata <span>${Object.keys(adapter.details).length}</span></summary>${renderKeyValues(adapter.details)}</details>` : "";
      return `<div class="adapter-card"><div class="adapter-head"><div><strong>${esc(adapter.label)}</strong><code>${esc(adapter.key)}</code></div><span class="adapter-status ${statusClass}">${statusLabel}</span></div>${adapter.reason ? `<p class="adapter-reason">${esc(adapter.reason)}</p>` : ""}${sections || details ? sections + details : `<div class="empty compact-empty">No portable values in this adapter.</div>`}</div>`;
    }).join("") || `<div class="empty">No adapters in this snapshot.</div>`;

    const safety = Object.entries(i.safety || {}).map(([key, value]) => {
      const [label, safe] = safetyState(key, value);
      return `<div class="safety-row"><span>${esc(safetyLabel(key))}</span><strong class="${safe ? "safe" : "warning"}">${esc(label)}</strong></div>`;
    }).join("") || `<div class="empty">No safety manifest was exported.</div>`;

    $("#inspector-body").innerHTML = `
      <div class="inspect-tabs" role="tablist">
        <button class="inspect-tab active" data-tab="overview">Overview</button>
        <button class="inspect-tab" data-tab="packages">Packages</button>
        <button class="inspect-tab" data-tab="wordpress">WordPress</button>
        <button class="inspect-tab" data-tab="structures">Structures</button>
        <button class="inspect-tab" data-tab="adapters">Adapters</button>
        <button class="inspect-tab" data-tab="safety">Safety</button>
      </div>

      <div class="inspect-tab-panel active" data-tab="overview">
        <div class="inspect-stats">
          <div><span>WordPress options</span><strong>${i.totals.wordpressOptions}</strong></div>
          <div><span>Adapter options</span><strong>${i.totals.adapterOptions}</strong></div>
          <div><span>Adapter settings</span><strong>${i.totals.adapterSettings}</strong></div>
          <div><span>Starter pages</span><strong>${i.totals.pages}</strong></div>
          <div><span>Portable adapters</span><strong>${i.totals.portableAdapters}</strong></div>
          <div><span>Deferred adapters</span><strong>${i.totals.deferredAdapters}</strong></div>
        </div>
        <section class="inspect-section"><h3>Source environment</h3><div class="source-grid"><div><span>WordPress</span><strong>${esc(i.source.wordpressVersion)}</strong></div><div><span>PHP</span><strong>${esc(i.source.phpVersion)}</strong></div><div><span>Locale</span><strong>${esc(i.source.locale)}</strong></div><div><span>Theme</span><strong>${esc(i.source.theme.name)} ${esc(i.source.theme.version)}</strong></div></div><h4>Source plugin inventory</h4><div class="entity-list">${pluginRows}</div><h4>Starter target packages</h4><div class="entity-list">${targetPluginRows}</div></section>
      </div>

      <div class="inspect-tab-panel" data-tab="packages">
        <section class="inspect-section"><div class="section-title"><h3>Exact package requirements</h3><span>${data.requirements.available} available · ${data.requirements.missing} missing</span></div><div class="table-wrap"><table><thead><tr><th>Status</th><th>Type</th><th>Package</th><th>Version</th></tr></thead><tbody>${reqRows}</tbody></table></div></section>
      </div>

      <div class="inspect-tab-panel" data-tab="wordpress">
        <section class="inspect-section"><div class="section-title"><h3>Portable WordPress configuration</h3><span>${i.wordpress.optionCount} options</span></div><div class="inspect-note"><span>Permalink</span><code>${esc(i.wordpress.permalinkStructure || "default")}</code><span>Default-content cleanup</span><strong>${i.wordpress.cleanupDefaultContent ? "Enabled" : "Disabled"}</strong></div>${renderKeyValues(i.wordpress.options)}</section>
      </div>

      <div class="inspect-tab-panel" data-tab="structures">
        <section class="inspect-section"><div class="section-title"><h3>Starter pages</h3><span>${i.wordpress.pages.length} portable page definitions</span></div><div class="entity-list">${pageRows}</div></section>
        <section class="inspect-section"><div class="section-title"><h3>Portable object structures</h3><span>Phase 2</span></div><p class="muted">Template, layout, taxonomy, and plugin-object structures will appear here as their adapters become portable.</p></section>
      </div>

      <div class="inspect-tab-panel" data-tab="adapters">
        <section class="inspect-section"><div class="section-title"><h3>Plugin adapters</h3><span>Portable data only</span></div><div class="adapter-grid">${adapterCards}</div></section>
      </div>

      <div class="inspect-tab-panel" data-tab="safety">
        <section class="inspect-section"><div class="section-title"><h3>Safety boundary</h3><span>What the exporter deliberately did not clone</span></div><div class="safety-grid">${safety}</div></section>
      </div>`;
    bindInspectTabs($("#inspector-body"));
  } catch (e) {
    $("#inspector-body").innerHTML = `<div class="flash error">${esc(e.message)}</div>`;
  }
}

async function compareConfigs() {
  const left = $("#compare-left").value;
  const right = $("#compare-right").value;
  if (!left || !right) return flash("Choose two snapshots first.", true);
  if (left === right) return flash("Choose two different snapshots to compare.", true);

  const dialog = $("#config-comparison");
  $("#comparison-title").textContent = "Comparing snapshots…";
  $("#comparison-meta").textContent = `${left} → ${right}`;
  $("#comparison-body").innerHTML = `<div class="empty">Calculating configuration differences…</div>`;
  if (!dialog.open) dialog.showModal();
  try {
    const c = await request(`/api/configs/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`);
    $("#comparison-title").textContent = `${c.left.name} → ${c.right.name}`;
    $("#comparison-meta").textContent = `${c.left.id} → ${c.right.id} · ${c.summary.total} total changes`;

    const binaryRows = c.binary.changes.map(change => `<tr><td>${changeChip(change.kind)}</td><td>${esc(change.packageKind)}</td><td><code>${esc(change.key)}</code></td><td>${esc(coordinateText(change.before))}</td><td>${esc(coordinateText(change.after))}</td></tr>`);
    const configRows = c.configuration.changes.map(change => `<tr><td>${changeChip(change.kind)}</td><td>${esc(change.scope)}</td><td><code>${esc(change.path)}</code></td><td>${diffValue(change.before)}</td><td>${diffValue(change.after)}</td></tr>`);
    const pageRows = c.structures.pages.map(change => `<tr><td>${changeChip(change.kind)}</td><td>Page</td><td><code>${esc(change.slug)}</code></td><td>${change.before ? esc(change.before.title) : "—"}</td><td>${change.after ? esc(change.after.title) : "—"}</td></tr>`);
    const adapterRows = c.structures.adapters.map(change => `<tr><td>${changeChip(change.kind)}</td><td>Adapter</td><td><code>${esc(change.key)}</code></td><td>${change.before ? `${esc(change.before.status)}${change.before.reason ? ` · ${esc(change.before.reason)}` : ""}` : "—"}</td><td>${change.after ? `${esc(change.after.status)}${change.after.reason ? ` · ${esc(change.after.reason)}` : ""}` : "—"}</td></tr>`);
    const safetyRows = c.safety.changes.map(change => `<tr><td>${changeChip(change.kind)}</td><td>${esc(change.path)}</td><td>${diffValue(change.before)}</td><td>${diffValue(change.after)}</td></tr>`);

    const unchanged = c.summary.total === 0 ? `<div class="comparison-clean"><strong>No differences detected.</strong><span>These snapshots are equivalent within the current portability model.</span></div>` : "";
    $("#comparison-body").innerHTML = `
      <div class="compare-summary">
        <div><span>Binary changes</span><strong>${c.summary.binary}</strong></div>
        <div><span>Configuration</span><strong>${c.summary.configuration}</strong></div>
        <div><span>Structures</span><strong>${c.summary.structures}</strong></div>
        <div><span>Safety</span><strong>${c.summary.safety}</strong></div>
        <div class="total"><span>Total</span><strong>${c.summary.total}</strong></div>
      </div>
      ${unchanged}
      <div class="inspect-tabs" role="tablist">
        <button class="inspect-tab active" data-tab="binary">Binaries <span>${c.summary.binary}</span></button>
        <button class="inspect-tab" data-tab="configuration">Settings <span>${c.summary.configuration}</span></button>
        <button class="inspect-tab" data-tab="structures">Structures <span>${c.summary.structures}</span></button>
        <button class="inspect-tab" data-tab="safety">Safety <span>${c.summary.safety}</span></button>
      </div>
      <div class="inspect-tab-panel active" data-tab="binary"><section class="inspect-section"><div class="section-title"><h3>Binary/package changes</h3><span>Software versions and active packages</span></div>${diffTable(binaryRows, ["Change", "Type", "Package", "Before", "After"])}</section></div>
      <div class="inspect-tab-panel" data-tab="configuration"><section class="inspect-section"><div class="section-title"><h3>Configuration changes</h3><span>Portable values only</span></div>${diffTable(configRows, ["Change", "Scope", "Path", "Before", "After"])}</section></div>
      <div class="inspect-tab-panel" data-tab="structures"><section class="inspect-section"><div class="section-title"><h3>Structural changes</h3><span>Objects and adapter capabilities</span></div>${diffTable([...pageRows, ...adapterRows], ["Change", "Type", "Object", "Before", "After"])}</section></div>
      <div class="inspect-tab-panel" data-tab="safety"><section class="inspect-section"><div class="section-title"><h3>Safety-boundary changes</h3><span>Exporter inclusion/exclusion policy</span></div>${diffTable(safetyRows, ["Change", "Field", "Before", "After"])}</section></div>`;
    bindInspectTabs($("#comparison-body"));
  } catch (e) {
    $("#comparison-body").innerHTML = `<div class="flash error">${esc(e.message)}</div>`;
  }
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

function localeLabel(locale) {
  const labels = {
    en_US: "English (United States)",
    fa_IR: "فارسی (ایران)",
    ar: "العربية",
    de_DE: "Deutsch",
    es_ES: "Español",
    fr_FR: "Français",
    it_IT: "Italiano",
    tr_TR: "Türkçe"
  };
  return labels[locale] ? `${locale} · ${labels[locale]}` : locale;
}

function availableLocales(config = null) {
  const locales = new Set(wordpressPackages().map(packageVariant));
  if (config?.locale) locales.add(config.locale);
  const current = $("#build-locale")?.value;
  if (current) locales.add(current);
  if (!locales.size) locales.add("en_US");
  return [...locales].sort((a, b) => {
    if (a === "en_US") return -1;
    if (b === "en_US") return 1;
    return a.localeCompare(b);
  });
}

function renderLocaleOptions(config = null, selectedLocale = null) {
  const select = $("#build-locale");
  const selected = selectedLocale || select.value || config?.locale || "en_US";
  const locales = availableLocales(config);
  if (selected && !locales.includes(selected)) locales.push(selected);
  select.innerHTML = locales.map(locale => `<option value="${escAttr(locale)}">${esc(localeLabel(locale))}</option>`).join("");
  select.value = locales.includes(selected) ? selected : locales[0] || "en_US";
  select.disabled = wordpressPackages().length === 0;
}

function renderWordPressOptions(config = null) {
  const packages = wordpressPackages();
  $("#build-wordpress").innerHTML = packages.map(p => `<option value="${escAttr(coordinateValue(p))}">${esc(p.version)} · ${esc(packageVariant(p))}</option>`).join("") || `<option value="">No WordPress packages</option>`;
  const locale = $("#build-locale").value || config?.locale || "en_US";
  const preferred = config
    ? packages.find(p => p.version === config.wordpressVersion && packageVariant(p) === locale) || packages.find(p => p.version === config.wordpressVersion && packageVariant(p) === "en_US") || packages.find(p => p.version === config.wordpressVersion) || packages[0]
    : packages.find(p => packageVariant(p) === locale) || packages.find(p => packageVariant(p) === "en_US") || packages[0];
  if (preferred) $("#build-wordpress").value = coordinateValue(preferred);
  renderPackageUpgradeMeta(config);
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
  renderPackageUpgradeMeta(config);
}

function renderPackageUpgradeMeta(config = null) {
  const wpMeta = $("#build-wordpress-meta");
  const themeMeta = $("#build-theme-meta");
  if (!config) {
    if (wpMeta) wpMeta.innerHTML = "";
    if (themeMeta) themeMeta.innerHTML = "";
    return;
  }
  const wp = decodeCoordinate($("#build-wordpress").value);
  const theme = decodeTheme($("#build-theme").value);
  const render = (element, exported, selected) => {
    if (!element || !exported) return;
    const newer = selected && selectedVersionIsNewer(selected, exported);
    element.innerHTML = `Exporter: ${esc(exported)}${newer ? ` <span class="upgrade-badge">Newer version</span>` : ""}`;
  };
  render(wpMeta, config.wordpressVersion, wp.version);
  render(themeMeta, config.theme?.version, theme.version);
}

function pluginChoice(plugin, checked, requiredByTemplates = false) {
  const available = pluginPackages(plugin.slug);
  const preferred = available.find(p => p.version === plugin.version) || available[0];
  const opts = available.map(p => `<option value="${escAttr(p.version)}" ${preferred && p.version === preferred.version ? "selected" : ""}>${esc(p.version)}</option>`).join("");
  return `<label class="check package-choice"><input class="plugin-selection" data-slug="${escAttr(plugin.slug)}" data-available="${available.length ? "1" : "0"}" type="checkbox" value="${escAttr(plugin.slug)}" ${checked && available.length ? "checked" : ""} ${available.length ? "" : "disabled"} ${requiredByTemplates ? "disabled" : ""}><span class="plugin-name"><strong>${esc(plugin.name)}</strong><small>${requiredByTemplates ? "Required by selected Elementor templates" : `Exporter: ${esc(plugin.version)}`}</small></span><select class="plugin-version" data-slug="${escAttr(plugin.slug)}" data-exported-version="${escAttr(plugin.version)}" ${available.length ? "" : "disabled"}>${opts || `<option>Missing</option>`}</select><span class="upgrade-badge hidden">Newer version</span><span class="meta ${available.length ? "status-ok" : "status-missing"}">${available.length ? `${available.length} version${available.length === 1 ? "" : "s"}` : "missing"}</span></label>`;
}

function selectedVersionIsNewer(selected, exported) { return compareVersions(exported, selected) > 0; }

function updatePluginUpgradeWarning(select) {
  const row = select.closest(".package-choice");
  const badge = row?.querySelector(".upgrade-badge");
  if (!badge) return false;
  const newer = !select.disabled && selectedVersionIsNewer(select.value, select.dataset.exportedVersion || "");
  badge.classList.toggle("hidden", !newer);
  return newer;
}

function renderCompatibilityPreview() {
  const box = $("#build-compatibility");
  if (!box) return;
  const config = state.configs.find(c => c.id === $("#build-config").value);
  renderPackageUpgradeMeta(config);
  const upgrades = [];
  if (config) {
    const wp = decodeCoordinate($("#build-wordpress").value);
    const theme = decodeTheme($("#build-theme").value);
    if (wp.version && selectedVersionIsNewer(wp.version, config.wordpressVersion)) upgrades.push({ slug: "wordpress", exportedVersion: config.wordpressVersion, selectedVersion: wp.version });
    if (theme.version && config.theme?.version && selectedVersionIsNewer(theme.version, config.theme.version)) upgrades.push({ slug: theme.slug, exportedVersion: config.theme.version, selectedVersion: theme.version });
    upgrades.push(...[...document.querySelectorAll("#build-plugins .plugin-version")].filter(updatePluginUpgradeWarning).map(select => ({ slug: select.dataset.slug, exportedVersion: select.dataset.exportedVersion, selectedVersion: select.value })));
  }
  if (!upgrades.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = `<strong>Upgrade warning</strong><span>Exported settings will be preserved. The selected package versions are newer than the reference site and should be tested.</span><ul>${upgrades.map(item => `<li>${esc(item.slug)} ${esc(item.exportedVersion)} → ${esc(item.selectedVersion)}</li>`).join("")}</ul>`;
}

function selectedMissingElementorDependencies() {
  const selected = new Set(currentElementorSelection || []);
  const available = new Set(elementorTemplatesForBuild().map(template => template.id));
  const missing = [];
  for (const template of elementorTemplatesForBuild()) {
    if (!selected.has(template.id)) continue;
    for (const dependency of template.dependencies || []) if (!available.has(dependency)) missing.push({ template, dependency });
  }
  return missing;
}

async function loadBuildSelection(id) {
  try {
    const config = id ? state.configs.find(c => c.id === id) : null;
    currentReport = id ? await request(`/api/configs/${encodeURIComponent(id)}/check`) : null;
    if (!$("#build-name").dataset.changed) $("#build-name").value = config ? safeUiName(config.id) : "package-only";
    if (!$("#build-locale").dataset.changed) $("#build-locale").value = config?.locale || "en_US";
    renderLocaleOptions(config, $("#build-locale").value);
    renderWordPressOptions(config);
    renderThemeOptions(config);

    renderElementorChecklist();
    const selectedTemplates = templateSelectionFromDom();
    if (config) {
      $("#build-plugins").innerHTML = config.plugins.map(plugin => pluginChoice(plugin, true, plugin.slug === "elementor" && selectedTemplates.length > 0)).join("") || `<span class="muted">No plugins in this snapshot.</span>`;
    } else {
      const availablePlugins = groups("plugin").map(records => ({ slug: records[0].slug, name: displayName(records), version: records[0].version }));
      $("#build-plugins").innerHTML = availablePlugins.map(plugin => pluginChoice(plugin, false, false)).join("") || `<span class="muted">No plugin packages in the library.</span>`;
    }
    document.querySelectorAll("#build-plugins .plugin-version").forEach(select => select.addEventListener("change", renderCompatibilityPreview));
    renderCompatibilityPreview();
  } catch (e) { flash(e.message, true); }
}

function selectWordPressForLocale() {
  const config = state.configs.find(c => c.id === $("#build-config").value) || null;
  const locale = $("#build-locale").value;
  const packages = wordpressPackages();
  const preferred = config
    ? packages.find(p => p.version === config.wordpressVersion && packageVariant(p) === locale) || packages.find(p => packageVariant(p) === locale)
    : packages.find(p => packageVariant(p) === locale);
  if (preferred) $("#build-wordpress").value = coordinateValue(preferred);
  renderPackageUpgradeMeta(config);
  renderCompatibilityPreview();
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
    locale: $("#build-locale").value || "en_US",
    excludedPlugins: excluded,
    wordpressVersion: wp.version,
    wordpressVariant: wp.variant,
    themeSlug: theme.slug,
    themeVersion: theme.version,
    pluginVersions,
    fontSystemId: $("#build-font-system").value,
    designSystemId: $("#build-design-system").value,
    elementorTemplateIds: currentElementorSelection || [],
    elementorTemplateMappings: templateMappingDraft,
    sourceFile: currentEditingProfileFile
  };
  const missingTemplates = selectedMissingElementorDependencies();
  if (missingTemplates.length) {
    const first = missingTemplates[0];
    const reference = first.dependency.startsWith("missing-") ? first.dependency.slice("missing-".length) : first.dependency;
    flash(`Cannot save profile: Elementor template "${first.template.name}" is missing dependency ${reference}. This is a template, not a plugin or setting. Remove "${first.template.name}" or re-import the snapshot with that template included.`, true);
    return;
  }
  try {
    setBusy(true);
    const data = await request("/api/profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (data.compatibility?.status === "upgrade-warning") {
      const upgrades = data.compatibility.warnings.map(w => `${w.slug} ${w.exportedVersion} → ${w.selectedVersion}`).join(", ");
      flash(`Profile ${data.profile.name} saved with upgrade warning: ${upgrades}`);
    } else {
      flash(`Profile ${data.profile.name} saved${configId ? "." : " without a configuration snapshot."}`);
    }
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

async function populateProfileEditor(profile) {
  $("#build-config").value = profile.config?.id || "";
  $("#build-name").dataset.changed = "1";
  $("#build-locale").dataset.changed = "1";
  $("#build-name").value = profile.name;
  $("#build-locale").value = profile.locale || "en_US";
  const baseId = profile.config?.id || "";
  currentElementorSelection = profile.schemaVersion === 8
    ? (profile.elementorTemplateIds || [])
    : profile.schemaVersion >= 7
    ? (profile.elementorTemplates || []).map(old => elementorTemplatesForBuild().find(template => template.snapshotId === old.snapshotId && template.sourceTemplateId === old.templateId)?.id).filter(Boolean)
    : elementorTemplatesForBuild().filter(template => template.snapshotId === baseId).map(template => template.id);
  { const selected=new Set(currentElementorSelection), depended=new Set(elementorTemplatesForBuild().filter(t=>selected.has(t.id)).flatMap(t=>t.dependencies||[])); currentElementorRoots=[...selected].filter(id=>!depended.has(id)); }
  templateMappingDraft = structuredClone(profile.elementorTemplateMappings || {});
  await loadBuildSelection(baseId);
  $("#build-font-system").value = profile.fontSystem?.id || "";
  $("#build-design-system").value = profile.designSystem?.id || "";
  syncFontSelectors();

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
  renderCompatibilityPreview();
}

async function loadProfileIntoEditor(file, duplicate = false, { notify = true } = {}) {
  try {
    const data = await request(`/api/profiles/${encodeURIComponent(file)}`);
    const profile = data.profile;
    currentEditingProfileFile = duplicate ? "" : file;
    await populateProfileEditor(profile);

    $("#cancel-profile-edit").classList.toggle("hidden", duplicate);
    $("#create-profile").textContent = duplicate ? "Save Copy" : "Save Changes";
    goView("build");
    if (notify) flash(duplicate ? `Duplicating ${profile.name}. Choose a new name and save.` : `Editing ${profile.name}.`);
  } catch (e) { flash(e.message, true); }
}

function resetProfileEditor() {
  currentEditingProfileFile = "";
  currentElementorSelection = null;
  currentElementorRoots = null;
  templateMappingDraft = {};
  $("#build-name").dataset.changed = "";
  $("#build-locale").dataset.changed = "";
  $("#build-config").value = "";
  $("#build-font-system").value = "";
  $("#build-design-system").value = "";
  syncFontSelectors();
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

async function deleteConfig(id) {
  const config = state.configs.find(item => item.id === id);
  if (!confirm(`Delete configuration snapshot ${config?.name || id}? Imported Elementor templates will remain in the template library.`)) return;
  try {
    await request(`/api/configs/${encodeURIComponent(id)}`, { method: "DELETE" });
    flash(`Deleted configuration snapshot ${config?.name || id}.`);
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
  $("#profile-select").value = file;
  await loadProfileIntoEditor(file, false, { notify: false });
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

function formatBuildFailure(message) {
  const text = String(message || "Build failed.");
  if (!text.startsWith("Build blocked:")) return { heading: text, detail: "Check the error and try again." };
  return {
    heading: "Build blocked",
    detail: text.replace(/\s*Build blocked:\s*/g, "\n").replace(/\s+Solution:\s*/g, "\nSolution: ").trim()
  };
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
    const compatibility = data.compatibility;
    const warning = compatibility?.status === "upgrade-warning" ? `<div class="compatibility-box"><strong>Build allowed with warnings</strong><span>Exported settings will be preserved. The selected package versions are newer than the reference site and should be tested.</span><ul>${compatibility.warnings.map(item => `<li>${esc(item.slug)} ${esc(item.exportedVersion)} → ${esc(item.selectedVersion)}</li>`).join("")}</ul></div>` : "";
    r.innerHTML = `<strong>Build complete</strong><br>${esc(data.file)}<br><small>SHA-256: ${esc(data.sha256)}</small>${warning}<br><a href="${data.download}">Download build ZIP</a>`;
    r.classList.remove("hidden");
    flash("Build completed successfully.");
    await refresh();
    showBuildProgress(100, "Build complete.", "complete", data.file);
  } catch (e) {
    const failure = formatBuildFailure(e.message);
    showBuildProgress(Number($("#build-progress-percent").textContent.replace("%", "")) || 0, failure.heading, "failed", failure.detail);
    flash(e.message, true);
  } finally {
    $("#build-button").disabled = false;
  }
}
function setBusy(on) { document.body.classList.toggle("busy", on); }

$("#type-devices").onclick = event => { const button=event.target.closest("[data-device]");if(!button)return;activeTypeDevice=button.dataset.device;document.querySelectorAll("#type-devices .device").forEach(item=>item.classList.toggle("active",item===button));renderTypographyDraft(); };
$("#type-add-custom").onclick = () => {restoreTypeDraft();const name=prompt("Custom typography name (for example, Eyebrow):");if(!name?.trim())return;const id=`custom-${Date.now().toString(36)}`;typographyDraft.custom[id]={fontRole:"accent",weight:600,style:"normal",textTransform:"none",textDecoration:"none",size:{desktop:{value:14,unit:"px"}},lineHeight:{desktop:{value:1.3,unit:""}}};typographyDraft.customRoleNames[id]=name.trim();saveTypeDraft();renderTypographyDraft();};
$("#type-clear-device").onclick = () => {restoreTypeDraft();for(const token of [...Object.values(typographyDraft.roles),...Object.values(typographyDraft.custom)])for(const [property] of TYPE_DIMENSIONS)if(token[property])delete token[property][activeTypeDevice];saveTypeDraft();renderTypographyDraft();};
$("#type-save").onclick = async () => {const saved=await saveResource("typography", { schemaVersion: 1, id: $("#type-id").value.trim(), name: $("#type-name").value.trim(), roles: typographyDraft.roles, custom: typographyDraft.custom, fontSlots: typographyDraft.fontSlots, customRoleNames: typographyDraft.customRoleNames });if(saved){$("#type-id").value=saved.id;sessionStorage.removeItem("wpstarter.typographyDraft");}};
$("#type-reset").onclick = resetTypographyEditor;
$("#color-add-custom").onclick = () => {colorDraft ||= freshColorDraft();colorDraft.custom.push({id:`color-${Date.now().toString(36)}`,name:"Custom color",value:"#000000"});renderColorDraft();};
$("#color-save").onclick = async () => {const saved=await saveResource("colors", { schemaVersion: 1, id: $("#color-id").value.trim(), name: $("#color-name").value.trim(), elementor: colorDraft.elementor, custom: colorDraft.custom });if(saved)$("#color-id").value=saved.id;};
$("#color-reset").onclick = resetColorEditor;
$("#ds-save").onclick = async () => {const saved=await saveResource("designSystems", { schemaVersion: 1, id: $("#ds-id").value.trim(), name: $("#ds-name").value.trim(), typographyProfileId: $("#ds-typography").value, colorProfileId: $("#ds-colors").value, fontBindings: bindingDraft });if(saved)$("#ds-id").value=saved.id;};
$("#ds-reset").onclick = resetDesignEditor;
$("#ds-typography").onchange = () => {bindingDraft={};renderBindingDraft();};
$("#ds-colors").onchange = renderBindingDraft;
$("#template-search").oninput = renderElementorChecklist;
$("#template-source").onchange = renderElementorChecklist;
$("#template-type").onchange = renderElementorChecklist;

document.querySelectorAll(".nav").forEach(btn => btn.onclick = () => goView(btn.dataset.view));
$("#refresh").onclick = () => refresh().catch(e => flash(e.message, true));
$("#package-file").onchange = e => uploadFiles([...e.target.files], "packages").catch(e => flash(e.message, true));
$("#font-file").onchange = e => uploadFiles([...e.target.files], "fonts").catch(e => flash(e.message, true));
$("#config-file").onchange = e => uploadFiles([...e.target.files], "configs").catch(e => flash(e.message, true));
const dz = $("#package-drop");
["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", e => uploadFiles([...e.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith(".zip")), "packages").catch(e => flash(e.message, true)));
$("#build-config").onchange = e => { loadBuildSelection(e.target.value); };
$("#build-font-system").onchange = syncFontSelectors;
$("#build-design-system").onchange = () => { syncFontSelectors(); renderTemplateMappings(); };
$("#profile-select").onchange = e => loadProfileIntoEditor(e.target.value, false, { notify: false });
$("#build-name").oninput = e => e.target.dataset.changed = "1";
$("#build-locale").onchange = e => { e.target.dataset.changed = "1"; selectWordPressForLocale(); };
$("#build-wordpress").onchange = e => {
  const selected = decodeCoordinate(e.target.value);
  const locale = selected.variant || "en_US";
  if ([...$("#build-locale").options].some(option => option.value === locale)) {
    $("#build-locale").value = locale;
    $("#build-locale").dataset.changed = "1";
  }
  renderCompatibilityPreview();
};
$("#build-theme").onchange = () => renderCompatibilityPreview();
$("#create-profile").onclick = createProfile;
$("#cancel-profile-edit").onclick = resetProfileEditor;
$("#new-profile").onclick = () => { resetProfileEditor(); goView("build"); };
$("#build-button").onclick = build;
$("#close-inspector").onclick = () => $("#config-inspector").close();
$("#config-inspector").addEventListener("click", e => { if (e.target === $("#config-inspector")) $("#config-inspector").close(); });
$("#compare-configs").onclick = compareConfigs;
$("#close-comparison").onclick = () => $("#config-comparison").close();
$("#config-comparison").addEventListener("click", e => { if (e.target === $("#config-comparison")) $("#config-comparison").close(); });
refresh().catch(e => flash(e.message, true));
