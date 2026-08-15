# Carmel High School Blood Drive Registration (MVP)

> **Status: PROTOTYPE. Not yet approved for real student data.**
> This system must not collect real student information until it has been
> reviewed and approved by the appropriate Carmel Clay Schools technology
> and privacy personnel.

## 1. Project Overview

This is a minimal, single-page registration form intended to replace the
previous Jotform / SignUpGenius blood-drive signup workflow. It is built
with plain HTML, CSS, and vanilla JavaScript (ES modules) and uses Firebase
(Firestore) for data storage. There is no framework, no
build step, no Firebase Auth sign-up request, and no student-facing accounts, dashboard, or login screen.

## 2. Student-Facing Workflow

1. Student opens the URL and immediately sees the registration form (no
   homepage, nav bar, or marketing content).
2. Student fills in their information, confirms eligibility, selects the
   senator(s) who assisted you, and picks an open appointment slot.
3. Student submits the form.
4. Student sees a confirmation screen with only the details they need
   (name, date, location, appointment, senator(s) who assisted you, confirmation ID)
   and can print it or register another student.

Students under 16 (as of the blood-drive date) cannot submit the form.
Students who will be exactly 16 on the blood-drive date are shown a
parent/guardian consent notice and a placeholder consent-form download.

## 3. Firebase Architecture

```
Student Browser (index.html / app.js / firebase-init.js)
        |
        v
Firestore (MVP: direct client transaction, see Section 15 below)
        |
        +--> slotCounts/{bloodDriveId}_{slotId}   (read + narrowly validated increment)
        +--> registrations/{autoId}               (create-only, narrowly validated)
        |
        v
Cloud Function: releaseSlotOnRegistrationDelete
        +--> decrements slotCounts when an organizer deletes a registration
```

Files:

| File | Purpose |
|---|---|
| `index.html` | Markup for the form and confirmation view. |
| `style.css` | All styling. |
| `config.js` | Single source of truth for event details, senators, and time slots. |
| `firebase-init.js` | Firebase app/auth/analytics initialization only; no UI logic. |
| `app.js` | Form rendering, validation, eligibility logic, and submission. |
| `firestore.rules` | Authoritative server-side access control (see Section 5). |
| `firestore.indexes.json` | Firestore index configuration; simple admin reads use the single-field `createdAt` index. |
| `firebase.json` | Firebase Hosting, Firestore, and Functions deployment configuration. |
| `functions/` | Firebase Cloud Function that reopens a slot when its registration is deleted. |
| `assets/parent-consent-placeholder.txt` | Placeholder only; **not** an official consent form. |

## 4. Firestore Schema

### `registrations/{autoId}`

Document ID is a Firestore auto-generated ID (opaque, random); **never**
the student's Student ID, email, or any other identifying value.

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | number | Must equal `2`. Bump on any shape change. |
| `bloodDriveId` | string | e.g. `"chs-fall-2026"`. |
| `bloodDriveDate` | string | `YYYY-MM-DD`. |
| `location` | string | e.g. `"Fieldhouse"`. |
| `firstName` | string | |
| `lastName` | string | |
| `studentEmail` | string | Personal email, not school email (best-effort client check only). |
| `parentEmail` | string | |
| `phone` | string | |
| `dob` | string | `YYYY-MM-DD`. |
| `studentId` | string | Never used as a document ID or exposed in a URL. |
| `senatorIds` | array&lt;string&gt; | 1–6 entries. |
| `appointmentSlotId` | string | e.g. `"1015"`. |
| `ageOnDriveDate` | number | Client-computed; rules only sanity-check the range. **Not authoritative**; see Section 10. |
| `parentConsentStatus` | string | `"required"` or `"not_required"`. |
| `eligibilityAgeConfirmed` | boolean | Must be `true`. |
| `eligibilityNoFallSportConfirmed` | boolean | Must be `true`. |
| `nhsSeniorMember` | boolean | Whether the student selected the NHS senior option. |
| `createdAt` | timestamp | Server timestamp; rules require it to equal `request.time`. |

Deliberately **not** collected: IP address, browser fingerprint, device ID,
passwords, medical/screening information, blood type, or any analytics
identifiers tied to a specific student.

### `slotCounts/{bloodDriveId}_{slotId}`

Non-PII capacity counters, optionally pre-seeded by an administrator or initialized by the first valid reservation for a known appointment slot (see Section 7).

| Field | Type | Notes |
|---|---|---|
| `bloodDriveId` | string | |
| `slotId` | string | |
| `label` | string | e.g. `"10:15 AM"`. |
| `capacity` | number | Fixed at 10 by public-client creates; clients cannot change it after creation. |
| `count` | number | Starts at 1 for first-registration initialization, then increments on signup and is decremented by the delete trigger when an organizer removes a registration. |

