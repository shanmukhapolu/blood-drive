import { app, db } from "../firebase-init.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

export const auth = getAuth(app);
export const UNAUTHORIZED = "Your account is not authorized to access the administrative dashboard.";

export async function getAdminProfile(user) {
  if (!user?.uid) return null;

  const uidProfile = await readAdminDocument(user.uid);
  if (isEnabledAdmin(uidProfile)) return uidProfile;

  const email = normalizeEmail(user.email);
  if (!email) return null;

  const emailIdProfile = await readAdminDocument(email);
  if (isEnabledAdmin(emailIdProfile)) return emailIdProfile;

  return null;
}

async function readAdminDocument(adminId) {
  try {
    const snap = await getDoc(doc(db, "admins", adminId));
    return snap.exists() ? normalizeAdminProfile(snap.id, snap.data()) : null;
  } catch (error) {
    console.info("[Admin Auth] admin document read failed", { adminId, code: error?.code || "unknown" });
    return null;
  }
}

function normalizeAdminProfile(id, data) {
  return {
    id,
    ...data,
    email: normalizeEmail(data?.email),
    role: String(data?.role || "").toLowerCase(),
    status: String(data?.status || "").toLowerCase(),
  };
}

function isEnabledAdmin(profile) {
  return profile?.role === "admin" && profile.status === "enabled";
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function finishAuthCheck() {
  document.body.classList.remove("admin-auth-checking");
  document.body.classList.add("admin-auth-ready");
}

export function requireAdmin({ onReady, onDenied }) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.replace("/admin/login.html");
      return;
    }

    try {
      const profile = await getAdminProfile(user);
      finishAuthCheck();

      if (!profile) {
        onDenied?.(UNAUTHORIZED);
        return;
      }

      onReady?.(user, profile);
    } catch (error) {
      finishAuthCheck();
      console.info("[Admin Auth] authorization failed", { code: error?.code || "unknown", message: error?.message || String(error) });
      onDenied?.("Admin authorization could not be verified. Please try again later.");
    }
  });
}

export async function logout() {
  await signOut(auth);
  window.location.replace("/admin/login.html");
}
