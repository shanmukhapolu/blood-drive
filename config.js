// ============================================================================
// config.js
//
// Single source of truth for event-specific values. Update this file (and
// TIME_SLOTS / SENATORS below) each semester instead of hunting for hard-coded
// values throughout the codebase.
//
// NOTE: None of the values in this file are secret. Security comes from
// Firestore Security Rules and (in production) a trusted backend — not from
// hiding configuration values in the client.
// ============================================================================

export const CONFIG = {
  bloodDriveId: "fall-2026",
  bloodDriveDate: "2026-10-01", // ISO date (local, no time component)
  displayDate: "Fall 2026",
  location: "Carmel High School",
  // Bump this whenever the registration document shape changes. Firestore
  // rules and any future backend should reject documents with an unexpected
  // schemaVersion.
  schemaVersion: 1,
  minimumAge: 16,
};

// Known school email domain(s). This is a CONVENIENCE check only — it warns
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
  { id: "self", name: "I registered myself" },
];

// Sample appointment slots with a starting capacity. The `capacity` value is
// a display default only — see app.js and firestore.rules for how real
// capacity is meant to be tracked (a dedicated, non-PII slotCounts document
// per slot, updated only via a validated, atomic transition).
export const TIME_SLOTS = [
  { id: "0900", label: "9:00 AM", capacity: 4 },
  { id: "0915", label: "9:15 AM", capacity: 4 },
  { id: "0930", label: "9:30 AM", capacity: 4 },
  { id: "0945", label: "9:45 AM", capacity: 4 },
  { id: "1000", label: "10:00 AM", capacity: 4 },
  { id: "1015", label: "10:15 AM", capacity: 4 },
  { id: "1030", label: "10:30 AM", capacity: 4 },
  { id: "1045", label: "10:45 AM", capacity: 4 },
  { id: "1100", label: "11:00 AM", capacity: 4 },
  { id: "1115", label: "11:15 AM", capacity: 4 },
  { id: "1130", label: "11:30 AM", capacity: 4 },
  { id: "1145", label: "11:45 AM", capacity: 4 },
];
