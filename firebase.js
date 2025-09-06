// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAFwzx4Wle4v-gi_GX_iPc9c6GvO9diMMc",
  authDomain: "dovolenky-5f5e1.firebaseapp.com",
  projectId: "dovolenky-5f5e1",
  storageBucket: "dovolenky-5f5e1.appspot.com",
  messagingSenderId: "617978338078",
  appId: "1:617978338078:web:d2d5e5800df96e3259c70f"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
