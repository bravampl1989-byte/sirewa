const socket = io();

const state = {
  status: {},
  groups: [],
  reminders: [],
};

let authState = {
  authenticated: false,
  setupRequired: false,
};

const dayOptions = [
  { value: 1, label: "Sen" },
  { value: 2, label: "Sel" },
  { value: 3, label: "Rab" },
  { value: 4, label: "Kam" },
  { value: 5, label: "Jum" },
  { value: 6, label: "Sab" },
  { value: 0, label: "Min" },
];

const authScreen = document.querySelector("#authScreen");
const authForm = document.querySelector("#authForm");
const authTitle = document.querySelector("#authTitle");
const authUsername = document.querySelector("#authUsername");
const authPassword = document.querySelector("#authPassword");
const authSubmit = document.querySelector("#authSubmit");
const authMessage = document.querySelector("#authMessage");
const statusPill = document.querySelector("#statusPill");
const sidebar = document.querySelector("#sidebar");
const pageTitle = document.querySelector("#pageTitle");
const dashboardView = document.querySelector("#dashboardView");
const reminderView = document.querySelector("#reminderView");
const groupsView = document.querySelector("#groupsView");
const usersView = document.querySelector("#usersView");
const navItems = document.querySelectorAll(".nav-item[data-view]");
const logoutButton = document.querySelector("#logoutButton");
const settingsForm = document.querySelector("#settingsForm");
const tokenInput = document.querySelector("#token");
const tokenInfo = document.querySelector("#tokenInfo");
const resetToken = document.querySelector("#resetToken");
const fetchGroups = document.querySelector("#fetchGroups");
const reminderForm = document.querySelector("#reminderForm");
const reminderItemList = document.querySelector("#reminderItemList");
const addReminderItemButton = document.querySelector("#addReminderItem");
const refreshGroups = document.querySelector("#refreshGroups");
const testSend = document.querySelector("#testSend");
const resetForm = document.querySelector("#resetForm");
const clearReminders = document.querySelector("#clearReminders");
const reminderList = document.querySelector("#reminderList");
const countText = document.querySelector("#countText");
const formMessage = document.querySelector("#formMessage");
const targetMessage = document.querySelector("#targetMessage");
const userForm = document.querySelector("#userForm");
const newUsername = document.querySelector("#newUsername");
const newPassword = document.querySelector("#newPassword");
const userMessage = document.querySelector("#userMessage");
const userList = document.querySelector("#userList");
const manualGroupForm = document.querySelector("#manualGroupForm");
const manualGroupName = document.querySelector("#manualGroupName");
const manualGroupId = document.querySelector("#manualGroupId");
const manualGroupMessage = document.querySelector("#manualGroupMessage");
const manualGroupList = document.querySelector("#manualGroupList");

const itemFiles = new WeakMap();

function createDayOptions(selectedDays = dayOptions.map((day) => day.value)) {
  return dayOptions
    .map(
      (day) => `
        <label>
          <input type="checkbox" value="${day.value}" ${selectedDays.includes(day.value) ? "checked" : ""} />
          ${day.label}
        </label>
      `
    )
    .join("");
}

function addTimeRow(timeList, value = "08:00") {
  const row = document.createElement("div");
  row.className = "time-row";
  row.innerHTML = `
    <input class="time-24" type="text" value="${value}" placeholder="HH:MM" inputmode="numeric" pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$" required />
    <button class="remove-time" type="button" title="Hapus waktu">X</button>
  `;
  row.querySelector("button").addEventListener("click", () => {
    if (timeList.querySelectorAll(".time-row").length > 1) {
      row.remove();
    }
  });
  timeList.appendChild(row);
}

