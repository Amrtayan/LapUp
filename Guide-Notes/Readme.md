# Brief-
LapUp is a custom app built for surveillance/time-keeping of focus sessions, revolving around a stopwatch dial.

It operates on the principle of Laps, Lap Medians, Lap Cycles, and Lap Deficit.

# Definitions-

- Lap: A singular instance of focus.  
- Lap-Median: The estimated time to be taken to finish the goal of the lap.
- Lap-Cycle: The entire duration of the focus session, comprising of a custom number of Laps each with a custom Lap-Median.
- Lap-Deficit: The undershoot or overshoot of time in each lap relative to the Lap-Median.
- Gap Time: The time elapse while the main dial is paused, usually for denoting breaks. (Note: When a session is "Hard-Paused", the gap timer visually freezes, but the underlying accumulated time is preserved until resumed or cleared).

# Components-
## LANDING-PAGE
- Dashboard: comprises of the Main dial and associated buttons.
- Lap Deficit Ledger: The ledger that keeps track of the net deficit for the entire session.
- Session History Panel: Panel on the left that tracks the history of sessions.
- Remarks: Any remarks for the session can be entered here, a button is provided within the Dashboard itself for this.
- Auth UI: Located in the header. Shows a sign-in button or user avatar, a dropdown for signing out, and dynamic cloud sync status indicators (pulsing dots).

## MODALS
- Set Lap-Cycle Modal: A dialog with inputs (HH:MM:SS) to build a repeating sequence of target lap durations.
- Remarks Modal: A large textarea dialog to write session notes. Autosaves notes with a visual indicator.

# Commands/Buttons-
- Create session: Creates a focus session.
- Set Lap-Cycle: Lets you add custom array of lap-medians that will play on repeat, in a preferred order, until the session is ended.
- Start/Resume: Starts the main dial.
- Pause: Pauses the main dial. Starts the gap-timer.
- Lap: Marks the end of a lap.
- Clear lap: Resets the current lap time to 0, doesn't affect Gap-Time
- Session-Pause/Hard-Pause: Pauses both the main dial and the gap-timer.
- Session-Resume/Hard-Resume: Resumes both the main dial and the gap-timer.
- End-Session: Closes the session, saves it to history, and makes it view-only.
- Remarks: Adds remarks to the session.
- Hide Deficit: An eye icon in the Lap Deficit Ledger that appears on hover, used to omit/exclude a specific lap's deficit from the session's net deficit calculation.

