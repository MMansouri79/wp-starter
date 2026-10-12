/* Shared offline UI primitives. Loaded before paint on every app page. */
(function (root) {
  "use strict";
  const storageKey = "wpstarter.theme";
  const normalizeTheme = value => ["light", "dark", "system"].includes(value) ? value : "system";
  const resolveTheme = (value, dark) => normalizeTheme(value) === "system" ? (dark ? "dark" : "light") : value;
  const matchesSearch = (text, query) => String(text).toLocaleLowerCase().includes(String(query).trim().toLocaleLowerCase());
  const motion = { feedback: 120, section: 180, enter: 220, exit: 150 };
  const UI = { normalizeTheme, resolveTheme, matchesSearch, motion };
  if (typeof module !== "undefined") module.exports = UI;
  root.WPUI = UI;
  if (typeof document === "undefined") return;
  let preference = "system";
  const media = root.matchMedia("(prefers-color-scheme: dark)");
  try { preference = normalizeTheme(localStorage.getItem(storageKey)); } catch { /* Storage is optional. */ }
  function applyTheme() {
    document.documentElement.dataset.theme = resolveTheme(preference, media.matches);
    document.documentElement.style.colorScheme = document.documentElement.dataset.theme;
  }
  applyTheme();
  media.addEventListener("change", applyTheme);
  UI.setTheme = value => {
    preference = normalizeTheme(value);
    try { localStorage.setItem(storageKey, preference); } catch { /* Private browsing. */ }
    applyTheme();
    document.querySelectorAll("[data-theme-picker]").forEach(picker => { picker.value = preference; });
  };
  root.addEventListener("storage", event => {
    if (event.key === storageKey) UI.setTheme(event.newValue);
  });
  UI.themeControl = () => {
    const label = document.createElement("label");
    label.className = "theme-control";
    label.textContent = "Appearance";
    const select = document.createElement("select");
    select.dataset.themePicker = "";
    select.setAttribute("aria-label", "Appearance");
    for (const value of ["system", "light", "dark"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value[0].toUpperCase() + value.slice(1);
      select.append(option);
    }
    select.value = preference;
    select.addEventListener("change", () => UI.setTheme(select.value));
    label.append(select);
    return label;
  };
  const dialogQueue = [];
  let dialogActive = false;
  UI.dialog = options => new Promise(resolve => {
    dialogQueue.push({ options, resolve });
    openNext();
  });
  function openNext() {
    if (dialogActive || !dialogQueue.length) return;
    dialogActive = true;
    const { options, resolve } = dialogQueue.shift();
    const returnFocus = document.activeElement;
    const dialog = document.createElement("dialog");
    dialog.className = "ui-dialog";
    dialog.setAttribute("aria-labelledby", "ui-dialog-title");
    dialog.setAttribute("aria-describedby", "ui-dialog-message");
    const title = document.createElement("h2");
    title.id = "ui-dialog-title";
    title.textContent = options.title || "Confirm action";
    const message = document.createElement("p");
    message.id = "ui-dialog-message";
    message.textContent = options.message || "";
    const form = document.createElement("form");
    let input;
    if (options.input) {
      const label = document.createElement("label");
      label.textContent = options.label || "Name";
      input = document.createElement(options.choices ? "select" : "input");
      if (options.choices) {
        for (const item of options.choices) {
          const option = document.createElement("option");
          option.value = item.value;
          option.textContent = item.label;
          input.append(option);
        }
      } else {
        input.type = options.secret ? "password" : "text";
        if (options.secret) input.autocomplete = "new-password";
      }
      input.value = options.value || input.value;
      input.required = true;
      label.append(input);
      form.append(label);
    }
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary";
    cancel.textContent = options.cancel || "Cancel";
    const accept = document.createElement("button");
    accept.type = "submit";
    accept.className = options.destructive ? "primary danger" : "primary";
    accept.textContent = options.accept || "Continue";
    actions.append(cancel, accept);
    form.append(actions);
    dialog.append(title, message, form);
    if (options.assets && input) {
      const preview=document.createElement("img");preview.className="asset-preview";
      const updatePreview=()=>{const asset=options.assets.find(asset=>asset.id===input.value);if(!asset){preview.hidden=true;return;}preview.hidden=false;preview.src=`/api/sample-content/assets/${encodeURIComponent(asset.id)}`;preview.alt=asset.alt||asset.filename;};
      input.addEventListener("change",updatePreview);form.prepend(preview);updatePreview();
    }
    let result = null;
    cancel.onclick = () => dialog.close();
    form.onsubmit = event => {
      event.preventDefault();
      if (input && !input.value.trim()) return;
      result = input ? input.value.trim() : true;
      dialog.close();
    };
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (returnFocus?.isConnected) returnFocus.focus();
      dialogActive = false;
      resolve(result);
      openNext();
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
    UI.animate(dialog);
    (input || cancel).focus();
  }
  UI.confirm = message => UI.dialog({ title: "Confirm change", message, accept: "Confirm", destructive: true });
  UI.prompt = (message, value = "") => UI.dialog({ title: "Add a name", message, input: true, value, accept: "Add" });
  UI.pickAsset = assets => UI.dialog({ title: "Insert local image", message: "Choose an image from the offline media library.", input: true, label: "Image", assets, choices: assets.map(asset => ({value: asset.id, label: asset.filename})), accept: "Insert image" });
  UI.discard = () => UI.dialog({ title: "Unsaved changes", message: "Your draft has not been saved. Keep editing or discard these changes.", cancel: "Keep editing", accept: "Discard", destructive: true });
  UI.animate = element => {
    if (!element || root.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    element.getAnimations?.().forEach(animation => animation.cancel());
    element.animate?.([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: motion.enter, easing: "cubic-bezier(.2,.8,.2,1)" });
  };
  UI.notify = (message, error = false) => {
    const box = document.querySelector("#flash,#message");
    if (!box) return;
    clearTimeout(UI.notify.timer);
    box.replaceChildren();
    box.classList.remove("hidden", "ws-hidden");
    box.classList.toggle("error", error);
    box.setAttribute("role", error ? "alert" : "status");
    const text = document.createElement("span");
    text.textContent = message;
    const close = document.createElement("button");
    close.className = "secondary";
    close.textContent = "Dismiss";
    close.onclick = () => box.classList.add("hidden");
    box.append(text, close);
    if (!error) UI.notify.timer = setTimeout(() => box.classList.add("hidden"), 6500);
  };
  UI.validate = (container, entries) => {
    container.querySelector(".error-summary")?.remove();
    container.querySelectorAll("[aria-invalid]").forEach(input => {
      input.removeAttribute("aria-invalid");
      if (input.getAttribute("aria-describedby") === `${input.id}-error`) input.removeAttribute("aria-describedby");
    });
    container.querySelectorAll(".inline-error").forEach(error => error.remove());
    const errors = entries.filter(entry => entry.message);
    if (!errors.length) return true;
    const summary = document.createElement("div");
    summary.className = "error-summary";
    summary.tabIndex = -1;
    summary.setAttribute("role", "alert");
    const heading = document.createElement("strong");
    heading.textContent = "Please check these fields";
    summary.append(heading);
    for (const { input, message } of errors) {
      input.setAttribute("aria-invalid", "true");
      const inline = document.createElement("small");
      inline.className = "inline-error";
      inline.id = `${input.id}-error`;
      inline.textContent = message;
      input.setAttribute("aria-describedby", inline.id);
      input.after(inline);
      const link = document.createElement("a");
      link.href = `#${input.id}`;
      link.textContent = message;
      link.onclick = event => { event.preventDefault(); input.dispatchEvent(new CustomEvent("reveal-field", { bubbles: true })); input.focus(); };
      summary.append(link);
    }
    container.prepend(summary);
    summary.focus();
    return false;
  };
  document.addEventListener("DOMContentLoaded", () => {
    const target = document.querySelector(".sidebar-foot,.ws-admin-header nav,.ws-auth-card");
    target?.append(UI.themeControl());
    const library=document.getElementById("library");
    if(library){const details=document.createElement("details"),summary=document.createElement("summary");details.className="advanced library-location";summary.textContent="Library location";details.append(summary,library);target.append(details);details.hidden=!library.textContent;}
    document.querySelectorAll("dialog:not(.ui-dialog)").forEach(dialog => {
      const title = dialog.querySelector("h2[id]");
      if (title) dialog.setAttribute("aria-labelledby", title.id);
    });
  });
})(typeof window === "undefined" ? globalThis : window);