function addReminderItem(data = {}) {
  const item = document.createElement("section");
  item.className = "reminder-item";
  item.innerHTML = `
    <div class="reminder-item-head">
      <strong>Paket reminder</strong>
      <button class="small danger remove-item" type="button">Hapus paket</button>
    </div>
    <div class="field">
      <label>Target WhatsApp paket ini</label>
      <div class="select-row">
        <select class="item-group-select">
          ${createGroupOptions(data.target)}
        </select>
      </div>
    </div>
    <div class="field">
      <label>Target manual paket ini</label>
      <input class="item-manual-target" type="text" placeholder="Contoh: 62812xxxx atau 12345@g.us" value="${escapeHtml(data.target || "")}" />
    </div>
    <div class="field">
      <label>Pesan</label>
      <textarea class="item-message" rows="3" placeholder="Contoh: Jangan lupa absen sore ini.">${escapeHtml(data.message || "")}</textarea>
    </div>
    <div class="field">
      <label>Lampiran paket ini</label>
      <div class="attachment-actions">
        <label class="file-button">
          Upload dokumen
          <input class="document-input" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,image/*" />
        </label>
        <label class="file-button">
          Ambil foto
          <input class="camera-input" type="file" accept="image/*" capture="environment" />
        </label>
      </div>
      <div class="attachment-list"><div class="attachment-empty">Belum ada lampiran.</div></div>
    </div>
    <div class="field">
      <label>Hari kirim paket ini</label>
      <div class="day-grid">${createDayOptions(data.days)}</div>
    </div>
    <div class="field">
      <label>Waktu kirim paket ini</label>
      <div class="time-list"></div>
      <button class="secondary add-time" type="button">Tambah waktu</button>
    </div>
  `;

  itemFiles.set(item, []);
  const timeList = item.querySelector(".time-list");
  (data.times?.length ? data.times : ["08:00", "17:00"]).forEach((time) => addTimeRow(timeList, time));

  const groupSelect = item.querySelector(".item-group-select");
  const manualTarget = item.querySelector(".item-manual-target");
  groupSelect.addEventListener("change", () => {
    if (groupSelect.value) {
      manualTarget.value = "";
    }
  });
  manualTarget.addEventListener("input", () => {
    if (manualTarget.value.trim()) {
      groupSelect.value = "";
    }
  });

  item.querySelector(".add-time").addEventListener("click", () => addTimeRow(timeList));
  item.querySelector(".remove-item").addEventListener("click", () => {
    if (reminderItemList.querySelectorAll(".reminder-item").length > 1) {
      item.remove();
    }
  });
  item.querySelector(".document-input").addEventListener("change", (event) => {
    addPendingFiles(item, [...event.target.files]);
    event.target.value = "";
  });
  item.querySelector(".camera-input").addEventListener("change", (event) => {
    addPendingFiles(item, [...event.target.files]);
    event.target.value = "";
  });

  reminderItemList.appendChild(item);
}

function createGroupOptions(selected = "") {
  const options = ['<option value="">Pilih group</option>'];
  state.groups.forEach((group) => {
    const label = `${group.source === "manual" ? "Manual" : "Fonnte"} - ${group.name}`;
    options.push(
      `<option value="${escapeHtml(group.id)}" data-name="${escapeHtml(group.name)}" ${group.id === selected ? "selected" : ""}>${escapeHtml(label)}</option>`
    );
  });
  return options.join("");
}

function addPendingFiles(item, files) {
  itemFiles.set(item, [...(itemFiles.get(item) || []), ...files].slice(0, 5));
  renderPendingFiles(item);
}

function renderPendingFiles(item) {
  const attachmentList = item.querySelector(".attachment-list");
  const files = itemFiles.get(item) || [];

  if (files.length === 0) {
    attachmentList.innerHTML = '<div class="attachment-empty">Belum ada lampiran.</div>';
    return;
  }

  attachmentList.innerHTML = "";
  files.forEach((file, index) => {
    const row = document.createElement("div");
    row.className = "attachment-item";
    row.innerHTML = `
      <span>${escapeHtml(file.name)} <small>${formatFileSize(file.size)}</small></span>
      <button class="remove-attachment" type="button">Hapus</button>
    `;
    row.querySelector("button").addEventListener("click", () => {
      files.splice(index, 1);
      itemFiles.set(item, files);
      renderPendingFiles(item);
    });
    attachmentList.appendChild(row);
  });
}

