// ============================================================================
// firebase-init.js
//
// Firebase initialization, kept intentionally separate from UI logic
// (app.js). This module is responsible ONLY for:
//   - initializing the Firebase app
//   - anonymous authentication
//   - exposing the Firestore instance and a couple of narrow helpers
//
// ----------------------------------------------------------------------------
// SECURITY NOTE — read before editing this file
// ----------------------------------------------------------------------------
// The Firebase web config below (apiKey, projectId, etc.) is NOT a secret.
// It identifies which Firebase project this client talks to, the same way a
// URL identifies a server. It is normal and expected for this object to be
// visible in frontend code / browser dev tools.
//
// Actual security comes from:
//   1. Firestore Security Rules (see firestore.rules) — these are enforced
//      by Firebase's servers and cannot be bypassed by editing client code.
//   2. Firebase App Check (placeholder below) — helps confirm requests come
//      from the real app, not a script or bot.
//   3. In production, a trusted backend (Cloud Function) that re-validates
//      everything the client claims before writing to Firestore.
//
// This file must NEVER contain:
//   - a Firebase Admin SDK / service-account key
//   - any secret used for server-side privileged access
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAnalytics, logEvent, isSupported as analyticsIsSupported } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-analytics.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app-check.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

// NOTE: apiKey is intentionally a placeholder. This project's owner must
// replace it with the real Firebase Web API key for the "blood-drive-test"
// project. Doing so does not weaken security — see the note above.
const firebaseConfig = {
  apiKey: "REPLACE_WITH_FIREBASE_WEB_API_KEY",
  authDomain: "blood-drive-test.firebaseapp.com",
  projectId: "blood-drive-test",
  storageBucket: "blood-drive-test.firebasestorage.app",
  messagingSenderId: "602277319865",
  appId: "1:602277319865:web:ce7c6a1b6ff97d09d5b768",
  measurementId: "G-EXG5880X37",
};

export const app = initializeApp(firebaseConfig);

// ----------------------------------------------------------------------------
// Firebase App Check (PRODUCTION-ONLY PLACEHOLDER)
// ----------------------------------------------------------------------------
// App Check helps reduce abuse (bots, scripted registration attempts) by
// attesting that requests come from this real, approved app instance. It is
// a DEFENSE-IN-DEPTH measure and is NOT a replacement for Firestore Security
// Rules — rules remain the authoritative access control.
//
// Replace "REPLACE_WITH_APP_CHECK_SITE_KEY" with the reCAPTCHA Enterprise (or
// district-approved) App Check site key created for the approved production
// domain before this app collects any real student data. Do not invent or
// guess a real site key.
let appCheck = null;
try {
  if (firebaseConfig.apiKey !== "REPLACE_WITH_FIREBASE_WEB_API_KEY") {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider("REPLACE_WITH_APP_CHECK_SITE_KEY"),
      isTokenAutoRefreshEnabled: true,
    });
  }
} catch (_err) {
  // App Check is optional for local prototyping; failures here must never
  // block the rest of the app from loading.
  appCheck = null;
}

export const auth = getAuth(app);
export const db = getFirestore(app);

// Analytics is optional and may be unavailable (e.g. blocked by an ad
// blocker, or unsupported browser). Never let analytics failures break the
// registration flow.
let analyticsInstance = null;
analyticsIsSupported()
  .then((supported) => {
    if (supported) {
      analyticsInstance = getAnalytics(app);
    }
  })
  .catch(() => {
    analyticsInstance = null;
  });

// Allow-listed, non-PII event names only. Do NOT pass student names, emails,
// IDs, phone numbers, or dates of birth as event parameters — see PII
// protection requirements in README.md.
const ALLOWED_EVENTS = new Set([
  "blood_drive_form_started",
  "blood_drive_registration_success",
  "blood_drive_registration_error",
  "blood_drive_ineligible_blocked",
]);

/**
 * Logs a non-PII product analytics event. Silently ignores any event name
 * that is not explicitly allow-listed above, and silently no-ops if
 * analytics failed to initialize.
 * @param {string} eventName
 */
export function logAnonymousEvent(eventName) {
  if (!analyticsInstance || !ALLOWED_EVENTS.has(eventName)) return;
  try {
    logEvent(analyticsInstance, eventName);
  } catch (_err) {
    // Never let analytics errors surface to the student.
  }
}

/**
 * Ensures an anonymous Firebase Auth session exists before any Firestore
 * write is attempted. Resolves with the signed-in user.
 *
 * The anonymous user is only ever granted the single, narrowly-scoped
 * "create a registration" permission in firestore.rules — it cannot read,
 * update, or delete anything.
 * @returns {Promise<import("https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js").User>}
 */
export function ensureAnonymousSession() {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          unsubscribe();
          resolve(user);
        }
      },
      (error) => {
        unsubscribe();
        reject(error);
      }
    );

    if (!auth.currentUser) {
      signInAnonymously(auth).catch((error) => {
        unsubscribe();
        reject(error);
      });
    }
  });
}
