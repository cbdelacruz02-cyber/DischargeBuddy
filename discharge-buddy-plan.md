# DischargeBuddy — Implementation Plan

## Top-Level Overview

This plan covers seven targeted improvement areas for the DischargeBuddy Expo / React Native app.
The three primary files in scope are:

- `src/app/index.tsx` — main dashboard, medications, name verification, voice triggers, header
- `src/components/emergency-flow.tsx` — full emergency evaluation flow (all phases)
- `src/constants/ui-copy.ts` — copy strings referenced from both files
- `src/hooks/use-voice-recognition.ts` — voice recognition hook (read-only reference; no changes required)

All sub-tasks are ordered so later tasks build on earlier ones with no regressions.
Each sub-task targets exactly one feature area and must not modify unrelated code.

---

## Architecture & Error Check Summary

### Pre-existing linting errors (do NOT fix — scope is frozen)
- `react-hooks/refs` — `useRef(new Animated.Value(x)).current` pattern throughout both files.
  These are intentional Animated patterns and pre-date this work.
- `react-hooks/set-state-in-effect` — `setPhase()` called synchronously inside effects in
  emergency-flow.tsx. Intentional architectural pattern used throughout; not introduced here.
- TypeScript errors in `app-tabs.tsx` and `use-theme.ts` — unrelated files; do not touch.

### Timer / interval leak status
All `setTimeout` / `setInterval` calls are correctly cleaned up via `useEffect` return functions,
refs stored in `voiceTimersRef.current` / `overdueTimers.current`, or are intentional
fire-and-forget haptic delays. No leaks introduced by previous work.

### Audio / microphone conflicts
Two separate `useVoiceRecognition` instances in `index.tsx` (name setup + voice trigger).
Only one should be listening at a time. Current code calls `stopListening` before transitioning
between them. The pattern must be preserved — any new mic activation must stop the other instance
first via the existing `cancelVoiceFlow()` / `nameStopListening()` helpers.

### Brief reliability / accessibility suggestions (≤ 3)
1. Wrap all `setTimeout` IDs that fire TTS prompts in `voiceTimersRef.current` so
   `cancelVoiceFlow()` reliably silences mid-phrase audio when the user cancels.
2. Add `accessibilityLiveRegion="polite"` to the overdue-alarm modal body text so screen readers
   announce the modal automatically without user focus movement.
3. Set `Speech.speak` `pitch` to 0.95 (slightly lower than default) — lower pitch is empirically
   more intelligible for elderly and hearing-impaired users over phone speakers.

---

## Sub-Tasks

---

### ST-1 — Universal Accessibility & Timing Rule (App-Wide)

**Status:** [ ] pending

**Intent**
Ensure every question in the app immediately activates the microphone without a separate tap,
gives a spoken instruction to speak, and paces all prompts for elderly / blind / hearing-impaired
/ immobile users. All text inputs gain a rounded input box with an embedded 🎤 icon on the right.

**Relevant Context**
- `src/app/index.tsx` — name setup TextInput at line ~705; mic button at line ~735;
  voice trigger prompt at line ~1030 (currently requires manual 🎤 tap).
- `src/components/emergency-flow.tsx` — alone-check mic button at line ~1759
  (already shows mic but requires a tap).
- `useVoiceRecognition` returns `startListening()` which must be called in a `useEffect`
  or directly after a phase transition rather than waiting for the user to tap.
- `speak()` must fire before `startListening()` so the instruction is heard first; add a
  `setTimeout(startListening, 1500)` guard (after TTS starts) so TTS audio is not self-captured.

**Expected Outcomes**
- Every phase that asks a yes/no or open-ended question auto-starts the microphone 1.5 s after
  the spoken prompt begins.
- The 🎤 button is still visible and functional as a manual fallback.
- All TextInput fields (name edit, any future inputs) use the new `MicTextInput` shared component
  with a rounded border and an inline 🎤 icon on the right that starts `nameStartListening`.
- Speech rate for all prompts is capped at 0.6 × (slightly slower than current 0.65 ×) to give
  elderly users more time.

**Todo List**
1. Create `src/components/MicTextInput.tsx` — a single rounded TextInput with a 🎤 icon button
   on the right. Props: `value`, `onChangeText`, `onMicPress`, `isListening`, `placeholder`,
   `style`. Use existing `styles.roundedInput` pattern if present, otherwise define inline.
