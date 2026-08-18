import { CONFIG, SENATORS, TIME_SLOTS } from "../config.js";
import { db } from "../firebase-init.js";
import { requireAdmin, logout, isEnabledAdmin } from "./auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

const REGISTRATIONS_COLLECTION = "registrations";
const CHECKINS_COLLECTION = "checkins";
const CHECKIN_ACTIVITY_COLLECTION = "checkinActivity";
const SLOT_COUNTS_COLLECTION = "slotCounts";
const ADMINS_COLLECTION = "admins";
const OUTCOMES = { single: "Single Donation", double: "Double Donation", deferred: "Deferred", other: "Did Not Donate / Other" };
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DRIVE_DATE = new Date(`${CONFIG.bloodDriveDate}T00:00:00`);
const DRIVE_TIME_ZONE = CONFIG.timeZone || "America/New_York";
const DRIVE_TIME_ZONE_LABEL = "EST";
let activeStatsTab = "registration";
const REGISTRATION_START = new Date("2026-08-15T00:00:00");
const $ = (id) => document.getElementById(id);

let registrations = [];
let adminDirectory = new Map();
let slotCapacities = new Map();
let tableState = { sortKey: "createdAt", sortDirection: "desc", page: 1, pageSize: 25 };

requireAdmin({
  allowCheckin: (location.pathname.includes("checkin") || location.pathname.includes("checkin-activity")),
  adminOnly: !(location.pathname.includes("checkin") || location.pathname.includes("checkin-activity")),
  onReady: (user, profile) => {
    initShell(user, profile);

    if (location.pathname.includes("checkin/activity") || location.pathname.includes("checkin-activity")) {
      initActivityPage(user, profile);
      return;
    }

    if ((location.pathname.includes("checkin") || location.pathname.includes("checkin-activity"))) {
      initCheckinPage(user, profile);
      return;
    }

    if (location.pathname.includes("registrations")) {
      initRegistrationsPage();
      return;
    }

    if (location.pathname.includes("statistics")) {
      initStatisticsPage();
      return;
    }

    if (location.pathname.includes("settings")) {
      initSettingsPage();
    }
  },
  onDenied: (message) => showError(message),
});

async function initSettingsPage() {
  await loadSlotCapacities();
  const ref = doc(db, "driveSettings", CONFIG.bloodDriveId);
  try {
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    setInputValue("setting-event-name", data.eventName || CONFIG.eventName);
    setInputValue("setting-date", data.bloodDriveDate || CONFIG.bloodDriveDate);
    setInputValue("setting-location", data.location || CONFIG.location);
    setInputValue("setting-term", data.term || inferTerm(data.eventName || CONFIG.eventName));
    setInputValue("setting-timezone", DRIVE_TIME_ZONE_LABEL);
    setInputValue("setting-start-time", hhmmToInputTime(data.slotsStart || CONFIG.slotsStart));
    setInputValue("setting-end-time", hhmmToInputTime(data.slotsEnd || CONFIG.slotsEnd));
    setInputValue("setting-slot-interval", data.slotInterval || 15);
  } catch {
    setInputValue("setting-event-name", CONFIG.eventName);
    setInputValue("setting-date", CONFIG.bloodDriveDate);
    setInputValue("setting-location", CONFIG.location);
    setInputValue("setting-term", inferTerm(CONFIG.eventName));
    setInputValue("setting-timezone", DRIVE_TIME_ZONE_LABEL);
    setInputValue("setting-start-time", hhmmToInputTime(CONFIG.slotsStart));
    setInputValue("setting-end-time", hhmmToInputTime(CONFIG.slotsEnd));
    setInputValue("setting-slot-interval", 15);
  }
  renderSlotCapacityEditor();
  ["setting-start-time", "setting-end-time", "setting-slot-interval"].forEach((id) => $(id)?.addEventListener("input", renderSlotCapacityEditor));
  $("save-drive-settings")?.addEventListener("click", async () => {
    await setDoc(ref, { term: $("setting-term")?.value || inferTerm(CONFIG.eventName), eventName: $("setting-event-name")?.value || CONFIG.eventName, bloodDriveDate: $("setting-date")?.value || CONFIG.bloodDriveDate, location: $("setting-location")?.value || CONFIG.location, slotsStart: inputTimeToHHMM($("setting-start-time")?.value) || CONFIG.slotsStart, slotsEnd: inputTimeToHHMM($("setting-end-time")?.value) || CONFIG.slotsEnd, slotInterval: Number($("setting-slot-interval")?.value) || 15, timeZone: "America/New_York", timeZoneLabel: DRIVE_TIME_ZONE_LABEL, updatedAt: serverTimestamp() }, { merge: true });
    setText("settings-message", "Settings saved. Timezone remains hardcoded to EST.");
  });
}
function setInputValue(id, value) { const el = $(id); if (el) el.value = value || ""; }
function inferTerm(name) { return String(name || "").toLowerCase().includes("spring") ? "spring" : "fall"; }
function hhmmToInputTime(hhmm) { return `${String(hhmm || "").slice(0, 2)}:${String(hhmm || "").slice(2, 4)}`; }
function inputTimeToHHMM(value) { return value ? value.replace(":", "") : ""; }
function settingsSlots() {
  const start = inputTimeToHHMM($("setting-start-time")?.value) || CONFIG.slotsStart;
  const end = inputTimeToHHMM($("setting-end-time")?.value) || CONFIG.slotsEnd;
  const interval = Math.max(5, Number($("setting-slot-interval")?.value) || 15);
  const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2));
  const slots = [];
  for (let m = toMinutes(start); m <= toMinutes(end); m += interval) {
    const hour24 = Math.floor(m / 60), minute = m % 60, id = `${String(hour24).padStart(2, "0")}${String(minute).padStart(2, "0")}`;
    const period = hour24 >= 12 ? "PM" : "AM", hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    slots.push({ id, label: `${hour12}:${String(minute).padStart(2, "0")} ${period}`, capacity: CONFIG.slotCapacity });
  }
  return slots;
}

function initShell(user, profile) {
  renderNavigation(profile);
  setText("admin-email", profile.email || user.email || "Admin");
  setText("drive-meta", `${CONFIG.eventName} • ${formatDriveDate(CONFIG.bloodDriveDate)} • ${CONFIG.location}`);
  $("logout")?.addEventListener("click", logout);
}


function renderNavigation(profile) {
  document.querySelectorAll(".nav").forEach((nav) => {
    nav.textContent = "";
    const adminLinks = [["Dashboard", "/admin/"], ["Registrations", "/admin/registrations.html"], ["Check-In", "/admin/checkin/"], ["Statistics", "/admin/statistics.html"], ["Settings", "/admin/settings.html"]];
    const checkinLinks = [["Check-In", "/admin/checkin/"], ["Recent Activity", "/admin/checkin/activity/"]];
    const links = isEnabledAdmin(profile) ? adminLinks : checkinLinks;
    let current = location.pathname.split("/").pop() || "index.html";
    if (location.pathname.includes("checkin/activity")) current = "checkin-activity.html";
    if (location.pathname.endsWith("/admin/checkin/") || location.pathname.endsWith("/admin/checkin")) current = "checkin.html";
    links.forEach(([label, href]) => {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = label;
      if (href.endsWith(current) || (href === "/admin/" && current === "index.html") || (href === "/admin/checkin/activity/" && current === "checkin-activity.html") || (href === "/admin/checkin/" && current === "checkin.html")) a.className = "active";
      nav.appendChild(a);
    });
  });
}

