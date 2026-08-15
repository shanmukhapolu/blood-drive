import { CONFIG, SENATORS, TIME_SLOTS } from "../config.js";
import { db } from "../firebase-init.js";
import { requireAdmin, logout } from "./auth.js";
import {
  collection,
  getDocs,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

const REGISTRATIONS_COLLECTION = "registrations";
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DRIVE_DATE = new Date(`${CONFIG.bloodDriveDate}T00:00:00`);
const REGISTRATION_START = new Date("2026-08-15T00:00:00");
const $ = (id) => document.getElementById(id);

let registrations = [];
let tableState = { sortKey: "createdAt", sortDirection: "desc", page: 1, pageSize: 25 };

requireAdmin({
  onReady: (user, profile) => {
    initShell(user, profile);

    if (location.pathname.includes("registrations")) {
      initRegistrationsPage();
      return;
    }

    if (location.pathname.includes("statistics")) {
      initStatisticsPage();
    }
  },
  onDenied: (message) => showError(message),
});

function initShell(user, profile) {
  setText("admin-email", profile.email || user.email || "Admin");
  setText("drive-meta", `${CONFIG.eventName} • ${formatDriveDate(CONFIG.bloodDriveDate)} • ${CONFIG.location}`);
  $("logout")?.addEventListener("click", logout);
}

async function initRegistrationsPage() {
  fillFilters();
  bindFilters();
  renderTable([]);
  setText("counts", "Loading registrations…");

  registrations = await loadRegistrations();
  renderRegistrations();
}

async function initStatisticsPage() {
  const stats = $("stats");
  if (stats) stats.innerHTML = '<section class="panel"><p>Loading statistics…</p></section>';

  registrations = await loadRegistrations();
  renderStats(registrations);
}

async function loadRegistrations() {
  try {
    const registrationsQuery = query(collection(db, REGISTRATIONS_COLLECTION), orderBy("createdAt", "desc"));
    const snapshot = await getDocs(registrationsQuery);
    console.info("[Admin Dashboard] all registrations read:", snapshot.size);
    return snapshot.docs.map((registration) => serialize({ id: registration.id, ...registration.data() }));
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
    renderRegistrations();
  });
}

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
    cell.colSpan = 13;
    cell.textContent = "No registrations to display.";
    row.appendChild(cell);
    rows.appendChild(row);
    return;
  }
  records.forEach((record) => {
    const row = document.createElement("tr");
    [record.id, formatTimestamp(record.createdAt), record.firstName, record.lastName, record.parentEmail, record.studentEmail, record.phone, formatDate(record.dob), record.studentId, yesNo(record.nhsSeniorMember), (record.senatorIds || []).map(senatorName).join(", "), slotLabel(record.appointmentSlotId), record.ageOnDriveDate]
      .forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value ?? "";
        row.appendChild(cell);
      });
    row.addEventListener("click", () => showDetail(record));
    rows.appendChild(row);
  });
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
  card.append(header, detailSection("Registration", [["Confirmation ID", record.id], ["Date submitted", formatTimestamp(record.createdAt)], ["Appointment", slotLabel(record.appointmentSlotId)], ["Blood drive date", formatDriveDate(record.bloodDriveDate || CONFIG.bloodDriveDate)], ["Location", record.location || CONFIG.location]]), detailSection("Student", [["First name", record.firstName], ["Last name", record.lastName], ["Student email", record.studentEmail], ["Parent email", record.parentEmail], ["Phone", record.phone], ["Birthdate", formatDate(record.dob)], ["Age on drive date", record.ageOnDriveDate], ["Student ID", record.studentId], ["In NHS?", yesNo(record.nhsSeniorMember)], ["Senator(s) assisted", (record.senatorIds || []).map(senatorName).join(", ")]]), detailSection("Eligibility", [["Parent consent status", statusLabel(record.parentConsentStatus)], ["Age confirmed", yesNo(record.eligibilityAgeConfirmed)], ["No fall sport confirmed", yesNo(record.eligibilityNoFallSportConfirmed)], ["Schema version", record.schemaVersion]]));
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
  items.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<div class="muted"></div><div class="stat-value"></div>`;
    card.querySelector(".muted").textContent = label;
    card.querySelector(".stat-value").textContent = String(value);
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

function statusLabel(value) {
  const labels = { required: "Required", not_required: "Not required", unknown: "Unknown / not tracked" };
  const normalized = String(value || "unknown").toLowerCase().replace(/-/g, "_");
  return labels[normalized] || value || "Unknown / not tracked";
}
function yesNo(value) { return value ? "Yes" : "No"; }
function senatorName(id) { return SENATORS.find((senator) => senator.id === id)?.name || id || ""; }
function slotLabel(id) { return TIME_SLOTS.find((slot) => slot.id === id)?.label || id || ""; }
function toDate(value) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; }
function formatTimestamp(value) { const date = toDate(value); return date ? date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : ""; }
function formatDate(value) { const date = value ? new Date(`${value}T00:00:00`) : null; return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-US", { dateStyle: "medium" }) : ""; }
function formatDriveDate(value) { return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { dateStyle: "long" }); }
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
