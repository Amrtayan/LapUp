// ── Firebase Configuration & Cloud Sync ──────────────────────
// Uses ES module imports from Firebase CDN (no npm/bundler needed)

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';

// ── Firebase Config ──────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAQyKWzbY8BFnexvF8LeS1VOA8T-Fbxz7w",
  authDomain: "lapup-5f654.firebaseapp.com",
  projectId: "lapup-5f654",
  storageBucket: "lapup-5f654.firebasestorage.app",
  messagingSenderId: "947363848057",
  appId: "1:947363848057:web:c96ae7c0efc88fd15d99a8"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// ── Auth Functions ───────────────────────────────────────────

export function getCurrentUser() {
  return auth.currentUser;
}

export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error) {
    console.error('[LapUp] Sign-in error:', error);
    // User closed popup or other error
    if (error.code !== 'auth/popup-closed-by-user') {
      alert('Sign-in failed: ' + error.message);
    }
    return null;
  }
}

export async function signOutUser() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('[LapUp] Sign-out error:', error);
  }
}

export function onAuthChange(callback) {
  onAuthStateChanged(auth, callback);
}

// ── Firestore Sync Functions ─────────────────────────────────

// Save all sessions to Firestore (full replace)
export async function saveSessionsToCloud(sessions, activeSessionId) {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const sessionsRef = collection(db, 'users', user.uid, 'sessions');

    // Get existing cloud session IDs to detect deletions
    const snapshot = await getDocs(sessionsRef);
    const cloudIds = new Set();
    snapshot.forEach(doc => cloudIds.add(doc.id));

    // Batch write all current sessions
    const batch = writeBatch(db);

    for (const session of sessions) {
      const sessionDoc = doc(db, 'users', user.uid, 'sessions', session.id);
      batch.set(sessionDoc, session);
      cloudIds.delete(session.id); // still exists locally
    }

    // Delete sessions that exist in cloud but not locally (user deleted them)
    for (const orphanId of cloudIds) {
      const orphanDoc = doc(db, 'users', user.uid, 'sessions', orphanId);
      batch.delete(orphanDoc);
    }

    // Save active session ID as metadata
    const metaDoc = doc(db, 'users', user.uid, 'meta', 'preferences');
    batch.set(metaDoc, { activeSessionId, lastSynced: Date.now() });

    await batch.commit();
    console.log('[LapUp] Synced to cloud ✓');
    return true;
  } catch (error) {
    console.error('[LapUp] Cloud save error:', error);
    return false;
  }
}

// Load all sessions from Firestore
export async function loadSessionsFromCloud() {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const sessionsRef = collection(db, 'users', user.uid, 'sessions');
    const snapshot = await getDocs(sessionsRef);

    const cloudSessions = [];
    snapshot.forEach(docSnap => {
      cloudSessions.push(docSnap.data());
    });

    // Load active session preference
    const metaDoc = doc(db, 'users', user.uid, 'meta', 'preferences');
    const { getDoc } = await import('https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js');
    const metaSnap = await getDoc(metaDoc);
    const meta = metaSnap.exists() ? metaSnap.data() : {};

    return {
      sessions: cloudSessions,
      activeSessionId: meta.activeSessionId || null
    };
  } catch (error) {
    console.error('[LapUp] Cloud load error:', error);
    return null;
  }
}

// Merge cloud sessions with local sessions (cloud wins for conflicts, local-only sessions are kept)
export function mergeSessions(localSessions, cloudSessions) {
  const merged = new Map();

  // Add all cloud sessions (they take priority)
  for (const s of cloudSessions) {
    merged.set(s.id, s);
  }

  // Add local-only sessions (ones not in cloud)
  for (const s of localSessions) {
    if (!merged.has(s.id)) {
      merged.set(s.id, s);
    } else {
      // Both exist — keep the one with the latest lastUpdated
      const cloud = merged.get(s.id);
      if (s.lastUpdated > (cloud.lastUpdated || 0)) {
        merged.set(s.id, s);
      }
    }
  }

  return Array.from(merged.values());
}
