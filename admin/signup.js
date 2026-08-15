import { auth, UNAUTHORIZED } from "./auth.js";
import { db } from "../firebase-init.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
const form=document.getElementById("signup-form"), errorEl=document.getElementById("error"), submit=document.getElementById("submit");
function show(m){errorEl.textContent=m||""} function busy(b){submit.disabled=b;submit.textContent=b?"Creating…":"Create Account"}
form.addEventListener("submit",async e=>{e.preventDefault();show("");busy(true);try{const email=form.email.value.trim().toLowerCase();const cred=await createUserWithEmailAndPassword(auth,email,form.password.value);await setDoc(doc(db,"admins",cred.user.uid),{email,role:"admin",status:"disabled",createdAt:serverTimestamp()});show("Account created. Your admin access is disabled until an organizer enables your admins record in Firebase.");busy(false)}catch(err){show(err?.code==="permission-denied"?UNAUTHORIZED:"Account setup failed. Make sure the email and password are valid.");busy(false)}});