2. In `index.tsx`, replace the bare `TextInput` in the name-setup `'input'` step with
   `<MicTextInput>` wired to `nameStartListening`.
3. In `triggerVoicePanel()` in `index.tsx`, change the auto-start mic delay from 500 ms to
   1 500 ms (after TTS) and remove the need for the user to tap the 🎤 button to start.
   Update the label from `'🎤 Tap to start mic'` to a spoken instruction only (button remains as
   manual fallback labelled `'🎤 Mic active'` / `'🎤 Tap to retry'`).
4. In `emergency-flow.tsx`, add a `useEffect` on `phase` that calls `emgStartListening()`
   (with a 1 500 ms delay after TTS fires) for `alone-check`, `active-check`, `validation`, and
   `word-check` phases. Guard with `emgMicSupported`.
5. In `ui-copy.ts`, add / update:
   - `micAutoStartInstruction: 'Bring your mouth close to the microphone and speak now.'`
   - Slow speech rate constant: export `ACCESSIBLE_RATE = 0.6` and use in both `speak()` calls.

---

### ST-2 — Patient Name Verification Under "Maria" (index.tsx)

**Status:** [x] done

**Intent**
Under the displayed patient name, automatically announce the name and ask if it is correct.
Provide a pencil-icon button for typing at any time. Handle two failed attempts with an
escalating spell-it-out flow.

**Relevant Context**
- `patientName` state; rendered in greeting card around line ~840.
- `nameSetupStep` state machine: `'idle' | 'speaking' | 'listening' | 'input' | 'confirm'`.
  Needs two new steps: `'attempt2'` and `'spell-first' | 'spell-last' | 'spell-confirm-first' |
  'spell-confirm-last'`.
- `heardName` state holds the latest STT result.
- `confirmNameSetup()` / `rejectNameSetup()` — existing commit / reject handlers.
- `useVoiceRecognition` name-setup instance at line ~186 (`nameStartListening`,
  `nameStopListening`, `nameIsListening`).

**Expected Outcomes**
- On app load, after 2 s, the app speaks: `"Your name is [patientName]. Is that correct?"` and
  shows a YES / NO prompt with a ✏ pencil button.
- Tapping ✏ at any time opens the `MicTextInput` (from ST-1) for manual entry.
- **Attempt 1 (first "No"):** Mic activates immediately with instruction
  `"Bring your phone close and say your name slowly."` After hearing a name, speaks
  `"I heard [name]. Is that correct?"` with YES / NO.
- **Attempt 2 (second "No"):**
  - Step A — spell first name: speaks `"Please spell your first name one letter at a time."`
    and activates mic. Accumulates letters into a first-name buffer. On pause / final result,
    reconstructs the name and speaks `"Your first name is [name]. Is that correct?"` YES / NO.
  - Step B — spell last name: same flow for last name.
  - On both confirmed: combines first + last, sets `patientName`, speaks confirmation.
- Pencil ✏ button visible in every step of the name flow.

**Todo List**
1. Extend `VoiceStep`-equivalent type for name flow:
   add `'name-verify' | 'name-attempt1' | 'name-spell-first' | 'name-spell-confirm-first' |
   'name-spell-last' | 'name-spell-confirm-last'` to `nameSetupStep` union.
2. Add state: `nameAttempt` (number, 0–2), `spellBuffer` (string), `confirmedFirst` (string).
3. On initial mount (useEffect with empty deps, 2 000 ms delay), speak
   `"Your name is [patientName]. Is that correct?"` and set `nameSetupStep` to `'name-verify'`.
4. Render the name-verify UI below the greeting: patient name large text, YES / NO buttons,
   ✏ pencil button that sets `nameSetupStep` to `'input'`.
5. On "No" from verify:
   - If `nameAttempt === 0`: set to `'name-attempt1'`, speak instruction, auto-start mic (1.5 s).
   - If `nameAttempt === 1`: set to `'name-spell-first'`, speak spelling instruction,
     auto-start mic.
