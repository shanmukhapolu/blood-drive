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
const $ = (id) => document.getElementById(id);

let registrations = [];

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
  setText("admin-email", `${profile.email || user.email || "Admin"} · admin enabled`);
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
    const registrationsQuery = query(
      collection(db, REGISTRATIONS_COLLECTION),
      orderBy("createdAt", "desc")
    );
    const snapshot = await getDocs(registrationsQuery);

    console.info("[Admin Dashboard] all registrations read:", snapshot.size);

    return snapshot.docs.map((registration) => serialize({
      id: registration.id,
      ...registration.data(),
    }));
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
}

function bindFilters() {
  ["search", "filter-slot", "filter-senator"].forEach((id) => $(id)?.addEventListener("input", renderRegistrations));
  $("refresh")?.addEventListener("click", async () => {
    setText("counts", "Refreshing registrations…");
    registrations = await loadRegistrations();
    renderRegistrations();
  });
}

function renderRegistrations() {
  const search = ($("search")?.value || "").trim().toLowerCase();
  const slot = $("filter-slot")?.value || "";
  const senator = $("filter-senator")?.value || "";

  const filtered = registrations.filter((record) => {
    const searchable = [record.id, record.firstName, record.lastName, record.studentEmail, record.parentEmail, record.studentId].join(" ").toLowerCase();
    if (search && !searchable.includes(search)) return false;
    if (slot && record.appointmentSlotId !== slot) return false;
    if (senator && !(record.senatorIds || []).includes(senator)) return false;
    return true;
  });

  renderTable(filtered);
  setText("counts", `${filtered.length} showing · ${registrations.length} total`);
}

function renderTable(records) {
  const rows = $("rows");
  if (!rows) return;

  rows.textContent = "";

  if (!records.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 10;
    cell.textContent = "No registrations to display.";
    row.appendChild(cell);
    rows.appendChild(row);
    return;
  }

  records.forEach((record) => {
    const row = document.createElement("tr");
    [
      record.id,
      formatTimestamp(record.createdAt),
      record.firstName || "",
      record.lastName || "",
      record.studentEmail || "",
      record.parentEmail || "",
      record.phone || "",
      slotLabel(record.appointmentSlotId),
      (record.senatorIds || []).map(senatorName).join(", "),
      record.parentConsentStatus || "",
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
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
  title.textContent = "Registration detail";

  const close = document.createElement("button");
  close.id = "close-modal";
  close.className = "secondary";
  close.type = "button";
  close.textContent = "Close";

  const detail = document.createElement("pre");
  detail.className = "detail-json";
  detail.textContent = JSON.stringify(record, null, 2);

  header.append(title, close);
  card.append(header, detail);
  modal.appendChild(card);
  root.appendChild(modal);
  close.addEventListener("click", () => {
    root.textContent = "";
  });
}

function renderStats(records) {
  const stats = $("stats");
  if (!stats) return;

  const total = records.length;
  const capacity = TIME_SLOTS.reduce((sum, slot) => sum + slot.capacity, 0);
  const bySlot = Object.fromEntries(TIME_SLOTS.map((slot) => [slot.id, 0]));
  const bySenator = Object.fromEntries(SENATORS.map((senator) => [senator.id, 0]));
  let consentRequired = 0;

  records.forEach((record) => {
    if (bySlot[record.appointmentSlotId] != null) bySlot[record.appointmentSlotId] += 1;
    (record.senatorIds || []).forEach((id) => {
      bySenator[id] = (bySenator[id] || 0) + 1;
    });
    if (record.parentConsentStatus === "required") consentRequired += 1;
  });

  stats.textContent = "";
  stats.append(
    statGrid([
      ["Total registrations", total],
      ["Remaining appointments", Math.max(0, capacity - total)],
      ["Capacity", capacity],
      ["Parent consent required", consentRequired],
    ]),
    listPanel("Appointments", TIME_SLOTS.map((slot) => `${slot.label} — ${bySlot[slot.id]}/${slot.capacity}`)),
    listPanel("Senators", SENATORS.map((senator) => `${senator.name} — ${bySenator[senator.id] || 0}`))
  );
}

function statGrid(items) {
  const grid = document.createElement("div");
  grid.className = "grid";
  items.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    const labelElement = document.createElement("div");
    labelElement.className = "muted";
    labelElement.textContent = label;

    const valueElement = document.createElement("div");
    valueElement.className = "stat-value";
    valueElement.textContent = String(value);

    card.append(labelElement, valueElement);
    grid.appendChild(card);
  });
  return grid;
}

function listPanel(title, rows) {
  const panel = document.createElement("section");
  panel.className = "panel";
  const heading = document.createElement("h2");
  heading.textContent = title;
  panel.appendChild(heading);

  const list = document.createElement("div");
  list.className = "list";
  rows.forEach((text) => {
    const item = document.createElement("div");
    item.className = "list-row";
    item.textContent = text;
    list.appendChild(item);
  });
  panel.appendChild(list);
  return panel;
}

function showError(message) {
  setText("error", message);
  setText("counts", "Unable to load registrations");
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function senatorName(id) {
  return SENATORS.find((senator) => senator.id === id)?.name || id || "";
}

function slotLabel(id) {
  return TIME_SLOTS.find((slot) => slot.id === id)?.label || id || "";
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTimestamp(value) {
  const date = toDate(value);
  return date ? date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
}

function formatDriveDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { dateStyle: "long" });
}
