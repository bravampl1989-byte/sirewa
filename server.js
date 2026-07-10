const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cron = require("node-cron");
const multer = require("multer");
const crypto = require("crypto");
const axios = require("axios");
const MultipartFormData = require("form-data");

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const REMINDERS_FILE = path.join(DATA_DIR, "reminders.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const FONNTE_BASE_URL = "https://api.fonnte.com";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    app: "SIREWA",
    time: new Date().toISOString(),
  });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      ensureDataDir();
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      callback(null, UPLOAD_DIR);
    },
    filename: (_req, file, callback) => {
      const safeName = file.originalname.replace(/[^\w.-]+/g, "_");
      callback(null, `${Date.now()}-${Math.random().toString(16).slice(2)}-${safeName}`);
    },
  }),
  limits: {
    fileSize: 4 * 1024 * 1024,
    files: 5,
  },
});

let groups = [];
let reminders = loadJson(REMINDERS_FILE, []).map(migrateReminder);
let settings = loadJson(SETTINGS_FILE, { token: "" });
settings = migrateSettings(settings);
const sessions = loadSessions();
let jobs = new Map();
let status = buildStatus();

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const index = cookie.indexOf("=");
        return [cookie.slice(0, index), decodeURIComponent(cookie.slice(index + 1))];
      })
  );
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function migrateSettings(value) {
  const migrated = { ...value };

  if (!Array.isArray(migrated.users)) {
    migrated.users = migrated.auth
      ? [
          {
            username: migrated.auth.username,
            salt: migrated.auth.salt,
            hash: migrated.auth.hash,
            role: "admin",
            createdAt: migrated.auth.createdAt || new Date().toISOString(),
          },
        ]
      : [];
  }

  delete migrated.auth;
  if (!Array.isArray(migrated.manualGroups)) {
    migrated.manualGroups = [];
  }
  return migrated;
}

function publicManualGroups() {
  return settings.manualGroups.map((group) => ({
    id: group.id,
    name: group.name,
    createdAt: group.createdAt,
  }));
}

function publicUsers() {
  return settings.users.map((user) => ({
    username: user.username,
    role: user.role || "admin",
    createdAt: user.createdAt,
  }));
}

function findUser(username) {
  return settings.users.find((user) => user.username === username);
}

function verifyPassword(password, user) {
  if (!user?.salt || !user?.hash) {
    return false;
  }

  const hash = crypto.scryptSync(password, user.salt, 64);
  const saved = Buffer.from(user.hash, "hex");
  return saved.length === hash.length && crypto.timingSafeEqual(saved, hash);
}

function isAuthenticated(req) {
  const token = parseCookies(req).reminder_session;
  if (!token || !sessions.has(token)) {
    return false;
  }

  const session = sessions.get(token);
  if (Date.now() - session.createdAt > SESSION_MAX_AGE_MS) {
    sessions.delete(token);
    saveSessions();
    return false;
  }

  return true;
}

function requireAuth(req, res, next) {
  if (settings.users.length === 0) {
    return res.status(401).json({ error: "Akun admin belum dibuat.", setupRequired: true });
  }

  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: "Login diperlukan." });
  }

  next();
}

function setSessionCookie(res, username) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { username, createdAt: Date.now() });
  saveSessions();
  res.setHeader("Set-Cookie", `reminder_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_MS / 1000}`);
}

function clearSessionCookie(req, res) {
  const token = parseCookies(req).reminder_session;
  if (token) {
    sessions.delete(token);
    saveSessions();
  }
  res.setHeader("Set-Cookie", "reminder_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadJson(filePath, fallback) {
  ensureDataDir();
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`Gagal membaca ${path.basename(filePath)}:`, error);
    return fallback;
  }
}

function loadSessions() {
  const rawSessions = loadJson(SESSIONS_FILE, {});
  const now = Date.now();
  const activeEntries = Object.entries(rawSessions).filter(
    ([, session]) => session?.username && now - Number(session.createdAt || 0) <= SESSION_MAX_AGE_MS
  );
  return new Map(activeEntries);
}

function saveSessions() {
  saveJson(SESSIONS_FILE, Object.fromEntries(sessions.entries()));
}

function saveJson(filePath, value) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function saveReminders() {
  saveJson(REMINDERS_FILE, reminders);
}

function saveSettings() {
  saveJson(SETTINGS_FILE, settings);
}