6. In `onResult` for name mic: route to the correct confirm step based on `nameSetupStep`.
7. Spell steps accumulate letters from interim results; on `isFinal` construct word from letters
   (e.g., `"H E L P"` → `"HELP"`), display for confirmation.
8. On both names confirmed, call existing `confirmNameSetup()` with combined name.
9. Add `ui-copy.ts` keys: `nameIsCorrect`, `spellFirstName`, `spellLastName`,
   `nameSpelledFirst`, `nameSpelledLast`, `confirmSpelledName`.

---

### ST-3 — Emergency Voice Triggers — One-Tap Auto-Mic + 5-Second "Clear the Air" (index.tsx)

**Status:** [x] done

**Intent**
When a user taps one of the three trigger boxes ("Help", "My chest hurts", "I can't breathe"),
the microphone activates automatically (no tap needed) with a spoken instruction. After the
phrase is spoken, a 5-second "clear the air" countdown runs — visual flash + vibration only,
no app speech, microphone stays open. If not cancelled after 5 seconds, "Help coming" plays,
then the Living Situation Question appears.

**Relevant Context**
- `triggerVoicePanel(phrase)` in `index.tsx` (line ~550) — current step1-listen / step2-countdown
  / step3-alone / step4-onway flow.
- `voiceStep` state machine + `voiceTimersRef.current`.
- `cancelVoiceFlow()` — clears all timers, stops mic, resets to idle.
- `startVoiceStep2()` currently starts the 5-second countdown and also fires haptics.
- Cancel button text: needs new labels: `"Cancel Help"` and `"Return to Main Page"`.
- `copy.helpIsOnTheWay` currently reads `"Help is on the way. Ambulance is coming."` —
  must NOT say "is" or "on its way". New value: `"Help coming."`.

**Expected Outcomes**
- Tapping a trigger box: microphone starts automatically after 1 500 ms (TTS instruction first);
  no separate "Tap to start mic" needed.
- Spoken instruction: `"Bring your mouth closer to the microphone and speak the text indicated
  in the box."` fires immediately on tap (before mic opens).
- 5-second countdown (`step2-countdown`) — visual countdown number + red flash + haptic vibrate
  every second; **no TTS during countdown**.
- Microphone stays open during countdown so the user can say "Cancel" to abort.
- After 5 seconds (if not cancelled): speaks `"Help coming."` then immediately transitions to
  the Living Situation Question (step3).
- Living Situation Question:
  - Voice prompt: `"Are you with someone or do you live alone? Say 'with someone' or
    'live alone', or press a button."` + auto-mic.
  - Green button: `"Yes, with someone"`.
  - Red button: `"No, live alone"`.
- Cancel & Exit Controls:
  - During countdown AND step3/step4: button labeled **"Cancel Help"** stops all flow.
  - Separate button labeled **"Return to Main Page"** calls `cancelVoiceFlow()` and scrolls to top.
- Update `copy.cancelAmbulance` → `"Cancel Help"` for this flow.
- Update `copy.helpIsOnTheWay` → `"Help coming."`.
- Update `copy.areYouAlone` → Living Situation wording above.

**Todo List**
1. In `triggerVoicePanel()`, remove the 500 ms auto-mic start; replace with:
   speak instruction → `setTimeout(triggerStartListening, 1500)`.
2. Remove the existing `step1-listen` mic-button `'🎤 Tap to start mic'` label; change to
   `'🎤 Listening…'` / `'🎤 Tap to retry'` depending on `triggerIsListening`.
3. In `startVoiceStep2()`, suppress all TTS calls during the 5-second countdown window.
   Keep haptic pulses every second. Keep microphone open (do not stop mic).
4. In the `onResult` handler for the trigger mic, add cancel detection during step2:
   if `voiceStepRef.current === 'step2-countdown'` and transcript contains a cancel word
   (`cancel`, `stop`, `no`), call `cancelVoiceFlow()`.
5. After the countdown ends (5 500 ms), speak `"Help coming."` (using new copy), then
   transition to `step3-alone` 800 ms later.
6. Update `step3-alone` UI: change YES/NO button labels to `"Yes, with someone"` /
   `"No, live alone"`.
