// ============================================================================
// config.js
//
// Single source of truth for event-specific values. Update this file (and
// TIME_SLOTS / SENATORS below) each semester instead of hunting for hard-coded
// values throughout the codebase.
//
// NOTE: None of the values in this file are secret. Security comes from
// Firestore Security Rules and (in production) a trusted backend, not from
// hiding configuration values in the client.
// ============================================================================

export const CONFIG = {
  bloodDriveId: "chs-fall-2026",
  bloodDriveDate: "2026-09-04", // ISO date (local, no time component), Friday, Sept 4, 2026
  eventName: "CHS Fall Blood Drive",
  location: "Fieldhouse",
  slotsStart: "0800", // 8:00 AM
  slotsEnd: "1430", // 2:30 PM
  slotCapacity: 10,
  // Bump this whenever the registration document shape changes. Firestore
  // rules and any future backend should reject documents with an unexpected
  // schemaVersion.
  schemaVersion: 2,
  minimumAge: 16,
  studentIdLength: 9,
};

// Known school email domain(s). This is a CONVENIENCE check only; it warns
// students who accidentally enter their school email instead of a personal
// one. It is NOT a security control and must never be relied on as the sole
// safeguard against a school-domain address reaching the database.
export const SCHOOL_EMAIL_DOMAINS = ["carmelclayschools.org", "students.ccs.k12.in.us"];

// Sample/fictional senator roster for the MVP. In a future version this
// should be loaded from an approved, district-reviewed configuration source
// (e.g. a read-only Firestore collection or remote config) instead of being
// hard-coded here. Keep the shape the same ({ id, name }) so the rest of the
// app does not need to change when that happens.
export const SENATORS = [
  { id: "alex-patel", name: "Alex Patel" },
  { id: "daniel-kim", name: "Daniel Kim" },
  { id: "maya-shah", name: "Maya Shah" },
  { id: "priya-desai", name: "Priya Desai" },
  { id: "sarah-chen", name: "Sarah Chen" },
];

/**
 * Builds the appointment-slot list from CONFIG.slotsStart to CONFIG.slotsEnd
 * (inclusive) in 15-minute increments. Keeping this generated, rather than
 * hand-typed, means the drive hours only ever need to change in one place.
 */
function buildTimeSlots() {
  const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2));
  const startMinutes = toMinutes(CONFIG.slotsStart);
  const endMinutes = toMinutes(CONFIG.slotsEnd);

  const slots = [];
  for (let m = startMinutes; m <= endMinutes; m += 15) {
    const hour24 = Math.floor(m / 60);
    const minute = m % 60;
    const id = `${String(hour24).padStart(2, "0")}${String(minute).padStart(2, "0")}`;
    const period = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    const label = `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
    slots.push({ id, label, capacity: CONFIG.slotCapacity });
  }
  return slots;
}

// Generated appointment slots with a starting capacity. The `capacity` value
// is a display default only; see app.js and firestore.rules for how real
// capacity is meant to be tracked (a dedicated, non-PII slotCounts document
// per slot, updated only via a validated, atomic transition).
export const TIME_SLOTS = buildTimeSlots();
