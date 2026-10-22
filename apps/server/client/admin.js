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

  function message(text, isError) { WPUI.notify(text, isError); }
  var pendingWrites = new Map();
  function api(path, options) {
    var init = options ? Object.assign({}, options) : {};
    init.headers = Object.assign({ "Content-Type": "application/json" }, init.headers || {});
    if (init.method && init.method !== "GET") init.headers["X-CSRF-Token"] = readCookie("wp_starter_csrf");
    init.credentials = "same-origin";

    var key = (init.method || "GET") + path + (init.body || "");
    if (init.method && pendingWrites.has(key)) return pendingWrites.get(key);
    var button = document.activeElement && document.activeElement.tagName === "BUTTON" ? document.activeElement : null;
    if (button && init.method) button.disabled = true;
    var operation = fetch(path, init).then(function (response) {
      if (response.status === 401) {
        window.location.replace("/login.html");
        throw new Error("Not signed in.");
      }
      return response.json().then(function (data) {
        if (!response.ok) throw new Error((data.error && data.error.message) || "Request failed.");
        return data;
      });
    }).finally(function () { pendingWrites.delete(key); if (button && init.method) button.disabled = false; });
    if (init.method) pendingWrites.set(key, operation);
    return operation;
  }

  function text(value) {
    return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, function(c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#039;"}[c]; });
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

  function renderTeams(teams) {
    el("invites").replaceChildren();
    teams.forEach(function(team) {
      var row = document.createElement("div"); row.className = "ws-team-row";
      var label = document.createElement("span"); label.textContent = team.name + " · " + team.status; row.appendChild(label);
      var toggle = document.createElement("button"); toggle.className = "ws-button ws-secondary"; toggle.type = "button"; toggle.textContent = team.status === "active" ? "Suspend" : "Activate";
      toggle.addEventListener("click", async function () {
        if (!await WPUI.confirm(toggle.textContent + " " + team.name + "?")) return;
        try { await api("/api/admin/teams/" + team.id + "/status", { method: "POST", body: JSON.stringify({ status: team.status === "active" ? "suspended" : "active" }) }); await load(); } catch (error) { message(error.message, true); }
      }); row.appendChild(toggle);
      var retry = document.createElement("button"); retry.type = "button"; retry.className = "ws-button ws-secondary"; retry.textContent = "Reissue initial owner invite";
      retry.addEventListener("click", async function () {
        var email = await WPUI.dialog({ title: "Initial owner invitation", message: "Available only before an owner joins.", input: true, label: "Owner email", accept: "Create invitation" }); if (!email) return;
        try { var data = await api("/api/admin/teams/" + team.id + "/owner-invite", { method: "POST", body: JSON.stringify({ email: email }) }); el("invite-code").textContent = data.invitationUrl; el("invite-result").classList.remove("ws-hidden"); } catch (error) { message(error.message, true); }
      }); row.appendChild(retry); el("invites").appendChild(row);
    });
    if (!teams.length) el("invites").textContent = "No teams yet.";
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
      button.addEventListener("click", async function () {
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
      button.addEventListener("click", async function () {
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
      button.addEventListener("click", async function () {
        var password = await WPUI.dialog({title:"Reset password",message:"Enter a new password with at least 10 characters.",input:true,secret:true,label:"New password",accept:"Reset password"});
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
      button.addEventListener("click", async function () {
        var email = button.getAttribute("data-email");
        if (!await WPUI.confirm("Delete " + email + "? Their team items and creator attribution are retained.")) return;
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
    return Promise.all([api("/api/admin/overview"), api("/api/admin/teams")])
      .then(function (results) {
        renderStats(results[0]);
        renderTeams(results[1].teams);
        renderUsers(results[0].accounts);
      })
      .catch(function (error) {
        message(error.message, true);
      });
  }

  el("provision-team").addEventListener("submit", function (event) {
    event.preventDefault(); el("create-invite").disabled = true;
    api("/api/admin/teams", { method: "POST", body: JSON.stringify({ name: el("team-name").value, ownerEmail: el("invite-email").value }) })
      .then(function (data) { el("invite-code").textContent = data.invitationUrl; el("invite-result").classList.remove("ws-hidden"); message("Team created. Copy the owner invitation link now."); return load(); })
      .catch(function(error) { message(error.message, true); }).finally(function() { el("create-invite").disabled = false; });
  });

  el("copy-invite").addEventListener("click", function () {
    var code = el("invite-code").textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(code);
    message("Invitation link copied.");
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
