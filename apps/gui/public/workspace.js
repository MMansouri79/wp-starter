/* Workspace composition over the shared builder API; no build logic lives here. */
(() => {
  "use strict";
  const UI = window.WPUI;
  const q = selector => document.querySelector(selector);
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  };
  const originalGoView = window.goView;
  const dirty = new Set();
  let activeView = "overview";
  let step = 0;
  let navigating = false;
  let loadingEditor = false;
  let buildingNow = false;
  const editors = new Map();
  const glyphs = {
    overview:"M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    profiles:"M6 3h9l3 3v15H6z M9 11h6 M9 15h6",
    build:"m9 5 10 7-10 7z", builds:"M3 12a9 9 0 1 0 3-7 M3 3v6h6 M12 7v5l3 2",
    packages:"m3 7 9-4 9 4v10l-9 4-9-4z M3 7l9 5 9-5 M12 12v9",
    configs:"M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5",
    "elementor-templates":"M3 4h18v16H3z M3 9h18 M9 9v11",
    "sample-content":"M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h4",
    "design-systems":"m12 3 9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5",
    fonts:"M4 5h16 M12 5v15 M8 20h8", typography:"m3 20 6-16 6 16 M5 14h8 M17 9h5 M19.5 9v11",
    colors:"M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h4a4 4 0 0 0 4-4c0-3-4-6-9-6z M7 9h.01 M10 6h.01 M16 7h.01"
  };
  const icon = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="${path}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const nav = q(".sidebar nav");
  nav.setAttribute("aria-label","Primary navigation");
  const navButtons = new Map([...nav.querySelectorAll(".nav")].map(button => [button.dataset.view, button]));
  nav.replaceChildren();
  for (const [label, views] of [["Workspace",["overview","profiles","build","builds"]],["Library",["packages","configs","elementor-templates","sample-content"]],["Design",["design-systems","fonts","typography","colors"]]]) {
    nav.append(make("div", "nav-group", label));
    for (const view of views) {
      const button = navButtons.get(view);
      const text = button.textContent;
      button.innerHTML = icon(glyphs[view]) + `<span class="nav-label">${text}</span>`;
      button.title = text;
      button.setAttribute("aria-current", view === activeView ? "page" : "false");
      nav.append(button);
    }
  }
  const skip = make("a", "skip-link", "Skip to workspace");
  skip.href = "#workspace-main";
  q("main").id = "workspace-main";
  document.body.prepend(skip);
  const headerActions = make("div", "header-actions");
  q("header").append(headerActions);
  headerActions.append(q("#refresh"));
  const toggle = make("button", "secondary nav-toggle");
  toggle.innerHTML = icon("M4 6h16 M4 12h16 M4 18h16");
  toggle.setAttribute("aria-label", "Toggle navigation");
  toggle.setAttribute("aria-expanded", "false");
  const closeNav = make("button", "secondary nav-toggle", "Close navigation");
  function setNav(open) {
    document.body.classList.toggle("nav-expanded", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (innerWidth < 768) {
      q("main").inert = open;
      q(".sidebar").inert = !open;
      if (open) closeNav.focus(); else toggle.focus();
    }
  }
  toggle.onclick = () => setNav(!document.body.classList.contains("nav-expanded"));
  closeNav.onclick = () => setNav(false);
  q(".sidebar").prepend(closeNav);
  headerActions.prepend(toggle);
  function responsiveNav() {
    const mobile = innerWidth < 768;
    q(".sidebar").inert = mobile && !document.body.classList.contains("nav-expanded");
    q("main").inert = mobile && document.body.classList.contains("nav-expanded");
  }
  window.addEventListener("resize", responsiveNav);
  responsiveNav();
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && document.body.classList.contains("nav-expanded") && !q("dialog[open]")) setNav(false);
    if (event.key === "Tab" && innerWidth < 768 && document.body.classList.contains("nav-expanded")) {
      const controls = [...q(".sidebar").querySelectorAll("button:not(:disabled),select,a[href]")].filter(el => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  // Preserve each existing profile field and handler while changing its location.
  const profileEditor = q("#build-name").closest(".panel");
  profileEditor.id = "profile-editor";
  profileEditor.classList.add("editor-panel");
  q("#view-profiles").append(profileEditor);
  const buildPanel = q("#build-button").closest(".panel");
  q("#view-build").replaceChildren(buildPanel);
  q("#view-build").classList.add("build-layout");
  const buildSummary = make("div", "review-grid");
  buildSummary.id = "build-summary";
  q("#profile-select").closest("label").after(buildSummary);
  const profileHeading = profileEditor.querySelector("h2");
  profileHeading.textContent = "Profile editor";
  const wizard = make("div", "wizard-tabs");
  wizard.setAttribute("role", "tablist");
  wizard.setAttribute("aria-label", "Profile steps");
  profileHeading.after(wizard);
  const names = ["Basics", "Packages", "Design & fonts", "Templates & content", "Review"];
  const groups = [
    ["#build-config", "#build-name", "#build-locale"],
    ["#build-wordpress", "#build-theme", "#build-plugins"],
    ["#build-design-system", "#build-font-systems"],
    ["#build-elementor-templates", "#template-mappings", "#build-site-content", "#build-sample-content"]
  ];
  const sections = names.map((name, index) => {
    const button = make("button", "", `${index + 1}. ${name}`);
    button.id = `profile-tab-${index}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", `profile-step-${index}`);
    button.onclick = () => showStep(index);
    wizard.append(button);
    const section = make("div", "wizard-step");
    section.id = `profile-step-${index}`;
    section.setAttribute("role", "tabpanel");
    section.setAttribute("aria-labelledby", button.id);
    profileEditor.append(section);
    for (const selector of groups[index] || []) {
      const field = q(selector);
      section.append(field.closest(".field") || field.closest("label") || field);
    }
    return section;
  });
  const profileActions = q("#create-profile").closest(".profile-actions");
  sections[4].append(profileActions);
  const summary = make("div", "review-grid");
  summary.id = "profile-review";
  sections[4].prepend(summary);
  const readiness = make("div", "readiness-links");
  summary.after(readiness);
  const wizardActions = make("div", "wizard-actions");
  const back = make("button", "secondary", "Back");
  const next = make("button", "primary", "Next step");
  back.onclick = () => showStep(step - 1);
  next.onclick = () => showStep(step + 1);
  wizardActions.append(back, next);
  profileEditor.append(wizardActions);
  wizard.addEventListener("keydown", event => {
    if (!["ArrowRight","ArrowLeft","Home","End"].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === "Home" ? 0 : event.key === "End" ? 4 : (step + (event.key === "ArrowRight" ? 1 : 4)) % 5;
    showStep(target);
    wizard.children[target].focus();
  });
  function profileErrors() {
    const errors = [];
    if (!q("#build-name").value.trim()) errors.push({ index:0, input:q("#build-name"), message:"Enter a profile name." });
    if (!q("#build-wordpress").value) errors.push({ index:1, input:q("#build-wordpress"), message:"Import and select a WordPress package." });
    if (typeof selectedMissingElementorDependencies === "function" && selectedMissingElementorDependencies().length) errors.push({ index:3, input:q("#template-search"), message:"Resolve missing template dependencies before saving." });
    if ([...q("#template-mapping-rows").querySelectorAll("select")].some(select => !select.value)) errors.push({ index:3, input:q("#template-search"), message:"Assign the unresolved template design references." });
    return errors;
  }
  function summaryCell(label, value) {
    const cell = make("div");
    cell.append(make("small", "", label), make("strong", "", value || "None"));
    return cell;
  }
  function reviewProfile() {
    summary.replaceChildren(
      summaryCell("Profile", q("#build-name").value),
      summaryCell("Locale", q("#build-locale").value),
      summaryCell("WordPress", q("#build-wordpress").selectedOptions[0]?.textContent),
      summaryCell("Theme", q("#build-theme").selectedOptions[0]?.textContent),
      summaryCell("Plugins", `${q("#build-plugins").querySelectorAll("input:checked").length} selected`),
      summaryCell("Design system", q("#build-design-system").selectedOptions[0]?.textContent),
      summaryCell("Exported site content", [q("#build-site-posts").checked ? "All posts" : "", q("#build-site-products").checked ? "All products" : ""].filter(Boolean).join(" · "))
    );
    readiness.replaceChildren();
    for (const error of profileErrors()) {
      const link = make("button", "secondary", error.message);
      link.onclick = () => { showStep(error.index); error.input.focus(); };
      readiness.append(link);
    }
    if (!readiness.children.length) readiness.append(make("p", "status-ok", "Ready to save. Package compatibility is checked by the builder."));
  }
  function showStep(index) {
    step = Math.max(0, Math.min(4, index));
    sections.forEach((section, i) => {
      section.hidden = i !== step;
      wizard.children[i].setAttribute("aria-selected", String(i === step));
      wizard.children[i].tabIndex = i === step ? 0 : -1;
    });
    back.disabled = step === 0;
    next.hidden = step === 4;
    if (step === 4) reviewProfile();
    UI.animate(sections[step]);
  }
  showStep(0);
  profileEditor.hidden = true;
  profileEditor.addEventListener("reveal-field", event => {
    const section = event.target.closest(".wizard-step");
    if (section) showStep(sections.indexOf(section));
  });

  // Resource editors start closed and remain independent of their library lists.
  for (const [view, name, reset] of [["typography","Typography profile",() => resetTypographyEditor(true)],["colors","Color profile",() => { colorDraft=freshColorDraft();q("#color-id").value="";q("#color-name").value="";renderColorDraft(); }],["design-systems","Design system",() => resetDesignEditor()]]) {
    const panels = q(`#view-${view}`).querySelectorAll(":scope > .panel");
    const panel = panels[1];
    panel.classList.add("editor-panel");
    panel.hidden = true;
    const create = make("button", "primary", `New ${name.toLowerCase()}`);
    panels[0].querySelector(".panel-head").append(create);
    create.onclick = async () => {
      if (dirty.has(view) && !await UI.discard()) return;
      await reset();dirty.delete(view);UI.validate(panel,[]);panel.hidden=false;panel.scrollIntoView({block:"start"});UI.animate(panel);
    };
    const cancel = make("button", "secondary", "Close editor");
    cancel.onclick = async () => {
      if (dirty.has(view) && !await UI.discard()) return;
      await reset(); dirty.delete(view); panel.hidden=true;
    };
    const save = panel.querySelector("#type-save,#color-save,#ds-save");
    save.closest(".profile-actions").append(cancel);
    editors.set(view, {panel, reset});
  }
  const originalEditResource = window.editResource;
  window.editResource = async (...args) => {
    const view = {typography:"typography",colors:"colors",designSystems:"design-systems"}[args[0]];
    if (!await leaveEditor()) return;
    loadingEditor = true;
    originalEditResource(...args);
    loadingEditor = false;
    editors.get(view).panel.hidden = false;
    UI.validate(editors.get(view).panel,[]);
    dirty.delete(view);
    UI.animate(editors.get(view).panel);
  };
  // Two independently labelled typography tabs retain the original row editors.
  const typePanel = editors.get("typography").panel;
  const headings = [...typePanel.querySelectorAll(":scope > h3")];
  const typeTabs = make("div", "editor-tabs");
  typeTabs.setAttribute("role", "tablist");
  typeTabs.setAttribute("aria-label", "Typography sections");
  const typeSections = [];
  const typeNodes = [...typePanel.children];
  headings.forEach((heading, i) => {
    const section = make("div");
    section.id = `typography-section-${i}`;
    section.setAttribute("role", "tabpanel");
    const nodes = typeNodes.slice(typeNodes.indexOf(heading), i === 0 ? typeNodes.indexOf(headings[1]) : typeNodes.length);
    // Keep the final Save/Reset action bar outside the tabs.
    nodes.forEach(el => { if (el.contains(q("#type-save"))) return; section.append(el); });
    typeSections.push(section);
    typePanel.append(section);
    const button = make("button", "", i ? "Global Fonts" : "Theme Style");
    button.id = `typography-tab-${i}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", section.id);
    section.setAttribute("aria-labelledby", button.id);
    button.onclick = () => selectTypeTab(i);
    typeTabs.append(button);
  });
  function selectTypeTab(index) {
    typeSections.forEach((section, i) => { section.hidden=i!==index;typeTabs.children[i].setAttribute("aria-selected",String(i===index));typeTabs.children[i].tabIndex=i===index?0:-1; });
    UI.animate(typeSections[index]);
  }
  typeTabs.addEventListener("keydown", event => {
    if (["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) {event.preventDefault();const index=event.key==="Home"?0:event.key==="End"?1:typeSections[0].hidden?0:1;selectTypeTab(index);typeTabs.children[index].focus();}
  });
  q("#type-name").closest("label").after(typeTabs);
  const globalAddActions = make("div", "profile-actions");
  globalAddActions.append(q("#global-font-add-custom"));
  typeSections[1].append(globalAddActions);
  typePanel.append(q("#type-save").closest(".profile-actions"));
  selectTypeTab(0);

  const originalLoadProfile = window.loadProfileIntoEditor;
  window.loadProfileIntoEditor = async (file, duplicate = false, options = {}) => {
    if (!options.forBuild && !await leaveEditor()) return;
    loadingEditor = true;
    await originalLoadProfile(file, duplicate, options);
    loadingEditor = false;
    if (!options.forBuild) {profileEditor.hidden=false;dirty.delete("profiles");UI.validate(profileEditor,[]);showStep(0);goView("profiles");}
  };
  q("#new-profile").onclick = async () => {
    if (!await leaveEditor()) return;
    await resetProfileEditor();
    dirty.delete("profiles");UI.validate(profileEditor,[]);profileEditor.hidden=false;showStep(0);goView("profiles");
    q("#cancel-profile-edit").classList.remove("hidden");
    q("#build-name").focus();
  };
  const originalCreateProfile = window.createProfile;
  let profileSaving=false;
  q("#create-profile").onclick = async () => {
    if (profileSaving || q("#create-profile").disabled) return;
    const errors = profileErrors();
    if (!UI.validate(profileEditor, errors)) { showStep(4); return; }
    profileSaving=true;q("#create-profile").disabled = true;
    try { await originalCreateProfile(); } finally { profileSaving=false;q("#create-profile").disabled=false; }
  };
  q("#cancel-profile-edit").classList.remove("hidden");
  q("#cancel-profile-edit").onclick = async () => {
    if (dirty.has("profiles") && !await UI.discard()) return;
    resetProfileEditor();dirty.delete("profiles");profileEditor.hidden=true;
  };
  q("#profile-select").onchange = () => renderBuildSummary();
  function renderBuildSummary() {
    const profile = state?.profiles.find(item => item.file === q("#profile-select").value);
    buildSummary.replaceChildren();
    q("#build-button").disabled=buildingNow||!profile;
    if (!profile) {
      const hint=make("div");hint.append(make("p", "muted", "Create a profile to choose your exact packages and optional resources."));
      const create=make("button","secondary","Create a profile");create.onclick=()=>q("#new-profile").click();hint.append(create);buildSummary.append(hint);return;
    }
    buildSummary.append(summaryCell("Profile",profile.name),summaryCell("WordPress",profile.wordpress),summaryCell("Theme",profile.theme),summaryCell("Plugins",String(profile.plugins)));
    const readiness=make("p","field-help","Profile selected. The builder checks package availability and compatibility when you start.");readiness.setAttribute("role","status");buildSummary.append(readiness);
  }
  window.buildProfileFile = async file => {
    q("#profile-select").value=file;
    if (!await goView("build")) return;
    await build();
  };
  // The running job continues polling while the user browses other views.
  const globalBuild = make("div", "global-build");
  globalBuild.hidden=true;
  globalBuild.setAttribute("role","status");
  const buildText=make("span");
  const miniTrack=make("div","mini-track"),miniFill=make("span");miniTrack.append(miniFill);
  const openBuild=make("button","secondary","View build");openBuild.onclick=()=>goView("build");
  globalBuild.append(buildText,miniTrack,openBuild);
  const dismissBuild=make("button","secondary","Dismiss");dismissBuild.hidden=true;dismissBuild.onclick=()=>{globalBuild.hidden=true;};globalBuild.append(dismissBuild);
  q("header").after(globalBuild);
  const originalProgress=window.showBuildProgress;
  window.showBuildProgress=(percent,message,status,detail)=>{
    originalProgress(percent,message,status,detail);
    globalBuild.hidden=false;buildText.textContent=`${message} · ${Math.round(Math.max(0,Math.min(100,Number(percent)||0)))}%`;
    dismissBuild.hidden=!status||status==="running"||status==="queued";
    miniFill.style.width=`${Math.max(0,Math.min(100,Number(percent)||0))}%`;
    q("#build-progress").setAttribute("role","progressbar");
    q("#build-progress").setAttribute("aria-label",message);
    q("#build-progress").setAttribute("aria-valuenow",String(percent));
    q("#build-progress").setAttribute("aria-valuemin","0");q("#build-progress").setAttribute("aria-valuemax","100");
  };
  const originalBuild=window.build;
  window.build=async()=>{
    if(buildingNow||q("#build-button").disabled)return;
    if (!await goView("build")) return;
    buildingNow=true;
    try{await originalBuild();}finally{buildingNow=false;renderBuildSummary();}
  };
  q("#build-button").onclick=()=>build();

  // Search only rendered library records, leaving selection and source data intact.
  const filters=[];
  for(const [view,selector,kind] of [["packages","#packages-body","package"],["fonts","#fonts-list"],["configs","#configs-list"],["elementor-templates","#elementor-templates-body","template"],["profiles","#profiles-manager"],["typography","#typography-list"],["colors","#colors-list"],["design-systems","#design-systems-list"],["builds","#build-history"]]) {
    const list=q(selector),tools=make("div","library-tools"),input=make("input");
    input.type="search";input.placeholder=`Search ${titles[view][0].toLowerCase()}`;input.setAttribute("aria-label",input.placeholder);tools.append(input);
    let select;
    if(kind){select=make("select");select.setAttribute("aria-label",kind==="package"?"Package type":"Template type");for(const value of kind==="package"?["All types","wordpress","theme","plugin"]:["All types"]){const option=make("option","",value);option.value=value==="All types"?"":value;select.append(option);}tools.append(select);}
    const wrapper=list.closest(".table-wrap")||list;wrapper.before(tools);
    const empty=make("p","search-empty","No matching items. Try another search or clear the filters.");empty.hidden=true;wrapper.after(empty);
    const filter=()=>{
      if(kind==="template"&&select){const current=select.value;const types=[...new Set((state?.elementorTemplates||[]).map(item=>item.type))];if(types.join("|")!==select.dataset.types){select.dataset.types=types.join("|");select.replaceChildren(make("option","","All types"));select.firstChild.value="";types.forEach(type=>{const option=make("option","",type);option.value=type;select.append(option);});select.value=current;}}
      let visible=0;
      for(const row of list.children){const type=kind==="package"?row.querySelector(".badge")?.textContent:kind==="template"?row.children[1]?.textContent:"";row.hidden=!UI.matchesSearch(row.textContent,input.value)||(select?.value&&type!==select.value);if(!row.hidden)visible++;}
      empty.hidden=visible>0||(!input.value&&!select?.value);
    };
    input.oninput=filter;if(select)select.onchange=filter;filters.push(filter);
  }
  const overviewPanel=q("#view-overview .steps").closest(".panel");
  overviewPanel.querySelector("h2").textContent="Your next starter, in three steps";
  q("#view-overview .steps").remove();
  const guide=make("div","setup-guide");
  for(const [label,text,view] of [["1 · Prepare your library","Import WordPress, themes and plugins. Add configuration and design resources when needed.","packages"],["2 · Create a profile","Choose exact versions and optional content in a guided editor.","profiles"],["3 · Build and download","Generate an offline WordPress ZIP from a saved profile.","build"]]) {
    const button=make("button","secondary");button.append(make("span","",label),make("strong","",view==="packages"?"Import packages":view==="profiles"?"Create profile":"Build a starter"),make("small","",text));button.onclick=()=>view==="profiles"?q("#new-profile").click():goView(view);guide.append(button);
  }
  overviewPanel.append(guide);
  const sampleView=q("#view-sample-content"),samplePanels=[...sampleView.children],sampleTabs=make("div","editor-tabs");
  sampleTabs.setAttribute("role","tablist");sampleTabs.setAttribute("aria-label","Sample library sections");
  const sampleSections=[];
  for(const [index,name,panels] of [[0,"Content",samplePanels.slice(0,2)],[1,"Taxonomies",samplePanels.slice(2,4)],[2,"Media",samplePanels.slice(4)]]){
    const section=make("div");section.id=`sample-section-${index}`;section.setAttribute("role","tabpanel");section.setAttribute("aria-labelledby",`sample-tab-${index}`);section.append(...panels);sampleView.append(section);sampleSections.push(section);
    const button=make("button","",name);button.id=`sample-tab-${index}`;button.setAttribute("role","tab");button.setAttribute("aria-controls",section.id);button.onclick=()=>selectSampleSection(index);sampleTabs.append(button);
  }
  function selectSampleSection(index){sampleSections.forEach((section,i)=>{section.hidden=i!==index;sampleTabs.children[i].setAttribute("aria-selected",String(i===index));sampleTabs.children[i].tabIndex=i===index?0:-1;});UI.animate(sampleSections[index]);}
  sampleTabs.addEventListener("keydown",event=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();const current=[...sampleTabs.children].indexOf(document.activeElement);const next=event.key==="Home"?0:event.key==="End"?2:(current+(event.key==="ArrowRight"?1:2))%3;selectSampleSection(next);sampleTabs.children[next].focus();});
  sampleView.prepend(sampleTabs);selectSampleSection(0);
  const sampleFilter=make("select");sampleFilter.id="sample-kind-filter";sampleFilter.setAttribute("aria-label","Sample type");for(const [value,label] of [["","All content"],["post","Posts"],["product","Products"]]){const option=make("option","",label);option.value=value;sampleFilter.append(option);}
  const sampleTools=make("div","library-tools");q("#sample-search").before(sampleTools);sampleTools.append(q("#sample-search"),sampleFilter);sampleFilter.onchange=()=>SampleContentUI.render(state);
  async function leaveEditor() {
    if (loadingEditor) return true;
    if (activeView === "sample-content") return await SampleContentUI.confirmLeave();
    if (!dirty.has(activeView)) return true;
    if (!await UI.discard()) return false;
    dirty.delete(activeView);
    if (activeView === "profiles") {await resetProfileEditor();profileEditor.hidden=true;}
    if (editors.has(activeView)) {await editors.get(activeView).reset();editors.get(activeView).panel.hidden=true;}
    return true;
  }
  window.goView=async view=>{
    if(!titles[view]||navigating)return false;
    if(view!==activeView&&!loadingEditor){navigating=true;const allowed=await leaveEditor();navigating=false;if(!allowed){if(innerWidth<768)setNav(false);return false;}}
    originalGoView(view);activeView=view;
    navButtons.forEach((button,key)=>button.setAttribute("aria-current",key===view?"page":"false"));
    if(innerWidth<768)setNav(false);
    if(view==="build")renderBuildSummary();
    q("#title").tabIndex=-1;q("#title").focus({preventScroll:true});UI.animate(q(`#view-${view}`));
    return true;
  };
  navButtons.forEach(button=>button.onclick=()=>goView(button.dataset.view));
  document.addEventListener("input",event=>{
    const panel=event.target.closest(".editor-panel");if(!panel)return;
    const view=panel.closest(".view").id.replace("view-","");dirty.add(view);
  });
  document.addEventListener("change",event=>{
    const panel=event.target.closest(".editor-panel");if(panel)dirty.add(panel.closest(".view").id.replace("view-",""));
  });
  window.addEventListener("beforeunload",event=>{if(dirty.size){event.preventDefault();event.returnValue="";}});
  document.addEventListener("wpstarter:saved",event=>{dirty.delete(event.detail);});
  // Keep editable selections through a library refresh, including dynamically rebuilt lists.
  function captureFields(container) {
    return [...container.querySelectorAll("input,select,textarea")].map(input => ({ id:input.id, data:{...input.dataset}, value:input.value, checked:input.checked, tag:input.tagName, type:input.type }));
  }
  function restoreFields(container, saved) {
    const inputs=[...container.querySelectorAll("input,select,textarea")];
    for(const item of saved){const input=item.id?q(`#${CSS.escape(item.id)}`):inputs.find(candidate=>candidate.tagName===item.tag&&candidate.type===item.type&&JSON.stringify({...candidate.dataset})===JSON.stringify(item.data)&&(!["checkbox","radio"].includes(item.type)||candidate.value===item.value));if(!input)continue;if(item.type==="checkbox"||item.type==="radio")input.checked=item.checked;else input.value=item.value;}
  }
  const originalRender=window.render;
  window.render=()=>{
    const profileFields=profileEditor.hidden?null:captureFields(profileEditor);
    const resourceFields=new Map([...editors].filter(([,editor])=>!editor.panel.hidden).map(([view,editor])=>[view,captureFields(editor.panel)]));
    originalRender();
    if(profileFields){restoreFields(profileEditor,profileFields);renderCompatibilityPreview();}
    resourceFields.forEach((fields,view)=>restoreFields(editors.get(view).panel,fields));
    filters.forEach(filter=>filter());renderBuildSummary();compactTypography();
    const location=q(".library-location");if(location)location.hidden=!state.library;
    q("#cancel-profile-edit").classList.remove("hidden");
  };
  function compactTypography() {
    for(const selector of ["#type-rows","#global-font-rows"]){
      const body=q(selector),table=body.closest("table");
      const labels=["Typography","Font slot","Weight","Style","Size","Line height","Letter spacing","Word spacing","Transform","Decoration"];
      for(const row of body.children){
        if(row.dataset.compact)return;
        const cells=[...row.children];if(cells.length!==11)continue;
        const details=make("details","typography-details"),summary=make("summary","","More settings"),fields=make("div","sample-fields");
        details.append(summary,fields);
        for(const index of [3,5,6,7,8,9]){const label=make("label","",labels[index]);while(cells[index].firstChild)label.append(cells[index].firstChild);fields.append(label);}
        const cell=make("td");cell.append(details);row.replaceChildren(cells[0],cells[1],cells[2],cells[4],cell,cells[10]);row.dataset.compact="1";
      }
      const head=table.querySelector("thead tr");head.replaceChildren(...[selector==="#type-rows"?"Typography":"Global Font","Font slot","Weight","Size","Details",""] .map(label=>make("th","",label)));
    }
  }
  const originalTypeRender=window.renderTypographyDraft,originalGlobalRender=window.renderGlobalFontsDraft;
  window.renderTypographyDraft=()=>{originalTypeRender();compactTypography();};
  window.renderGlobalFontsDraft=()=>{originalGlobalRender();compactTypography();};
  const deviceIcons={desktop:"M3 4h18v12H3z M8 21h8 M12 16v5",tablet:"M5 3h14v18H5z M12 18h.01",mobile:"M7 2h10v20H7z M12 19h.01"};
  q("#type-devices").setAttribute("role","group");q("#type-devices").setAttribute("aria-label","Typography breakpoint");
  for(const button of q("#type-devices").children){button.innerHTML=icon(deviceIcons[button.dataset.device])+` ${button.dataset.device[0].toUpperCase()+button.dataset.device.slice(1)}`;button.setAttribute("aria-pressed",String(button.classList.contains("active")));}
  const originalDeviceClick=q("#type-devices").onclick;
  q("#type-devices").onclick=event=>{originalDeviceClick(event);for(const button of q("#type-devices").children)button.setAttribute("aria-pressed",String(button.classList.contains("active")));};
  for(const [selector,label] of [["#template-search","Search templates"],["#template-source","Template source site"],["#template-type","Template type"],["#sample-search","Search sample content"]])q(selector).setAttribute("aria-label",label);
  const originalRequest=window.request,pending=new Map();
  window.request=(url,options={})=>{
    const method=String(options.method||"GET").toUpperCase();
    if(method==="GET")return originalRequest(url,options);
    const key=`${method}:${url}:${typeof options.body==="string"?options.body:"upload"}`;
    if(pending.has(key))return pending.get(key);
    const button=document.activeElement?.tagName==="BUTTON"?document.activeElement:null;
    const wasDisabled=button?.disabled;if(button)button.disabled=true;
    const operation=originalRequest(url,options).finally(()=>{pending.delete(key);if(button?.isConnected)button.disabled=wasDisabled;});
    pending.set(key,operation);return operation;
  };
  profileEditor.addEventListener("click",event=>{if(event.target.matches("input[type=checkbox]"))dirty.add("profiles");});
  document.addEventListener("click",event=>{if(event.target.closest("#type-add-custom,#global-font-add-custom,#color-add-custom,.remove-custom-type,.remove-global-font,.remove-custom-color,#type-clear-device"))dirty.add(activeView);});
  const originalSaveResource=window.saveResource;
  window.saveResource=async(kind,value)=>{
    const view={typography:"typography",colors:"colors",designSystems:"design-systems"}[kind];
    const name=q(kind==="typography"?"#type-name":kind==="colors"?"#color-name":"#ds-name");
    const entries=[{input:name,message:!value.name?.trim()?"Enter a profile name.":null}];
    if(kind==="colors")for(const input of q("#color-rows").querySelectorAll(".hex-input")){input.id||=`color-hex-${input.dataset.colorHex}`;entries.push({input,message:!/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(input.value)?"Enter a six or eight digit hexadecimal color.":null});}
    if(kind==="designSystems"){
      for(const selector of ["#ds-typography","#ds-colors"]){const input=q(selector);entries.push({input,message:!input.value?`Choose a ${selector.includes("typography")?"typography":"color"} profile.`:null});}
      for(const input of q("#ds-binding-list").querySelectorAll("select")){input.id||=`ds-slot-${input.dataset.slot}`;entries.push({input,message:!input.value?"Assign a font profile for this slot.":null});}
    }
    if(!UI.validate(editors.get(view).panel,entries))return null;
    return originalSaveResource(kind,value);
  };
  for (const selector of ["#type-save","#color-save","#ds-save","#create-profile"]) {
    const actions=q(selector).closest(".profile-actions"),panel=actions.closest(".editor-panel");
    actions.classList.add("save-actions");
    (selector==="#create-profile"?wizard:panel.querySelector(".panel-head,h2")).after(actions);
  }
  q("#type-reset").onclick=async()=>{if(await resetTypographyEditor()){dirty.delete("typography");UI.validate(editors.get("typography").panel,[]);}};
  q("#color-reset").onclick=async()=>{if(await resetColorEditor()){dirty.delete("colors");UI.validate(editors.get("colors").panel,[]);}};
  q("#ds-reset").onclick=async()=>{if(dirty.has("design-systems")&&!await UI.discard())return;resetDesignEditor();dirty.delete("design-systems");UI.validate(editors.get("design-systems").panel,[]);};
  // Keep existing theme and token editing handlers intact; add semantic tab behavior.
  window.WPWorkspace={showStep,profileErrors,reviewProfile,filters,dirty,leaveEditor};
})();