async function initRegistrationsPage() {
  fillFilters();
  bindFilters();
  bindRegistrationActions();
  renderTable([]);
  setText("counts", "Loading registrations…");

  await Promise.all([loadAdminDirectory(), loadSlotCapacities()]);
  registrations = await loadRegistrations();
  renderRegistrations();
}

async function initStatisticsPage() {
  const stats = $("stats");
  if (stats) stats.innerHTML = '<section class="panel"><p>Loading statistics…</p></section>';

  registrations = await loadRegistrations();
  bindStatsTabs();
  renderStats(registrations);
  $("generate-report")?.addEventListener("click", () => openBloodDriveReport(registrations));
}

async function loadAdminDirectory() {
  try {
    const snap = await getDocs(collection(db, ADMINS_COLLECTION));
    adminDirectory = new Map(snap.docs.map((d) => {
      const data = d.data();
      const name = [data.firstName, data.lastName].filter(Boolean).join(" ").trim() || data.name || data.displayName || data.email || d.id;
      return [d.id, name];
    }));
  } catch (error) {
    console.info("[Admin Dashboard] admin directory read failed", { code: error?.code || "unknown" });
    adminDirectory = new Map();
  }
}

async function loadSlotCapacities() {
  const snap = await getDocs(collection(db, SLOT_COUNTS_COLLECTION));
  slotCapacities = new Map(snap.docs.map((d) => [d.data().slotId || d.id.split("_").pop(), serialize({ id: d.id, ...d.data() })]));
}

async function loadRegistrations() {
  try {
    const registrationsQuery = query(collection(db, REGISTRATIONS_COLLECTION), orderBy("createdAt", "desc"));
    const snapshot = await getDocs(registrationsQuery);
    console.info("[Admin Dashboard] all registrations read:", snapshot.size);
    const records = snapshot.docs.map((registration) => serialize({ id: registration.id, ...registration.data() }));
    const checkins = await loadCheckinsMap();
    return records.map((record) => ({ ...record, checkin: checkins.get(record.id) || { status: "registered" } }));
  } catch (error) {
    console.error("[Admin Dashboard] all registrations read failed:", error);
    showError("Could not load registrations.");
    return [];
  }
}

function serialize(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serialize(entry)]));
  }
  return value;
}

function fillFilters() {
  TIME_SLOTS.forEach((slot) => $("filter-slot")?.append(new Option(slot.label, slot.id)));
  SENATORS.forEach((senator) => $("filter-senator")?.append(new Option(senator.name, senator.id)));
  PAGE_SIZE_OPTIONS.forEach((size) => $("page-size")?.append(new Option(`${size} per page`, String(size), size === 25, size === 25)));
  fillSelect("filter-age", [["16", "Exactly 16"], ["17plus", "17+"], ["unknown", "Unknown age"]]);
  fillSelect("filter-nhs", [["yes", "In NHS"], ["no", "Not in NHS"]]);
}

function fillSelect(id, options) {
  const select = $(id);
  if (!select) return;
  options.forEach(([value, label]) => select.append(new Option(label, value)));
}


function bindFilters() {
  ["search", "filter-slot", "filter-senator", "filter-age", "filter-nhs"].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      tableState.page = 1;
      renderRegistrations();
    });
  });
  $("page-size")?.addEventListener("input", () => {
    tableState.pageSize = Number($("page-size").value) || 25;
    tableState.page = 1;
    renderRegistrations();
  });
  $("clear-filters")?.addEventListener("click", () => {
    ["search", "filter-slot", "filter-senator", "filter-age", "filter-nhs"].forEach((id) => { if ($(id)) $(id).value = ""; });
    tableState = { sortKey: "createdAt", sortDirection: "desc", page: 1, pageSize: Number($("page-size")?.value) || 25 };
    renderRegistrations();
  });
  document.querySelectorAll("[data-sort]").forEach((header) => {
    header.addEventListener("click", () => setSort(header.dataset.sort));
  });
  $("prev-page")?.addEventListener("click", () => { tableState.page -= 1; renderRegistrations(); });
  $("next-page")?.addEventListener("click", () => { tableState.page += 1; renderRegistrations(); });
  $("refresh")?.addEventListener("click", async () => {
    setText("counts", "Refreshing registrations…");
    registrations = await loadRegistrations();
    await loadSlotCapacities();
    renderRegistrations();
  });
}

function bindRegistrationActions() {
  $("export-all-csv")?.addEventListener("click", () => showExportModal(filteredRecords(), "all-registrations", "csv"));
  $("export-all-pdf")?.addEventListener("click", () => showExportModal(filteredRecords(), "all-registrations", "pdf"));
}

function renderSlotCapacityEditor() {
  const root = $("slot-capacity-grid");
  if (!root) return;
  root.textContent = "";
  const slots = settingsSlots();
  setText("slot-preview-count", `${slots.length} slots`);
  slots.forEach((slot) => {
    const data = slotCapacities.get(slot.id) || { capacity: slot.capacity, count: 0 };
    const wrap = document.createElement("div");
    wrap.className = "slot-capacity-item";
    const label = document.createElement("label");
    label.textContent = `${slot.label} (${data.count || 0} registered)`;
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(data.count || 0);
    input.value = String(data.capacity ?? slot.capacity);
    const button = smallButton("Save", async () => {
      const capacity = Math.max(Number(input.value) || 0, Number(data.count) || 0);
      await setDoc(doc(db, SLOT_COUNTS_COLLECTION, slotDocId(slot.id)), { bloodDriveId: CONFIG.bloodDriveId, slotId: slot.id, label: slot.label, capacity, count: Number(data.count) || 0 }, { merge: true });
      await loadSlotCapacities();
      renderSlotCapacityEditor();
    });
    wrap.append(label, input, button);
    root.appendChild(wrap);
  });
}

function slotDocId(slotId) { return `${CONFIG.bloodDriveId}_${slotId}`; }

function setSort(sortKey) {
  if (tableState.sortKey === sortKey) {
    tableState.sortDirection = tableState.sortDirection === "asc" ? "desc" : "asc";
  } else {
    tableState.sortKey = sortKey;
    tableState.sortDirection = "asc";
  }
  tableState.page = 1;
  renderRegistrations();
}

function renderRegistrations() {
  const filtered = filteredRecords();
  const sorted = [...filtered].sort(compareRecords);
  const pageCount = Math.max(1, Math.ceil(sorted.length / tableState.pageSize));
  tableState.page = Math.min(Math.max(1, tableState.page), pageCount);
  const start = (tableState.page - 1) * tableState.pageSize;

  renderTable(sorted.slice(start, start + tableState.pageSize));
  renderSortIndicators();
  setText("counts", `${filtered.length} matching registrations · ${registrations.length} total overall`);
  setText("page-info", `Page ${tableState.page} of ${pageCount}`);
  setDisabled("prev-page", tableState.page <= 1);
  setDisabled("next-page", tableState.page >= pageCount);
}

