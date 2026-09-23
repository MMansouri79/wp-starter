/* Administrator console: invitations and accounts. */
(function () {
  "use strict";

  var session = null;

  function el(id) {
    return document.getElementById(id);
  }

  function readCookie(name) {
    var parts = String(document.cookie || "").split(";");
    for (var i = 0; i < parts.length; i += 1) {
      var pair = parts[i].trim();
      if (pair.indexOf(name + "=") === 0) return decodeURIComponent(pair.slice(name.length + 1));
    }
    return "";
  }

  function message(text, isError) {
    var box = el("message");
    box.textContent = text;
    box.className = "ws-message " + (isError ? "ws-error" : "ws-ok");
    if (!text) box.classList.add("ws-hidden");
    if (text) setTimeout(function () {
      box.classList.add("ws-hidden");
    }, 6000);
  }

  function api(path, options) {
    var init = options ? Object.assign({}, options) : {};
    init.headers = Object.assign({ "Content-Type": "application/json" }, init.headers || {});
    if (init.method && init.method !== "GET") init.headers["X-CSRF-Token"] = readCookie("wp_starter_csrf");
    init.credentials = "same-origin";

    return fetch(path, init).then(function (response) {
      if (response.status === 401) {
        window.location.replace("/login.html");
        throw new Error("Not signed in.");
      }
      return response.json().then(function (data) {
        if (!response.ok) throw new Error((data.error && data.error.message) || "Request failed.");
        return data;
      });
    });
  }

  function text(value) {
    return String(value === null || value === undefined ? "" : value);
  }

  function renderStats(overview) {
    var cards = [
      ["Accounts", overview.users],
      ["Active", overview.active],
      ["Administrators", overview.byRole.admin],
      ["Members", overview.byRole.member],
      ["Clients", overview.byRole.client],
      ["Pending invites", overview.pendingInvites],
      ["Active builds", overview.activeBuilds]
    ];
    el("stats").innerHTML = cards
      .map(function (card) {
        return '<div class="ws-stat"><span>' + text(card[0]) + "</span><strong>" + text(card[1]) + "</strong></div>";
      })
      .join("");
  }

  function renderInvites(invites) {
    var pending = invites.filter(function (invite) {
      return invite.pending;
    });

    if (!pending.length) {
      el("invites").innerHTML = '<div class="ws-empty">No pending invitations.</div>';
      return;
    }

    var rows = pending
      .map(function (invite) {
        return (
          "<tr>" +
          "<td><code>…" +
          text(invite.codeHint) +
          "</code></td>" +
          "<td>" +
          text(invite.email || "Any email") +
          "</td>" +
          "<td>" +
          text(invite.role) +
          "</td>" +
          "<td>" +
          text(invite.createdByName) +
          "</td>" +
          "<td>" +
          new Date(invite.expiresAt).toLocaleDateString() +
          "</td>" +
          '<td><button class="ws-button ws-danger" type="button" data-revoke="' +
          text(invite.id) +
          '">Revoke</button></td>' +
          "</tr>"
        );
      })
      .join("");

    el("invites").innerHTML =
      '<table class="ws-table"><thead><tr><th>Code</th><th>Reserved for</th><th>Role</th><th>Created by</th><th>Expires</th><th></th></tr></thead><tbody>' +
      rows +
      "</tbody></table>";

    Array.prototype.forEach.call(el("invites").querySelectorAll("[data-revoke]"), function (button) {
      button.addEventListener("click", function () {
        if (!window.confirm("Revoke this invitation code?")) return;
        api("/api/admin/invites/" + encodeURIComponent(button.getAttribute("data-revoke")), { method: "DELETE" })
          .then(function () {
            message("Invitation revoked.");
            load();
          })
          .catch(function (error) {
            message(error.message, true);
          });
      });
    });
  }

  function renderUsers(users) {
    if (!users.length) {
      el("users").innerHTML = '<div class="ws-empty">No accounts yet.</div>';
      return;
    }

    var rows = users
      .map(function (user) {
        var isSelf = session && session.user && session.user.id === user.id;
        var nextStatus = user.status === "active" ? "disabled" : "active";
        var nextRole = user.role === "admin" ? "member" : "admin";

        return (
          "<tr>" +
          "<td><strong>" +
          text(user.displayName) +
          "</strong>" +
          (isSelf ? ' <span class="ws-shared-badge">you</span>' : "") +
          "<br><small>" +
          text(user.email) +
          "</small></td>" +
          '<td><span class="ws-chip ws-' +
          text(user.status) +
          '">' +
          text(user.status) +
          "</span></td>" +
          "<td>" +
          text(user.role) +
          "</td>" +
          "<td>" +
          (user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never") +
          "</td>" +
          '<td><button class="ws-button ws-secondary" type="button" data-role="' +
          text(user.id) +
          '" data-next-role="' +
          text(nextRole) +
          '">Make ' +
          text(nextRole) +
          "</button> " +
          '<button class="ws-button ws-secondary" type="button" data-status="' +
          text(user.id) +
          '" data-next-status="' +
          text(nextStatus) +
          '">' +
          (user.status === "active" ? "Disable" : "Enable") +
          "</button> " +
          '<button class="ws-button ws-secondary" type="button" data-reset="' +
          text(user.id) +
          '">Reset password</button> ' +
          '<button class="ws-button ws-danger" type="button" data-remove="' +
          text(user.id) +
          '" data-email="' +
          text(user.email) +
          '">Delete</button></td>' +
          "</tr>"
        );
      })
      .join("");

    el("users").innerHTML =
      '<table class="ws-table"><thead><tr><th>Account</th><th>Status</th><th>Role</th><th>Last sign-in</th><th></th></tr></thead><tbody>' +
      rows +
      "</tbody></table>";

    Array.prototype.forEach.call(el("users").querySelectorAll("[data-role]"), function (button) {
      button.addEventListener("click", function () {
        api("/api/admin/users/" + encodeURIComponent(button.getAttribute("data-role")) + "/role", {
          method: "POST",
          body: JSON.stringify({ role: button.getAttribute("data-next-role") })
        })
          .then(function () {
            message("Role updated.");
            load();
          })
          .catch(function (error) {
            message(error.message, true);
          });
      });
    });

    Array.prototype.forEach.call(el("users").querySelectorAll("[data-status]"), function (button) {
      button.addEventListener("click", function () {
        api("/api/admin/users/" + encodeURIComponent(button.getAttribute("data-status")) + "/status", {
          method: "POST",
          body: JSON.stringify({ status: button.getAttribute("data-next-status") })
        })
          .then(function () {
            message("Account status updated.");
            load();
          })
          .catch(function (error) {
            message(error.message, true);
          });
      });
    });

    Array.prototype.forEach.call(el("users").querySelectorAll("[data-reset]"), function (button) {
      button.addEventListener("click", function () {
        var password = window.prompt("New password (at least 10 characters):");
        if (!password) return;
        api("/api/admin/users/" + encodeURIComponent(button.getAttribute("data-reset")) + "/password", {
          method: "POST",
          body: JSON.stringify({ password: password })
        })
          .then(function () {
            message("Password reset. That account's sessions were signed out.");
          })
          .catch(function (error) {
            message(error.message, true);
          });
      });
    });

    Array.prototype.forEach.call(el("users").querySelectorAll("[data-remove]"), function (button) {
      button.addEventListener("click", function () {
        var email = button.getAttribute("data-email");
        if (!window.confirm("Delete " + email + "? Items they created stay in the shared library as unowned.")) return;
        api("/api/admin/users/" + encodeURIComponent(button.getAttribute("data-remove")), { method: "DELETE" })
          .then(function () {
            message("Account deleted.");
            load();
          })
          .catch(function (error) {
            message(error.message, true);
          });
      });
    });
  }

  function load() {
    return Promise.all([api("/api/admin/overview"), api("/api/admin/invites")])
      .then(function (results) {
        renderStats(results[0]);
        renderInvites(results[1].invites);
        renderUsers(results[0].accounts);
      })
      .catch(function (error) {
        message(error.message, true);
      });
  }

  el("create-invite").addEventListener("click", function () {
    var days = Number(el("invite-days").value) || 14;
    api("/api/admin/invites", {
      method: "POST",
      body: JSON.stringify({
        email: el("invite-email").value,
        role: el("invite-role").value,
        expiresInDays: days
      })
    })
      .then(function (data) {
        el("invite-code").textContent = data.code;
        el("invite-result").classList.remove("ws-hidden");
        message("Invitation created. Copy the code now; it will not be shown again.");
        load();
      })
      .catch(function (error) {
        message(error.message, true);
      });
  });

  el("copy-invite").addEventListener("click", function () {
    var code = el("invite-code").textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(code);
    message("Invitation code copied.");
  });

  el("create-user").addEventListener("click", function () {
    api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: el("user-email").value,
        displayName: el("user-name").value,
        role: el("user-role").value,
        password: el("user-password").value
      })
    })
      .then(function () {
        el("user-email").value = "";
        el("user-name").value = "";
        el("user-password").value = "";
        message("Account created.");
        load();
      })
      .catch(function (error) {
        message(error.message, true);
      });
  });

  el("sign-out").addEventListener("click", function () {
    api("/api/auth/logout", { method: "POST" }).then(function () {
      window.location.replace("/login.html");
    });
  });

  fetch("/api/auth/session", { credentials: "same-origin" })
    .then(function (response) {
      return response.json();
    })
    .then(function (data) {
      if (!data || !data.authenticated) {
        window.location.replace("/login.html");
        return;
      }
      if (data.user.role !== "admin") {
        window.location.replace("/");
        return;
      }
      session = data;
      el("signed-in-as").textContent = "Signed in as " + data.user.email;
      return load();
    })
    .catch(function () {
      window.location.replace("/login.html");
    });
})();
