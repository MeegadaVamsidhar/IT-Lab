const state = {
  token: localStorage.getItem("neon_token"),
  user: null,
  socket: null,
  room: null,
  view: "dashboard",
  charts: {},
};
const $ = (selector) => document.querySelector(selector);
const api = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.token}`,
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Something went wrong");
  return body;
};
const toast = (message, error = false) => {
  const item = document.createElement("div");
  item.className = `toast ${error ? "error" : ""}`;
  item.textContent = message;
  $("#toast-stack").append(item);
  setTimeout(() => item.remove(), 4200);
};
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
function showAuth(mode = "login") {
  $("#auth-shell").classList.remove("hidden");
  $("#app-shell").classList.add("hidden");
  document
    .querySelectorAll(".tab")
    .forEach((tab) =>
      tab.classList.toggle("active", tab.dataset.auth === mode),
    );
  $("#login-form").classList.toggle("hidden", mode !== "login");
  $("#register-form").classList.toggle("hidden", mode !== "register");
}
function showApp() {
  $("#auth-shell").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  $("#sidebar-name").textContent = state.user.name;
  $("#sidebar-handle").textContent = `@${state.user.username}`;
  $("#avatar").textContent = state.user.name.slice(0, 1).toUpperCase();
  connectSocket();
  renderView("dashboard");
}
function connectSocket() {
  if (state.socket) state.socket.disconnect();
  state.socket = io({ auth: { token: state.token }, reconnection: true });
  state.socket.on("presence", ({ online }) => {
    $("#online-count").textContent = `${online} online`;
  });
  state.socket.on("connect_error", () =>
    toast("Reconnecting to the arena…", true),
  );
  state.socket.on("notification", ({ message, type }) =>
    toast(message, type === "error"),
  );
  state.socket.on("room:update", (room) => {
    if (state.room?.roomId === room.roomId) {
      state.room = room;
      renderGame();
    }
  });
  state.socket.on("game:started", () =>
    toast("Match started. Make your move."),
  );
  state.socket.on("game:finished", ({ result, winnerId }) => {
    const text =
      result === "draw"
        ? "Draw game."
        : winnerId === state.user.id
          ? "You won! +10 credits."
          : "Match finished.";
    toast(text);
  });
}
function renderView(view) {
  state.view = view;
  const titles = {
    dashboard: "Overview",
    rooms: "Play room",
    history: "Match history",
    leaderboard: "Leaderboard",
    analytics: "Analytics",
  };
  $("#view-title").textContent = titles[view] || "Overview";
  document
    .querySelectorAll(".nav-item")
    .forEach((item) =>
      item.classList.toggle("active", item.dataset.view === view),
    );
  const template = $(`#${view}-view`);
  if (!template) return;
  $("#view-container").replaceChildren(template.content.cloneNode(true));
  ({
    dashboard: loadDashboard,
    rooms: loadRooms,
    history: loadHistory,
    leaderboard: () => loadLeaderboard("credits"),
    analytics: loadAnalytics,
  })[view]();
}
async function loadDashboard() {
  try {
    const profile = await api("/api/profile");
    state.user = profile.user;
    updateStats();
    const rooms = await api("/api/rooms");
    renderRooms($("#room-preview"), rooms.rooms.slice(0, 3));
    const matches = await api("/api/matches");
    renderMatches($("#match-preview"), matches.matches.slice(0, 4));
  } catch (error) {
    toast(error.message, true);
  }
}
function updateStats() {
  const games = state.user.wins + state.user.losses + state.user.draws;
  const rate = games ? Math.round((state.user.wins / games) * 100) : 0;
  ["games", "wins", "rate", "credits"].forEach((key) => {
    const el = $(`#stat-${key}`);
    if (el)
      el.textContent =
        key === "games"
          ? games
          : key === "wins"
            ? state.user.wins
            : key === "rate"
              ? `${rate}%`
              : state.user.credits;
  });
}
function renderRooms(container, rooms) {
  if (!rooms.length) {
    container.innerHTML =
      '<div class="empty">No active rooms yet. Create the first arena.</div>';
    return;
  }
  container.innerHTML = rooms
    .map(
      (room) =>
        `<div class="room-item"><div><strong>${escapeHtml(room.roomName)}</strong><small>hosted by ${escapeHtml(room.hostName)} · ${room.status}</small></div><div class="room-item-actions"><span class="room-code">${room.roomId}</span><button class="copy-btn" data-action="copy-room" data-room="${room.roomId}" title="Copy room code" aria-label="Copy room code">▣</button><button class="join-btn" data-join="${room.roomId}">Join</button></div></div>`,
    )
    .join("");
  container
    .querySelectorAll("[data-join]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        enterRoom(
          button.dataset.join,
          button.closest(".room-item").querySelector("strong").textContent,
        ),
      ),
    );
}
function renderMatches(container, matches) {
  if (!matches.length) {
    container.innerHTML =
      '<div class="empty">Your first match is waiting in the lobby.</div>';
    return;
  }
  container.innerHTML = matches
    .map(
      (match) =>
        `<div class="activity-line"><span>${escapeHtml(match.playerXName)} vs ${escapeHtml(match.playerOName || "waiting")}</span><small>${match.result === "draw" ? "DRAW" : match.winner_id === state.user.id ? "WIN" : "MATCH"} · ${new Date(match.played_at).toLocaleDateString()}</small></div>`,
    )
    .join("");
}
async function loadRooms() {
  try {
    const data = await api("/api/rooms");
    renderRooms($("#room-list"), data.rooms);
  } catch (error) {
    toast(error.message, true);
  }
}
async function loadHistory() {
  try {
    const data = await api("/api/matches");
    $("#history-table").innerHTML = data.matches.length
      ? `<table class="data-table"><thead><tr><th>DATE</th><th>PLAYERS</th><th>RESULT</th><th>WINNER</th></tr></thead><tbody>${data.matches.map((m) => `<tr><td>${new Date(m.played_at).toLocaleDateString()}</td><td>${escapeHtml(m.playerXName)} vs ${escapeHtml(m.playerOName || "—")}</td><td>${m.result.replace("_", " ").toUpperCase()}</td><td>${escapeHtml(m.winnerName || "Draw")}</td></tr>`).join("")}</tbody></table>`
      : '<div class="empty">No completed matches yet.</div>';
  } catch (error) {
    toast(error.message, true);
  }
}
async function loadLeaderboard(sort) {
  try {
    const data = await api(`/api/leaderboard?sort=${sort}`);
    $("#leaderboard-table").innerHTML =
      `<table class="data-table"><thead><tr><th>#</th><th>PLAYER</th><th>CREDITS</th><th>WINS</th><th>WIN RATE</th></tr></thead><tbody>${data.players.map((p, i) => `<tr><td class="rank">${String(i + 1).padStart(2, "0")}</td><td><strong>${escapeHtml(p.name)}</strong><br><small class="muted">@${escapeHtml(p.username)}</small></td><td>${p.credits}</td><td>${p.wins}</td><td>${p.win_rate}%</td></tr>`).join("")}</tbody></table>`;
    document
      .querySelectorAll("[data-sort]")
      .forEach((button) =>
        button.classList.toggle("selected", button.dataset.sort === sort),
      );
  } catch (error) {
    toast(error.message, true);
  }
}
async function loadAnalytics() {
  try {
    if (!window.Chart) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js";
        script.onload = resolve;
        script.onerror = () => reject(new Error("Analytics charts could not load."));
        document.head.append(script);
      });
    }
    const data = await api("/api/analytics");
    $("#a-users").textContent = data.platform.totalUsers;
    $("#a-rooms").textContent = data.platform.activeRooms;
    $("#a-matches").textContent = data.platform.totalMatches;
    Object.values(state.charts).forEach((chart) => chart.destroy());
    state.charts.personal = new Chart($("#personal-chart"), {
      type: "doughnut",
      data: {
        labels: ["Wins", "Losses", "Draws"],
        datasets: [
          {
            data: [data.stats.wins, data.stats.losses, data.stats.draws],
            backgroundColor: ["#cbf36b", "#ff7768", "#6d8cff"],
            borderWidth: 0,
          },
        ],
      },
      options: { plugins: { legend: { position: "bottom" } }, cutout: "68%" },
    });
    state.charts.daily = new Chart($("#daily-chart"), {
      type: "line",
      data: {
        labels: data.daily.map((d) => d.day.slice(5)),
        datasets: [
          {
            label: "Matches",
            data: data.daily.map((d) => d.matches),
            borderColor: "#ff7768",
            backgroundColor: "#ff776820",
            fill: true,
            tension: 0.35,
          },
        ],
      },
      options: {
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
        plugins: { legend: { display: false } },
      },
    });
  } catch (error) {
    toast(error.message, true);
  }
}
function openModal(join) {
  $("#modal").classList.remove("hidden");
  $("#modal-title").textContent = join ? "Join a room" : "Create a room";
  $("#room-name-label").classList.toggle("hidden", join);
  $("#room-code-label").classList.toggle("hidden", !join);
  $("#room-form").dataset.mode = join ? "join" : "create";
  document.querySelectorAll("#room-form input").forEach((input) => {
    input.value = "";
  });
}
function enterRoom(roomId, roomName) {
  if (!state.socket?.connected)
    return toast("Still reconnecting to the server.", true);
  state.socket.emit("room:join", { roomId }, (response) => {
    if (!response.ok) return toast(response.error, true);
    state.room = response.room;
    state.view = "game";
    $("#view-title").textContent = roomName || state.room.roomName;
    document
      .querySelectorAll(".nav-item")
      .forEach((item) => item.classList.remove("active"));
    renderGame();
  });
}
function renderGame() {
  const room = state.room;
  if (!room) return;
  const me = room.players.find((p) => p.id === state.user.id);
  $("#view-container").innerHTML =
    `<div class="section-intro"><div><p class="eyebrow accent">LIVE MATCH / ${room.roomId}</p><h3>${escapeHtml(room.roomName)}</h3><p class="muted">${room.status === "playing" ? `You are Player ${me?.symbol || "spectator"} · ${room.turn}'s turn` : room.status === "finished" ? "Match finished" : "Share the room code and wait for a challenger."}</p></div><div class="room-actions"><button class="secondary" data-action="copy-room" data-room="${room.roomId}">Copy code</button><button class="secondary" data-action="leave-room">Leave room</button></div></div><section class="panel" style="max-width:680px;margin:auto;text-align:center"><div class="game-meta"><span>${room.players.map((p) => `${escapeHtml(p.name)} <b>${p.symbol}</b>`).join(" · ") || "Waiting for players"}</span><span>${room.spectators} spectator${room.spectators === 1 ? "" : "s"}</span></div><div class="game-board">${room.board.map((cell, i) => `<button class="cell ${cell ? `filled ${cell.toLowerCase()}` : ""}" data-cell="${i}" ${cell || room.status !== "playing" || !me || me.symbol !== room.turn ? "disabled" : ""}>${cell || ""}</button>`).join("")}</div>${room.status === "finished" ? '<button class="primary" data-action="restart">Restart match ↻</button>' : ""}</section>`;
  $("#view-container")
    .querySelectorAll("[data-cell]")
    .forEach((cell) =>
      cell.addEventListener("click", () =>
        state.socket.emit(
          "game:move",
          { roomId: room.roomId, index: Number(cell.dataset.cell) },
          (r) => {
            if (!r.ok) toast(r.error, true);
          },
        ),
      ),
    );
}
async function submitAuth(event) {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  try {
    const result = await fetch(
      form.id === "login-form" ? "/api/login" : "/api/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form.id === "login-form" ? data : data),
      },
    ).then(async (r) => {
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      return b;
    });
    state.token = result.token;
    state.user = result.user;
    localStorage.setItem("neon_token", state.token);
    showApp();
  } catch (error) {
    $("#auth-error").textContent = error.message;
  }
}
document.addEventListener("click", (event) => {
  const view = event.target.closest("[data-view]")?.dataset.view;
  if (view) renderView(view);
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "new-room") openModal(false);
  if (action === "join-room") openModal(true);
  if (action === "leave-room") {
    state.socket.emit("room:leave", { roomId: state.room.roomId });
    state.room = null;
    renderView("rooms");
  }
  if (action === "restart")
    state.socket.emit("game:restart", { roomId: state.room.roomId });
  if (action === "copy-room") {
    const roomId = event.target.closest("[data-action='copy-room']").dataset.room;
    navigator.clipboard
      ?.writeText(roomId)
      .then(() => toast(`Room code ${roomId} copied.`))
      .catch(() => toast(`Room code: ${roomId}`));
  }
  if (event.target.matches(".modal-close") || event.target.id === "modal")
    $("#modal").classList.add("hidden");
  if (event.target.closest("[data-sort]"))
    loadLeaderboard(event.target.closest("[data-sort]").dataset.sort);
});
$("#login-form").addEventListener("submit", submitAuth);
$("#register-form").addEventListener("submit", submitAuth);
document
  .querySelectorAll(".tab")
  .forEach((tab) =>
    tab.addEventListener("click", () => showAuth(tab.dataset.auth)),
  );
$("#logout").addEventListener("click", () => {
  localStorage.removeItem("neon_token");
  state.socket?.disconnect();
  state.token = null;
  state.user = null;
  showAuth();
});
$("#refresh").addEventListener("click", () => renderView(state.view));
$("#room-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  try {
    if (event.target.dataset.mode === "create") {
      const result = await api("/api/room/create", {
        method: "POST",
        body: JSON.stringify(data),
      });
      state.socket.emit("room:create", result, (response) => {
        $("#modal").classList.add("hidden");
        if (response.ok) {
          state.room = response.room;
          renderGame();
          $("#view-title").textContent = result.roomName;
          toast(`Room ${result.roomId} created. Share the code.`);
        }
      });
    } else {
      const result = await api("/api/room/join", {
        method: "POST",
        body: JSON.stringify(data),
      });
      $("#modal").classList.add("hidden");
      enterRoom(result.roomId, result.roomName);
    }
  } catch (error) {
    toast(error.message, true);
  }
});
if (state.token)
  api("/api/profile")
    .then((profile) => {
      state.user = profile.user;
      showApp();
    })
    .catch(() => {
      localStorage.removeItem("neon_token");
      showAuth();
    });
else showAuth();