function filteredRecords() {
  const search = ($("search")?.value || "").trim().toLowerCase();
  const slot = $("filter-slot")?.value || "";
  const senator = $("filter-senator")?.value || "";
  const age = $("filter-age")?.value || "";
  const nhs = $("filter-nhs")?.value || "";
  return registrations.filter((record) => {
    const searchable = [record.studentId, record.firstName, record.lastName, record.studentEmail, record.parentEmail, record.id].join(" ").toLowerCase();
    if (search && !searchable.includes(search)) return false;
    if (slot && record.appointmentSlotId !== slot) return false;
    if (senator && !(record.senatorIds || []).includes(senator)) return false;
    if (age === "16" && Number(record.ageOnDriveDate) !== 16) return false;
    if (age === "17plus" && Number(record.ageOnDriveDate) < 17) return false;
    if (age === "unknown" && Number.isFinite(Number(record.ageOnDriveDate))) return false;
    if (nhs === "yes" && !record.nhsSeniorMember) return false;
    if (nhs === "no" && record.nhsSeniorMember) return false;
    return true;
  });
}

function compareRecords(a, b) {
  const direction = tableState.sortDirection === "asc" ? 1 : -1;
  const sorters = {
    createdAt: (record) => toDate(record.createdAt)?.getTime() || 0,
    appointmentSlotId: (record) => record.appointmentSlotId || "",
    firstName: (record) => (record.firstName || "").toLowerCase(),
    lastName: (record) => (record.lastName || "").toLowerCase(),
    ageOnDriveDate: (record) => Number(record.ageOnDriveDate) || 0,
  };
  const getValue = sorters[tableState.sortKey] || sorters.createdAt;
  return String(getValue(a)).localeCompare(String(getValue(b)), undefined, { numeric: true }) * direction;
}

function renderSortIndicators() {
  document.querySelectorAll("[data-sort]").forEach((header) => {
    const active = header.dataset.sort === tableState.sortKey;
    header.textContent = `${header.dataset.label}${active ? (tableState.sortDirection === "asc" ? " ↑" : " ↓") : ""}`;
  });
}

function renderTable(records) {
  const rows = $("rows");
  if (!rows) return;
  rows.textContent = "";
  if (!records.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 18;
    cell.textContent = "No registrations to display.";
    row.appendChild(cell);
    rows.appendChild(row);
    return;
  }
  records.forEach((record) => {
    const row = document.createElement("tr");
    [record.id, formatTimestamp(record.createdAt), record.firstName, record.lastName, record.parentEmail, record.studentEmail, record.phone, formatDate(record.dob), record.studentId, yesNo(record.nhsSeniorMember), (record.senatorIds || []).map(senatorName).join(", "), slotLabel(record.appointmentSlotId), record.ageOnDriveDate, operationalLabel(record.checkin?.status), formatTimestamp(record.checkin?.checkedInAt), formatTimestamp(record.checkin?.checkedOutAt), outcomeLabel(record.checkin?.outcome)]
      .forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value ?? "";
        row.appendChild(cell);
      });
    const actions = document.createElement("td");
    actions.className = "table-actions";
    actions.append(smallButton("Export", () => showExportModal([record], `${record.firstName || "student"}-${record.lastName || "registration"}`)), smallButton("Delete", () => showDeleteModal(record), "danger-lite"));
    row.appendChild(actions);
    row.addEventListener("click", () => showDetail(record));
    actions.addEventListener("click", (event) => event.stopPropagation());
    rows.appendChild(row);
  });
}

function smallButton(label, handler, className = "secondary") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `small-button ${className}`;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function showExportModal(records, filenameBase, preferredFormat = "") {
  const root = $("modal-root");
  if (!root) return;
  root.textContent = "";
  const modal = modalShell(`Export ${records.length} registration${records.length === 1 ? "" : "s"}`);
  const body = document.createElement("div");
  body.className = "modal-actions-stack";
  const csv = smallButton("Download CSV", () => downloadCsv(records, filenameBase));
  const pdf = smallButton("Open printable PDF view", () => openPrintableExport(records));
  body.append(csv, pdf);
  modal.card.appendChild(body);
  root.appendChild(modal.overlay);
  if (preferredFormat === "csv") downloadCsv(records, filenameBase);
  if (preferredFormat === "pdf") openPrintableExport(records);
}

function showDeleteModal(record) {
  const root = $("modal-root");
  if (!root) return;
  root.textContent = "";
  const modal = modalShell(`Delete ${record.firstName || "this"} ${record.lastName || "registration"}?`);
  const reason = document.createElement("select");
  [["", "Select a required reason"], ["student_declined", "Student does not want to donate"], ["testing", "Just for testing"], ["other", "Other"]].forEach(([v,l]) => reason.append(new Option(l,v)));
  const other = document.createElement("textarea");
  other.placeholder = "Required when Other is selected";
  other.className = "hidden";
  const error = document.createElement("p");
  error.className = "error";
  const confirm = smallButton("Delete from Firebase", async () => {
    if (!reason.value || (reason.value === "other" && !other.value.trim())) { error.textContent = "Choose a reason. If you select Other, add a written explanation."; return; }
    await setDoc(doc(collection(db, "registrationDeletionLogs")), { registrationId: record.id, reason: reason.value, otherReason: other.value.trim(), deletedAt: serverTimestamp() });
    await deleteDoc(doc(db, REGISTRATIONS_COLLECTION, record.id));
    await deleteDoc(doc(db, CHECKINS_COLLECTION, record.id)).catch(() => {});
    registrations = registrations.filter((r) => r.id !== record.id);
    root.textContent = "";
    renderRegistrations();
  }, "danger");
  reason.addEventListener("input", () => other.classList.toggle("hidden", reason.value !== "other"));
  modal.card.append(detailSection("Required deletion reason", [["Student", `${record.firstName || ""} ${record.lastName || ""}`.trim()], ["Confirmation ID", record.id]]), reason, other, error, confirm);
  root.appendChild(modal.overlay);
}

function modalShell(titleText) {
  const overlay = document.createElement("div"); overlay.className = "modal";
  const card = document.createElement("div"); card.className = "modal-card";
  const header = document.createElement("div"); header.className = "summary-line";
  const title = document.createElement("h2"); title.textContent = titleText;
  const close = smallButton("Close", () => { const root = $("modal-root"); if (root) root.textContent = ""; });
  header.append(title, close); card.appendChild(header); overlay.appendChild(card);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) overlay.remove(); });
  return { overlay, card };
}

