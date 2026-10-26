const state = { view: "overview", activities: [], projects: [], user: null };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char],
  );
const statusClass = (status) =>
  status === "Approved"
    ? "approved"
    : status === "Needs changes"
      ? "changes"
      : "pending";
const statusBadge = (status) =>
  `<span class="status ${statusClass(status)}">${escapeHtml(status)}</span>`;
const showToast = (message) => {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
};
async function api(url, options = {}) {
  const token = localStorage.getItem("deptflow-token");
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error || "Something went wrong.");
  return data;
}
async function loadData() {
  [state.activities, state.projects] = await Promise.all([
    api("/api/activities"),
    api("/api/projects"),
  ]);
  render();
}
function activityRow(item) {
  return `<div class="activity-row"><div class="activity-mark">${item.category === "Examination" ? "◌" : item.category === "Events" ? "✦" : "▤"}</div><div class="activity-info"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.programme)} · ${escapeHtml(item.submitted_by)}</small></div>${statusBadge(item.status)}</div>`;
}
function layout(content) {
  return `<div class="content">${content}</div>`;
}
function overview() {
  const pending = state.activities.filter((item) =>
    item.status.startsWith("Pending"),
  ).length;
  const approved = state.activities.filter(
    (item) => item.status === "Approved",
  ).length;
  const role = state.user.role;
  const isAdmin = role === "Admin";
  const isFaculty = role === "Faculty";
  const heading = isAdmin
    ? "Everything in one place."
    : isFaculty
      ? "Your faculty workspace."
      : "Your permission workspace.";
  const description = isAdmin
    ? "Review requests, manage approvals and monitor departmental activity."
    : isFaculty
      ? "Submit faculty requests, guide student work and track department decisions."
      : "Submit UG/PG requests and follow every approval step from one place.";
  const primaryLabel = isAdmin ? "+ Review requests" : "+ Request permission";
  const firstMetric = isAdmin ? "AWAITING APPROVAL" : "MY PENDING REQUESTS";
  const secondMetric = isAdmin ? approved + 12 : "APPROVED";
  const thirdMetric = isAdmin
    ? "ACTIVE PROJECTS"
    : isFaculty
      ? "GUIDED PROJECTS"
      : "MY REQUESTS";
  return layout(`<div class="page-intro"><div><p class="eyebrow accent">${isAdmin ? "DEPARTMENT SNAPSHOT" : `${role.toUpperCase()} WORKSPACE`}</p><h2>${heading}</h2><p class="muted">${description}</p></div><button class="button primary" id="new-activity-button">${primaryLabel}</button></div>
    <div class="stats-grid"><div class="stat-card"><span class="stat-icon">◈</span><small>${firstMetric}</small><strong>${pending}</strong><em>${isAdmin ? "Needs your attention" : "Keep your requests moving"}</em></div><div class="stat-card"><span class="stat-icon">◷</span><small>${isAdmin ? "APPROVED THIS MONTH" : "APPROVED REQUESTS"}</small><strong>${secondMetric}</strong><em>${isAdmin ? "↑ 18% from February" : "Successfully completed"}</em></div><div class="stat-card"><span class="stat-icon">✓</span><small>${thirdMetric}</small><strong>${isAdmin ? state.projects.length : state.activities.length}</strong><em>${isFaculty ? "Across assigned programmes" : isAdmin ? `${state.projects.filter((p) => p.status === "At risk").length} need a check-in` : "Visible only to you"}</em></div><div class="stat-card"><span class="stat-icon">◎</span><small>${isAdmin ? "DEPARTMENT MEMBERS" : "YOUR PROGRAMME"}</small><strong>${isAdmin ? "42" : escapeHtml(state.user.programme)}</strong><em>${isAdmin ? "6 faculty · 36 students" : role === "Faculty" ? "Faculty access enabled" : "Student access enabled"}</em></div></div>
    <div class="grid-2"><section class="panel"><div class="panel-heading"><div><p class="eyebrow">${isAdmin ? "APPROVAL INBOX" : "MY REQUESTS"}</p><h3>${isAdmin ? "Requests needing review" : "Recent permission activity"}</h3></div><button class="text-button" data-view="inbox">View all →</button></div>${state.activities.length ? state.activities.slice(0, 4).map(activityRow).join("") : '<div class="empty">No requests yet. Use the button above to submit one.</div>'}</section><section class="panel"><div class="panel-heading"><div><p class="eyebrow">${isAdmin ? "DEPARTMENT PULSE" : "NEXT STEP"}</p><h3>${isAdmin ? "Activity overview" : "Keep work moving"}</h3></div><span class="status approved">${isAdmin ? "On track" : "Ready"}</span></div>${isAdmin ? '<div class="mini-chart"><i class="bar" style="height:42%"></i><i class="bar" style="height:66%"></i><i class="bar" style="height:54%"></i><i class="bar active" style="height:82%"></i><i class="bar active" style="height:70%"></i><i class="bar" style="height:91%"></i><i class="bar" style="height:75%"></i></div><div class="chart-labels"><span>W1</span><span>W2</span><span>W3</span><span>W4</span><span>W5</span><span>W6</span><span>W7</span></div><p class="muted">Requests are moving <strong>24% faster</strong> than last month.</p>' : `<p class="muted">${isFaculty ? "Review your assigned activities and guide updates from the Activities section." : "Create a request with its programme date and supporting notes. Your dashboard will show the approval status here."}</p>`}</section></div>`);
}
function inbox() {
  const isAdmin = state.user.role === "Admin";
  return layout(
    `<div class="page-intro"><div><p class="eyebrow accent">WORKFLOW / 02</p><h2>${isAdmin ? "Approval inbox" : "My permission requests"}</h2><p class="muted">${isAdmin ? "Review and route departmental requests to keep work moving." : "Track the permission requests submitted through your account."}</p></div><button class="button primary" id="new-activity-button">+ ${isAdmin ? "New activity" : "Request permission"}</button></div><div class="workflow-toolbar"><select class="filter" id="status-filter"><option value="all">All requests</option><option>Pending HOD</option><option>Pending Faculty</option><option>Approved</option><option>Needs changes</option></select><select class="filter"><option>All programmes</option><option>B.Tech CSE</option><option>M.Tech AI</option></select><span class="muted">${state.activities.length} visible items</span></div><div class="workflow-list" id="workflow-list">${state.activities.length ? state.activities.map(workflowCard).join("") : '<div class="panel empty">No permission requests are associated with your account.</div>'}</div>`,
  );
}
function workflowCard(item) {
  const facultyCanAct =
    state.user?.role === "Faculty" && item.status === "Pending Faculty";
  const adminCanAct =
    state.user?.role === "Admin" && item.status === "Pending HOD";
  const ownerCanDelete = item.submitted_by === state.user?.name;
  const canAct = facultyCanAct || adminCanAct;
  const approvalLabel = facultyCanAct ? "Approve & send to HOD" : "Approve";
  const actionButtons = canAct
    ? `<button class="action-btn approve" data-action="approve" data-id="${item.id}">✓ ${approvalLabel}</button><button class="action-btn change" data-action="changes" data-id="${item.id}">↻ Request changes</button>`
    : `<button class="action-btn" data-action="advance" data-id="${item.id}">${item.status === "Approved" ? "Approved" : state.user?.role === "Admin" ? "Waiting for faculty" : "View"} ↗</button>`;
  return `<article class="workflow-card"><div><div style="display:flex;gap:10px;align-items:center"><h3>${escapeHtml(item.title)}</h3>${statusBadge(item.status)}<span class="priority ${escapeHtml(item.priority)}">${escapeHtml(item.priority)}</span></div><div class="workflow-meta"><span>◷ Programme date ${escapeHtml(item.programme_date)}</span><span>◎ ${escapeHtml(item.submitted_by)}</span><span>▤ ${escapeHtml(item.programme)}</span></div><p class="workflow-desc">${escapeHtml(item.description)}</p></div><div class="workflow-actions">${actionButtons}${ownerCanDelete ? `<button class="action-btn change" data-action="delete" data-id="${item.id}">Delete</button>` : ""}</div></article>`;
}
function projects() {
  return layout(
    `<div class="page-intro"><div><p class="eyebrow accent">STUDENT WORK / 03</p><h2>Project allocation</h2><p class="muted">Monitor guides, teams and milestones across UG and PG projects.</p></div><button class="button primary" id="new-project-button">+ Allocate project</button></div><section class="panel"><div class="panel-heading"><div><p class="eyebrow">ACTIVE REGISTER</p><h3>${state.projects.length} active allocations</h3></div><select class="filter"><option>All programmes</option><option>B.Tech CSE</option><option>M.Tech AI</option></select></div><div class="table-wrap"><table class="project-table"><thead><tr><th>PROJECT</th><th>PROGRAMME</th><th>GUIDE</th><th>TEAM</th><th>MILESTONE</th><th>PROGRESS</th><th>STATUS</th></tr></thead><tbody>${state.projects.map((p) => `<tr><td><strong>${escapeHtml(p.title)}</strong><small>${escapeHtml(p.code)}</small></td><td>${escapeHtml(p.programme)}</td><td>${escapeHtml(p.guide)}</td><td>${escapeHtml(p.students)}</td><td>${escapeHtml(p.milestone)}</td><td><span class="progress"><i style="width:${p.progress}%"></i></span>${p.progress}%</td><td><span class="status ${p.status === "At risk" ? "risk" : "track"}">${escapeHtml(p.status)}</span></td></tr>`).join("")}</tbody></table></div></section>`,
  );
}
function people() {
  return layout(
    `<div class="page-intro"><div><p class="eyebrow accent">DIRECTORY / 04</p><h2>People & roles</h2><p class="muted">Know who owns each step in the departmental workflow.</p></div><button class="button secondary">Manage roles</button></div><div class="people-grid">${[
      ["AM", "Arjun Mehta", "Head of Department", "Approver"],
      ["RM", "Riya Menon", "Faculty coordinator · UG", "Faculty reviewer"],
      ["SI", "Sanjay Iyer", "Faculty coordinator · PG", "Faculty reviewer"],
      ["PN", "Priya Nair", "Project cell coordinator", "Coordinator"],
      ["AS", "Aarav Sharma", "Student representative", "Submitter"],
      ["MS", "Maya Singh", "Student representative", "Submitter"],
    ]
      .map(
        (p) =>
          `<article class="panel person-card"><div class="large-avatar">${p[0]}</div><h3>${p[1]}</h3><small>${p[2]}</small><span class="role-tag">${p[3]}</span></article>`,
      )
      .join("")}</div>`,
  );
}
function render() {
  const firstName = state.user?.name?.split(" ")[0] || "there";
  const titles = {
    overview: `Good morning, ${firstName} `,
    inbox:
      state.user?.role === "Admin"
        ? "Your approval queue "
        : "My permission requests ",
    projects: "Project allocation ",
    people: "People & roles ",
  };
  $("#current-date").textContent = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .format(new Date())
    .toUpperCase();
  $("#page-title").innerHTML = `${titles[state.view]}<span>✦</span>`;
  $("#view-container").innerHTML =
    state.view === "overview"
      ? overview()
      : state.view === "inbox"
        ? inbox()
        : state.view === "projects"
          ? projects()
          : people();
  $("#nav-pending").textContent = state.activities.filter((item) =>
    item.status.startsWith("Pending"),
  ).length;
  $("#user-name").textContent = state.user.name;
  $("#user-role").textContent = `${state.user.role} · ${state.user.programme}`;
  $(".user-role").textContent = state.user.role;
  $("#user-avatar").textContent = state.user.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  bindViewActions();
}
function openDialog() {
  $("#requesting-user").value = state.user?.name || "";
  $("#new-activity").showModal();
}
function bindViewActions() {
  document.querySelectorAll("[data-view]").forEach(
    (button) =>
      (button.onclick = () => {
        state.view = button.dataset.view;
        render();
      }),
  );
  $("#new-activity-button")?.addEventListener("click", openDialog);
  $("#new-project-button")?.addEventListener("click", () =>
    showToast("Project allocation form is ready for the next workflow update."),
  );
  $("#status-filter")?.addEventListener("change", (event) => {
    const filtered =
      event.target.value === "all"
        ? state.activities
        : state.activities.filter((item) => item.status === event.target.value);
    $("#workflow-list").innerHTML = filtered.map(workflowCard).join("");
    bindWorkflowActions();
  });
  bindWorkflowActions();
}
function bindWorkflowActions() {
  document.querySelectorAll("[data-action]").forEach(
    (button) =>
      (button.onclick = async () => {
        if (button.dataset.action === "advance") return;
        if (button.dataset.action === "delete") {
          if (!window.confirm("Delete this request? This cannot be undone."))
            return;
          try {
            await api(`/api/activities/${button.dataset.id}`, {
              method: "DELETE",
            });
            await loadData();
            showToast("Request deleted.");
          } catch (error) {
            showToast(error.message);
          }
          return;
        }
        const status =
          button.dataset.action === "approve" ? "Approved" : "Needs changes";
        try {
          await api(`/api/activities/${button.dataset.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status }),
          });
          await loadData();
          showToast(
            status === "Approved"
              ? state.user.role === "Faculty"
                ? "Faculty approval recorded. Request sent to Admin."
                : "Request approved and submitter notified."
              : "Changes requested from submitter.",
          );
        } catch (error) {
          showToast(error.message);
        }
      }),
  );
}
$("#activity-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const activityForm = event.currentTarget;
  const form = new FormData(activityForm);
  const payload = Object.fromEntries(form.entries());
  try {
    await api("/api/activities", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    $("#new-activity").close();
    activityForm.reset();
    await loadData();
    state.view = "inbox";
    render();
    showToast("Permission request submitted for approval.");
  } catch (error) {
    showToast(error.message);
  }
});
$("#cancel-dialog").onclick = () => $("#new-activity").close();
$(".mobile-menu").onclick = () => $(".sidebar").classList.toggle("open");
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const error = $("#login-error");
  error.textContent = "";
  try {
    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    localStorage.setItem("deptflow-token", result.token);
    state.user = result.user;
    $("#login-shell").classList.add("hidden");
    $(".app").classList.remove("hidden");
    await loadData();
  } catch (loginError) {
    error.textContent = loginError.message;
  }
});
$("#logout-button").onclick = async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } finally {
    localStorage.removeItem("deptflow-token");
    location.reload();
  }
};
async function bootstrap() {
  const token = localStorage.getItem("deptflow-token");
  if (!token) return;
  try {
    state.user = await api("/api/me");
    $("#login-shell").classList.add("hidden");
    $(".app").classList.remove("hidden");
    await loadData();
  } catch {
    localStorage.removeItem("deptflow-token");
  }
}
bootstrap();
