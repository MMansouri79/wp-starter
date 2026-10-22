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
  var invitation = new URLSearchParams(window.location.hash.slice(1)).get("invite") || "";
  if (invitation) document.getElementById("inviteCode").value = invitation;
  async function finish(data, acceptInvitation) {
    if (invitation && acceptInvitation) {
      var response = await fetch("/api/auth/team-invites/accept", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": data.csrfToken }, body: JSON.stringify({ token: invitation }) });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error.message);
      window.location.replace("/?team=" + encodeURIComponent(result.teamId));
      return;
    }
    var teams = data.teams || [];
    window.location.replace(teams.length === 1 ? "/?team=" + encodeURIComponent(teams[0].id) : "/teams.html");
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove("ws-hidden");
    noticeBox.classList.add("ws-hidden");
    errorBox.tabIndex = -1;
    errorBox.focus();
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
    nameField.hidden = !creating;
    submit.textContent = creating ? "Create account" : "Sign in";
    toggle.textContent = creating ? "Sign in instead" : "Create an account";
    togglePrompt.textContent = creating ? "Already have an account?" : "Invited to a team?";
    subtitle.textContent = creating
      ? "Create an account to join the team that invited you."
      : "Sign in to your private team workspaces.";
    passwordInput.setAttribute("autocomplete", creating ? "new-password" : "current-password");
    passwordInput.minLength = creating ? 10 : 1;
    clearMessages();
  }

  passwordInput.minLength = 1;

  toggle.addEventListener("click", function () {
    setMode(state.mode === "login" ? "register" : "login");
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (submit.disabled) return;
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
        return finish(result.data, state.mode === "login");
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
      if (data && data.authenticated) return finish(data, true);
    })
    .catch(function (error) {
      if (invitation) showError(error.message);
    });
})();
