# Carmel High School Student Senate — Blood Drive Registration (MVP)

> **Status: PROTOTYPE. Not yet approved for real student data.**
> This system must not collect real student information until it has been
> reviewed and approved by the appropriate Carmel Clay Schools technology
> and privacy personnel.

## 1. Project Overview

This is a minimal, single-page registration form intended to replace the
previous Jotform / SignUpGenius blood-drive signup workflow. It is built
with plain HTML, CSS, and vanilla JavaScript (ES modules) and uses Firebase
(Authentication + Firestore) for data storage. There is no framework, no
build step, and no student-facing accounts, dashboard, or login screen.

## 2. Student-Facing Workflow

1. Student opens the URL and immediately sees the registration form (no
   homepage, nav bar, or marketing content).
2. Student fills in their information, confirms eligibility, selects the
   senator(s) who helped them sign up, and picks an open appointment slot.
3. Student submits the form.
4. Student sees a confirmation screen with only the details they need
   (name, drive, date, location, appointment, senator(s), confirmation ID)
   and can print it or register another student.

Students under 16 (as of the blood-drive date) cannot submit the form.
Students who will be exactly 16 on the blood-drive date are shown a
parent/guardian consent notice and a placeholder consent-form download.

## 3. Firebase Architecture

```
Student Browser (index.html / app.js / firebase-init.js)
        |
        v
Firebase Anonymous Authentication  ── required before any Firestore write
        |
        v
Firestore (MVP: direct client transaction, see Section 17 below)
        |
        +--> slotCounts/{bloodDriveId}_{slotId}   (read + narrowly validated increment)
        +--> registrations/{autoId}               (create-only, narrowly validated)
```

Files:

| File | Purpose |
|---|---|
| `index.html` | Markup for the form and confirmation view. |
| `style.css` | All styling. |
| `config.js` | Single source of truth for event details, senators, and time slots. |
| `firebase-init.js` | Firebase app/auth/analytics initialization only — no UI logic. |
| `app.js` | Form rendering, validation, eligibility logic, and submission. |
| `firestore.rules` | Authoritative server-side access control (see Section 5). |
| `firestore.indexes.json` | Intentionally empty — see Section 11. |
| `firebase.json` | Firebase Hosting + Firestore deployment configuration. |
| `assets/parent-consent-placeholder.txt` | Placeholder only — **not** an official consent form. |

## 4. Firestore Schema

### `registrations/{autoId}`

Document ID is a Firestore auto-generated ID (opaque, random) — **never**
the student's Student ID, email, or any other identifying value.

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | number | Must equal `1`. Bump on any shape change. |
| `bloodDriveId` | string | e.g. `"fall-2026"`. |
| `bloodDriveDate` | string | `YYYY-MM-DD`. |
| `location` | string | e.g. `"Carmel High School"`. |
| `legalName` | string | |
| `studentEmail` | string | Personal email, not school email (best-effort client check only). |
| `parentEmail` | string | |
| `phone` | string | |
| `dob` | string | `YYYY-MM-DD`. |
| `studentId` | string | Never used as a document ID or exposed in a URL. |
| `senatorIds` | array&lt;string&gt; | 1–6 entries. |
| `appointmentSlotId` | string | e.g. `"1015"`. |
| `ageOnDriveDate` | number | Client-computed; rules only sanity-check the range. **Not authoritative** — see Section 12. |
| `parentConsentStatus` | string | `"required"` or `"not_required"`. |
| `eligibilityAgeConfirmed` | boolean | Must be `true`. |
| `eligibilityNoFallSportConfirmed` | boolean | Must be `true`. |
| `createdAt` | timestamp | Server timestamp; rules require it to equal `request.time`. |

Deliberately **not** collected: IP address, browser fingerprint, device ID,
passwords, medical/screening information, blood type, or any analytics
identifiers tied to a specific student. See Section 8.

