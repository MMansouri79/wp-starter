(function () {
  "use strict";
  var teamId = new URL(window.location.href).searchParams.get("team");
  var current;
  function el(id) { return document.getElementById(id); }
  function message(text) { el("team-message").textContent = text; }
  function node(tag, text) { var result = document.createElement(tag); if (text) result.textContent = text; return result; }
  async function api(url, options) {
    var init = Object.assign({}, options || {});
    init.headers = { "Content-Type": "application/json" };
    if (init.method) init.headers["X-CSRF-Token"] = current.csrfToken;
    var response = await fetch(url, init);
    if (response.status === 401) { window.location.replace("/login.html"); throw new Error("Sign in to continue."); }
    var data = await response.json();
    if (!response.ok) throw new Error(data.error.message);
    return data;
  }
  function button(text, work) {
    var result = node("button", text); result.type = "button"; result.className = "ws-button ws-secondary";
    result.addEventListener("click", async function () { result.disabled = true; try { await work(); } catch (error) { message(error.message); } finally { result.disabled = false; } });
    return result;
  }
  async function settings(team) {
    el("team-picker").hidden = true; el("team-settings").hidden = false;
    el("team-title").textContent = team.name;
    el("team-description").replaceChildren();
    var back = node("a", "Open Builder"); back.href = "/?team=" + encodeURIComponent(team.id); el("team-description").append(back);
    var prefix = "/api/teams/" + encodeURIComponent(team.id);
    var members = (await api(prefix + "/members")).members;
    el("team-members").replaceChildren();
    members.forEach(function (member) {
      var row = node("div"); row.className = "ws-team-row";
      row.append(node("span", member.displayName + " · " + member.email + " · " + member.role + (member.status !== "active" ? " · disabled" : "")));
      if (team.capabilities.canManageMembers && (team.role === "owner" || ["editor", "viewer"].includes(member.role))) {
        var select = node("select"); select.setAttribute("aria-label", "Role for " + member.displayName);
        (team.role === "owner" ? ["owner", "admin", "editor", "viewer"] : ["editor", "viewer"]).forEach(function (role) { var option = node("option", role); option.value = role; select.append(option); });
        select.value = member.role; row.append(select);
        row.append(button("Save role", async function () { await api(prefix + "/members/" + encodeURIComponent(member.userId), { method: "PUT", body: JSON.stringify({ role: select.value }) }); window.location.reload(); }));
        row.append(button("Remove", async function () { if (!await WPUI.confirm("Remove " + member.displayName + " from this team?")) return; await api(prefix + "/members/" + encodeURIComponent(member.userId), { method: "DELETE" }); window.location.reload(); }));
      }
      el("team-members").append(row);
    });
    if (!team.capabilities.canManageMembers) return;
    el("team-invitations").hidden = false;
    if (team.role === "owner" && !el("team-invite-role").querySelector('[value="owner"]')) ["admin", "owner"].forEach(function (role) { var option = node("option", role); option.value = role; el("team-invite-role").append(option); });
    var invites = (await api(prefix + "/invites")).invites;
    el("team-invite-list").replaceChildren();
    invites.forEach(function (invite) {
      var row = node("div"); row.className = "ws-team-row";
      var pending = !invite.usedAt && !invite.revokedAt && new Date(invite.expiresAt) > new Date();
      row.append(node("span", invite.email + " · " + invite.role + " · " + (invite.usedAt ? "accepted" : invite.revokedAt ? "revoked" : pending ? "pending" : "expired")));
      if (pending) row.append(button("Revoke", async function () { await api(prefix + "/invites/" + invite.id, { method: "DELETE" }); await settings(team); }));
      el("team-invite-list").append(row);
    });
    el("team-audit-panel").hidden = false;
    el("team-audit").replaceChildren();
    (await api(prefix + "/audit")).events.forEach(function (event) {
      var actor = members.find(function (member) { return member.userId === event.actorId; });
      el("team-audit").append(node("p", new Date(event.createdAt).toLocaleString() + " · " + (actor ? actor.displayName : event.actorId) + " · " + event.action + " · " + event.target));
    });
  }
  el("team-invite-form").addEventListener("submit", async function (event) {
    event.preventDefault(); var submit = event.currentTarget.querySelector("button"); submit.disabled = true;
    try {
      var result = await api("/api/teams/" + teamId + "/invites", { method: "POST", body: JSON.stringify({ email: el("team-invite-email").value, role: el("team-invite-role").value }) });
      el("team-invite-link").value = result.invitationUrl; el("team-invite-result").hidden = false;
      message("Copy this link now; it will not be shown again."); await settings(current.teams.find(function (team) { return team.id === teamId; }));
    } catch (error) { message(error.message); } finally { submit.disabled = false; }
  });
  el("team-copy-invite").addEventListener("click", async function () { try { await navigator.clipboard.writeText(el("team-invite-link").value); message("Invitation link copied."); } catch (_) { el("team-invite-link").select(); message("Select and copy the invitation link."); } });
  el("team-signout").addEventListener("click", async function () { try { await api("/api/auth/logout", { method: "POST" }); window.location.replace("/login.html"); } catch (error) { message(error.message); } });
  fetch("/api/auth/session").then(function (response) { return response.json(); }).then(async function (session) {
    current = session;
    if (!session.authenticated) { window.location.replace("/login.html"); return; }
    el("platform-link").hidden = !session.isAdmin;
    var teams = session.teams || [];
    if (teamId) {
      var team = teams.find(function (candidate) { return candidate.id === teamId; });
      if (!team) { message("This team is unavailable. Choose another workspace or ask its owner for access."); }
      else { await settings(team); return; }
    }
    el("team-list").replaceChildren();
    if (!teams.length) { el("team-list").append(node("p", "You don’t have a team yet. Ask a team owner for an invitation link.")); return; }
    teams.forEach(function (team) { var link = node("a", team.name + " · " + team.role); link.className = "ws-team-row"; link.href = "/?team=" + encodeURIComponent(team.id); el("team-list").append(link); });
  }).catch(function (error) { message(error.message); });
})();