## 5. Security Model (MVP)

- **No public reads.** `registrations` cannot be read by anyone from the
  client, not the submitting student, not another student, and not a
  public visitor. `allow read: if false;` is unconditional.
- **No updates or deletes** of `registrations` from the client, ever.
- **Narrowly validated create only.** A `registrations` document can only
  be created if it matches an
  exact allow-listed field set, correct types, length bounds, an
  `ageOnDriveDate` sanity range, both eligibility booleans `true`, the
  current `schemaVersion`, and a server-set `createdAt`. Unexpected fields
  are rejected outright (`hasOnly(...)`).
- **`slotCounts` is intentionally separate** from `registrations` so the UI
  can show live "spots left" without any read access to student data. It
  contains no PII. Clients can initialize a missing slot counter only as
  the first valid reservation for a known appointment slot (`count: 1`),
  then can only increment `count` by exactly 1, never past `capacity`, and
  cannot touch any other field; enforced by `firestore.rules`, not by
  client trust. When an organizer deletes a registration directly in
  Firestore, `releaseSlotOnRegistrationDelete` decrements the matching
  counter so that the appointment spot reopens.
- **Default deny everything else**: `match /{document=**} { allow read,
  write: if false; }`.
- **Simple admin dashboard.** The `/admin` pages use Firebase Auth and read
  `registrations` directly from Firestore after an admin profile with
  `role: "admin"` and `status: "enabled"` is found.

## 6. FERPA / Privacy Limitations

This application is designed with privacy and least-privilege principles,
but **the code alone does not establish FERPA compliance**. FERPA
compliance and district approval depend on the school's policies,
contracts, data practices, access controls, retention policies, vendor
relationships, and administrative safeguards. This system must not collect
real student information until reviewed and approved by the appropriate
Carmel Clay Schools technology/privacy personnel.

This system is **designed to support district privacy requirements**; it
is not, and does not claim to be, "FERPA compliant" on its own.

## 7. Firestore Setup

1. Create/select the Firebase project referenced in `firebase-init.js`
   (`blood-drive-test`) or your own project, and update the config there.
2. Enable Firestore in Native mode.
3. Optional: pre-seed `slotCounts` documents before opening registration if
   you want every slot to appear from the Firebase console immediately. If a
   counter is missing, the first valid registration for that slot creates it
   atomically with `count: 1`:
   ```json
   { "bloodDriveId": "chs-fall-2026", "slotId": "0900", "label": "9:00 AM", "capacity": 10, "count": 1 }
   ```
   Admin-created seed documents should use the same shape with `count: 0`.
   Never embed Admin SDK credentials in frontend code.
4. Set the real Firebase Web API key in `firebase-init.js` (this value is
   not a secret; see the comment in that file for why).

## 8. Rules Deployment

```bash
firebase deploy --only firestore:rules,functions
```

Review `firestore.rules` and the Cloud Function with district technology staff before deploying against a project containing real student data.

## 9. Local Testing

```bash
pnpm install
pnpm dev
```

This serves the static files with `http-server` (no build step). The student-facing client only reads `slotCounts`; the admin dashboard reads
`registrations` ordered by `createdAt`. This uses Firestore's normal
single-field index, so no composite index is required for the simple admin
view.

To test the full flow, open the page, fill out the form with **fictional data only**, and submit. Then delete that test registration from Firestore and confirm the matching `slotCounts` document decrements by 1 after the deployed `releaseSlotOnRegistrationDelete` function runs.

## 10. Production Requirements

This MVP is a *starting point*, not a production-ready system. Before real
students use it:

- **Trusted backend (Cloud Function).** Treat the client-side Firestore
  transaction in `app.js` (`reserveSlotAndCreateRegistration`) as an
  MVP-appropriate mechanism for atomic slot reservation; it does prevent
  two students from claiming the same last slot; but a Cloud Function
  should become the authoritative registration endpoint so that:
  - eligibility (age) is independently recalculated server-side from `dob`
    and the configured blood-drive date, never trusting the client's
    `ageOnDriveDate`;
  - duplicate registrations are detected (the client cannot do this; it
    has no read access to `registrations`);
  - requests are rate-limited;
- **District-approved access model** should be reassessed before production.
- **Retention policy** must be defined by the district (Section 11).
- **Official consent form** must replace the placeholder in `assets/`.

## 11. Data Retention Considerations

Retention period to be determined and approved by Carmel Clay Schools.
Before production use, the district must decide and document:

- How long registration records are retained.
- When and how records are deleted.
- Who is authorized to access them (and how that access is enforced).
- How backups are handled and how long they persist.
- How/whether any export process works (e.g. to a school-controlled Google
  Sheet; see Section 13) and what happens to exported copies.
