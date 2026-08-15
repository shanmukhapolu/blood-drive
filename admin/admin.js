import { CONFIG, TIME_SLOTS } from "../config.js";
import { auth, requireAdmin, logout } from "./auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";

const PAGE_SIZE = 25;
const DEFAULT_SORT_KEY = "createdAt";
const REGISTRATIONS_COLLECTION = "registrations";

const $ = (id) => document.getElementById(id);

let registrations = [];
let filteredRegistrations = [];
let page = 1;
let sortKey = DEFAULT_SORT_KEY;
let sortDir = "desc";
const functions = getFunctions();
const listAdminRegistrations = httpsCallable(functions, "listAdminRegistrations");
const listAdminRegistrationsHttpUrl = "https://us-central1-blood-drive-test.cloudfunctions.net/listAdminRegistrationsHttp";
let loadingRegistrations = false;

const columns = [
  ["id", "Confirmation ID"],
  ["createdAt", "Date Submitted"],
  ["firstName", "First Name"],
  ["lastName", "Last Name"],
  ["parentEmail", "Parent Email"],
  ["studentEmail", "Personal Student Email"],
  ["phone", "Phone"],
  ["dob", "Birthdate"],
  ["studentId", "Student ID"],
  ["nhsSeniorMember", "NHS?"],
  ["senatorIds", "Senator(s) Who Assisted"],
  ["appointmentSlotId", "Appointment Time"],
  ["ageOnDriveDate", "Age on Drive Date"],
  ["confirmation", "Confirmation Email Sent"],
  ["consent", "Consent Email Sent"],
  ["lastUpdated", "Last Updated"],
];

requireAdmin({
  onReady: (user, profile) => {
    debugAdminCheckpoint("admin-ready", { email: user.email || "missing", adminDocumentId: redactId(profile?.id) });
    initShell(user);

    if (isRegistrationsPage()) {
      initRegistrationsPage();
      return;
    }

    if (isStatisticsPage()) {
      initStatisticsPage();
      return;
    }
  },
  onDenied: (message) => {
    if ($("error")) $("error").textContent = message;
  },
});

function isRegistrationsPage() {
  return location.pathname.includes("registrations");
}

function isStatisticsPage() {
  return location.pathname.includes("statistics");
}

function initShell(user) {
  if ($("admin-email")) $("admin-email").textContent = user.email || "Admin";
  if ($("drive-meta")) {
    $("drive-meta").textContent = `${CONFIG.eventName} • ${formatDriveDate(CONFIG.bloodDriveDate)} • ${CONFIG.location}`;
  }
  $("logout")?.addEventListener("click", logout);
}

function initRegistrationsPage() {
  debugAdminCheckpoint("registrations-page-init", { collection: REGISTRATIONS_COLLECTION });
  fillFilterOptions();
  renderTableHead();
  bindRegistrationControls();
  setRegistrationLoadingState();
  watchRegistrations((records) => {
    registrations = records;
    page = 1;
    applyFilters();
  });
}

function initStatisticsPage() {
  debugAdminCheckpoint("statistics-page-init", { collection: REGISTRATIONS_COLLECTION });
  setStatsLoadingState();
  watchRegistrations((records) => {
    registrations = records;
    renderStats(registrations);
  });
}

async function watchRegistrations(onRecords) {
  if (loadingRegistrations) return;
  loadingRegistrations = true;

  debugAdminCheckpoint("registrations-fetch-start", {
    collection: REGISTRATIONS_COLLECTION,
    source: "listAdminRegistrations callable",
  });

  try {
    const data = await fetchAdminRegistrations();
    const records = Array.isArray(data?.registrations) ? data.registrations : [];
    debugAdminCheckpoint("registrations-fetch-success", {
      count: records.length,
      adminDocumentId: redactId(data?.adminDocumentId),
    });
    onRecords(records);
  } catch (error) {
    debugAdminCheckpoint("registrations-fetch-error", {
      code: error?.code || "unknown",
      message: error?.message || String(error),
    });
    showLoadError(error);
  } finally {
    loadingRegistrations = false;
  }
}

