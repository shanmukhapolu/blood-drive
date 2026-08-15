// ============================================================================
// app.js
//
// UI + form logic for the blood drive registration form. Firebase
// initialization lives in firebase-init.js; this file only orchestrates the
// DOM and talks to the exported Firebase helpers.
//
// SECURITY REMINDERS (see README.md for the full model):
//   - Never insert user-entered text with innerHTML. Use textContent.
//   - Never log student PII to the console.
//   - Never put student PII into the URL, localStorage, or sessionStorage.
//   - The client-side age/eligibility checks below are UX only. The
//     authoritative check happens in firestore.rules, and, in production,
//     must be re-verified by a trusted backend.
// ============================================================================

import { CONFIG, SCHOOL_EMAIL_DOMAINS, SENATORS, TIME_SLOTS } from "./config.js";
import { db, logSafeEvent } from "./firebase-init.js";
import {
  doc,
  getDoc,
  collection,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

// ----------------------------------------------------------------------------
// DOM references
// ----------------------------------------------------------------------------
const form = document.getElementById("registration-form");
const confirmationView = document.getElementById("confirmation-view");
const statusLive = document.getElementById("status-live");

const ineligibleBanner = document.getElementById("ineligible-banner");
const consentBanner = document.getElementById("consent-banner");

const senatorGroup = document.getElementById("senator-group");
const slotGrid = document.getElementById("slot-grid");

const submitBtn = document.getElementById("submit-btn");
const errSubmit = document.getElementById("err-submit");

// ----------------------------------------------------------------------------
// Module state (in-memory only; never persisted to browser storage)
// ----------------------------------------------------------------------------
let selectedSlotId = null;
let slotAvailability = {}; // { [slotId]: { capacity, count } }
let submissionInFlight = false;

// ============================================================================
// Pure helper functions
// ============================================================================

/**
 * Calculates a person's age as of a specific date (NOT the current date).
 * Both inputs are "YYYY-MM-DD" strings and are parsed as UTC calendar dates
 * to avoid timezone-related off-by-one errors.
 * @param {string} dob - date of birth, "YYYY-MM-DD"
 * @param {string} onDate - the date to calculate age as of, "YYYY-MM-DD"
 * @returns {number|null} age in whole years, or null if inputs are invalid
 */
export function calculateAgeOnDate(dob, onDate) {
  const dobParts = parseIsoDate(dob);
  const refParts = parseIsoDate(onDate);
  if (!dobParts || !refParts) return null;

  let age = refParts.year - dobParts.year;
  const hasHadBirthdayThisYear =
    refParts.month > dobParts.month ||
    (refParts.month === dobParts.month && refParts.day >= dobParts.day);

  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

function parseIsoDate(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function formatDisplayDate(isoDate, { weekday = false } = {}) {
  const parts = parseIsoDate(isoDate);
  if (!parts) return isoDate;
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return d.toLocaleDateString("en-US", {
    ...(weekday ? { weekday: "long" } : {}),
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function isLikelyValidEmail(value) {
  // Intentionally simple syntax check, not a full RFC 5322 validator.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Convenience-only check for a known school email domain. NOT a security
 * control; see SCHOOL_EMAIL_DOMAINS in config.js.
 */
function formatPhoneNumber(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function normalizePhoneInput(event) {
  event.target.value = formatPhoneNumber(event.target.value);
}

function isSchoolDomainEmail(value) {
  const at = value.lastIndexOf("@");
  if (at === -1) return false;
  const domain = value.slice(at + 1).trim().toLowerCase();
  return SCHOOL_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

// ============================================================================
// Rendering
// ============================================================================

function renderHeader() {
  document.getElementById("fact-date").textContent = formatDisplayDate(CONFIG.bloodDriveDate, { weekday: true });

  const firstSlot = TIME_SLOTS[0];
  const lastSlot = TIME_SLOTS[TIME_SLOTS.length - 1];
  document.getElementById("fact-time").textContent =
    firstSlot && lastSlot ? `${firstSlot.label} – ${lastSlot.label}` : "";

  document.getElementById("fact-location").textContent = CONFIG.location;
}

function renderSenatorOptions() {
  senatorGroup.textContent = "";
  for (const senator of SENATORS) {
    const label = document.createElement("label");
    label.className = "senator-chip";
    label.setAttribute("for", `senator-${senator.id}`);

    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `senator-${senator.id}`;
    input.name = "senators";
    input.value = senator.id;
    input.addEventListener("change", () => {
      label.classList.toggle("checked", input.checked);
    });

    const text = document.createElement("span");
    text.textContent = senator.name; // textContent only; never innerHTML

    label.appendChild(input);
    label.appendChild(text);
    senatorGroup.appendChild(label);
  }
}

function renderAppointmentSlots() {
  slotGrid.textContent = "";
  for (const slot of TIME_SLOTS) {
    const availability = slotAvailability[slot.id] || { capacity: slot.capacity, count: 0 };
    const remaining = Math.max(0, availability.capacity - availability.count);
    const isFull = remaining <= 0;
    const isSelected = selectedSlotId === slot.id;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot-btn" + (isSelected ? " selected" : "");
    btn.disabled = isFull;
    btn.setAttribute("aria-pressed", String(isSelected));
    btn.dataset.slotId = slot.id;

    const timeEl = document.createElement("span");
    timeEl.textContent = slot.label;

    const subEl = document.createElement("span");
    subEl.className = "slot-sub";
    if (isFull) {
      subEl.textContent = "Full";
    } else if (isSelected) {
      subEl.textContent = "✓ Selected";
    } else {
      subEl.textContent = `${remaining} spot${remaining === 1 ? "" : "s"} left`;
    }

    btn.appendChild(timeEl);
    btn.appendChild(subEl);

    if (!isFull) {
      btn.addEventListener("click", () => {
        selectedSlotId = slot.id;
        renderAppointmentSlots();
        setError("err-slot", "");
      });
    }

    slotGrid.appendChild(btn);
  }
}

/**
 * Best-effort read of current slot capacity/count for display purposes only.
 * This is NOT the security boundary; the atomic check happens inside the
 * Firestore transaction in reserveSlotAndCreateRegistration(). If this read
 * fails (e.g. offline, not yet seeded), slots fall back to showing their
 * configured capacity with zero recorded registrations.
 */
async function loadSlotAvailability() {
  const results = await Promise.allSettled(
    TIME_SLOTS.map(async (slot) => {
      const ref = doc(db, "slotCounts", slotDocId(slot.id));
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        return [slot.id, { capacity: data.capacity, count: data.count }];
      }
      return [slot.id, { capacity: slot.capacity, count: 0 }];
    })
  );

  const next = {};
  for (const result of results) {
    if (result.status === "fulfilled") {
      const [slotId, availability] = result.value;
      next[slotId] = availability;
    }
  }
  slotAvailability = next;
  renderAppointmentSlots();
}

function slotDocId(slotId) {
  return `${CONFIG.bloodDriveId}_${slotId}`;
}

// ============================================================================
// Eligibility
// ============================================================================

function updateEligibilityUI() {
  const dobValue = document.getElementById("dob").value;
  const result = validateEligibility(dobValue);

  ineligibleBanner.classList.toggle("hidden", result.status !== "ineligible");
  consentBanner.classList.toggle("hidden", result.status !== "consent-required");

  const disableSubmission = result.status === "ineligible" && dobValue !== "";
  submitBtn.disabled = disableSubmission || submissionInFlight;

  if (result.status === "ineligible" && dobValue !== "") {
    logSafeEvent("blood_drive_ineligible_blocked");
  }

  return result;
}

/**
 * Independently determines eligibility from date of birth. This result is
 * authoritative over the checkboxes; a checked eligibility checkbox can
 * never override an under-16 date of birth.
 * @param {string} dobValue - "YYYY-MM-DD"
 * @returns {{status: "invalid"|"ineligible"|"consent-required"|"eligible", age: number|null}}
 */
export function validateEligibility(dobValue) {
  const age = calculateAgeOnDate(dobValue, CONFIG.bloodDriveDate);
  if (age === null) return { status: "invalid", age: null };
  if (age < CONFIG.minimumAge) return { status: "ineligible", age };
  if (age === CONFIG.minimumAge) return { status: "consent-required", age };
  return { status: "eligible", age };
}

// ============================================================================
// Validation
// ============================================================================

function setError(fieldId, message) {
  const el = document.getElementById(`err-${fieldId}`);
  if (el) el.textContent = message || "";

  const input = document.getElementById(fieldId);
  if (input) {
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
}

function clearAllErrors() {
  document.querySelectorAll(".error").forEach((el) => {
    el.textContent = "";
  });
  document.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
}

/**
 * Validates the full form. Returns a plain object describing validity and
 * a normalized payload safe to submit. Never throws.
 */
export function validateForm(formEl, currentSelectedSlotId) {
  const firstName = formEl.firstName.value.trim();
  const lastName = formEl.lastName.value.trim();
  const studentEmail = formEl.studentEmail.value.trim();
  const parentEmail = formEl.parentEmail.value.trim();
  const phone = formatPhoneNumber(formEl.phone.value);
  const dob = formEl.dob.value;
  const studentId = formEl.studentId.value.trim();
  const nhsSenior = formEl.nhsSenior.checked;
  const eligAge = formEl.eligAge.checked;
  const eligNoSport = formEl.eligNoSport.checked;
  const selectedSenators = Array.from(formEl.querySelectorAll('input[name="senators"]:checked')).map(
    (el) => el.value
  );

  let valid = true;

  if (!firstName || firstName.length < 2) {
    setError("firstName", "Enter the student's first name.");
    valid = false;
  }

  if (!lastName || lastName.length < 2) {
    setError("lastName", "Enter the student's last name.");
    valid = false;
  }

  if (!studentEmail || !isLikelyValidEmail(studentEmail)) {
    setError("studentEmail", "Enter a valid email address.");
    valid = false;
  } else if (isSchoolDomainEmail(studentEmail)) {
    setError("studentEmail", "Please use a personal email address, not your school email.");
    valid = false;
  }

  if (!parentEmail || !isLikelyValidEmail(parentEmail)) {
    setError("parentEmail", "Enter a valid parent/guardian email address.");
    valid = false;
  }

  if (!phone || phone.replace(/\D/g, "").length !== 10) {
    setError("phone", "Enter a valid 10-digit phone number.");
    valid = false;
  } else {
    formEl.phone.value = phone;
  }

  const eligibility = validateEligibility(dob);
  if (eligibility.status === "invalid") {
    setError("dob", "Enter a valid date of birth.");
    valid = false;
  } else if (eligibility.status === "ineligible") {
    setError("dob", "You must be at least 16 years old on the blood-drive date.");
    valid = false;
  }

  if (!/^\d{9}$/.test(studentId)) {
    setError("studentId", "Enter your 9-digit student ID number.");
    valid = false;
  }

  if (!eligAge) {
    setError("eligAge", "You must confirm this to register.");
    valid = false;
  }
  if (!eligNoSport) {
    setError("eligNoSport", "You must confirm this to register.");
    valid = false;
  }

  if (selectedSenators.length === 0) {
    setError("senators", "Select at least one senator who assisted you.");
    valid = false;
  }

  if (!currentSelectedSlotId) {
    setError("slot", "Choose an available appointment time.");
    valid = false;
  }

  return {
    valid,
    eligibility,
    payload: {
      firstName,
      lastName,
      studentEmail,
      parentEmail,
      phone,
      dob,
      studentId,
      senatorIds: selectedSenators,
      appointmentSlotId: currentSelectedSlotId,
      eligibilityAgeConfirmed: eligAge,
      eligibilityNoFallSportConfirmed: eligNoSport,
      nhsSeniorMember: nhsSenior,
    },
  };
}

// ============================================================================
// Submission
// ============================================================================

/**
 * Atomically reserves capacity and creates the registration document in a
 * single Firestore transaction. If a slotCounts document has not been seeded
 * yet, the first valid registration initializes it with count 1 so registration
 * is not blocked by setup lag; concurrent students still cannot overbook.
 *
 * IMPORTANT (see README "Production Requirements"): this client-side
 * transaction is an MVP-appropriate mechanism, but the ultimate trust
 * boundary for production must be a Cloud Function that re-validates
 * eligibility, rate-limits requests, and performs duplicate detection that
 * the public client is not permitted to do (it cannot read `registrations`
 * at all).
 */
async function reserveSlotAndCreateRegistration(payload) {
  const slotRef = doc(db, "slotCounts", slotDocId(payload.appointmentSlotId));
  const registrationRef = doc(collection(db, "registrations"));

  await runTransaction(db, async (tx) => {
    const slotSnap = await tx.get(slotRef);
    if (!slotSnap.exists()) {
      const slot = TIME_SLOTS.find((s) => s.id === payload.appointmentSlotId);
      if (!slot) {
        throw new Error("SLOT_UNAVAILABLE");
      }

      tx.set(slotRef, {
        bloodDriveId: CONFIG.bloodDriveId,
        slotId: slot.id,
        label: slot.label,
        capacity: slot.capacity,
        count: 1,
      });
      tx.set(registrationRef, buildRegistrationRecord(payload));
      return;
    }
    const slotData = slotSnap.data();
    if (typeof slotData.capacity !== "number" || typeof slotData.count !== "number") {
      throw new Error("SLOT_UNAVAILABLE");
    }
    if (slotData.count >= slotData.capacity) {
      throw new Error("SLOT_FULL");
    }

    tx.update(slotRef, { count: slotData.count + 1 });
    tx.set(registrationRef, buildRegistrationRecord(payload));
  });

  return registrationRef.id;
}

function buildRegistrationRecord(payload) {
  return {
    schemaVersion: CONFIG.schemaVersion,
    bloodDriveId: CONFIG.bloodDriveId,
    bloodDriveDate: CONFIG.bloodDriveDate,
    location: CONFIG.location,
    firstName: payload.firstName,
    lastName: payload.lastName,
    studentEmail: payload.studentEmail,
    parentEmail: payload.parentEmail,
    phone: payload.phone,
    dob: payload.dob,
    studentId: payload.studentId,
    senatorIds: payload.senatorIds,
    appointmentSlotId: payload.appointmentSlotId,
    ageOnDriveDate: payload.eligibility.age,
    parentConsentStatus: payload.eligibility.status === "consent-required" ? "required" : "not_required",
    eligibilityAgeConfirmed: payload.eligibilityAgeConfirmed,
    eligibilityNoFallSportConfirmed: payload.eligibilityNoFallSportConfirmed,
    nhsSeniorMember: payload.nhsSeniorMember,
    createdAt: serverTimestamp(),
  };
}

async function submitRegistration(event) {
  event.preventDefault();
  if (submissionInFlight) return;

  clearAllErrors();
  setError("submit", "");

  const { valid, eligibility, payload } = validateForm(form, selectedSlotId);
  if (!valid) {
    announce("Please fix the highlighted fields before submitting.");
    return;
  }

  submissionInFlight = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "Registering…";

  try {
    logRegistrationStep("Submitting registration transaction");
    const confirmationId = await reserveSlotAndCreateRegistration({ ...payload, eligibility });
    logRegistrationStep("Registration transaction completed");

    logSafeEvent("blood_drive_registration_success");
    showConfirmation({
      firstName: payload.firstName,
      lastName: payload.lastName,
      senatorIds: payload.senatorIds,
      appointmentSlotId: payload.appointmentSlotId,
      parentConsentRequired: eligibility.status === "consent-required",
      confirmationId,
    });
  } catch (error) {
    logSafeEvent("blood_drive_registration_error");
    handleSubmissionError(error);
  } finally {
    submissionInFlight = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Register for the Blood Drive";
  }
}

function handleSubmissionError(error) {
  // Never surface raw Firebase error internals to the student.
  const code = error && (error.code || error.message);
  logRegistrationStep("Registration failed", { code: code || "unknown" });

  if (code === "permission-denied") {
    setError(
      "submit",
      "Registration could not be saved because Firebase permissions blocked the request. Please ask the organizers to deploy the latest Firestore rules."
    );
    announce("Registration could not be saved because Firebase permissions blocked the request.");
    return;
  }

  if (code === "SLOT_FULL" || code === "SLOT_UNAVAILABLE") {
    setError("slot", "That appointment just filled up. Please choose another time.");
    loadSlotAvailability();
    announce("That appointment just filled up. Please choose another time.");
    return;
  }

  setError(
    "submit",
    "We could not complete your registration. Please try again or contact the blood-drive organizers."
  );
  announce("We could not complete your registration. Please try again.");
}

function logRegistrationStep(message, details = {}) {
  // Safe diagnostics only. Do not include names, emails, phone numbers, DOB, or student IDs.
  console.info("[blood-drive-registration]", message, details);
}

function announce(message) {
  // Non-PII status text only.
  statusLive.textContent = message;
}

// ============================================================================
// Confirmation view
// ============================================================================

function showConfirmation({ firstName, lastName, senatorIds, appointmentSlotId, parentConsentRequired, confirmationId }) {
  document.body.classList.add("confirmation-mode");
  form.classList.add("hidden");
  confirmationView.classList.remove("hidden");

  const slot = TIME_SLOTS.find((s) => s.id === appointmentSlotId);
  const senatorNames = senatorIds
    .map((id) => SENATORS.find((s) => s.id === id)?.name)
    .filter(Boolean)
    .join(", ");

  setText("sum-student", `${firstName} ${lastName}`);
  setText("sum-date", formatDisplayDate(CONFIG.bloodDriveDate, { weekday: true }));
  setText("sum-location", CONFIG.location);
  setText("sum-slot", slot ? slot.label : "");
  setText("sum-senators", senatorNames);
  setText("sum-confid", confirmationId);

  document.getElementById("consent-download-block").classList.toggle("hidden", !parentConsentRequired);

  confirmationView.setAttribute("tabindex", "-1");
  confirmationView.focus();
}

function setText(id, value) {
  document.getElementById(id).textContent = value; // textContent only; never innerHTML
}

function resetForm() {
  form.reset();
  selectedSlotId = null;
  clearAllErrors();
  ineligibleBanner.classList.add("hidden");
  consentBanner.classList.add("hidden");
  document.querySelectorAll(".senator-chip.checked").forEach((el) => el.classList.remove("checked"));

  document.body.classList.remove("confirmation-mode");
  confirmationView.classList.add("hidden");
  form.classList.remove("hidden");

  loadSlotAvailability();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ============================================================================
// Wiring
// ============================================================================

function init() {
  renderHeader();
  renderSenatorOptions();
  renderAppointmentSlots();

  document.getElementById("phone").addEventListener("input", normalizePhoneInput);
  document.getElementById("dob").addEventListener("change", updateEligibilityUI);
  form.addEventListener("submit", submitRegistration);
  document.getElementById("print-btn").addEventListener("click", () => window.print());
  document.getElementById("reset-btn").addEventListener("click", resetForm);

  logSafeEvent("blood_drive_form_started");

  // Best-effort slot availability warm-up. Failures here must not block the
  // student from filling out the form. The submit transaction repeats the
  // capacity check before it writes anything.
  loadSlotAvailability().catch((error) => {
    logRegistrationStep("Slot availability warm-up failed", { code: error?.code || error?.message || "unknown" });
  });
}

document.addEventListener("DOMContentLoaded", init);