### `slotCounts/{bloodDriveId}_{slotId}`

Non-PII capacity counters, pre-seeded by an administrator (see Section 9).

| Field | Type | Notes |
|---|---|---|
| `bloodDriveId` | string | |
| `slotId` | string | |
| `label` | string | e.g. `"10:15 AM"`. |
| `capacity` | number | Fixed at seed time; clients cannot change it. |
| `count` | number | Only mutable via a validated +1 increment (see rules). |

## 5. Security Model (MVP)

- **No public reads.** `registrations` cannot be read by anyone from the
  client — not the submitting student, not another student, not an
  anonymous visitor. `allow read: if false;` is unconditional.
- **No updates or deletes** of `registrations` from the client, ever.
- **Narrowly validated create only.** A `registrations` document can only
  be created if it is authenticated (anonymous auth counts) and matches an
  exact allow-listed field set, correct types, length bounds, an
  `ageOnDriveDate` sanity range, both eligibility booleans `true`, the
  current `schemaVersion`, and a server-set `createdAt`. Unexpected fields
  are rejected outright (`hasOnly(...)`).
- **`slotCounts` is intentionally separate** from `registrations` so the UI
  can show live "spots left" without any read access to student data. It
  contains no PII. Clients can only increment `count` by exactly 1, never
  past `capacity`, and cannot touch any other field — enforced by
  `firestore.rules`, not by client trust.
- **Default deny everything else**: `match /{document=**} { allow read,
  write: if false; }`.
