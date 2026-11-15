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
  getDoc,
  onSnapshot,
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

// Write only the sessions that changed (dirtySessions) and delete removed ones
// (deletedIds). No read-before-write and no full-collection rewrite.
export async function saveSessionsToCloud(dirtySessions, deletedIds, activeSessionId) {
  const user = auth.currentUser;
  if (!user) return false;

  try {
    const batch = writeBatch(db);

    for (const session of dirtySessions) {
      batch.set(doc(db, 'users', user.uid, 'sessions', session.id), session);
    }
    for (const id of deletedIds) {
      batch.delete(doc(db, 'users', user.uid, 'sessions', id));
    }
    batch.set(doc(db, 'users', user.uid, 'meta', 'preferences'),
      { activeSessionId: activeSessionId || null, lastSynced: Date.now() });

    await batch.commit();
    return true;
  } catch (error) {
    console.error('[LapUp] Cloud save error:', error);
    return false;
  }
}

// One-off load of all sessions + preferences (fetched in parallel)
export async function loadSessionsFromCloud() {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const [snapshot, metaSnap] = await Promise.all([
      getDocs(collection(db, 'users', user.uid, 'sessions')),
      getDoc(doc(db, 'users', user.uid, 'meta', 'preferences'))
    ]);

    const cloudSessions = [];
    snapshot.forEach(docSnap => cloudSessions.push(docSnap.data()));
    const meta = metaSnap.exists() ? metaSnap.data() : {};

    return { sessions: cloudSessions, activeSessionId: meta.activeSessionId || null };
  } catch (error) {
    console.error('[LapUp] Cloud load error:', error);
    return null;
  }
}

// Realtime listener: calls onChange(changes) whenever another device writes.
// Each change: { type: 'added'|'modified'|'removed', id, data, pending }
// Returns an unsubscribe function.
export function subscribeToCloud(onChange) {
  const user = auth.currentUser;
  if (!user) return () => {};
  return onSnapshot(
    collection(db, 'users', user.uid, 'sessions'),
    { includeMetadataChanges: false },
    (snap) => {
      const changes = snap.docChanges().map(c => ({
        type: c.type,
        id: c.doc.id,
        data: c.doc.data(),
        pending: c.doc.metadata.hasPendingWrites
      }));
      if (changes.length) onChange(changes);
    },
    (err) => console.error('[LapUp] Realtime listener error:', err)
  );
}

// Pick the winning version of one session.
// An ended session is final: it always beats a non-ended copy, so a stale
// device can never "re-open" a session that was closed elsewhere.
export function pickNewerSession(local, cloud) {
  const localEnded = local.status === 'ended';
  const cloudEnded = cloud.status === 'ended';
  if (localEnded !== cloudEnded) return localEnded ? local : cloud;
  return (local.lastUpdated || 0) > (cloud.lastUpdated || 0) ? local : cloud;
}

// Merge cloud sessions with local sessions
export function mergeSessions(localSessions, cloudSessions) {
  const merged = new Map();
  for (const s of cloudSessions) merged.set(s.id, s);
  for (const s of localSessions) {
    merged.set(s.id, merged.has(s.id) ? pickNewerSession(s, merged.get(s.id)) : s);
  }
  return Array.from(merged.values());
}