function exportRows(records) {
  return records.map((r) => ({ confirmationId: r.id, submitted: formatTimestamp(r.createdAt), firstName: r.firstName, lastName: r.lastName, parentEmail: r.parentEmail, studentEmail: r.studentEmail, phone: r.phone, dob: r.dob, studentId: r.studentId, nhsSeniorMember: yesNo(r.nhsSeniorMember), senators: (r.senatorIds || []).map(senatorName).join("; "), appointment: slotLabel(r.appointmentSlotId), status: operationalLabel(r.checkin?.status), checkedInAt: formatTimestamp(r.checkin?.checkedInAt), checkedInBy: adminName(r.checkin?.checkedInBy, r.checkin?.checkedInByName), checkedOutAt: formatTimestamp(r.checkin?.checkedOutAt), checkedOutBy: adminName(r.checkin?.checkedOutBy, r.checkin?.checkedOutByName), outcome: outcomeLabel(r.checkin?.outcome) }));
}
function downloadCsv(records, filenameBase) { const rows = exportRows(records); const headers = Object.keys(rows[0] || { confirmationId: "" }); const csv = [headers.join(","), ...rows.map((row) => headers.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `${filenameBase}.csv`; a.click(); URL.revokeObjectURL(a.href); }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
}
function openPrintableExport(records) {
  const win = window.open("", "_blank");
  if (!win) return;
  const rows = exportRows(records);
  const style = `<style>body{font-family:Inter,Arial,sans-serif;margin:24px;color:#131a24}h1{margin:0 0 6px}.muted{color:#61707f}.card{border:1px solid #dde3ec;border-radius:18px;padding:18px;margin:14px 0;background:#f8fafc}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.item{background:#fff;border:1px solid #e5eaf1;border-radius:12px;padding:10px}.label{font-size:10px;text-transform:uppercase;color:#61707f;font-weight:700}.value{font-weight:650;word-break:break-word}table{border-collapse:collapse;width:100%;font-size:9px;table-layout:fixed}td,th{border:1px solid #ccd5e1;padding:4px;word-break:break-word;vertical-align:top}th{background:#eef2f7;font-size:8px;text-transform:uppercase}@media print{@page{size:landscape;margin:.35in}body{margin:0}.card{break-inside:avoid}}</style>`;
  const body = records.length === 1 ? `<section class="card"><h1>Registration Card</h1><p class="muted">${escapeHtml(CONFIG.eventName)} · ${escapeHtml(formatDriveDate(CONFIG.bloodDriveDate))}</p><div class="grid">${Object.entries(rows[0] || {}).map(([k,v]) => `<div class="item"><div class="label">${escapeHtml(k)}</div><div class="value">${escapeHtml(v)}</div></div>`).join("")}</div></section>` : `<h1>Registration Export</h1><p class="muted">${records.length} registrations · ${escapeHtml(CONFIG.eventName)}</p><table><thead><tr>${Object.keys(rows[0] || {}).map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${Object.values(row).map((v) => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  win.document.write(`<title>Registration Export</title>${style}${body}`);
  win.document.close();
  win.print();
}


function showDetail(record) {
  const root = $("modal-root");
  if (!root) return;
  root.textContent = "";
  const modal = document.createElement("div");
  modal.className = "modal";
  const card = document.createElement("div");
  card.className = "modal-card";
  const header = document.createElement("div");
  header.className = "summary-line";
  const title = document.createElement("h2");
  title.textContent = `${record.firstName || ""} ${record.lastName || ""}`.trim() || "Registration detail";
  const close = document.createElement("button");
  close.className = "secondary";
  close.type = "button";
  close.textContent = "Close";
  header.append(title, close);
  card.append(header, detailSection("Registration", [["Confirmation ID", record.id], ["Date submitted", formatTimestamp(record.createdAt)], ["Appointment", slotLabel(record.appointmentSlotId)], ["Blood drive date", formatDriveDate(record.bloodDriveDate || CONFIG.bloodDriveDate)], ["Location", record.location || CONFIG.location]]), detailSection("Student", [["First name", record.firstName], ["Last name", record.lastName], ["Student email", record.studentEmail], ["Parent email", record.parentEmail], ["Phone", record.phone], ["Birthdate", formatDate(record.dob)], ["Age on drive date", record.ageOnDriveDate], ["Student ID", record.studentId], ["In NHS?", yesNo(record.nhsSeniorMember)], ["Senator(s) assisted", (record.senatorIds || []).map(senatorName).join(", ")]]), detailSection("Eligibility", [["Parent consent status", statusLabel(record.parentConsentStatus)], ["Age confirmed", yesNo(record.eligibilityAgeConfirmed)], ["No fall sport confirmed", yesNo(record.eligibilityNoFallSportConfirmed)], ["Schema version", record.schemaVersion]]), detailSection("Check-in operations", [["Operational status", operationalLabel(record.checkin?.status)], ["Checked in", formatTimestamp(record.checkin?.checkedInAt)], ["Checked in by", adminName(record.checkin?.checkedInBy, record.checkin?.checkedInByName)], ["Checked out", formatTimestamp(record.checkin?.checkedOutAt)], ["Checked out by", adminName(record.checkin?.checkedOutBy, record.checkin?.checkedOutByName)], ["Outcome", outcomeLabel(record.checkin?.outcome)]]));
  modal.appendChild(card);
  root.appendChild(modal);
  close.addEventListener("click", () => { root.textContent = ""; });
  modal.addEventListener("click", (event) => { if (event.target === modal) root.textContent = ""; });
}

function detailSection(title, items) {
  const section = document.createElement("section");
  section.className = "detail-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const grid = document.createElement("div");
  grid.className = "detail-grid";
  items.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "detail-item";
    item.innerHTML = `<div class="detail-label"></div><div class="detail-value"></div>`;
    item.querySelector(".detail-label").textContent = label;
    item.querySelector(".detail-value").textContent = value ?? "Not provided";
    grid.appendChild(item);
  });
  section.append(heading, grid);
  return section;
}

async function loadCheckinsMap() {
  const snap = await getDocs(collection(db, CHECKINS_COLLECTION));
  return new Map(snap.docs.map((d) => [d.id, serialize({ id: d.id, ...d.data() })]));
}

async function initCheckinPage(user, profile) {
  const actorName = adminDisplayName(profile, user);
  const search = $("checkin-search");
  const results = $("checkin-results");
  const summary = $("checkin-summary");
  const expected = $("expected-soon");
  let regs = [];
  let checkins = new Map();
  try {
    await loadAdminDirectory();
    const snap = await getDocs(query(collection(db, REGISTRATIONS_COLLECTION), orderBy("createdAt", "desc")));
    regs = snap.docs.map((d) => serialize({ id: d.id, ...d.data() }));
    setText("checkin-status", "Start typing to find a student.");
  } catch {
    showError("Could not load registrations for check-in.");
  }
  onSnapshot(collection(db, CHECKINS_COLLECTION), (snap) => {
    checkins = new Map(snap.docs.map((d) => [d.id, serialize({ id: d.id, ...d.data() })]));
    markLateRegistrations(regs, checkins, user.uid, actorName);
    renderOperationsDashboard(summary, regs, checkins, user);
    renderExpectedSoon(expected, regs, checkins, user);
    renderCheckinResults(search?.value || "", regs, checkins, results, user);
  }, () => showError("Could not subscribe to check-in updates."));
  search?.addEventListener("input", () => renderCheckinResults(search.value, regs, checkins, results, user));
  setInterval(() => { markLateRegistrations(regs, checkins, user.uid, actorName); renderOperationsDashboard(summary, regs, checkins, user); renderExpectedSoon(expected, regs, checkins, user); }, 30000);
}


function renderExpectedSoon(root, regs, checkins, user) {
  if (!root) return;
  const nowSlot = currentSlotId(new Date());
  const next = nextSlotId(new Date());
  const relevant = new Set([nowSlot, next].filter(Boolean));
  const expected = regs.filter((r) => relevant.has(r.appointmentSlotId) && !["checked_in", "completed"].includes(checkins.get(r.id)?.status)).sort((a,b) => String(a.appointmentSlotId).localeCompare(String(b.appointmentSlotId)));
  root.textContent = "";
  if (!expected.length) { const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "No students are expected in the current or next appointment window."; root.appendChild(empty); return; }
  expected.forEach((r) => root.appendChild(checkinCard({ ...r, checkin: checkins.get(r.id) || { status: "registered" } }, user)));
}

function currentSlotId(now) {
  const parts = timeParts(now);
  const minutes = parts.hour * 60 + parts.minute;
  const rounded = minutes - (minutes % 15);
  const id = `${String(Math.floor(rounded / 60)).padStart(2, "0")}${String(rounded % 60).padStart(2, "0")}`;
  return TIME_SLOTS.some((slot) => slot.id === id) ? id : null;
}
function nextSlotId(now) {
  const parts = timeParts(now);
  const minutes = parts.hour * 60 + parts.minute;
  return TIME_SLOTS.find((slot) => slotMinutes(slot.id) > minutes)?.id || null;
}
function timeParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: DRIVE_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  return { hour: Number(parts.find((p) => p.type === "hour")?.value || 0), minute: Number(parts.find((p) => p.type === "minute")?.value || 0) };
}

async function markLateRegistrations(regs, checkins, uid, actorName) {
  const now = new Date();
  const late = regs.filter((r) => !checkins.has(r.id) && slotEndTime(r.appointmentSlotId) < (timeParts(now).hour * 60 + timeParts(now).minute) * 60 * 1000).slice(0, 20);
  await Promise.all(late.map((r) => setDoc(doc(db, CHECKINS_COLLECTION, r.id), { registrationId: r.id, status: "late", lateAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: uid, updatedByName: actorName }, { merge: true })
    .then(() => setDoc(doc(collection(db, CHECKIN_ACTIVITY_COLLECTION)), { registrationId: r.id, action: "late", actorUid: uid, actorName, occurredAt: serverTimestamp() }))
    .catch(() => {})));
}

function slotEndTime(slotId) {
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: DRIVE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  if (today < CONFIG.bloodDriveDate) return Infinity;
  if (today > CONFIG.bloodDriveDate) return 0;
  return (slotMinutes(slotId) + 15) * 60 * 1000;
}
function slotMinutes(slotId) { return Number(String(slotId).slice(0, 2)) * 60 + Number(String(slotId).slice(2)); }

function renderCheckinResults(term, regs, checkins, root, user) {
  if (!root) return;
  const q = normalizeSearch(term);
  root.textContent = "";
  if (q.length < 2) return;
  const matches = regs.filter((r) => normalizeSearch([r.studentId, r.firstName, r.lastName, `${r.firstName || ""} ${r.lastName || ""}`, r.studentEmail, r.parentEmail, r.phone, r.id].join(" ")).includes(q)).slice(0, 25);
  setText("checkin-status", `${matches.length} matching result${matches.length === 1 ? "" : "s"}`);
  matches.forEach((r) => root.appendChild(checkinCard({ ...r, checkin: checkins.get(r.id) || { status: "registered" } }, user)));
}

function checkinCard(record, user) {
  const card = document.createElement("article");
  card.className = "checkin-card";
  const status = record.checkin?.status || "registered";
  card.innerHTML = `<div><h2></h2><p></p><p></p></div><div class="checkin-actions"></div>`;
  card.querySelector("h2").textContent = `${record.firstName || ""} ${record.lastName || ""}`.trim() || "Unnamed student";
  card.querySelectorAll("p")[0].textContent = `Student ID: ${record.studentId || "Not provided"} · Appointment: ${slotLabel(record.appointmentSlotId) || "Not selected"}`;
  card.querySelectorAll("p")[1].textContent = `${operationalLabel(status)}${record.checkin?.checkedInAt ? ` · Checked in ${timeOnly(record.checkin.checkedInAt)}` : ""}${isLateArrival(record) ? " · Status: Late" : ""}`;
  const actions = card.querySelector(".checkin-actions");
  if (status === "registered" || status === "late") actions.append(actionButton(status === "late" ? "CHECK IN LATE" : "CHECK IN", () => transitionCheckin(record.id, "checkin", user.uid, adminDisplayName(null, user))));
  else if (status === "checked_in") actions.append(actionButton("CHECK OUT", () => showCheckout(record, actions, user.uid, adminDisplayName(null, user))));
  else actions.append(Object.assign(document.createElement("strong"), { textContent: `Completed${record.checkin?.outcome ? ` · ${outcomeLabel(record.checkin.outcome)}` : ""}` }));
  return card;
}

function actionButton(label, handler) { const b = document.createElement("button"); b.className = "primary big-action"; b.type = "button"; b.textContent = label; b.addEventListener("click", handler); return b; }
function showCheckout(record, root, uid, actorName) { root.textContent = ""; const sel = document.createElement("select"); Object.entries(OUTCOMES).forEach(([v,l]) => sel.append(new Option(l,v))); const b = actionButton("COMPLETE CHECK-OUT", () => transitionCheckin(record.id, "checkout", uid, actorName, sel.value)); root.append(sel,b); }

async function transitionCheckin(id, action, uid, actorName, outcome) {
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, CHECKINS_COLLECTION, id);
      const snap = await tx.get(ref);
      const current = snap.exists() ? snap.data().status : "registered";
      if (action === "checkin" && !["registered", "late"].includes(current)) throw new Error("already-updated");
      if (action === "checkout" && current !== "checked_in") throw new Error("already-updated");
      const base = { registrationId: id, updatedAt: serverTimestamp(), updatedBy: uid, updatedByName: actorName };
      const activityRef = doc(collection(db, CHECKIN_ACTIVITY_COLLECTION));
      if (action === "checkin") {
        tx.set(ref, { ...base, status: "checked_in", checkedInAt: serverTimestamp(), checkedInBy: uid, checkedInByName: actorName }, { merge: true });
        tx.set(activityRef, { registrationId: id, action: "checkin", actorUid: uid, actorName, occurredAt: serverTimestamp() });
      } else {
        tx.set(ref, { ...base, status: "completed", checkedOutAt: serverTimestamp(), checkedOutBy: uid, checkedOutByName: actorName, outcome }, { merge: true });
        tx.set(activityRef, { registrationId: id, action: "checkout", actorUid: uid, actorName, outcome, occurredAt: serverTimestamp() });
      }
    });
    setText("checkin-message", action === "checkin" ? "Student checked in." : "Check-out completed.");
  } catch { setText("checkin-message", "Another staff member already updated this registration. The live status has refreshed."); }
}

function mergedRecords(regs, checkins) { return regs.map((r) => ({ ...r, checkin: checkins.get(r.id) || { status: "registered" } })); }
function computeOpsStats(regs, checkins) {
  const records = mergedRecords(regs, checkins);
  const counts = { expected: records.length, checkedIn: 0, checkedOut: 0, notArrived: 0, donated: 0, deferred: 0, other: 0, single: 0, double: 0, totalUnits: 0 };
  for (const r of records) {
    const status = r.checkin?.status;
    const outcome = r.checkin?.outcome;
    if (status === "checked_in") counts.checkedIn += 1;
    if (status === "completed") counts.checkedOut += 1;
    if (status === "completed" && outcome === "single") { counts.single += 1; counts.donated += 1; counts.totalUnits += 1; }
    if (status === "completed" && outcome === "double") { counts.double += 1; counts.donated += 1; counts.totalUnits += 2; }
    if (status === "completed" && outcome === "deferred") counts.deferred += 1;
    if (status === "completed" && outcome === "other") counts.other += 1;
  }
  counts.notArrived = Math.max(0, counts.expected - counts.checkedIn - counts.checkedOut);
  counts.rates = { checkin: percent(counts.checkedIn, counts.expected), checkout: percent(counts.checkedOut, counts.expected), notArrived: percent(counts.notArrived, counts.expected), donation: percent(counts.donated, counts.checkedOut), deferral: percent(counts.deferred, counts.checkedOut), single: percent(counts.single, counts.donated), double: percent(counts.double, counts.donated) };
  return counts;
}
function slotStats(slotId, regs, checkins) {
  const slotRegs = regs.filter((r) => r.appointmentSlotId === slotId);
  return computeOpsStats(slotRegs, checkins);
}
function renderOperationsDashboard(root, regs, checkins, user) {
  if (!root) return;
  const stats = computeOpsStats(regs, checkins);
  root.textContent = "";
  root.append(statGrid([["Not checked in yet", stats.notArrived], ["Currently checked in", stats.checkedIn], ["Checked out / done", stats.checkedOut], ["Total students expected", stats.expected], ["Single donations", stats.single], ["Double donations", stats.double], ["Total units donated", stats.totalUnits]]));
}
function attendancePanel(stats) {
  const panel = document.createElement("section"); panel.className = "ops-card ops-wide";
  const total = Math.max(1, stats.expected); let a = 0;
  const colors = [["Not Arrived", stats.notArrived, "#cbd5e1"], ["Checked In", stats.checkedIn, "#0e60ab"], ["Checked Out", stats.checkedOut, "#1f6b42"]];
  const stops = colors.map(([,v,c]) => { const s=a; a += (v/total)*360; return `${c} ${s}deg ${a}deg`; }).join(", ");
  panel.innerHTML = `<h2>Attendance</h2><div class="donut" aria-label="Attendance chart"></div>`;
  panel.querySelector(".donut").style.background = stats.expected ? `conic-gradient(${stops})` : "#e5e7eb";
  panel.append(listElement(colors.map(([l,v]) => `${l} — ${v}`)));
  return panel;
}
function appointmentNowPanel(title, slotId, regs, checkins, empty = "No current appointment.") {
  const panel = document.createElement("section"); panel.className = "ops-card";
  const h = document.createElement("h2"); h.textContent = title; panel.appendChild(h);
  if (!slotId) { const p=document.createElement("p"); p.className="muted"; p.textContent=empty; panel.appendChild(p); return panel; }
  const s = slotStats(slotId, regs, checkins); const strong=document.createElement("strong"); strong.className="slot-heading"; strong.textContent=slotLabel(slotId); panel.appendChild(strong);
  panel.append(listElement([`Expected: ${s.expected}`, `Checked In: ${s.checkedIn}`, `Checked Out: ${s.checkedOut}`, `Not Arrived: ${s.notArrived}`])); return panel;
}
function donationPanel(stats) { return chartPanel("Donation outcomes", `Donated is successful students; total units are ${stats.single} single + (${stats.double} double × 2).`, [{label:"Donated",value:stats.donated},{label:"Deferred",value:stats.deferred},{label:"Other",value:stats.other},{label:"Single",value:stats.single},{label:"Double",value:stats.double},{label:"Units",value:stats.totalUnits}], [`Donation rate — ${stats.rates.donation}`, `Deferral rate — ${stats.rates.deferral}`, `Single donation percentage — ${stats.rates.single}`, `Double donation percentage — ${stats.rates.double}`], { panelClass: "ops-wide" }); }
function appointmentOverview(regs, checkins) { const panel=document.createElement("section"); panel.className="panel ops-wide"; panel.append(headingBlock("Appointment overview", "Every configured 15-minute appointment slot.")); const table=document.createElement("table"); table.className="compact-table"; table.innerHTML="<thead><tr><th>Time</th><th>Expected</th><th>Checked In</th><th>Checked Out</th><th>Donated</th><th>Deferred</th><th>Not Arrived</th><th>Donation Rate</th></tr></thead>"; const body=document.createElement("tbody"); TIME_SLOTS.forEach((slot)=>{ const s=slotStats(slot.id, regs, checkins); const tr=document.createElement("tr"); [slot.label,s.expected,s.checkedIn,s.checkedOut,s.donated,s.deferred,s.notArrived,s.rates.donation].forEach(v=>{const td=document.createElement("td"); td.textContent=String(v); tr.appendChild(td);}); body.appendChild(tr); }); table.appendChild(body); panel.appendChild(table); return panel; }
function isLateArrival(record) { const checked = toDate(record.checkin?.checkedInAt); if (!checked || !record.appointmentSlotId) return false; const p = timeParts(checked); const actual = p.hour * 60 + p.minute; const start = slotMinutes(record.appointmentSlotId); return actual < start || actual >= start + 15; }

async function initActivityPage() {
  const type = $("activity-type"), staff = $("activity-staff"), rows = $("activity-list");
  let items = [];
  let names = new Map();
  try {
    await loadAdminDirectory();
    const regs = await getDocs(collection(db, REGISTRATIONS_COLLECTION));
    names = new Map(regs.docs.map((d) => [d.id, `${d.data().firstName || ""} ${d.data().lastName || ""}`.trim() || d.id]));
    fillAdminFilter(staff);
  } catch {}
  onSnapshot(query(collection(db, CHECKIN_ACTIVITY_COLLECTION), orderBy("occurredAt", "desc"), limit(200)), (snap) => { items = snap.docs.map((d) => serialize({ id: d.id, ...d.data() })); renderActivity(items, names, type?.value || "", staff?.value || "", rows); });
  [type, staff].forEach((el) => el?.addEventListener("input", () => renderActivity(items, names, type?.value || "", staff?.value || "", rows)));
}

function fillAdminFilter(select) {
  if (!select) return;
  select.textContent = "";
  select.append(new Option("All admins", ""));
  [...adminDirectory.entries()].sort((a,b) => a[1].localeCompare(b[1])).forEach(([uid, name]) => select.append(new Option(name, uid)));
}

function renderActivity(items, names, type, staff, root) {
  if (!root) return;
  root.textContent = "";
  const filtered = items.filter((i) => (!type || i.action === type) && (!staff || i.actorUid === staff));
  if (!filtered.length) { const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "No activity matches these filters."; root.appendChild(empty); return; }
  filtered.forEach((i) => {
    const div = document.createElement("article");
    div.className = "activity-card";
    const action = ({ checkin: "Checked in", checkout: "Checked out", late: "Marked late" })[i.action] || i.action || "Updated";
    div.innerHTML = `<div><strong></strong><p></p></div><time></time>`;
    div.querySelector("strong").textContent = `${action}: ${names.get(i.registrationId) || i.registrationId}`;
    div.querySelector("p").textContent = `By ${adminName(i.actorUid, i.actorName) || "Unknown admin"}${i.outcome ? ` · Outcome: ${outcomeLabel(i.outcome)}` : ""}`;
    div.querySelector("time").textContent = formatTimestampWithSeconds(i.occurredAt);
    root.appendChild(div);
  });
}

function normalizeSearch(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9@.]+/g, " ").trim(); }
function operationalLabel(value) { return ({ registered: "Registered", checked_in: "Checked In", completed: "Completed" })[value] || "Registered"; }
function adminDisplayName(profile, user) { return [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() || profile?.name || profile?.displayName || profile?.email || user?.email || user?.uid || "Admin"; }
function adminName(uid, fallback = "") { return fallback || adminDirectory.get(uid) || uid || ""; }
function outcomeLabel(value) { return OUTCOMES[value] || value || ""; }
function timeOnly(value) { const d = toDate(value); return d ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: DRIVE_TIME_ZONE, timeZoneName: "short" }).replace(/EDT|GMT[-+]\d+/, DRIVE_TIME_ZONE_LABEL) : ""; }

function bindStatsTabs() {
  document.querySelectorAll("[data-stats-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeStatsTab = button.dataset.statsTab || "registration";
      document.querySelectorAll("[data-stats-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
      renderStats(registrations);
    });
  });
}

function renderStats(records) {
  const stats = $("stats");
  if (!stats) return;
  const total = records.length;
  const capacity = TIME_SLOTS.reduce((sum, slot) => sum + slot.capacity, 0);
  const bySlot = Object.fromEntries(TIME_SLOTS.map((slot) => [slot.id, 0]));
  const bySenator = Object.fromEntries(SENATORS.map((senator) => [senator.id, 0]));
  const byDate = dateRange(REGISTRATION_START, DRIVE_DATE).map((date) => ({ date, count: 0 }));
  const byDateMap = Object.fromEntries(byDate.map((entry) => [isoDate(entry.date), entry]));
  records.forEach((record) => {
    if (bySlot[record.appointmentSlotId] != null) bySlot[record.appointmentSlotId] += 1;
    (record.senatorIds || []).forEach((id) => { bySenator[id] = (bySenator[id] || 0) + 1; });
    const submitted = toDate(record.createdAt);
    if (submitted && byDateMap[isoDate(submitted)]) byDateMap[isoDate(submitted)].count += 1;
  });
  const todayCount = countSince(records, startOfDay(new Date()), addDays(startOfDay(new Date()), 1));
  const weekCount = countSince(records, addDays(startOfDay(new Date()), -6), addDays(startOfDay(new Date()), 1));
  const age16 = records.filter((record) => Number(record.ageOnDriveDate) === 16).length;
  const age17Plus = records.filter((record) => Number(record.ageOnDriveDate) >= 17).length;
  const highestDay = byDate.reduce((best, entry) => entry.count > best.count ? entry : best, byDate[0] || { date: DRIVE_DATE, count: 0 });
  const average = byDate.length ? (total / byDate.length).toFixed(1) : "0";
  const slotCounts = TIME_SLOTS.map((slot) => ({ ...slot, count: bySlot[slot.id] || 0 }));
  const senatorRows = SENATORS.map((senator) => ({ ...senator, count: bySenator[senator.id] || 0 })).sort((a, b) => b.count - a.count);
  stats.textContent = "";
  if (activeStatsTab === "dayof") {
    stats.append(
      dayOfOverview(records),
      dayOfStatsPanel(records),
      appointmentOverview(records, new Map(records.map((r) => [r.id, r.checkin || { status: "registered" }])))
    );
    return;
  }
  stats.append(
    statGrid([["Total registrations", total], ["Registrations today", todayCount], ["Registrations this week", weekCount], ["Remaining available appointments", Math.max(0, capacity - total)], ["Number of 16-year-olds", age16], ["Number of students 17+", age17Plus]]),
    chartPanel("Registrations over time", "Daily registrations through drive day.", byDate.map((entry) => ({ label: shortDate(entry.date), value: entry.count })), [`Total registrations — ${total}`, `Average registrations per day — ${average}`, `Highest-registration day — ${shortDate(highestDay.date)} (${highestDay.count})`, `Registration growth over time — ${total} cumulative registrations`]),
    chartPanel("Appointment analytics", "Capacity filled for each appointment slot.", slotCounts.map((slot) => ({ label: slot.label, value: slot.count, max: slot.capacity })), appointmentRows(slotCounts), { listClass: "appointment-list" }),
    chartPanel("Senator analytics", "Each listed senator receives credit when multiple senators helped one signup.", senatorRows.map((senator) => ({ label: senator.name, value: senator.count })), senatorLeaderboardRows(senatorRows, total), { panelClass: "senator-panel", chartClass: "diagonal-labels", listClass: "leaderboard-list" }),
    piePanel("Age split", [{ label: "Exactly 16", value: age16, color: "#0e60ab" }, { label: "17+", value: age17Plus, color: "#47a3f3" }])
  );
}

function statGrid(items) {
  const grid = document.createElement("div");
  grid.className = "grid stats-grid";
  items.forEach(([label, value, note]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<div class="muted"></div><div class="stat-value"></div><div class="stat-note"></div>`;
    card.querySelector(".muted").textContent = label;
    card.querySelector(".stat-value").textContent = String(value);
    card.querySelector(".stat-note").textContent = note || "";
    grid.appendChild(card);
  });
  return grid;
}

