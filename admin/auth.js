import { app, db } from "../firebase-init.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

export const auth = getAuth(app);
export const UNAUTHORIZED = "Your account is not authorized to access the administrative dashboard.";

export async function getAdminProfile(user) {
  if (!user?.uid) return null;

  const candidateIds = [user.uid, user.email?.toLowerCase()].filter(Boolean);
  for (const adminId of candidateIds) {
    const snap = await getDoc(doc(db, "admins", adminId));
    if (!snap.exists()) continue;

    const data = snap.data();
    if (isEnabledAdminProfile(data)) return data;
  }

  return null;
}

function isEnabledAdminProfile(data) {
  return data?.role === "admin" && (data.status === "enabled" || data.enabled === true || data.active === true);
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
      if (!profile) {
        finishAuthCheck();
        onDenied?.(UNAUTHORIZED);
        return;
      }
      finishAuthCheck();
      onReady(user, profile);
    } catch (_error) {
      finishAuthCheck();
      onDenied?.("Admin authorization could not be verified. Please try again later.");
    }
  });
}

export async function logout() {
  await signOut(auth);
  window.location.replace("/admin/login.html");
}
