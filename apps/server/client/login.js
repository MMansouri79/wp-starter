/* Sign-in and invite-based account creation. */
(function () {
  "use strict";

  var state = { mode: "login", openRegistration: false };
  var form = document.getElementById("form");
  var errorBox = document.getElementById("error");
  var noticeBox = document.getElementById("notice");
  var submit = document.getElementById("submit");
  var inviteField = document.getElementById("invite-field");
  var nameField = document.getElementById("name-field");
  var toggle = document.getElementById("toggle");
  var togglePrompt = document.getElementById("toggle-prompt");
  var subtitle = document.getElementById("subtitle");
  var passwordInput = document.getElementById("password");

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove("ws-hidden");
    noticeBox.classList.add("ws-hidden");
  }

  function showNotice(message) {
    noticeBox.textContent = message;
    noticeBox.classList.remove("ws-hidden");
    errorBox.classList.add("ws-hidden");
  }

  function clearMessages() {
    errorBox.classList.add("ws-hidden");
    noticeBox.classList.add("ws-hidden");
  }

  function setMode(mode) {
    state.mode = mode;
    var creating = mode === "register";

    inviteField.classList.toggle("ws-hidden", !creating);
    nameField.style.display = creating ? "" : "none";
    submit.textContent = creating ? "Create account" : "Sign in";
    toggle.textContent = creating ? "Sign in instead" : "Create an account";
    togglePrompt.textContent = creating ? "Already have an account?" : "Have an invitation code?";
    subtitle.textContent = creating
      ? "Create your account with the invitation code you received."
      : "Sign in to the shared starter library.";
    passwordInput.setAttribute("autocomplete", creating ? "new-password" : "current-password");
    clearMessages();
  }

  toggle.addEventListener("click", function () {
    setMode(state.mode === "login" ? "register" : "login");
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearMessages();
    submit.disabled = true;

    var payload =
      state.mode === "register"
        ? {
            email: document.getElementById("email").value,
            password: passwordInput.value,
            displayName: document.getElementById("displayName").value,
            inviteCode: document.getElementById("inviteCode").value
          }
        : {
            email: document.getElementById("email").value,
            password: passwordInput.value
          };

    fetch("/api/auth/" + state.mode, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          throw new Error((result.data.error && result.data.error.message) || "Sign-in failed.");
        }
        window.location.replace("/");
      })
      .catch(function (error) {
        showError(error.message);
        submit.disabled = false;
      });
  });

  // If a session already exists, go straight to the app.
  fetch("/api/auth/session", { credentials: "same-origin" })
    .then(function (response) {
      return response.json();
    })
    .then(function (data) {
      if (data && data.authenticated) window.location.replace("/");
    })
    .catch(function () {
      /* Offline or first load: stay on the form. */
    });
})();