function chartPanel(title, description, data, rows, options = {}) {
  const panel = document.createElement("section");
  panel.className = ["panel", options.panelClass].filter(Boolean).join(" ");
  const max = Math.max(1, ...data.map((item) => item.max || item.value));
  const chart = document.createElement("div");
  chart.className = ["chart", options.chartClass].filter(Boolean).join(" ");
  data.forEach((item) => {
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = `${Math.max(4, (item.value / max) * 100)}%`;
    bar.title = `${item.label}: ${item.value}`;
    bar.innerHTML = `<strong></strong><span></span>`;
    bar.querySelector("strong").textContent = String(item.value);
    bar.querySelector("span").textContent = item.label;
    chart.appendChild(bar);
  });
  panel.append(headingBlock(title, description), chart, listElement(rows, options.listClass));
  return panel;
}

function piePanel(title, slices) {
  const panel = document.createElement("section");
  panel.className = "panel pie-panel";
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  let current = 0;
  const stops = slices.map((slice) => {
    const start = current;
    current += total ? (slice.value / total) * 360 : 0;
    return `${slice.color} ${start}deg ${current}deg`;
  }).join(", ");
  const pie = document.createElement("div");
  pie.className = "pie-chart";
  pie.style.background = total ? `conic-gradient(${stops})` : "#e5e7eb";
  panel.append(headingBlock(title, "Exactly 16-year-olds compared with students 17 and older."), pie, listElement(slices.map((slice) => `${slice.label} — ${slice.value} (${percent(slice.value, total)})`)));
  return panel;
}