- What happens to the data after the blood drive concludes.
- Whether the blood-drive provider (e.g. the Red Cross) receives any
  information, and under what data-sharing agreement.
- Whether parent/guardian consent records are stored separately from this
  system, and if so, where and under what retention rules.

## 12. Admin Access Considerations

The `/admin` route is intentionally simple. It signs in with Firebase Auth,
looks for an enabled admin profile, then pulls registration documents from
Firestore.

Admin access works when either of these documents exists:

- `admins/{firebaseAuthUid}`
- `admins/{exact-admin-email}`

The document must contain:

```json
{ "role": "admin", "status": "enabled" }
```

Self-service signup creates `admins/{firebaseAuthUid}` with
`status: "disabled"`. To enable the account, change that field to
`"enabled"` in Firebase Console and deploy the latest Firestore rules. The
simple dashboard pages are:

- `/admin/login.html`
- `/admin/`
- `/admin/registrations.html`
- `/admin/statistics.html`

## 13. Future Google Sheets Integration

Not implemented in this MVP. When approved, the intended design is: a
school-controlled, server-side process (e.g. a Cloud Function using a
Google service account with least-privilege scope) reads *only the
approved fields* from Firestore and writes them to a school-controlled
Google Sheet. Google service-account credentials and Apps Script secrets
must never be placed in frontend JavaScript, and no public endpoint should
ever accept arbitrary student data destined for a spreadsheet.

## 14. Future Notification Integration

Not implemented in this MVP. `studentEmail`, `parentEmail`, and `phone` are
captured so that a future, separately-approved notification system
(reminders, confirmations, etc.) could use them; but this codebase does
not send any email or SMS today. Any such system requires its own school
approval before going live.

## 15. Appointment Transaction Requirements

Signups remain atomic and slot availability is reopened after manual admin deletion.
`app.js` uses a single Firestore `runTransaction()` that:

1. Reads the current `slotCounts` document for the requested slot.
2. If the slot counter is missing but the requested slot exists in
   `TIME_SLOTS`, creates the counter with `count: 1` and creates the
   `registrations` document in the same commit.
3. Rejects if an existing slot counter is already at capacity
   (`SLOT_FULL`) or malformed/unknown (`SLOT_UNAVAILABLE`), which the UI
   surfaces as *"That appointment just filled up. Please choose another
   time."*
4. Otherwise increments `count` by 1 and creates the `registrations`
   document; both writes commit atomically, or neither does.

`firestore.rules` independently re-validates first-reservation counter
creation, subsequent increments (exactly +1, never past `capacity`, no
other field changed), and the registration schema,
so this guarantee does not depend on trusting the browser. As noted in
Section 10, production should still move final registration creation authority
to a Cloud Function for rate limiting and duplicate detection that rules alone cannot
provide.

The deployed `releaseSlotOnRegistrationDelete` function listens for
`registrations/{registrationId}` deletes. If an organizer deletes a
registration in the Firebase console, the function transactionally decrements
`slotCounts/{bloodDriveId}_{appointmentSlotId}` without letting the count go
below zero, so the public form can show and accept the reopened spot.

## 16. Security Checklist

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
- [x] Public clients cannot read registrations
- [x] Public clients cannot modify registrations
- [x] Public clients cannot delete registrations
- [x] Students cannot access other students' information
- [x] Admin access is not publicly exposed (no admin UI exists in this MVP)
- [x] Appointment capacity cannot be bypassed by manipulating frontend JavaScript (enforced by `firestore.rules`, not just `app.js`)
- [ ] Production architecture includes server-side registration validation *(a delete-reconciliation Cloud Function exists; final registration endpoint still requires Section 10)*
- [ ] Production architecture includes rate limiting *(requires a backend; not possible from rules alone)*
- [x] Production architecture uses atomic appointment reservation *(implemented via Firestore transaction + rules; see Section 15)*
- [x] Deleting a registration reopens its appointment slot *(implemented by `releaseSlotOnRegistrationDelete`; see Section 15)*
- [ ] Duplicate registrations are handled server-side *(not possible from a public client with no read access; requires Section 10's Cloud Function)*
- [ ] Retention policy is explicitly determined before production *(Section 11)*
- [ ] District technology/privacy approval is required before real student data is collected

## 17. District Approval Checklist

Before this system collects any real student data, confirm with Carmel
Clay Schools technology/privacy staff:

- [ ] Firestore Security Rules have been reviewed line-by-line.
- [ ] A production registration backend (Cloud Function) has been built for
      rate limiting, duplicate detection, and authoritative eligibility
      re-verification.
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
