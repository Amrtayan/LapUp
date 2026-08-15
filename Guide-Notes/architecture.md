# App Architecture & Data Models

This document outlines the underlying architecture, data schemas, cloud sync logic, and timekeeping mechanisms for LapUp.

## 1. Data Schema & State Management

### The Session Object
Each study session is stored locally (and on the cloud) as a JSON object with the following schema:
- `id`: Unique string (e.g., `session-[timestamp]-[random]`).
- `name`: Auto-generated string (e.g., `2026-07-15-Session 1`).
- `status`: `'active'` or `'ended'`.
- `startTime`: Timestamp (ms).
- `endTime`: Timestamp (ms) or `null`.
- `elapsedMs`: Total active time accumulated on the main dial.
- `lapStartMs`: The `elapsedMs` value when the current lap started.
- `lapMedianMs`: Legacy fallback field for a single median.
- `lapCounter`: Integer tracking the current active lap number.
- `gapElapsedMs`: Accumulated gap time for the current paused state.
- `currentGapLapNum`: The lap number during which the gap timer is running.
- `remarks`: String containing user notes.
- `createdTime`: Timestamp (ms).
- `lastUpdated`: Timestamp (ms) for resolving sync conflicts.
- `laps`: Array of chronologically ordered event objects (see below).

### The `laps` Array (Polymorphism)
The `laps` array is not just a list of laps; it is a chronological timeline of events. It contains objects of three different types:
1. **Lap Event**: `{ type: 'lap', lapNum, lapTimeMs, deficitMs, targetMs, excludeDeficit }`
2. **Gap Event**: `{ type: 'gap', lapNum, durationMs, cleared: boolean }`
3. **Cycle Change Event**: `{ type: 'cycle_change', medians: [number, number, ...], timestamp }`
The ledger renders these sequentially by parsing the array backwards.

## 2. Timekeeping Engine
LapUp requires high-precision timekeeping. Instead of relying on standard `setInterval` loops (which can drift or pause when the tab is inactive), the app utilizes `requestAnimationFrame` (rAF). 
- On every frame, the engine calculates the delta between the current timestamp and the `lastTimestamp`.
- This delta is added to `elapsedMs` (or `gapElapsedMs`), ensuring accurate time tracking regardless of frame rate drops.

## 3. Storage, Auth, & Cloud Sync

### Local Storage (Offline-First)
The app writes its state to `localStorage` under two keys:
- `laptrack_sessions`: A serialized array of all session objects.
- `laptrack_active_session_id`: The ID of the currently loaded session.

### Firebase Integration & Cloud Syncing
- The app uses Firebase (`firebase-config.js`) for Google Authentication.
- When signed in, the app automatically debounces state changes (waiting 2 seconds of inactivity) before writing the full session payload to Firestore.
- On startup or sign-in, the app fetches cloud data and runs a `mergeSessions()` function, comparing `lastUpdated` timestamps to resolve conflicts between local storage and cloud data, ensuring the user always sees the most recent state.

## 4. Progressive Web App (PWA) Configuration
LapUp is built as an installable PWA.
- **`manifest.json`**: Defines the app name, icons, display mode (`standalone`), and theme color (`#4a90d9`).
- **`sw.js`**: Registers a Service Worker on load to cache static assets, allowing the stopwatch to run perfectly offline.