function headingBlock(title, description) {
  const wrap = document.createElement("div");
  const heading = document.createElement("h2");
  heading.textContent = title;
  const copy = document.createElement("p");
  copy.className = "muted";
  copy.textContent = description;
  wrap.append(heading, copy);
  return wrap;
}

function listElement(rows, extraClass = "") {
  const list = document.createElement("div");
  list.className = ["list", "analytics-list", extraClass].filter(Boolean).join(" ");
  rows.forEach((row) => {
    const item = document.createElement("div");
    item.className = ["list-row", row.className].filter(Boolean).join(" ");
    item.textContent = row.text || row;
    list.appendChild(item);
  });
  return list;
}

function appointmentRows(slotCounts) {
  const summaryRows = [
    { text: `Most popular appointment time — ${popular(slotCounts, true)}`, className: "featured-row" },
    { text: `Least popular appointment time — ${popular(slotCounts, false)}`, className: "featured-row" },
  ];
  const slotRows = slotCounts.map((slot) => ({
    text: `${slot.label}: ${slot.count} spots filled of ${slot.capacity} (${Math.round((slot.count / slot.capacity) * 100)}% filled)`,
    className: "subtle-row",
  }));
  return summaryRows.concat(slotRows);
}

function senatorLeaderboardRows(senatorRows, total) {
  return senatorRows.map((senator, index) => ({
    text: `#${index + 1} ${senator.name} — ${senator.count} registrations (${percent(senator.count, total)})`,
    className: "leaderboard-row",
  }));
}