async function fetchAdminRegistrations() {
  try {
    const result = await listAdminRegistrations();
    debugAdminCheckpoint("registrations-fetch-callable-success");
    return result.data;
  } catch (callableError) {
    debugAdminCheckpoint("registrations-fetch-callable-error", {
      code: callableError?.code || "unknown",
      message: callableError?.message || String(callableError),
      fallback: "listAdminRegistrationsHttp",
    });

    if (!shouldTryHttpFallback(callableError)) throw callableError;
    return fetchAdminRegistrationsHttp(callableError);
  }
}

function shouldTryHttpFallback(error) {
  const code = error?.code || "";
  return !code || code === "functions/internal" || code === "internal" || code === "functions/unavailable" || code === "unavailable";
}

async function fetchAdminRegistrationsHttp(originalError) {
  const token = await auth.currentUser?.getIdToken(true);
  if (!token) throw originalError;

  debugAdminCheckpoint("registrations-fetch-http-start", { endpoint: listAdminRegistrationsHttpUrl });
  const response = await fetch(listAdminRegistrationsHttpUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const fallbackError = new Error(payload?.error?.message || `HTTP fallback failed with status ${response.status}.`);
    fallbackError.code = payload?.error?.code || `http-${response.status}`;
    throw fallbackError;
  }

  debugAdminCheckpoint("registrations-fetch-http-success");
  return payload.data;
}

function showLoadError(error) {
  const code = error?.code || "unknown";
  const rawMessage = error?.message || String(error || "No error details returned.");
  const message =
    code === "permission-denied"
      ? "The admin data endpoint denied access. Make sure your Firebase Auth user has an admins record whose document ID is your Firebase Auth UID or exact email, with role admin and status enabled, then deploy the latest functions."
      : "Unable to load registration data from the secure admin endpoint. Please refresh or check Firebase configuration.";

  if ($("counts")) $("counts").textContent = "Unable to load registrations";
  if ($("rows")) {
    $("rows").textContent = "";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columns.length;
    cell.textContent = message;
    row.appendChild(cell);
    $("rows").appendChild(row);
  }
  if ($("stats")) {
    $("stats").textContent = "";
    const panel = el("section", "panel");
    panel.appendChild(el("p", "", message));
    $("stats").appendChild(panel);
  }
  if ($("error")) $("error").textContent = `${message} (${code}: ${rawMessage}) Check the browser console for [Admin Dashboard] and [Admin Auth] checkpoints.`;
}

function setRegistrationLoadingState() {
  if ($("counts")) $("counts").textContent = "Loading registrations from Firestore…";
  if ($("rows")) {
    $("rows").textContent = "";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columns.length;
    cell.textContent = "Loading registrations from Firestore…";
    row.appendChild(cell);
    $("rows").appendChild(row);
  }
}

function setStatsLoadingState() {
  if ($("stats")) {
    $("stats").textContent = "";
    const panel = el("section", "panel");
    panel.appendChild(el("p", "", "Loading statistics from Firestore…"));
    $("stats").appendChild(panel);
  }
}

function fillFilterOptions() {
  TIME_SLOTS.forEach((slot) => $("filter-slot")?.append(new Option(slot.label, slot.id)));
  getKnownSenatorIds().forEach((id) => $("filter-senator")?.append(new Option(titleCase(id), id)));
}

function getKnownSenatorIds() {
  return ["alex-patel", "daniel-kim", "maya-shah", "priya-desai", "sarah-chen"];
}

function renderTableHead() {
  const head = $("head");
  if (!head) return;
  head.textContent = "";

  columns.forEach(([key, label]) => {
    const th = document.createElement("th");
    th.textContent = label;
    th.addEventListener("click", () => {
      if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
      else {
        sortKey = key;
        sortDir = key === DEFAULT_SORT_KEY ? "desc" : "asc";
      }
      applyFilters();
    });
    head.appendChild(th);
  });
}