7. Update cancel buttons in all voice-trigger steps to `"Cancel Help"`.
8. Add a `"Return to Main Page"` button to `step2-countdown`, `step3-alone`, and `step4-onway`.
9. Update relevant `ui-copy.ts` strings:
   - `helpIsOnTheWay: 'Help coming.'`
   - `cancelAmbulance: 'Cancel Help'`
   - `livingWithSomeone: 'Yes, with someone'`
   - `livingAlone: 'No, live alone'`
   - `livingQuestion: 'Are you with someone or do you live alone? Say "with someone" or "live alone", or press a button.'`
   - `triggerInstruction: 'Bring your mouth closer to the microphone and speak the text indicated in the box.'`

---

### ST-4 — Lisinopril & Missed Dose Alert Fixes (index.tsx)

**Status:** [x] done

**Intent**
Verify the three Lisinopril doses show correctly (08:00, 12:00, 20:00). Rename the
"Mark Taken" button label to just "Taken". Fix cancel behavior so cancelling one alert does not
affect the other two dose alarms. Confirm the 6-alert lockout grays the dose correctly.

**Relevant Context**
- `initialMedications` at line ~53 — already updated to three Lisinopril 10 mg entries.
- Button label: `copy.markTaken` / `copy.taken` in `ui-copy.ts` line ~114.
- Overdue alarm engine: `startOverdueAlarm()` at line ~343; uses `key = name__time` to isolate
  doses.
- Cancel in modal: clears `overdueTimers.current[key]` — correct; no cross-alarm leakage.
- 6-alert lockout: sets `taken: true` — correct; grays button (disabled styling at line ~978).
- The times stored are `'8:00 AM'`, `'12:00 PM'`, `'8:00 PM'`. The spec says `0800`, `1200`,
  `6pm`. The 20:00 hour must become 18:00 (`hour: 18`) and time `'6:00 PM'` to match the spec.

**Expected Outcomes**
- Three Lisinopril 10 mg doses displayed: `8:00 AM`, `12:00 PM`, `6:00 PM`.
- "Mark Taken" button label reads only `"Taken"` (active state, not yet taken).
- Cancelling a missed-dose popup for the 8:00 AM dose stops ONLY that dose's alert interval;
  the 12:00 PM and 6:00 PM alarms continue independently.
- After 6 alerts, the dose button is grayed out and not pressable.

**Todo List**
1. Change the third entry in `initialMedications` from `time: '8:00 PM', hour: 20` to
   `time: '6:00 PM', hour: 18`.
2. In `ui-copy.ts` for all three language objects, change `markTaken` to `'Taken'`
   (the button label for untaken medications). Ensure `taken` (post-taken label) is also
   `'Taken ✓'` or similar to distinguish the two states visually.
3. Verify that the overdue modal cancel handler correctly uses the `name__time` composite key
   (already done in previous session — confirm no regression).
4. Add a disabled/opacity style to the medication row when `medication.taken` is true so the
   "Taken" button is visually grayed (opacity 0.4, `pointerEvents: 'none'`).

---

### ST-5 — Top-Right Speaker Switch & "Read Everything" Button (index.tsx)

**Status:** [x] done

**Intent**
Add a Speaker ON/OFF switch and a "Read Everything" button to the top-right header area,
next to the existing Language & Access gear button.

**Relevant Context**
- Header zone `modeToggleRow` renders the gear button at line ~612.
- `speak()` function available throughout component.
- `Speech.stop()` available via `expo-speech` import.
- `showAccessibility` state controls the settings dropdown.
- "Read Everything" must produce a concatenated string of all visible section content and pass
  to `speak()`, stopping if pressed again.

**Expected Outcomes**
- **Speaker switch** (next to gear button, top-right):
  - When toggled ON: announces `"Speaker is activated."` then speaks the name of the current
    section (e.g., the section currently scrolled into view, or just the screen heading).
  - When OFF: calls `Speech.stop()`.
  - State: `speakerEnabled` boolean.
- **"Read Everything" button** (next to speaker switch):
  - First press: concatenates all visible text on screen (medications, appointment, greeting,
    voice triggers section headings) and calls `speak()`. Button label changes to
    `"■ Stop Reading"`.
  - Second press (while speaking): calls `Speech.stop()` and resets label to `"Read Everything"`.
  - State: `isReadingAll` boolean, toggled via `Speech` callback or press.

