// src/firebase.js
// ----------------
// Firebase modular JS SDK initialisation.
// Checks for missing env vars and throws a descriptive error so the
// ErrorBoundary can render a helpful setup screen instead of a white crash.

import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { getStorage } from 'firebase/storage'

const required = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
]

const missing = required.filter(k => !import.meta.env[k])
if (missing.length > 0) {
  throw new Error(
    `Firebase is not configured. Missing env vars in .env:\n${missing.join('\n')}\n\n` +
    `Copy .env.example → .env and fill in your Firebase Web SDK credentials.`
  )
}

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

const app     = initializeApp(firebaseConfig)
export const db      = getFirestore(app)
export const auth    = getAuth(app)
export const storage = getStorage(app)
export default app