function bindRegistrationControls() {
  ["search", "filter-slot", "filter-age", "filter-nhs", "filter-senator", "filter-confirmation", "filter-consent"].forEach(
    (id) => $(id)?.addEventListener("input", () => {
      page = 1;
      applyFilters();
    })
  );

  $("clear")?.addEventListener("click", () => {
    ["search", "filter-slot", "filter-age", "filter-nhs", "filter-senator", "filter-confirmation", "filter-consent"].forEach(
      (id) => {
        if ($(id)) $(id).value = "";
      }
    );
    page = 1;
    applyFilters();
  });

  $("prev")?.addEventListener("click", () => {
    page = Math.max(1, page - 1);
    renderRows();
  });

  $("next")?.addEventListener("click", () => {
    page += 1;
    renderRows();
  });
}

function applyFilters() {
  const search = ($("search")?.value || "").trim().toLowerCase();

  filteredRegistrations = registrations.filter((record) => {
    const searchableText = [
      record.id,
      record.firstName,
      record.lastName,
      record.studentEmail,
      record.parentEmail,
      record.studentId,
    ]
      .join(" ")
      .toLowerCase();

    if (search && !searchableText.includes(search)) return false;
    if ($("filter-slot")?.value && record.appointmentSlotId !== $("filter-slot").value) return false;

    const ageFilter = $("filter-age")?.value;
    const age = Number(record.ageOnDriveDate);
    if (ageFilter === "18+" && age < 18) return false;
    if (ageFilter && ageFilter !== "18+" && String(record.ageOnDriveDate) !== ageFilter) return false;

    if ($("filter-nhs")?.value && String(record.nhsSeniorMember) !== $("filter-nhs").value) return false;
    if ($("filter-senator")?.value && !(record.senatorIds || []).includes($("filter-senator").value)) return false;
    if ($("filter-confirmation")?.value && ($("filter-confirmation").value === "sent") !== confirmationEmailSent(record)) {
      return false;
    }

    const consentFilter = $("filter-consent")?.value;
    if (consentFilter === "sent" && !consentEmailSent(record)) return false;
    if (consentFilter === "required" && record.parentConsentStatus !== "required") return false;
    if (consentFilter === "not_required" && record.parentConsentStatus !== "not_required") return false;

    return true;
  });

  filteredRegistrations.sort((a, b) => compareValues(getSortValue(a, sortKey), getSortValue(b, sortKey)) * (sortDir === "asc" ? 1 : -1));
  renderRows();
}

function renderRows() {
  const rows = $("rows");
  if (!rows) return;

  const totalPages = Math.max(1, Math.ceil(filteredRegistrations.length / PAGE_SIZE));
  if (page > totalPages) page = totalPages;

  const start = (page - 1) * PAGE_SIZE;
  const currentPageRecords = filteredRegistrations.slice(start, start + PAGE_SIZE);

  rows.textContent = "";

  if (currentPageRecords.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columns.length;
    cell.textContent = registrations.length === 0 ? "No registration records found in Firestore." : "No registrations match the current filters.";
    row.appendChild(cell);
    rows.appendChild(row);
  } else {
    currentPageRecords.forEach((record) => {
      const row = document.createElement("tr");
      row.addEventListener("click", () => showDetail(record));
      columns.forEach(([key]) => {
        const cell = document.createElement("td");
        cell.textContent = displayValue(record, key);
        row.appendChild(cell);
      });
      rows.appendChild(row);
    });
  }

  if ($("counts")) $("counts").textContent = `${filteredRegistrations.length} matching • ${registrations.length} total registrations`;
  if ($("page")) $("page").textContent = `Page ${page} of ${totalPages}`;
  if ($("prev")) $("prev").disabled = page <= 1;
  if ($("next")) $("next").disabled = page >= totalPages;
}

function showDetail(record) {
  const root = $("modal-root");
  if (!root) return;

  root.textContent = "";

  const modal = el("div", "modal");
  const card = el("div", "modal-card");
  const header = el("div", "summary-line");
  const title = el("h2", "", "Registration Detail");
  const close = el("button", "secondary", "Close");
  close.type = "button";
  close.addEventListener("click", () => {
    root.textContent = "";
  });

  const grid = el("div", "detail-grid");
  const detailFields = columns.concat([
    ["bloodDriveId", "Blood Drive ID"],
    ["bloodDriveDate", "Blood Drive Date"],
    ["location", "Location"],
    ["parentConsentStatus", "Parent Consent Status"],
    ["eligibilityAgeConfirmed", "Age Confirmed"],
    ["eligibilityNoFallSportConfirmed", "No Fall Sport Confirmed"],
  ]);

  detailFields.forEach(([key, label]) => {
    const item = el("div", "detail-item");
    item.appendChild(el("div", "detail-label", label));
    item.appendChild(el("div", "detail-value", displayValue(record, key)));
    grid.appendChild(item);
  });

  header.append(title, close);
  card.append(header, grid);
  modal.appendChild(card);
  root.appendChild(modal);
}

