import { app, db } from "../firebase-init.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

export const auth = getAuth(app);
export const UNAUTHORIZED = "Your account is not authorized to access the administrative dashboard.";

export async function getAdminProfile(user) {
  if (!user?.uid) return null;

  const candidateIds = getAdminCandidateIds(user);
  debugAuthCheckpoint("admin-profile-check-start", {
    uid: redactId(user.uid),
    email: user.email || "missing",
    candidateIds: candidateIds.map(redactId),
  });

  for (const adminId of candidateIds) {
    try {
      debugAuthCheckpoint("admin-profile-read-attempt", { adminId: redactId(adminId) });
      const snap = await getDoc(doc(db, "admins", adminId));
      debugAuthCheckpoint("admin-profile-read-result", {
        adminId: redactId(adminId),
        exists: snap.exists(),
      });

      if (!snap.exists()) continue;

      const data = snap.data();
      const normalized = normalizeAdminProfile(data, adminId);
      debugAuthCheckpoint("admin-profile-evaluated", {
        adminId: redactId(adminId),
        role: normalized.role || "missing",
        status: normalized.status || "missing",
        enabled: normalized.enabled,
        active: normalized.active,
        authorized: isEnabledAdminProfile(normalized),
      });

      if (isEnabledAdminProfile(normalized)) return normalized;
    } catch (error) {
      debugAuthCheckpoint("admin-profile-read-error", {
        adminId: redactId(adminId),
        code: error?.code || "unknown",
        message: error?.message || String(error),
      });
      if (error?.code === "permission-denied") continue;
      throw error;
    }
  }

  debugAuthCheckpoint("admin-profile-check-failed", {
    reason: "No admins document matched an enabled admin profile.",
  });
  return null;
}

function getAdminCandidateIds(user) {
  const ids = [user.uid];
  if (user.email) {
    ids.push(user.email);
    ids.push(user.email.toLowerCase());
  }
  return [...new Set(ids.filter(Boolean))];
}

function normalizeAdminProfile(data, id) {
  return {
    id,
    ...data,
    role: data?.role,
    status: data?.status,
  };
}

function isEnabledAdminProfile(data) {
  return data?.role === "admin" && (data.status === "enabled" || data.enabled === true || data.active === true);
}

function debugAuthCheckpoint(label, details = {}) {
  console.info(`[Admin Auth] ${label}`, details);
}

function redactId(value) {
  const text = String(value || "");
  if (text.includes("@")) return text;
  if (text.length <= 8) return text || "missing";
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function finishAuthCheck() {
  document.body.classList.remove("admin-auth-checking");
  document.body.classList.add("admin-auth-ready");
}

export function requireAdmin({ onReady, onDenied }) {
  return onAuthStateChanged(auth, async (user) => {
    debugAuthCheckpoint("auth-state-changed", {
      signedIn: Boolean(user),
      uid: user?.uid ? redactId(user.uid) : "missing",
      email: user?.email || "missing",
    });

    if (!user) {
      window.location.replace("/admin/login.html");
      return;
    }
    try {
      const profile = await getAdminProfile(user);
      if (!profile) {
        finishAuthCheck();
        onDenied?.(UNAUTHORIZED);
        return;
      }
      finishAuthCheck();
      debugAuthCheckpoint("authorization-ready", {
        adminDocumentId: redactId(profile.id),
        role: profile.role,
        status: profile.status,
      });
      onReady(user, profile);
    } catch (error) {
      finishAuthCheck();
      debugAuthCheckpoint("authorization-error", {
        code: error?.code || "unknown",
        message: error?.message || String(error),
      });
      onDenied?.("Admin authorization could not be verified. Please try again later. Check the browser console for [Admin Auth] checkpoints.");
    }
  });
}

export async function logout() {
  await signOut(auth);
  window.location.replace("/admin/login.html");
}