function formatFileSize(size) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function uploadFiles(files) {
  if (files.length === 0) {
    return [];
  }

  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  const response = await fetch("/api/uploads", {
    method: "POST",
    body: formData,
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Gagal upload lampiran.");
  }

  return payload.attachments || [];
}

function collectReminderItems() {
  return [...reminderItemList.querySelectorAll(".reminder-item")].map((item) => ({
    item,
    ...getItemTarget(item),
    message: item.querySelector(".item-message").value.trim(),
    days: [...item.querySelectorAll(".day-grid input:checked")].map((input) => Number(input.value)),
    times: [...item.querySelectorAll(".time-list .time-24")].map((input) => input.value.trim()),
    files: itemFiles.get(item) || [],
  }));
}

function getItemTarget(item) {
  const manual = item.querySelector(".item-manual-target").value.trim();
  if (manual) {
    return {
      target: manual,
      targetName: manual,
    };
  }

  const groupSelect = item.querySelector(".item-group-select");
  const selectedOption = groupSelect.options[groupSelect.selectedIndex];
  return {
    target: groupSelect.value,
    targetName: selectedOption?.dataset.name || selectedOption?.textContent || groupSelect.value,
  };
}

function resetReminderForm(message = "") {
  reminderForm.reset();
  reminderItemList.innerHTML = "";
  addReminderItem();
  formMessage.textContent = message;
}

function updateStatus() {
  const { message, tokenMasked } = state.status;
  statusPill.textContent = message || "Memuat";
  statusPill.className = `status ${state.status.ready ? "ready" : "warning"}`;
  tokenInfo.innerHTML = `
    <span>Status token</span>
    <strong>${tokenMasked ? `Token database aktif (${tokenMasked})` : "Token belum tersimpan"}</strong>
  `;
}

function setTokenNote(message, isError = false) {
  tokenInfo.innerHTML = `
    <span>Status token</span>
    <strong class="${isError ? "status-error" : ""}">${message}</strong>
  `;
}

function renderGroups() {
  reminderItemList.querySelectorAll(".item-group-select").forEach((select) => {
    const selected = select.value;
    select.innerHTML = createGroupOptions(selected);
    select.value = selected;
  });
}

function formatDays(daysValue) {
  if (!daysValue || daysValue.length === 0 || daysValue.length === 7) {
    return "Setiap hari";
  }

  return dayOptions
    .filter((day) => daysValue.includes(day.value))
    .map((day) => day.label)
    .join(", ");
}

function renderReminders() {
  const activeCount = state.reminders.filter((reminder) => reminder.active).length;
  countText.textContent = `${activeCount} aktif`;

  if (state.reminders.length === 0) {
    reminderList.innerHTML = '<div class="empty">Belum ada reminder.</div>';
    return;
  }

  reminderList.innerHTML = "";
  state.reminders.forEach((reminder) => {
    const card = document.createElement("article");
    card.className = "reminder-card";
    card.innerHTML = `
      <div class="reminder-top">
        <div>
          <div class="group-name">${escapeHtml(reminder.targetName || reminder.groupName || reminder.target)}</div>
          <div class="meta">
            <span class="chip">${reminder.active ? "Aktif" : "Nonaktif"}</span>
            <span class="chip">${reminder.times.join(", ")}</span>
            <span class="chip">${formatDays(reminder.days)}</span>
          </div>
        </div>
        <div class="actions">
          <button class="small toggle" type="button">${reminder.active ? "Pause" : "Aktifkan"}</button>
          <button class="small danger delete" type="button">Hapus</button>
        </div>
      </div>
      <div class="reminder-messages">${renderReminderMessages(reminder)}</div>
      ${renderReminderAttachments(reminder)}
      ${reminder.lastSentAt ? `<div class="meta"><span class="chip">Terkirim ${new Date(reminder.lastSentAt).toLocaleString("id-ID")}</span></div>` : ""}
      ${reminder.lastError ? `<div class="meta"><span class="chip">Error: ${escapeHtml(reminder.lastError)}</span></div>` : ""}
    `;

    card.querySelector(".toggle").addEventListener("click", () => toggleReminder(reminder));
    card.querySelector(".delete").addEventListener("click", () => deleteReminder(reminder));
    reminderList.appendChild(card);
  });
}

function renderReminderMessages(reminder) {
  const messages = reminder.messages?.length ? reminder.messages : [reminder.message];
  return messages
    .filter(Boolean)
    .map((message, index) => `<p class="reminder-message">${index + 1}. ${escapeHtml(message)}</p>`)
    .join("");
}

function renderReminderAttachments(reminder) {
  const attachments = reminder.attachments || [];
  if (attachments.length === 0) {
    return "";
  }

  return `
    <div class="meta">
      ${attachments.map((attachment) => `<span class="chip">${escapeHtml(attachment.originalName)}</span>`).join("")}
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function toggleReminder(reminder) {
  await fetch(`/api/reminders/${reminder.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: !reminder.active }),
  });
}

async function deleteReminder(reminder) {
  await fetch(`/api/reminders/${reminder.id}`, {
    method: "DELETE",
  });
}

async function refreshState() {
  const response = await fetch("/api/state");
  if (response.status === 401) {
    await refreshAuth();
    return;
  }
  Object.assign(state, await response.json());
  renderAll();
}