function renderStats(records) {
  const stats = $("stats");
  if (!stats) return;

  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);

  const slotCounts = Object.fromEntries(TIME_SLOTS.map((slot) => [slot.id, 0]));
  const byDate = {};
  const senatorCounts = {};
  const ages = { 16: 0, 17: 0, "18+": 0 };
  let last24Hours = 0;
  let last7Days = 0;
  let requiringConsent = 0;

  records.forEach((record) => {
    const createdAt = toDate(record.createdAt);
    if (createdAt) {
      const dayKey = createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      byDate[dayKey] = (byDate[dayKey] || 0) + 1;
      if (now - createdAt < 86_400_000) last24Hours += 1;
      if (createdAt >= sevenDaysAgo) last7Days += 1;
    }

    if (slotCounts[record.appointmentSlotId] != null) slotCounts[record.appointmentSlotId] += 1;
    (record.senatorIds || []).forEach((id) => {
      senatorCounts[id] = (senatorCounts[id] || 0) + 1;
    });

    const age = Number(record.ageOnDriveDate);
    if (age === 16) {
      ages[16] += 1;
      requiringConsent += 1;
    } else if (age === 17) ages[17] += 1;
    else if (age >= 18) ages["18+"] += 1;
  });

  const total = records.length;
  const capacity = TIME_SLOTS.reduce((sum, slot) => sum + slot.capacity, 0);
  const remaining = Math.max(0, capacity - total);

  const cards = [
    ["Total registrations", total],
    ["Today", countToday(records)],
    ["This week", last7Days],
    ["Remaining appointments", remaining],
    ["16-year-olds", ages[16]],
    ["Students 17+", ages[17] + ages["18+"]],
    ["Requiring parent consent", requiringConsent],
    ["Last 24 hours", last24Hours],
  ];

  stats.textContent = "";

  const grid = el("div", "grid");
  cards.forEach(([label, value]) => {
    const card = el("div", "stat-card");
    card.append(el("div", "muted", label), el("div", "stat-value", String(value)));
    grid.appendChild(card);
  });

  stats.append(
    grid,
    chartPanel("Registrations over time", byDate),
    listPanel("Appointment analytics", appointmentRows(slotCounts)),
    listPanel("Senate leaderboard", leaderRows(senatorCounts, total)),
    listPanel("Age distribution", [`16 — ${ages[16]}`, `17 — ${ages[17]}`, `18+ — ${ages["18+"]}`]),
    listPanel("Additional metrics", [
      `Average registrations/day — ${average(byDate)}`,
      `Highest-registration day — ${highest(byDate)}`,
      `Registration growth — ${total}`,
      `Most popular appointment period — ${popularSlot(slotCounts)}`,
      `Appointments filled — ${capacity ? Math.round((total / capacity) * 100) : 0}%`,
      `Needs attention — ${records.filter((record) => record.parentConsentStatus === "required" && !consentEmailSent(record)).length} consent emails pending`,
    ])
  );
}

function displayValue(record, key) {
  if (key === "id") return record.id || "—";
  if (key === "createdAt") return formatTimestamp(record.createdAt);
  if (key === "lastUpdated") return formatTimestamp(record.lastUpdated || record.updateTime || record.updatedAt);
  if (key === "senatorIds") return (record.senatorIds || []).map(titleCase).join(", ") || "—";
  if (key === "appointmentSlotId") return slotLabel(record.appointmentSlotId);
  if (key === "nhsSeniorMember") return yesNo(record.nhsSeniorMember);
  if (key === "confirmation") return confirmationEmailSent(record) ? "Yes" : "No";
  if (key === "consent") return consentEmailSent(record) ? "Yes" : record.parentConsentStatus === "required" ? "Required" : "Not required";
  if (key === "eligibilityAgeConfirmed" || key === "eligibilityNoFallSportConfirmed") return yesNo(record[key]);
  return record[key] ?? "—";
}