function dayOfOverview(records) {
  const stats = computeOpsStats(records, new Map(records.map((r) => [r.id, r.checkin || { status: "registered" }])));
  return statGrid([["Not checked in yet", stats.notArrived], ["Currently checked in", stats.checkedIn], ["Checked out / done", stats.checkedOut], ["Total expected", stats.expected], ["Single donations", stats.single], ["Double donations", stats.double], ["Total units", stats.totalUnits]]);
}

function dayOfStatsPanel(records) {
  const stats = computeOpsStats(records, new Map(records.map((r) => [r.id, r.checkin || { status: "registered" }])));
  return chartPanel("Day-of blood drive outcomes", "Operational statistics from check-in and checkout records.", [{ label: "Checked In", value: stats.checkedIn }, { label: "Checked Out", value: stats.checkedOut }, { label: "Donated", value: stats.donated }, { label: "Deferred", value: stats.deferred }, { label: "Units", value: stats.totalUnits }], [`Expected — ${stats.expected}`, `Not arrived — ${stats.notArrived} (${stats.rates.notArrived})`, `Donation rate — ${stats.rates.donation}`, `Deferral rate — ${stats.rates.deferral}`, `Total units — ${stats.totalUnits}`]);
}
function openBloodDriveReport(records) {
  const win = window.open("", "_blank"); if (!win) return;
  const stats = computeOpsStats(records, new Map(records.map((r) => [r.id, r.checkin || { status: "registered" }])));
  const rows = exportRows(records);
  win.document.write(`<title>${escapeHtml(CONFIG.eventName)} Report</title><style>body{font-family:Inter,Arial,sans-serif;margin:28px;color:#131a24}.hero{border:1px solid #dde3ec;border-radius:20px;padding:22px;background:#f8fafc}h1{margin:0 0 8px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.card{border:1px solid #dde3ec;border-radius:14px;padding:12px}.num{font-size:28px;font-weight:800;color:#07345e}table{border-collapse:collapse;width:100%;font-size:10px;table-layout:fixed}th,td{border:1px solid #d8dee8;padding:5px;word-break:break-word}th{background:#eef2f7}@media print{@page{size:landscape;margin:.35in}}</style><section class="hero"><h1>${escapeHtml(CONFIG.eventName)} Outcomes Report</h1><p>${escapeHtml(formatDriveDate(CONFIG.bloodDriveDate))} · ${escapeHtml(CONFIG.location)} · Times shown in ${escapeHtml(DRIVE_TIME_ZONE_LABEL)}</p></section><div class="grid">${[["Expected",stats.expected],["Checked In",stats.checkedIn],["Checked Out",stats.checkedOut],["Donated",stats.donated],["Deferred",stats.deferred],["Single",stats.single],["Double",stats.double],["Total Units",stats.totalUnits]].map(([l,v])=>`<div class="card"><div>${escapeHtml(l)}</div><div class="num">${escapeHtml(v)}</div></div>`).join("")}</div><h2>Rates</h2><p>Check-in ${stats.rates.checkin} · Checkout ${stats.rates.checkout} · Donation ${stats.rates.donation} · Deferral ${stats.rates.deferral}</p><h2>All registrations</h2><table><thead><tr>${Object.keys(rows[0] || {}).map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${Object.values(row).map((v) => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
  win.document.close(); win.print();
}

function statusLabel(value) {
  const labels = { required: "Required", not_required: "Not required", unknown: "Unknown / not tracked" };
  const normalized = String(value || "unknown").toLowerCase().replace(/-/g, "_");
  return labels[normalized] || value || "Unknown / not tracked";
}
function yesNo(value) { return value ? "Yes" : "No"; }
function senatorName(id) { return SENATORS.find((senator) => senator.id === id)?.name || id || ""; }
function slotLabel(id) { return TIME_SLOTS.find((slot) => slot.id === id)?.label || id || ""; }
function toDate(value) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; }
function formatTimestamp(value) { const date = toDate(value); return date ? date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: DRIVE_TIME_ZONE }).replace(/EDT|GMT[-+]\d+/, DRIVE_TIME_ZONE_LABEL) : ""; }
function formatTimestampWithSeconds(value) { const date = toDate(value); return date ? date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "medium", timeZone: DRIVE_TIME_ZONE }).replace(/EDT|GMT[-+]\d+/, DRIVE_TIME_ZONE_LABEL) : ""; }
function formatDate(value) { const date = value ? new Date(`${value}T00:00:00`) : null; return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: DRIVE_TIME_ZONE }) : ""; }
function formatDriveDate(value) { return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { dateStyle: "long", timeZone: DRIVE_TIME_ZONE }); }
function setText(id, value) { const element = $(id); if (element) element.textContent = value; }
function setDisabled(id, disabled) { const element = $(id); if (element) element.disabled = disabled; }
function showError(message) { setText("error", message); setText("counts", "Unable to load registrations"); }
function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function addDays(date, days) { const result = new Date(date); result.setDate(result.getDate() + days); return result; }
function isoDate(date) { return date.toISOString().slice(0, 10); }
function shortDate(date) { return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
function dateRange(start, end) { const dates = []; for (let d = startOfDay(start); d <= end; d = addDays(d, 1)) dates.push(new Date(d)); return dates; }
function countSince(records, start, end) { return records.filter((record) => { const date = toDate(record.createdAt); return date && date >= start && date < end; }).length; }
function percent(value, total) { return total ? `${Math.round((value / total) * 100)}%` : "0%"; }
function popular(items, highest) { const sorted = [...items].sort((a, b) => highest ? b.count - a.count : a.count - b.count); const item = sorted[0]; return item ? `${item.label} (${item.count})` : "None"; }