- **No admin dashboard exists in this codebase.** There is no `/admin`
  route, no admin UI, and no rule that grants any authenticated user broad
  read access (a rule like `allow read: if request.auth != null;` on
  `registrations` would let *every* anonymous visitor read *every*
  student's data — this repository deliberately does not do that).

## 6. FERPA / Privacy Limitations

This application is designed with privacy and least-privilege principles,
but **the code alone does not establish FERPA compliance**. FERPA
compliance and district approval depend on the school's policies,
contracts, data practices, access controls, retention policies, vendor
relationships, and administrative safeguards. This system must not collect
real student information until reviewed and approved by the appropriate
Carmel Clay Schools technology/privacy personnel.

This system is **designed to support district privacy requirements** — it
is not, and does not claim to be, "FERPA compliant" on its own.

## 7. App Check Setup (Production-Only Placeholder)

`firebase-init.js` contains a placeholder App Check initialization using
`ReCaptchaEnterpriseProvider("REPLACE_WITH_APP_CHECK_SITE_KEY")`. Before
production use:

1. Create a reCAPTCHA Enterprise (or district-approved) App Check provider
   for the approved production domain in the Firebase console.
2. Replace the placeholder site key.
3. Enforce App Check on Firestore in the Firebase console (App Check →
   APIs → Firestore → Enforce).

App Check reduces abuse (bots, scripted requests) but is **not** a
replacement for Firestore Security Rules — both are required.

## 8. Authentication Setup

- Enable **Anonymous** sign-in under Firebase Authentication → Sign-in
  method.
- The anonymous user is granted exactly one capability by
  `firestore.rules`: creating a schema-valid `registrations` document (plus
  reading/incrementing `slotCounts`). It cannot read anything back.
- There are no student accounts, no passwords, and no login screen.
- Re-evaluate with district technology staff whether anonymous auth is the
  right long-term choice, or whether a district-issued identity should
  gate access instead.

## 9. Firestore Setup

1. Create/select the Firebase project referenced in `firebase-init.js`
   (`blood-drive-test`) or your own project, and update the config there.
2. Enable Firestore in Native mode.
3. **Seed `slotCounts` documents before opening registration.** For each
   entry in `TIME_SLOTS` (see `config.js`), create a document at
   `slotCounts/{bloodDriveId}_{slotId}` with:
   ```json
   { "bloodDriveId": "fall-2026", "slotId": "0900", "label": "9:00 AM", "capacity": 4, "count": 0 }
   ```
   This can be done via the Firebase console or a one-time authenticated
   admin script — **never** from this public client, and never with the
   Admin SDK's credentials embedded in frontend code.
4. Set the real Firebase Web API key in `firebase-init.js` (this value is
   not a secret — see the comment in that file for why).

## 10. Rules Deployment

```bash
firebase deploy --only firestore:rules
```

Review `firestore.rules` with district technology staff before deploying
against a project containing real student data.

## 11. Local Testing

```bash
pnpm install
pnpm dev
```

This serves the static files with `http-server` (no build step). Because
the client never queries `registrations` and only fetches `slotCounts` by
direct document ID, **no composite indexes are required** —
`firestore.indexes.json` is intentionally empty. If a future change adds a
query (e.g. an approved admin export), document why each new index exists
in this file's comments before adding it.

To test the full flow, seed at least one `slotCounts` document (Section 9),
open the page, fill out the form with **fictional data only** (see Section
16), and submit.

## 12. Production Requirements

This MVP is a *starting point*, not a production-ready system. Before real
students use it:

- **Trusted backend (Cloud Function).** Treat the client-side Firestore
  transaction in `app.js` (`reserveSlotAndCreateRegistration`) as an
  MVP-appropriate mechanism for atomic slot reservation — it does prevent
  two students from claiming the same last slot — but a Cloud Function
  should become the authoritative registration endpoint so that:
  - eligibility (age) is independently recalculated server-side from `dob`
    and the configured blood-drive date, never trusting the client's
    `ageOnDriveDate`;
  - duplicate registrations are detected (the client cannot do this — it
    has no read access to `registrations`);
  - requests are rate-limited;
  - Firebase App Check is enforced at the function boundary.
- **App Check** must be configured with a real site key and enforced
  (Section 7).
- **District-approved authentication model** should be reassessed — is
  anonymous auth acceptable, or does the district require something else?
- **Retention policy** must be defined by the district (Section 13).
- **Official consent form** must replace the placeholder in `assets/`
  (Section 14).

## 13. Data Retention Considerations

Retention period to be determined and approved by Carmel Clay Schools.
Before production use, the district must decide and document:

- How long registration records are retained.
- When and how records are deleted.
- Who is authorized to access them (and how that access is enforced).
- How backups are handled and how long they persist.
- How/whether any export process works (e.g. to a school-controlled Google
  Sheet — see Section 15) and what happens to exported copies.
- What happens to the data after the blood drive concludes.
- Whether the blood-drive provider (e.g. the Red Cross) receives any
  information, and under what data-sharing agreement.
- Whether parent/guardian consent records are stored separately from this
  system, and if so, where and under what retention rules.

## 14. Admin Access Considerations

This MVP intentionally ships **no admin dashboard or `/admin` route**. If
one is built in the future, it must, at minimum:

- Use district-approved authentication (not anonymous auth).
- Use role-based access with least-privilege custom claims.
- Never grant blanket `allow read: if request.auth != null;` on
  `registrations` — that would let every authenticated user (including
  every student, if students ever get accounts) read every other student's
  record.
- Log administrative access (audit logging) without logging student PII in
  those logs any more than necessary.
- Never be reachable by anonymous or public traffic.

## 15. Future Google Sheets Integration

Not implemented in this MVP. When approved, the intended design is: a
school-controlled, server-side process (e.g. a Cloud Function using a
Google service account with least-privilege scope) reads *only the
approved fields* from Firestore and writes them to a school-controlled
Google Sheet. Google service-account credentials and Apps Script secrets
must never be placed in frontend JavaScript, and no public endpoint should
ever accept arbitrary student data destined for a spreadsheet.

## 16. Future Notification Integration

Not implemented in this MVP. `studentEmail`, `parentEmail`, and `phone` are
captured so that a future, separately-approved notification system
(reminders, confirmations, etc.) could use them — but this codebase does
not send any email or SMS today. Any such system requires its own school
approval before going live.

## 17. Appointment Transaction Requirements

`app.js` uses a single Firestore `runTransaction()` that:

1. Reads the current `slotCounts` document for the requested slot.
2. Rejects if the slot document doesn't exist or is already at capacity
   (`SLOT_FULL` / `SLOT_UNAVAILABLE`), which the UI surfaces as
   *"That appointment just filled up. Please choose another time."*
3. Otherwise increments `count` by 1 and creates the `registrations`
   document — both writes commit atomically, or neither does.

`firestore.rules` independently re-validates the increment (exactly +1,
never past `capacity`, no other field changed) and the registration schema,
so this guarantee does not depend on trusting the browser. As noted in
Section 12, production should still move final authority to a Cloud
Function for rate limiting and duplicate detection that rules alone cannot
provide.

## 18. Security Checklist

- [x] No public Firestore reads (`registrations`: `allow read: if false;`)
- [x] No public Firestore writes without validation (create is schema-validated; update/delete are `false`)
- [x] No `allow read, write: if true` anywhere
- [x] No admin credentials in frontend
- [x] No service-account keys in frontend
- [x] No PII in URLs (confirmation ID is an opaque Firestore document ID)
- [x] No PII in console logs
- [x] No PII in Analytics (allow-listed, parameter-free event names only)
- [x] No PII in `localStorage`
- [x] No PII in `sessionStorage`
- [x] No medical information collected
- [x] No student data in public configuration (`config.js` has no student data)
- [x] No student data in page source except what the current user typed
- [x] No raw Firebase errors shown to students
- [x] No `innerHTML` with user-controlled data (`textContent` throughout)
- [x] Anonymous users cannot read registrations
- [x] Anonymous users cannot modify registrations
- [x] Anonymous users cannot delete registrations
- [x] Students cannot access other students' information
- [x] Admin access is not publicly exposed (no admin UI exists in this MVP)
- [x] Appointment capacity cannot be bypassed by manipulating frontend JavaScript (enforced by `firestore.rules`, not just `app.js`)
- [ ] Production architecture includes server-side validation *(Cloud Function — not yet built; see Section 12)*
- [ ] Production architecture includes App Check enforcement *(placeholder site key only; see Section 7)*
- [ ] Production architecture includes rate limiting *(requires a backend; not possible from rules alone)*
- [x] Production architecture uses atomic appointment reservation *(implemented via Firestore transaction + rules; see Section 17)*
- [ ] Duplicate registrations are handled server-side *(not possible from an anonymous client with no read access; requires Section 12's Cloud Function)*
- [ ] Retention policy is explicitly determined before production *(Section 13)*
- [ ] District technology/privacy approval is required before real student data is collected

## 19. District Approval Checklist

Before this system collects any real student data, confirm with Carmel
Clay Schools technology/privacy staff:

- [ ] Firestore Security Rules have been reviewed line-by-line.
- [ ] A production backend (Cloud Function) has been built for rate
      limiting, duplicate detection, and authoritative eligibility
      re-verification.
- [ ] Firebase App Check is configured with a real site key and enforced.
- [ ] The Firebase project's IAM/service-account access is restricted to
      approved district/IT staff only.
- [ ] A data retention and deletion policy has been documented and
      approved.
- [ ] The official parent/guardian consent form and return process have
      replaced the placeholder in `assets/`.
- [ ] Any future Google Sheets export or email/SMS notification feature
      has been separately reviewed and approved.
- [ ] Backup, export, and incident-response procedures have been defined.
- [ ] The blood-drive provider's data-handling agreement (if any) has been
      reviewed.

---

**Sample data note:** any names/emails referenced in code comments or
manual testing (e.g. "Alex Johnson", `alex.personal@example.com`) are
fictional and for testing only. Never enter real student data into this
prototype.