function getSortValue(record, key) {
  if (key === "confirmation") return confirmationEmailSent(record);
  if (key === "consent") return consentEmailSent(record);
  if (key === "lastUpdated") return record.lastUpdated || record.updateTime || record.updatedAt;
  return record[key];
}

function compareValues(a, b) {
  const dateA = toDate(a);
  const dateB = toDate(b);
  if (dateA && dateB) return dateA - dateB;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true });
}

function confirmationEmailSent(record) {
  return record.confirmationEmailSent === true || record.confirmationSent === true || record.confirmationEmailStatus === "sent";
}

function consentEmailSent(record) {
  return record.consentEmailSent === true || record.consentSent === true || record.consentEmailStatus === "sent";
}

function yesNo(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "—";
}

function titleCase(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function slotLabel(slotId) {
  return TIME_SLOTS.find((slot) => slot.id === slotId)?.label || slotId || "—";
}

function toDate(value) {
  if (value?.toDate) return value.toDate();
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function formatTimestamp(value) {
  const date = toDate(value);
  return date ? date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function formatDriveDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString("en-US", { dateStyle: "long" });
}

function countToday(records) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return records.filter((record) => {
    const createdAt = toDate(record.createdAt);
    return createdAt && createdAt >= start;
  }).length;
}

function average(valuesByKey) {
  const values = Object.values(valuesByKey);
  return values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : "0";
}

function highest(valuesByKey) {
  const highestEntry = Object.entries(valuesByKey).sort((a, b) => b[1] - a[1])[0];
  return highestEntry ? `${highestEntry[0]} — ${highestEntry[1]}` : "—";
}

function popularSlot(slotCounts) {
  const top = Object.entries(slotCounts).sort((a, b) => b[1] - a[1])[0];
  return top ? `${slotLabel(top[0])} (${top[1]})` : "—";
}

function appointmentRows(slotCounts) {
  return TIME_SLOTS.map((slot) => `${slot.label} — ${slotCounts[slot.id] || 0}/${slot.capacity}`);
}

function leaderRows(senatorCounts, total) {
  const rows = Object.entries(senatorCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([id, count], index) => `${index + 1}. ${titleCase(id)} — ${count} (${total ? Math.round((count / total) * 100) : 0}%)`);
  return rows.length ? rows : ["No senator attribution yet."];
}

function chartPanel(title, valuesByKey) {
  const panel = el("section", "panel");
  panel.appendChild(el("h2", "", title));

  const chart = el("div", "chart");
  const max = Math.max(1, ...Object.values(valuesByKey));

  if (Object.keys(valuesByKey).length === 0) {
    chart.appendChild(el("p", "muted", "No registration dates available yet."));
  } else {
    Object.entries(valuesByKey).forEach(([label, value]) => {
      const bar = el("div", "bar");
      bar.style.height = `${Math.max(6, (value / max) * 190)}px`;
      bar.title = `${label}: ${value}`;
      bar.appendChild(el("span", "", label));
      chart.appendChild(bar);
    });
  }

  panel.append(
    chart,
    el(
      "p",
      "muted",
      `Total registrations: ${Object.values(valuesByKey).reduce((sum, value) => sum + value, 0)} • Average/day: ${average(valuesByKey)} • Highest day: ${highest(valuesByKey)}`
    )
  );
  return panel;
}

function listPanel(title, rows) {
  const panel = el("section", "panel");
  panel.appendChild(el("h2", "", title));
  const list = el("div", "list");
  rows.forEach((row) => list.appendChild(el("div", "list-row", row)));
  panel.appendChild(list);
  return panel;
}

function el(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}


function debugAdminCheckpoint(label, details = {}) {
  console.info(`[Admin Dashboard] ${label}`, details);
}

function redactId(value) {
  const text = String(value || "");
  if (text.includes("@")) return text;
  if (text.length <= 8) return text || "missing";
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}
