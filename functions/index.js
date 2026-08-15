const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

const ADMIN_ALLOWED_ORIGINS = [
  "https://blood-drive.netlify.app",
  "https://blood-drive-test.web.app",
  "https://blood-drive-test.firebaseapp.com",
  /^http:\/\/localhost(?::\d+)?$/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
];

/**
 * Returns all registration records to enabled admins through the Admin SDK.
 *
 * This endpoint intentionally replaces direct browser reads of the protected
 * `registrations` collection. Firestore rules can be strict/default-deny while
 * the server performs one consistent authorization check against the `admins`
 * collection using the caller's verified Firebase Auth token.
 */
exports.listAdminRegistrations = onCall({ cors: ADMIN_ALLOWED_ORIGINS }, async (request) => {
  return listAdminRegistrationsForAuth(request.auth);
});

/**
 * HTTP fallback for browsers/environments where callable preflight handling is
 * blocked by hosting or Firebase proxy behavior. The admin dashboard tries the
 * callable first, then this endpoint with the same Firebase ID token.
 */
exports.listAdminRegistrationsHttp = onRequest({ cors: false }, async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: { code: "method-not-allowed", message: "Use POST for this endpoint." } });
    return;
  }

  try {
    const idToken = getBearerToken(req);
    if (!idToken) {
      throw new HttpsError("unauthenticated", "Sign in before opening the admin dashboard.");
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const payload = await listAdminRegistrationsForAuth({ uid: decodedToken.uid, token: decodedToken });
    res.status(200).json({ data: payload });
  } catch (error) {
    const normalized = normalizeHttpsError(error);
    logger.warn("Admin registration HTTP endpoint failed", {
      code: normalized.code,
      message: normalized.message,
      origin: req.get("origin") || "missing",
    });
    res.status(normalized.status).json({ error: { code: normalized.code, message: normalized.message } });
  }
});

async function listAdminRegistrationsForAuth(auth) {
  if (!auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in before opening the admin dashboard.");
  }

  const adminProfile = await getEnabledAdminProfile(auth);
  if (!adminProfile) {
    throw new HttpsError("permission-denied", "This account is not enabled for admin access.");
  }

  const snapshot = await admin
    .firestore()
    .collection("registrations")
    .orderBy("createdAt", "desc")
    .get();

  return {
    adminDocumentId: adminProfile.id,
    registrations: snapshot.docs.map((doc) => serializeDocument(doc)),
  };
}

async function getEnabledAdminProfile(auth) {
  const candidates = [auth.uid];
  const email = auth.token?.email;
  if (email) {
    candidates.push(email, String(email).toLowerCase());
  }

  for (const id of [...new Set(candidates.filter(Boolean))]) {
    const snap = await admin.firestore().collection("admins").doc(id).get();
    if (!snap.exists) continue;

    const data = snap.data() || {};
    if (data.role === "admin" && (data.status === "enabled" || data.enabled === true || data.active === true)) {
      return { id, ...data };
    }
  }

  return null;
}

function setCorsHeaders(req, res) {
  const origin = req.get("origin") || "";
  if (isAllowedOrigin(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Max-Age", "3600");
}

function isAllowedOrigin(origin) {
  return ADMIN_ALLOWED_ORIGINS.some((allowedOrigin) => {
    if (typeof allowedOrigin === "string") return allowedOrigin === origin;
    return allowedOrigin.test(origin);
  });
}

function getBearerToken(req) {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function normalizeHttpsError(error) {
  const code = error?.code || "internal";
  const message = error?.message || "Unable to load registration data.";
  const statusByCode = {
    unauthenticated: 401,
    "permission-denied": 403,
    "invalid-argument": 400,
    "method-not-allowed": 405,
  };
  return { code, message, status: statusByCode[code] || 500 };
}

function serializeDocument(doc) {
  return serializeValue({ id: doc.id, ...doc.data() });
}

function serializeValue(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializeValue(entry)]));
  }
  return value;
}

/**
 * Keeps slot availability tied to actual registrations.
 *
 * When an organizer deletes a registration from Firestore, this trigger
 * decrements the matching non-PII slot counter so that the public form shows
 * the reopened appointment spot and allows another student to register.
 */
exports.releaseSlotOnRegistrationDelete = onDocumentDeleted("registrations/{registrationId}", async (event) => {
  const deletedRegistration = event.data?.data();
  if (!deletedRegistration) return;

  const { bloodDriveId, appointmentSlotId } = deletedRegistration;
  if (typeof bloodDriveId !== "string" || typeof appointmentSlotId !== "string") {
    logger.warn("Deleted registration missing slot metadata", { registrationId: event.params.registrationId });
    return;
  }

  const slotRef = admin.firestore().doc(`slotCounts/${bloodDriveId}_${appointmentSlotId}`);

  await admin.firestore().runTransaction(async (tx) => {
    const slotSnap = await tx.get(slotRef);
    if (!slotSnap.exists) {
      logger.warn("Slot counter missing while releasing deleted registration", {
        registrationId: event.params.registrationId,
        bloodDriveId,
        appointmentSlotId,
      });
      return;
    }

    const currentCount = slotSnap.get("count");
    if (typeof currentCount !== "number") {
      logger.warn("Slot counter count is not numeric while releasing deleted registration", {
        registrationId: event.params.registrationId,
        bloodDriveId,
        appointmentSlotId,
      });
      return;
    }

    tx.update(slotRef, { count: Math.max(0, currentCount - 1) });
  });
});
