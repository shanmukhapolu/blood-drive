import { app, db } from "../firebase-init.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

export const auth = getAuth(app);
export const UNAUTHORIZED = "Your account is not authorized to access the administrative dashboard.";

export async function getAdminProfile(user) {
  if (!user?.uid) return null;
  const snap = await getDoc(doc(db, "admins", user.uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (data.status !== "enabled" || data.role !== "admin") return null;
  return data;
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
        onDenied?.(UNAUTHORIZED);
        return;
      }
      onReady(user, profile);
    } catch (_error) {
      onDenied?.("Admin authorization could not be verified. Please try again later.");
    }
  });
}

export async function logout() {
  await signOut(auth);
  window.location.replace("/admin/login.html");
}
