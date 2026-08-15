### 1. Overall Vibe & Aesthetic
The app features a **modern, sleek, dark-mode design** with a "cyberpunk-lite" or high-tech aesthetic. It relies heavily on **glassmorphism** (frosted glass effects using `backdrop-filter: blur(12px)` and semi-transparent white overlays) and **neon/glowing elements** (achieved via CSS drop-shadows and radial background gradients). The interface feels precise, data-rich, and premium.

### 2. Colors Used
The color palette is built around deep dark backgrounds contrasting with vibrant neon accents:
* **Backgrounds:** Deep navy/black (`#070b18`) and a slightly lighter navy (`#0d1327`).
* **Accents:** 
  * Electric Blue (`#4a90d9`) – the primary interactive color.
  * Indigo/Purple (`#6c63ff`) – secondary accent.
  * Neon Red (`#ff4d6d`) – used for alerts, errors, or "over target" deficit states.
  * Neon Green (`#00e676`) – used for success, "under target" states, and pulsing indicators.
* **Text:** Crisp off-white (`#e8eaf6`) for primary text and muted grayish-blue (`#8892b0`) for secondary/subtext.
* **Glass/Overlays:** Uses `rgba(255, 255, 255, 0.04)` for fills and `0.08` for borders.

### 3. Fonts Used
* **Primary Font:** **[Outfit](https://fonts.google.com/specimen/Outfit)** (imported from Google Fonts in weights 300, 400, 500, 600, 700). Fallbacks are `system-ui` and `sans-serif`. 
* **Clock Digits:** The main clock uses `Outfit` but applies `font-variant-numeric: tabular-nums;` to prevent the numbers from shifting horizontally as the timer ticks, ensuring a monospaced, rigid feel for the digits.

### 4. Font Sizes Used
The app uses a modular scale of `rem` units to establish hierarchy:
* **Massive:** `3.4rem` (The main clock digits, dominating the center dial).
* **Headings/Titles:** `1.2rem` (Modal titles), `1.15rem` (Header Logo), `1.1rem` (Empty states).
* **Standard UI/Buttons:** `0.95rem`, `0.9rem`, `0.88rem`, `0.85rem` (Used for buttons, session items, main text).
* **Micro-copy & Badges:** `0.8rem`, `0.75rem`, `0.72rem`, `0.7rem` (Used for lap segment labels, syncing indicators, timestamp metas, heavily spaced with uppercase formatting like `LAP 1`).

### 5. Background
The main app background isn't just a flat color; it's a dynamic, space-like ambient glow. It uses a composite of the deep navy base (`#070b18`) overlaid with two large, subtle, off-center radial gradients—one electric blue and one indigo—that fade out at 70%, creating soft, glowing orbs behind the frosted glass panels.

### 6. Icons
The icons are **custom inline SVGs** designed in a minimalist, geometric line-art style (very similar to *Feather Icons* or *Lucide*). They strictly use `stroke="currentColor"` (or specific accent colors), `fill="none"`, `stroke-width="2"` or `2.5`, and rounded line caps/joins. This keeps the iconography lightweight, consistent, and easily animatable. Some icons, like the "hide deficit" eye in the ledger, use stateful designs (switching between open and closed-eye paths) to give clear visual feedback.

### 7. Main Dial Appearance
The central stopwatch dial is the focal point of the app, built using layered SVGs (320x320px):
* **Outer Ring:** A thin, decorative dashed line (`stroke-dasharray: 3 6`).
* **Track Ring:** A thick (10px), dim-blue background track for the progress arc.
* **Progress Arc:** A thick (10px) bright blue arc that fills up as the lap progresses. It emits a glowing aura using a CSS `drop-shadow`. If the lap exceeds the target time, JavaScript interpolates this blue stroke and glow smoothly into neon red (`#ff4d6d`).
* **Tick Marks:** Around the inside of the track, there are 60 tick marks resembling a traditional analog stopwatch. Every 5th tick is "major" (slightly thicker, longer, and more opaque), while the rest are "minor" (thinner and faint). 
* **Inner Ring:** A very faint solid ring enclosing the central clock digits.

### 8. Sources Used for the Main Dial
There are **no external libraries or visual assets** (like Chart.js or image files) used to derive the dial. It is entirely **custom-built from scratch**:
* The rings are standard SVG `<circle>` elements.
* The progress animation relies on native SVG properties: calculating the exact circumference (`2 * Math.PI * 132 ≈ 829.38`) and dynamically adjusting the `stroke-dashoffset` via CSS transitions.
* The 60 analog tick marks are generated programmatically on load via a JavaScript IIFE (Immediately Invoked Function Expression) using standard trigonometry (`Math.cos` and `Math.sin`) to calculate the exact X/Y coordinates for 60 SVG `<line>` elements injected into the DOM.

### 9. Layout Structure
The app utilizes a Flexbox-based layout spanning exactly `100vh` to prevent scrolling. It is divided into three main zones:
* **Sidebar:** Fixed width (280px), collapsible off-canvas for mobile/focus mode.
* **Clock Panel (Center):** Flex basis of 52%, housing the main dial centrally.
* **Ledger Panel (Right):** Flexes to fill remaining space, containing the scrolling table.

### 10. Empty States
Visual empty states are provided when no data is present:
* **No Active Session:** The clock panel hides and displays a massive, dashed "Create Session" button in the center.
* **Empty Ledger:** A faded SVG clipboard icon and text ("No laps recorded yet") appears when a session is new.

### 11. Micro-Animations
The app uses subtle CSS animations to enhance the experience:
* **Success Flash:** The clock digits flash green (`flash-green` keyframes) momentarily if a lap is completed under the target time.
* **Pulse Indicators:** Used on the net-deficit value when updating, and continuously on the green cloud-sync indicator.
* **Row Slide-in:** New ledger rows enter via a cubic-bezier slide-in animation (`rowSlideIn`).