**Todo List**
1. Add state: `const [speakerEnabled, setSpeakerEnabled] = useState(false);`
   and `const [isReadingAll, setIsReadingAll] = useState(false);`.
2. In the header `modeToggleRow`, after the gear button, add:
   - A `Switch` component for `speakerEnabled`. On value change to `true`: speak
     `"Speaker is activated."` + name of current screen section. On `false`: `Speech.stop()`.
   - A `TouchableOpacity` labeled `isReadingAll ? '■ Stop' : '📢 Read All'`. On press:
     if `isReadingAll`, call `Speech.stop()` + `setIsReadingAll(false)`.
     If not reading, build the `readAllText` string (see step 3) and call `speak()` +
     `setIsReadingAll(true)`.
3. Build `readAllText` as a helper function that returns a single string concatenating:
   - Greeting (`"Hello [patientName]"`)
   - Appointment summary (`"Appointment with Dr. [doctor] on [date]"`)
   - Medications list (each: `"[name], due at [time], [taken/not taken]"`)
   - Voice triggers section heading and phrase labels
   - Any visible alert text
4. After `Speech.speak()` completes (use the `onDone` callback in `Speech.speak` options),
   auto-reset `isReadingAll` to `false`.

---

### ST-6 — HELP Button, Pain Evaluation & Severe Escalation (emergency-flow.tsx)

**Status:** [x] done

**Intent**
Keep the prior fixes (no silence countdown on pain, Yellow Tier "No" stays in Yellow,
"← Return to Dashboard"). Replace the 10 individual pain score buttons with three large
color-coded buttons (green 1–3, yellow 4–7, red 8–10). For the red tier selection, apply the
exact same 5-second "clear the air" + auto-mic + "Help coming" + Living Situation Question
sequence from ST-3. Skip the initial `pause` phase countdown — go directly to pain.

**Relevant Context**
- `phase === 'pause'` countdown (line ~463) currently counts 2 s then transitions to `'pain'`.
  This must be removed — transition from initial entry directly to `'pain'`.
- `handlePainScore(score)` at line ~983: calls `transitionTo('countdown')` for score ≥ 8.
- `SILENCE_PHASE_MAP` — `'pain'` entry already removed.
- `handleValidationYes` / `handleValidationNo` — validation phase not changed.
- `alone-check` phase currently has a tap-required mic button; ST-1 adds auto-start, but this
  sub-task must also add the Living Situation Question buttons with new labels.
- `copy.helpIsOnTheWay` already updated to `"Help coming."` by ST-3.

**Expected Outcomes**
- On entering emergency flow, no countdown — immediately shows pain screen.
- Pain screen shows exactly three buttons:
  - 🟢 Large green button: `"1 – 3\nMild"` → routes to green tier (copy.greenTierTitle).
  - 🟡 Large yellow button: `"4 – 7\nModerate"` → routes to yellow tier.
  - 🔴 Large red button: `"8 – 10\nSevere"` → triggers escalation sequence below.
- "I Feel Fine" and "Hear Again" buttons remain.
- **Red 8–10 escalation sequence** (mirrors ST-3):
  1. Micro-vibrate immediately.
  2. Speaks: `"Help coming."` — no other TTS.
  3. 5-second "clear the air" countdown: visual flash + haptic every second; mic open, no TTS.
  4. After 5 s: speaks Living Situation Question; auto-mic (1.5 s delay).
  5. Screen shows: `"Yes, with someone"` (green button) / `"No, live alone"` (red button).
  6. `"Cancel Help"` button stops escalation and returns to pain screen.
  7. `"Return to Main Page"` closes the emergency modal.
- `pause` phase: remove the 2-second countdown before routing to `'pain'`. Instead, route
  directly by setting `pauseSeconds` start to 0 or skipping the timeout entirely.

**Todo List**
1. In the `pause` phase `useEffect` (line ~463), change the countdown start so it skips
   directly: set initial `pauseSeconds` to `0` and in the countdown effect, immediately
   transition to `'pain'` without waiting. (Simplest approach: remove the 2 s pause entirely
   by changing `pauseSeconds` initial value from `2` to `0`.)