function maskToken(token) {
  if (!token) {
    return "";
  }

  if (token.length <= 8) {
    return "********";
  }

  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function buildStatus(message) {
  const configured = Boolean(settings.token);
  return {
    state: configured ? "ready" : "needs_token",
    message: message || (configured ? "Fonnte siap" : "Masukkan token Fonnte"),
    ready: configured,
    tokenMasked: maskToken(settings.token),
  };
}

function emitState() {
  io.emit("state", { status, groups: allGroups(), reminders });
}

function allGroups() {
  const manualGroups = publicManualGroups().map((group) => ({ ...group, source: "manual" }));
  const fonnteGroups = groups.map((group) => ({ ...group, source: "fonnte" }));
  return [...manualGroups, ...fonnteGroups];
}

function normalizeTimes(times) {
  return [...new Set((times || []).filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)))].sort();
}

function normalizeDays(days) {
  return Array.isArray(days)
    ? [...new Set(days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [];
}

function normalizeMessages(messages) {
  return (messages || [])
    .map((message) => String(message || "").trim())
    .filter(Boolean);
}

function normalizeAttachments(attachments) {
  return (attachments || [])
    .map((attachment) => ({
      id: String(attachment.id || ""),
      originalName: String(attachment.originalName || ""),
      filename: String(attachment.filename || ""),
      mimetype: String(attachment.mimetype || ""),
      size: Number(attachment.size || 0),
    }))
    .filter((attachment) => attachment.id && attachment.filename);
}

function migrateReminder(reminder) {
  const migrated = reminder.target
    ? { ...reminder }
    : {
        ...reminder,
        target: reminder.groupId || "",
        targetName: reminder.groupName || reminder.groupId || "",
      };

  migrated.messages = normalizeMessages(migrated.messages || [migrated.message]);
  migrated.attachments = normalizeAttachments(migrated.attachments);
  migrated.message = migrated.messages[0] || "";
  return migrated;
}

function getReminder(id) {
  return reminders.find((reminder) => reminder.id === id);
}

function createCronExpression(time, days) {
  const [hour, minute] = time.split(":");
  const dayPart = Array.isArray(days) && days.length ? days.join(",") : "*";
  return `${minute} ${hour} * * ${dayPart}`;
}

function stopReminderJobs(id) {
  const reminderJobs = jobs.get(id) || [];
  reminderJobs.forEach((job) => job.stop());
  jobs.delete(id);
}

function scheduleReminder(reminder) {
  stopReminderJobs(reminder.id);

  if (!reminder.active) {
    return;
  }

  const scheduledJobs = reminder.times.map((time) => {
    const expression = createCronExpression(time, reminder.days);
    return cron.schedule(
      expression,
      async () => {
        const latest = getReminder(reminder.id);
        if (!latest || !latest.active || !settings.token) {
          return;
        }

        try {
          latest.lastResponse = await sendFonnteMessages(
            latest.target,
            latest.messages || [latest.message],
            latest.attachments || []
          );
          latest.lastSentAt = new Date().toISOString();
          latest.lastError = null;
        } catch (error) {
          latest.lastError = error.message;
          console.error(`Gagal mengirim reminder ${latest.id}:`, error);
        }

        saveReminders();
        emitState();
      },
      { timezone: "Asia/Bangkok" }
    );
  });

  jobs.set(reminder.id, scheduledJobs);
}

function rescheduleAll() {
  jobs.forEach((_, id) => stopReminderJobs(id));
  reminders.forEach(scheduleReminder);
}

async function fonntePost(endpoint, formData) {
  if (!settings.token) {
    throw new Error("Token Fonnte belum disimpan.");
  }

  const options = {
    method: "POST",
    headers: { Authorization: settings.token },
  };

  if (formData) {
    options.body = formData;
  }

  const response = await fetch(`${FONNTE_BASE_URL}${endpoint}`, options);
  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_error) {
    payload = { detail: text };
  }

  if (!response.ok || payload.status === false) {
    throw new Error(payload.reason || payload.detail || `Fonnte error ${response.status}`);
  }

  return payload;
}

async function sendFonnteMessage(target, message, attachment) {
  const formData = new MultipartFormData();
  formData.append("target", target);
  formData.append("message", message);
  formData.append("countryCode", "62");
  formData.append("connectOnly", "true");
  formData.append("delay", "0");

  if (attachment) {
    const filePath = path.join(UPLOAD_DIR, attachment.filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File lampiran tidak ditemukan: ${attachment.originalName}`);
    }

    formData.append("file", fs.createReadStream(filePath), {
      filename: attachment.originalName || attachment.filename,
      contentType: attachment.mimetype || "application/octet-stream",
    });
    formData.append("filename", attachment.originalName || attachment.filename);
  }

  try {
    const response = await axios.post(`${FONNTE_BASE_URL}/send`, formData, {
      headers: {
        ...formData.getHeaders(),
        Authorization: settings.token,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,
    });

    if (response.status >= 400 || response.data?.status === false) {
      throw new Error(response.data?.reason || response.data?.detail || `Fonnte error ${response.status}`);
    }

    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.reason || error.response?.data?.detail || error.message);
  }
}

async function sendFonnteMessages(target, messages, attachments = []) {
  const results = [];
  const cleanedMessages = normalizeMessages(messages);
  const cleanedAttachments = normalizeAttachments(attachments);

  if (cleanedAttachments.length > 0) {
    for (const [index, attachment] of cleanedAttachments.entries()) {
      const message = cleanedMessages[index] || cleanedMessages[0] || attachment.originalName;
      results.push(await sendFonnteMessage(target, message, attachment));
    }

    for (const message of cleanedMessages.slice(cleanedAttachments.length)) {
      results.push(await sendFonnteMessage(target, message));
    }

    return results;
  }

  for (const message of cleanedMessages) {
    results.push(await sendFonnteMessage(target, message));
  }

  return results;
}

async function fetchFonnteGroups() {
  const payload = await fonntePost("/get-whatsapp-group");
  groups = Array.isArray(payload.data)
    ? payload.data
        .filter((group) => group.id && group.name)
        .map((group) => ({ id: group.id, name: group.name }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return groups;
}

app.get("/api/auth/status", (req, res) => {
  const token = parseCookies(req).reminder_session;
  const session = token ? sessions.get(token) : null;
  res.json({
    authenticated: isAuthenticated(req),
    setupRequired: settings.users.length === 0,
    username: session?.username || "",
  });
});

app.post("/api/auth/setup", (req, res) => {
  if (settings.users.length > 0) {
    return res.status(400).json({ error: "Akun admin sudah dibuat." });
  }

  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (!username || password.length < 6) {
    return res.status(400).json({ error: "Username wajib diisi dan password minimal 6 karakter." });
  }

  settings.users.push({
    username,
    ...createPasswordHash(password),
    role: "admin",
    createdAt: new Date().toISOString(),
  });
  saveSettings();
  setSessionCookie(res, username);
  res.json({ ok: true, username });
});

app.post("/api/auth/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (settings.users.length === 0) {
    return res.status(400).json({ error: "Akun admin belum dibuat.", setupRequired: true });
  }

  const user = findUser(username);
  if (!user || !verifyPassword(password, user)) {
    return res.status(401).json({ error: "Username atau password salah." });
  }

  setSessionCookie(res, username);
  res.json({ ok: true, username });
});

app.post("/api/auth/logout", (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.get("/api/users", requireAuth, (_req, res) => {
  res.json({ users: publicUsers() });
});

app.post("/api/users", requireAuth, (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (!username || password.length < 6) {
    return res.status(400).json({ error: "Username wajib diisi dan password minimal 6 karakter." });
  }

  if (findUser(username)) {
    return res.status(400).json({ error: "Username sudah ada." });
  }

  settings.users.push({
    username,
    ...createPasswordHash(password),
    role: "admin",
    createdAt: new Date().toISOString(),
  });
  saveSettings();
  res.status(201).json({ users: publicUsers() });
});

app.delete("/api/users/:username", requireAuth, (req, res) => {
  const username = req.params.username;

  if (settings.users.length <= 1) {
    return res.status(400).json({ error: "Minimal harus ada satu user." });
  }

  const before = settings.users.length;
  settings.users = settings.users.filter((user) => user.username !== username);

  if (settings.users.length === before) {
    return res.status(404).json({ error: "User tidak ditemukan." });
  }

  for (const [token, session] of sessions.entries()) {
    if (session.username === username) {
      sessions.delete(token);
    }
  }

  saveSettings();
  res.json({ users: publicUsers() });
});

app.get("/api/state", requireAuth, (_req, res) => {
  res.json({ status, groups: allGroups(), reminders });
});

app.post("/api/settings", requireAuth, (req, res) => {
  const token = String(req.body.token || "").trim();
  if (!token) {
    return res.status(400).json({ error: "Token Fonnte wajib diisi." });
  }

  settings.token = token;
  saveSettings();
  status = buildStatus("Token Fonnte tersimpan");
  rescheduleAll();
  emitState();
  res.json({ status });
});

app.delete("/api/settings/token", requireAuth, (_req, res) => {
  settings.token = "";
  saveSettings();
  status = buildStatus("Token Fonnte direset");
  emitState();
  res.json({ status });
});

app.post("/api/groups/fetch", requireAuth, async (_req, res) => {
  try {
    const payload = await fonntePost("/fetch-group");
    status = buildStatus(payload.detail || "Update group selesai");
    emitState();
    res.json(payload);
  } catch (error) {
    status = buildStatus(error.message);
    emitState();
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/groups/refresh", requireAuth, async (_req, res) => {
  try {
    await fetchFonnteGroups();
    status = buildStatus("Daftar group diperbarui");
    emitState();
    res.json({ groups: allGroups() });
  } catch (error) {
    status = buildStatus(error.message);
    emitState();
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/groups/manual", requireAuth, (_req, res) => {
  res.json({ groups: publicManualGroups() });
});

app.post("/api/groups/manual", requireAuth, (req, res) => {
  const id = String(req.body.id || "").trim();
  const name = String(req.body.name || "").trim();

  if (!id || !name) {
    return res.status(400).json({ error: "Nama group dan ID group wajib diisi." });
  }

  if (settings.manualGroups.some((group) => group.id === id)) {
    return res.status(400).json({ error: "ID group sudah ada." });
  }

  settings.manualGroups.push({
    id,
    name,
    createdAt: new Date().toISOString(),
  });
  saveSettings();
  emitState();
  res.status(201).json({ groups: publicManualGroups() });
});

app.delete("/api/groups/manual/:id", requireAuth, (req, res) => {
  const before = settings.manualGroups.length;
  settings.manualGroups = settings.manualGroups.filter((group) => group.id !== req.params.id);

  if (settings.manualGroups.length === before) {
    return res.status(404).json({ error: "Group manual tidak ditemukan." });
  }

  saveSettings();
  emitState();
  res.json({ groups: publicManualGroups() });
});

app.post("/api/uploads", requireAuth, upload.array("files", 5), (req, res) => {
  const attachments = (req.files || []).map((file) => ({
    id: file.filename,
    originalName: file.originalname,
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size,
  }));

  res.status(201).json({ attachments });
});

app.post("/api/reminders/test", requireAuth, async (req, res) => {
  const target = String(req.body.target || "").trim();
  const messages = normalizeMessages(req.body.messages || [req.body.message]);
  const attachments = normalizeAttachments(req.body.attachments);

  if (!target || (messages.length === 0 && attachments.length === 0)) {
    return res.status(400).json({ error: "Target dan pesan/lampiran wajib diisi." });
  }

  try {
    res.json(await sendFonnteMessages(target, messages, attachments));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/reminders", requireAuth, (req, res) => {
  const { target, targetName, message, messages, times, days, attachments } = req.body;
  const cleanedTarget = String(target || "").trim();
  const cleanedMessages = normalizeMessages(messages || [message]);
  const cleanedAttachments = normalizeAttachments(attachments);
  const cleanedTimes = normalizeTimes(times);
  const cleanedDays = normalizeDays(days);

  if (!settings.token) {
    return res.status(400).json({ error: "Simpan token Fonnte dulu." });
  }

  if (!cleanedTarget || (cleanedMessages.length === 0 && cleanedAttachments.length === 0) || cleanedTimes.length === 0) {
    return res.status(400).json({ error: "Target, pesan/lampiran, dan minimal satu waktu wajib diisi." });
  }

  const reminder = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    target: cleanedTarget,
    targetName: targetName || cleanedTarget,
    message: cleanedMessages[0],
    messages: cleanedMessages,
    attachments: cleanedAttachments,
    times: cleanedTimes,
    days: cleanedDays,
    active: true,
    createdAt: new Date().toISOString(),
    lastSentAt: null,
    lastError: null,
    lastResponse: null,
  };

  reminders.unshift(reminder);
  saveReminders();
  scheduleReminder(reminder);
  emitState();
  res.status(201).json(reminder);
});

app.patch("/api/reminders/:id", requireAuth, (req, res) => {
  const reminder = getReminder(req.params.id);
  if (!reminder) {
    return res.status(404).json({ error: "Reminder tidak ditemukan." });
  }

  if (typeof req.body.active === "boolean") {
    reminder.active = req.body.active;
  }

  saveReminders();
  scheduleReminder(reminder);
  emitState();
  res.json(reminder);
});

app.delete("/api/reminders/:id", requireAuth, (req, res) => {
  const before = reminders.length;
  reminders = reminders.filter((reminder) => reminder.id !== req.params.id);

  if (before === reminders.length) {
    return res.status(404).json({ error: "Reminder tidak ditemukan." });
  }

  stopReminderJobs(req.params.id);
  saveReminders();
  emitState();
  res.status(204).end();
});

app.delete("/api/reminders", requireAuth, (_req, res) => {
  jobs.forEach((_, id) => stopReminderJobs(id));
  reminders = [];
  saveReminders();
  emitState();
  res.status(204).end();
});

io.on("connection", (socket) => {
  socket.emit("state", { status, groups: allGroups(), reminders });
});

rescheduleAll();

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Reminder WA Fonnte berjalan di http://localhost:${PORT}`);
  });
}

module.exports = { app, server, io };