function renderAll() {
  renderAuth();
  updateStatus();
  renderGroups();
  renderReminders();
}

function renderAuth() {
  authScreen.classList.toggle("hidden", authState.authenticated);
  sidebar.classList.toggle("hidden", !authState.authenticated);
  logoutButton.classList.toggle("hidden", !authState.authenticated);
  authTitle.textContent = authState.setupRequired ? "Buat Akun Admin" : "Login";
  authSubmit.textContent = authState.setupRequired ? "Buat akun" : "Masuk";
  authPassword.autocomplete = authState.setupRequired ? "new-password" : "current-password";
}

async function showView(viewId) {
  const views = [dashboardView, reminderView, groupsView, usersView];
  views.forEach((view) => view.classList.toggle("hidden", view.id !== viewId));
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));

  if (viewId === "reminderView") {
    pageTitle.textContent = "Buat Reminder";
    return;
  }

  if (viewId === "groupsView") {
    pageTitle.textContent = "Group WhatsApp";
    await loadManualGroups();
    return;
  }

  if (viewId === "usersView") {
    pageTitle.textContent = "User Login";
    await loadUsers();
    return;
  }

  pageTitle.textContent = "Daftar Reminder";
}

async function loadUsers() {
  const response = await fetch("/api/users");
  if (!response.ok) {
    userList.innerHTML = '<div class="empty">Gagal memuat user.</div>';
    return;
  }

  const payload = await response.json();
  renderUsers(payload.users || []);
}

async function loadManualGroups() {
  const response = await fetch("/api/groups/manual");
  if (!response.ok) {
    manualGroupList.innerHTML = '<div class="empty">Gagal memuat group manual.</div>';
    return;
  }

  const payload = await response.json();
  renderManualGroups(payload.groups || []);
}

function renderManualGroups(groups) {
  if (groups.length === 0) {
    manualGroupList.innerHTML = '<div class="empty">Belum ada group manual.</div>';
    return;
  }

  manualGroupList.innerHTML = "";
  groups.forEach((group) => {
    const row = document.createElement("div");
    row.className = "user-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(group.name)}</strong>
        <p>${escapeHtml(group.id)}</p>
      </div>
      <button class="small danger" type="button">Hapus</button>
    `;
    row.querySelector("button").addEventListener("click", () => deleteManualGroup(group.id));
    manualGroupList.appendChild(row);
  });
}

async function deleteManualGroup(id) {
  manualGroupMessage.textContent = "";
  const response = await fetch(`/api/groups/manual/${encodeURIComponent(id)}`, { method: "DELETE" });
  const payload = await response.json();
  if (!response.ok) {
    manualGroupMessage.textContent = payload.error || "Gagal menghapus group.";
    return;
  }
  renderManualGroups(payload.groups || []);
  await refreshState();
  manualGroupMessage.textContent = "Group dihapus.";
}

function renderUsers(users) {
  if (users.length === 0) {
    userList.innerHTML = '<div class="empty">Belum ada user.</div>';
    return;
  }

  userList.innerHTML = "";
  users.forEach((user) => {
    const row = document.createElement("div");
    row.className = "user-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(user.username)}</strong>
        <p>${user.role || "admin"}${user.createdAt ? ` - ${new Date(user.createdAt).toLocaleDateString("id-ID")}` : ""}</p>
      </div>
      <button class="small danger" type="button">Hapus</button>
    `;
    row.querySelector("button").addEventListener("click", () => deleteUser(user.username));
    userList.appendChild(row);
  });
}

async function deleteUser(username) {
  userMessage.textContent = "";
  const response = await fetch(`/api/users/${encodeURIComponent(username)}`, { method: "DELETE" });
  const payload = await response.json();
  if (!response.ok) {
    userMessage.textContent = payload.error || "Gagal menghapus user.";
    return;
  }
  renderUsers(payload.users || []);
  userMessage.textContent = "User dihapus.";
}

async function refreshAuth() {
  const response = await fetch("/api/auth/status");
  authState = await response.json();
  renderAuth();

  if (authState.authenticated) {
    await refreshState();
  }
}