2. Replace the pain phase's two rows of 10 number buttons with three large `TouchableOpacity`
   buttons, keeping the existing `painTierBadges` legend.
3. Implement `handlePainScore` for each tier range by calling existing helper with
   representative score (1 for green, 4 for yellow, 8 for red) or adapt to accept a range.
4. For the red tier button press:
   a. Start micro haptic immediately.
   b. Speak `"Help coming."` (with `replace: true`).
   c. Transition to a new sub-phase `'pain-escalation'` added to the `Phase` union.
   d. `pain-escalation` renders the 5-second countdown with the same flash/vibrate pattern
      used in the voice trigger countdown (port from `step2-countdown` in index.tsx).
   e. Keep microphone open during countdown (call `emgStartListening()` immediately).
   f. After 5 s: speak Living Situation Question (copy from ST-3), auto-mic.
   g. Replace `alone-check` heading / buttons with Living Situation Question wording and
      `"Yes, with someone"` / `"No, live alone"` button labels.
5. Add `"Cancel Help"` and `"Return to Main Page"` buttons to `pain-escalation` and
   `alone-check` phases.
6. `"Cancel Help"` in pain-escalation: calls `transitionTo('pain')` (return to pain screen).
7. `"Return to Main Page"`: calls `onClose()` (closes emergency modal).
8. Extend the silence auto-start `useEffect` (from ST-1) to also include `'pain-escalation'`.

---

### ST-7 — Integration & Regression Check

**Status:** [x] done

**Intent**
Run lint and typecheck across the three changed files, fix any new warnings or errors introduced
by ST-1 through ST-6, and verify no regressions against the previously-applied fixes:
- Yellow Tier "No" stays in yellow (no routing to green/education).
- "← Return to Dashboard" label on yellow tier.
- Pain evaluation has no SilenceBar.
- Pain evaluation has no initial countdown.
- Lisinopril 10 mg × 3 doses.
- 6-alert lockout + 1-hour timer.
- Overdue alarm cancel key uses `name__time`.

**Expected Outcomes**
- `npx expo lint` produces zero new errors in `index.tsx`, `emergency-flow.tsx`, and
  `use-voice-recognition.ts` (pre-existing errors in other files are unchanged).
- `npx tsc --noEmit` produces zero new errors in any of the three target files.

**Todo List**
1. Run `npx expo lint` filtered to the three target files. Fix any new errors.
2. Run `npx tsc --noEmit`. Fix any new type errors in target files.
3. Manually trace the cancel path for each overdue alarm to confirm the `name__time` key is
   still correctly formed and cleared.
4. Confirm Yellow Tier "No" button `onPress` does not call `transitionTo`.
5. Confirm SILENCE_PHASE_MAP does not include `'pain'`.
6. Confirm `pauseSeconds` initial value is 0 or the pause phase is bypassed.

---

## File Change Matrix

| Sub-Task | index.tsx | emergency-flow.tsx | ui-copy.ts | MicTextInput.tsx (new) |
|----------|-----------|--------------------|------------|------------------------|
| ST-1     | ✏ edit    | ✏ edit             | ✏ edit     | 🆕 create              |
| ST-2     | ✏ edit    | —                  | ✏ edit     | —                      |
| ST-3     | ✏ edit    | —                  | ✏ edit     | —                      |
| ST-4     | ✏ edit    | —                  | ✏ edit     | —                      |
| ST-5     | ✏ edit    | —                  | —          | —                      |
| ST-6     | —         | ✏ edit             | ✏ edit     | —                      |
| ST-7     | verify    | verify             | verify     | verify                 |

---

## Preserved Prior Fixes (Do Not Regress)

- Yellow Tier "No" stays in Yellow (no route to green/education).
- `"← Return to Dashboard"` label on Yellow Tier exit buttons.
- Pain evaluation has no `SilenceBar`.
- `SILENCE_PHASE_MAP` does not include `'pain'`.
- Lisinopril 10 mg × 3 doses (08:00, 12:00, 20:00 — but 20:00 to change to 18:00 in ST-4).
- 6-alert lockout after 1 hour; marks `taken: true` to disable button.
- Overdue alarm cancel uses composite key `name__time`.
- Trigger mic `onResult` speaks `"I heard: [transcript]"` + ascending/low-tone chimes.
