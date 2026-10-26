const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const express = require("express");
const helmet = require("helmet");
const Database = require("better-sqlite3");

const app = express();
const port = process.env.PORT || 3000;
const dataDirectory = path.join(__dirname, "data");
fs.mkdirSync(dataDirectory, { recursive: true });
const db = new Database(path.join(dataDirectory, "deptflow.db"));
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, category TEXT NOT NULL, programme TEXT NOT NULL,
    owner TEXT NOT NULL, submitted_by TEXT NOT NULL, programme_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending HOD', priority TEXT NOT NULL DEFAULT 'Medium',
    description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, programme TEXT NOT NULL,
    guide TEXT NOT NULL, students TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'On track',
    milestone TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('Student', 'Faculty', 'Admin')),
    programme TEXT NOT NULL DEFAULT 'Department',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const activityColumns = db.prepare("PRAGMA table_info(activities)").all();
if (
  activityColumns.some((column) => column.name === "due_date") &&
  !activityColumns.some((column) => column.name === "programme_date")
) {
  db.exec("ALTER TABLE activities RENAME COLUMN due_date TO programme_date");
}

const hashPassword = (password) =>
  crypto.createHash("sha256").update(password).digest("hex");
const users = [
  {
    name: "Aarav Sharma",
    email: "student@reqmail.com",
    password: "student123",
    role: "Student",
    programme: "B.Tech CSE",
  },
  {
    name: "Riya Menon",
    email: "faculty@reqmail.com",
    password: "faculty123",
    role: "Faculty",
    programme: "B.Tech CSE",
  },
  {
    name: "Arjun Mehta",
    email: "admin@reqmail.com",
    password: "admin123",
    role: "Admin",
    programme: "Department",
  },
];
const addUser =
  db.prepare(`INSERT OR IGNORE INTO users (name, email, password_hash, role, programme)
  VALUES (@name, @email, @password_hash, @role, @programme)`);
users.forEach((user) =>
  addUser.run({ ...user, password_hash: hashPassword(user.password) }),
);
const sessions = new Map();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/login", (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim() : "";
  const password =
    typeof req.body.password === "string" ? req.body.password : "";
  const user = db
    .prepare(
      "SELECT id, name, email, role, programme, password_hash FROM users WHERE email = ?",
    )
    .get(email);
  if (!user || user.password_hash !== hashPassword(password)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    programme: user.programme,
  });
  res.json({ token, user: sessions.get(token) });
});
app.post("/api/logout", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) sessions.delete(token);
  res.status(204).end();
});
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const user = token ? sessions.get(token) : null;
  if (!user)
    return res.status(401).json({ error: "Please sign in to continue." });
  req.user = user;
  next();
};
const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role))
      return res
        .status(403)
        .json({
          error:
            "This action is restricted to authorised department approvers.",
        });
    next();
  };
app.use("/api", authenticate);

app.get("/api/me", (req, res) => res.json(req.user));
app.get("/api/summary", (_req, res) => {
  const stats = db
    .prepare(
      `
    SELECT
      (SELECT COUNT(*) FROM activities WHERE status IN ('Pending HOD', 'Pending Faculty')) AS pending,
      (SELECT COUNT(*) FROM activities WHERE status = 'Approved') AS approved,
      (SELECT COUNT(*) FROM projects) AS projects,
      (SELECT COUNT(*) FROM projects WHERE status = 'At risk') AS risks
  `,
    )
    .get();
  res.json(stats);
});
app.get("/api/activities", (req, res) => {
  const status = req.query.status;
  const visibility =
    req.user.role === "Student"
      ? "submitted_by = @name"
      : req.user.role === "Faculty"
        ? "1 = 1"
        : "1 = 1";
  const params = { name: req.user.name, programme: req.user.programme, status };
  const activities =
    status && status !== "all"
      ? db
          .prepare(
            `SELECT * FROM activities WHERE ${visibility} AND status = @status ORDER BY programme_date ASC`,
          )
          .all(params)
      : db
          .prepare(
            `SELECT * FROM activities WHERE ${visibility} ORDER BY created_at DESC`,
          )
          .all(params);
  res.json(activities);
});
app.post(
  "/api/activities",
  requireRole("Student", "Faculty", "Admin"),
  (req, res) => {
    const { title, category, programme, programmeDate, priority, description } =
      req.body;
    if (
      ![title, category, programme, programmeDate].every(
        (value) => typeof value === "string" && value.trim(),
      )
    ) {
      return res
        .status(400)
        .json({
          error: "Title, category, programme and programme date are required.",
        });
    }
    const result = db
      .prepare(
        `INSERT INTO activities
    (title, category, programme, owner, submitted_by, programme_date, priority, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        title.trim(),
        category,
        programme,
        "Unassigned",
        req.user.name,
        programmeDate,
        priority || "Medium",
        description || "",
      );
    const initialStatus =
      req.user.role === "Faculty" ? "Pending HOD" : "Pending Faculty";
    db.prepare("UPDATE activities SET status = ? WHERE id = ?").run(
      initialStatus,
      result.lastInsertRowid,
    );
    res
      .status(201)
      .json(
        db
          .prepare("SELECT * FROM activities WHERE id = ?")
          .get(result.lastInsertRowid),
      );
  },
);
app.delete("/api/activities/:id", (req, res) => {
  const activity = db
    .prepare("SELECT id, submitted_by FROM activities WHERE id = ?")
    .get(req.params.id);
  if (!activity) return res.status(404).json({ error: "Activity not found." });
  if (activity.submitted_by !== req.user.name) {
    return res
      .status(403)
      .json({
        error: "Only the person who created this request can delete it.",
      });
  }
  db.prepare("DELETE FROM activities WHERE id = ?").run(req.params.id);
  res.status(204).end();
});
app.patch(
  "/api/activities/:id",
  requireRole("Faculty", "Admin"),
  (req, res) => {
    const { status } = req.body;
    const allowed = [
      "Pending HOD",
      "Pending Faculty",
      "Approved",
      "Needs changes",
    ];
    if (!allowed.includes(status))
      return res.status(400).json({ error: "Unsupported workflow status." });
    const activity = db
      .prepare("SELECT * FROM activities WHERE id = ?")
      .get(req.params.id);
    if (!activity)
      return res.status(404).json({ error: "Activity not found." });
    const approving = status === "Approved";
    const requestingChanges = status === "Needs changes";
    const facultyCanAct =
      req.user.role === "Faculty" &&
      (approving || requestingChanges) &&
      activity.status === "Pending Faculty";
    const adminCanAct =
      req.user.role === "Admin" &&
      (approving || requestingChanges) &&
      activity.status === "Pending HOD";
    if (!facultyCanAct && !adminCanAct) {
      return res.status(403).json({
        error:
          req.user.role === "Faculty"
            ? "Faculty can act only on requests waiting for faculty approval."
            : "Admin can act only after faculty approval is complete.",
      });
    }
    const nextStatus = facultyCanAct && approving ? "Pending HOD" : status;
    const result = db
      .prepare(
        "UPDATE activities SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .run(nextStatus, req.params.id);
    res.json(
      db.prepare("SELECT * FROM activities WHERE id = ?").get(req.params.id),
    );
  },
);
app.get("/api/projects", (_req, res) =>
  res.json(db.prepare("SELECT * FROM projects ORDER BY progress DESC").all()),
);
app.get("*", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);

app.listen(port, () => console.log(`running at http://localhost:${port}`));