addReminderItemButton.addEventListener("click", () => addReminderItem());
resetForm.addEventListener("click", () => resetReminderForm("Form direset."));
navItems.forEach((item) => {
  item.addEventListener("click", () => showView(item.dataset.view));
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authMessage.textContent = "";

  const response = await fetch(authState.setupRequired ? "/api/auth/setup" : "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: authUsername.value,
      password: authPassword.value,
    }),
  });
  const payload = await response.json();

  if (!response.ok) {
    authMessage.textContent = payload.error || "Login gagal.";
    return;
  }

  authUsername.value = "";
  authPassword.value = "";
  await refreshAuth();
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  authState = { authenticated: false, setupRequired: false };
  showView("dashboardView");
  renderAuth();
});

userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  userMessage.textContent = "";

  const response = await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: newUsername.value,
      password: newPassword.value,
    }),
  });
  const payload = await response.json();

  if (!response.ok) {
    userMessage.textContent = payload.error || "Gagal menambah user.";
    return;
  }

  userForm.reset();
  renderUsers(payload.users || []);
  userMessage.textContent = "User ditambahkan.";
});

manualGroupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  manualGroupMessage.textContent = "";

  const response = await fetch("/api/groups/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: manualGroupName.value,
      id: manualGroupId.value,
    }),
  });
  const payload = await response.json();

  if (!response.ok) {
    manualGroupMessage.textContent = payload.error || "Gagal menambah group.";
    return;
  }

  manualGroupForm.reset();
  renderManualGroups(payload.groups || []);
  await refreshState();
  manualGroupMessage.textContent = "Group manual ditambahkan.";
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: tokenInput.value }),
  });

  const payload = await response.json();
  if (response.ok) {
    setTokenNote("Token tersimpan ke database.");
  } else {
    setTokenNote(payload.error || "Gagal menyimpan token.", true);
  }
  if (response.ok) {
    tokenInput.value = "";
  }
});

resetToken.addEventListener("click", async () => {
  const response = await fetch("/api/settings/token", { method: "DELETE" });
  const payload = await response.json();

  if (!response.ok) {
    setTokenNote(payload.error || "Gagal reset token.", true);
    return;
  }

  tokenInput.value = "";
  Object.assign(state.status, payload.status);
  updateStatus();
  setTokenNote("Token Fonnte sudah direset.");
});

fetchGroups.addEventListener("click", async () => {
  fetchGroups.disabled = true;
  const response = await fetch("/api/groups/fetch", { method: "POST" });
  const payload = await response.json();
  setTokenNote(response.ok ? payload.detail || "Update group selesai." : payload.error || "Gagal update group.", !response.ok);
  fetchGroups.disabled = false;
});

refreshGroups.addEventListener("click", async () => {
  refreshGroups.disabled = true;
  const response = await fetch("/api/groups/refresh", { method: "POST" });
  const payload = await response.json();
  targetMessage.textContent = response.ok ? "Daftar group diperbarui." : payload.error || "Gagal refresh group.";
  refreshGroups.disabled = false;
});

clearReminders.addEventListener("click", async () => {
  formMessage.textContent = "";

  if (state.reminders.length === 0) {
    formMessage.textContent = "Tidak ada reminder untuk dihapus.";
    return;
  }

  await fetch("/api/reminders", { method: "DELETE" });
  formMessage.textContent = "Semua reminder dibatalkan.";
});

testSend.addEventListener("click", async () => {
  formMessage.textContent = "";

  try {
    const items = collectReminderItems();
    for (const item of items) {
      if (!item.target) {
        throw new Error("Pilih target WhatsApp di setiap paket.");
      }
      const attachments = await uploadFiles(item.files);
      const response = await fetch("/api/reminders/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: item.target,
          messages: item.message ? [item.message] : [],
          attachments,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Gagal tes kirim.");
      }
    }
    formMessage.textContent = "Semua paket tes kirim masuk antrean Fonnte.";
  } catch (error) {
    formMessage.textContent = error.message;
  }
});

reminderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formMessage.textContent = "";

  try {
    const items = collectReminderItems();
    for (const item of items) {
      if (!item.target) {
        throw new Error("Pilih target WhatsApp di setiap paket.");
      }
      const attachments = await uploadFiles(item.files);
      const response = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: item.target,
          targetName: item.targetName,
          messages: item.message ? [item.message] : [],
          attachments,
          times: item.times,
          days: item.days,
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Gagal menyimpan reminder.");
      }
    }

    resetReminderForm("Semua paket reminder tersimpan.");
  } catch (error) {
    formMessage.textContent = error.message;
  }
});

socket.on("state", (nextState) => {
  if (!authState.authenticated) {
    return;
  }
  Object.assign(state, nextState);
  renderAll();
});

resetReminderForm("");
refreshAuth();
