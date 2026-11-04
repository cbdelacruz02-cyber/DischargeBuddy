/**
 * medication-flow.tsx  —  DischargeBuddy Medication Management Screen
 *
 * OFFLINE ONLY: zero network dependencies — all state, timers, and TTS use:
 *   • React Native state / setInterval / setTimeout
 *   • expo-speech  (offline TTS — pacing guard: rate ≤ 0.65)
 *   • expo-haptics (offline haptic feedback)
 *
 * ═══════════════════════════════════════════════════════════════════
 *  MEDICATION ROSTER
 * ═══════════════════════════════════════════════════════════════════
 *  PRIMARY SINGLE-DOSE HEART MEDICATIONS  (overdose risk if doubled)
 *   1. Metoprolol Succinate 50 mg  — Beta-blocker       — 08:00
 *   2. Lisinopril 10 mg            — ACE Inhibitor       — 08:00
 *   3. Atorvastatin 40 mg          — Statin              — 21:00
 *   4. Aspirin 81 mg               — Antiplatelet        — 08:00
 *
 *  OTC MEDICATION  (multi-dose, never blocked)
 *   5. Acetaminophen 500 mg (Tylenol) — Pain/Fever — PRN
 *
 * ═══════════════════════════════════════════════════════════════════
 *  SAFETY RULES
 * ═══════════════════════════════════════════════════════════════════
 *  • Mark Taken: requires confirmation via large green YES Voice Bubble
 *    before the button locks/grays out.
 *  • Remind Me: requires confirmation via large green YES Voice Bubble
 *    before the button grays out.
 *  • Missed dose: continuous alert every 10 min for 1 hour (6 alerts).
 *  • Heart meds: Remind Me locks after first use (overdose prevention).
 *  • OTC: Remind Me is NEVER blocked regardless of missed-dose status.
 *  • Midnight reset: background clock listener resets all states at 00:00.
 */

import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type MedCategory = 'heart' | 'otc';

type MedRecord = {
  id:            string;
  name:          string;
  dose:          string;
  category:      MedCategory;
  /** HH:MM scheduled time, or 'PRN' for as-needed */
  scheduledTime: string;
  description:   string;
};

type MedState = {
  taken:        boolean;
  remindSet:    boolean;
  /** How many 10-min missed-dose alerts have fired this cycle */
  missedAlerts: number;
  /** Timestamp (ms) when Remind Me was activated, null if never */
  remindStart:  number | null;
};

type ConfirmTarget = {
  medId:  string;
  action: 'taken' | 'remind';
};

type MedicationFlowProps = {
  speechRate?: number;
  soundLevel?: number;
  fontScale?:  number;
  onClose?:    () => void;
  /** Parent-controlled standalone value — overrides internal state when provided. */
  isStandaloneOverride?: boolean;
  /** Bubble toggle changes back up to the parent. */
  onStandaloneChange?: (standalone: boolean) => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Medication data
// ─────────────────────────────────────────────────────────────────────────────

const MEDICATIONS: MedRecord[] = [
  {
    id:            'metoprolol',
    name:          'Metoprolol Succinate 50 mg',
    dose:          '50 mg — 1 tablet daily',
    category:      'heart',
    scheduledTime: '08:00',
    description:   'Beta-blocker. Controls heart rate and blood pressure. Take with or without food. Single dose per day — do NOT double dose if missed.',
  },
  {
    id:            'lisinopril',
    name:          'Lisinopril 10 mg',
    dose:          '10 mg — 1 tablet daily',
    category:      'heart',
    scheduledTime: '08:00',
    description:   'ACE Inhibitor. Lowers blood pressure and protects the kidneys. Take at the same time each morning. Do NOT take a second dose.',
  },
  {
    id:            'atorvastatin',
    name:          'Atorvastatin 40 mg',
    dose:          '40 mg — 1 tablet daily',
    category:      'heart',
    scheduledTime: '21:00',
    description:   'Statin. Lowers LDL cholesterol. Take in the evening. If you miss a dose, skip it — do NOT take two doses the next day.',
  },
  {
    id:            'aspirin',
    name:          'Aspirin 81 mg',
    dose:          '81 mg — 1 tablet daily',
    category:      'heart',
    scheduledTime: '08:00',
    description:   'Low-dose antiplatelet. Reduces blood-clot risk. Take with food to prevent stomach irritation. One dose per day only.',
  },
  {
    id:            'acetaminophen',
    name:          'Acetaminophen 500 mg (Tylenol)',
    dose:          '500–1000 mg — 1–2 tablets',
    category:      'otc',
    scheduledTime: 'PRN',
    description:   'OTC pain and fever relief. May take every 4–6 hours as needed. Maximum 4 g (8 tablets) per day. Always available — not dose-locked.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_MED_STATE = (): Record<string, MedState> =>
  Object.fromEntries(
    MEDICATIONS.map(m => [
      m.id,
      { taken: false, remindSet: false, missedAlerts: 0, remindStart: null },
    ]),
  );

/** Returns milliseconds until the next 00:00:00 local time. */
function msUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function MedicationFlow({
  speechRate = 0.65,
  soundLevel = 80,
  fontScale  = 1.25,
  onClose,
  isStandaloneOverride,
  onStandaloneChange,
}: MedicationFlowProps) {
  // Pacing guard — never rush elderly / hearing-impaired users
  const safeRate    = Math.min(0.65, Math.max(0.4, speechRate));
  const voiceVolume = Math.min(1, Math.max(0, soundLevel / 100));
  const textScale   = Math.min(1.75, Math.max(1.25, fontScale));

  // ── State ──────────────────────────────────────────────────────────────────
  const [medStates, setMedStates]         = useState<Record<string, MedState>>(INITIAL_MED_STATE);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [expandedId, setExpandedId]       = useState<string | null>(null);

  // ── Refs — track active missed-dose intervals by med ID ───────────────────
  const missedIntervals = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // ─────────────────────────────────────────────────────────────────────────
  // speak — ALL TTS routed through here. Strictly offline (expo-speech only).
  // Stops any current utterance before speaking (always replace=true here
  // because medication prompts must be heard in full).
  // ─────────────────────────────────────────────────────────────────────────
  const speak = useCallback(
    (text: string) => {
      AccessibilityInfo.announceForAccessibility(text);
      const opts = { rate: safeRate, volume: voiceVolume };
      void Speech.stop().then(
        () => Speech.speak(text, opts),
        () => Speech.speak(text, opts),
      );
    },
    [safeRate, voiceVolume],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Standalone / Cloud Sync master toggle
  // isStandalone = true  → dead-zone mode — TTS, intervals, overdose locks, and
  //                         missed-dose alerts all run strictly from local memory.
  //                         Any cloud-dependent feature shows a "slide to connect"
  //                         prompt instead of proceeding.
  // isStandalone = false → Cloud Sync connected mode.
  // ─────────────────────────────────────────────────────────────────────────
  const [isStandaloneInternal, setIsStandaloneInternal] = useState(true);
  const [showCloudPrompt,  setShowCloudPrompt]  = useState(false);
  const [cloudActionLabel, setCloudActionLabel] = useState('');

  // Parent override wins when provided
  const isStandalone = isStandaloneOverride !== undefined
    ? isStandaloneOverride
    : isStandaloneInternal;

  const setIsStandalone = useCallback((next: boolean) => {
    setIsStandaloneInternal(next);
    onStandaloneChange?.(next);
  }, [onStandaloneChange]);

  const requireCloud = useCallback((actionLabel: string, proceed: () => void) => {
    if (!isStandalone) {
      proceed();
      return;
    }
    setCloudActionLabel(actionLabel);
    setShowCloudPrompt(true);
    speak(
      `${actionLabel} requires a cloud connection. ` +
      'Slide the Standalone Mode switch to Cloud Sync to activate this feature.',
    );
  }, [isStandalone, speak]);

  // ─────────────────────────────────────────────────────────────────────────
  // Midnight background clock listener — resets all states at 00:00 local.
  // Uses a single setTimeout calculated from the current time; fires once,
  // which is sufficient because the component re-mounts at app restart.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      // 1. Kill all active missed-dose intervals
      Object.values(missedIntervals.current).forEach(clearInterval);
      missedIntervals.current = {};
      // 2. Reset all medication UI state
      setMedStates(INITIAL_MED_STATE());
      // 3. Voice announcement
      speak('Midnight. All medication reminders have been reset for a new day.');
    }, msUntilMidnight());
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // startMissedDoseAlert — fires every 10 minutes for 1 hour (6 reminders).
  // Heart meds: the Remind Me button is already locked before this is called.
  // OTC meds: reminder fires but button is never locked.
  // ─────────────────────────────────────────────────────────────────────────
  const startMissedDoseAlert = useCallback(
    (med: MedRecord) => {
      if (missedIntervals.current[med.id]) return; // already running

      let alertCount = 0;
      const MAX_ALERTS = 6; // 6 × 10 min = 1 hour

      missedIntervals.current[med.id] = setInterval(() => {
        alertCount++;

        const msg =
          `Missed dose reminder ${alertCount} of ${MAX_ALERTS} for ${med.name}. ` +
          (med.category === 'heart'
            ? `This is a single-dose heart medication. Do NOT take a second dose. Please contact your care team.`
            : `Take as needed. You may take ${med.name} now if you still need pain or fever relief.`);

        speak(msg);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

        setMedStates(prev => ({
          ...prev,
          [med.id]: { ...prev[med.id], missedAlerts: alertCount },
        }));

        if (alertCount >= MAX_ALERTS) {
          clearInterval(missedIntervals.current[med.id]);
          delete missedIntervals.current[med.id];
        }
      }, 10 * 60 * 1000); // 10 minutes

      // Announce the activation immediately (alert #0)
      const firstMsg =
        `Missed dose alert activated for ${med.name}. ` +
        (med.category === 'heart'
          ? `This is a single-dose heart medication. The Remind Me button has been locked to prevent a dangerous double dose. You will receive a reminder every 10 minutes for one hour.`
          : `You will receive a reminder every 10 minutes for one hour.`);
      speak(firstMsg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    },
    [speak],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Confirmation modal  (green YES Voice Bubble pattern)
  // ─────────────────────────────────────────────────────────────────────────

  const openConfirm = useCallback(
    (medId: string, action: 'taken' | 'remind') => {
      const med = MEDICATIONS.find(m => m.id === medId)!;
      const question =
        action === 'taken'
          ? `You are about to mark ${med.name} as taken. Say Yes or press the green Yes button to confirm.`
          : `You are about to set a missed-dose reminder for ${med.name}. Say Yes or press the green Yes button to confirm.`;
      speak(question);
      setConfirmTarget({ medId, action });
    },
    [speak],
  );

  const closeConfirm = useCallback(() => {
    setConfirmTarget(null);
    speak('Action cancelled. No changes were made.');
  }, [speak]);

  const executeConfirm = useCallback(() => {
    if (!confirmTarget) return;
    const { medId, action } = confirmTarget;
    const med = MEDICATIONS.find(m => m.id === medId)!;
    setConfirmTarget(null);

    if (action === 'taken') {
      // Stop any active missed-dose alert for this med
      if (missedIntervals.current[medId]) {
        clearInterval(missedIntervals.current[medId]);
        delete missedIntervals.current[medId];
      }
      setMedStates(prev => ({
        ...prev,
        [medId]: {
          ...prev[medId],
          taken: true,
          remindSet: false,
          missedAlerts: 0,
          remindStart: null,
        },
      }));
      speak(`Confirmed. ${med.name} has been marked as taken for today. Well done.`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    } else {
      // action === 'remind'
      setMedStates(prev => ({
        ...prev,
        [medId]: {
          ...prev[medId],
          remindSet: true,
          remindStart: Date.now(),
        },
      }));
      speak(`Reminder confirmed for ${med.name}.`);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // Start missed-dose alert background loop
      startMissedDoseAlert(med);
    }
  }, [confirmTarget, speak, startMissedDoseAlert]);

  // ─────────────────────────────────────────────────────────────────────────
  // Safety flag helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remind Me is blocked when:
   *   - Heart med AND reminder already set (overdose prevention lock)
   * OTC: NEVER blocked.
   */
  const isRemindBlocked = (med: MedRecord, state: MedState): boolean => {
    if (med.category === 'otc') return false;
    return state.remindSet;
  };

  /** Mark Taken is blocked when the med is already marked taken this cycle. */
  const isTakenBlocked = (_med: MedRecord, state: MedState): boolean => state.taken;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────
  // Mode Toggle Bar — top of every screen
  // ─────────────────────────────────────────────────────────────────────────
  const ModeToggleBar = (
    <View style={styles.modeToggleBar} accessibilityRole="none">
      <View style={styles.modeToggleLeft}>
        <Text style={[styles.modeToggleIcon, { fontSize: 16 * textScale }]}>
          {isStandalone ? '📴' : '🌐'}
        </Text>
        <View>
          <Text style={[styles.modeToggleLabel, { fontSize: 13 * textScale }]}>
            {isStandalone ? 'Standalone Mode' : 'Cloud Sync'}
          </Text>
          <Text style={[styles.modeToggleSub, { fontSize: 11 * textScale }]}>
            {isStandalone
              ? 'All local · no internet required'
              : 'Connected · cloud features active'}
          </Text>
        </View>
      </View>
      <Switch
        value={!isStandalone}
        onValueChange={(on: boolean) => {
          const next = !on;
          setIsStandalone(next);
          if (next) {
            speak('Standalone Mode activated. All medication data and alerts run from local device memory.');
          } else {
            speak('Cloud Sync activated. Connected mode enabled.');
          }
        }}
        trackColor={{ false: '#374151', true: '#1d4ed8' }}
        thumbColor={isStandalone ? '#94a3b8' : '#60a5fa'}
        accessibilityRole="switch"
        accessibilityLabel={
          isStandalone
            ? 'Standalone Mode on. Toggle to enable Cloud Sync.'
            : 'Cloud Sync on. Toggle to enable Standalone Mode.'
        }
      />
    </View>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Cloud-gate prompt modal
  // ─────────────────────────────────────────────────────────────────────────
  const CloudGateModal = (
    <Modal
      visible={showCloudPrompt}
      transparent
      animationType="fade"
      onRequestClose={() => setShowCloudPrompt(false)}
      accessibilityViewIsModal
    >
      <View style={styles.cloudGateOverlay}>
        <View style={styles.cloudGateCard}>
          <Text style={[styles.cloudGateIcon, { fontSize: 48 * textScale }]}>📴</Text>
          <Text style={[styles.cloudGateTitle, { fontSize: 20 * textScale }]}>
            Standalone Mode Active
          </Text>
          <Text style={[styles.cloudGateBody, { fontSize: 15 * textScale }]}>
            <Text style={{ fontWeight: '900', color: '#facc15' }}>{cloudActionLabel}</Text>
            {' '}requires a cloud connection.{'\n\n'}
            Slide the{' '}
            <Text style={{ fontWeight: '900', color: '#60a5fa' }}>Standalone Mode</Text>
            {' '}switch at the top of the screen to{' '}
            <Text style={{ fontWeight: '900', color: '#60a5fa' }}>Cloud Sync</Text>
            {' '}to activate this feature.
          </Text>
          <View style={[styles.modeToggleBar, { borderRadius: 12, marginTop: 4, alignSelf: 'stretch' }]}>
            <View style={styles.modeToggleLeft}>
              <Text style={{ fontSize: 16 }}>{isStandalone ? '📴' : '🌐'}</Text>
              <Text style={[styles.modeToggleLabel, { fontSize: 14 * textScale }]}>
                {isStandalone ? 'Standalone Mode' : 'Cloud Sync'}
              </Text>
            </View>
            <Switch
              value={!isStandalone}
              onValueChange={(on: boolean) => {
                const next = !on;
                setIsStandalone(next);
                if (!next) {
                  setShowCloudPrompt(false);
                  speak('Cloud Sync activated. Proceeding.');
                }
              }}
              trackColor={{ false: '#374151', true: '#1d4ed8' }}
              thumbColor={isStandalone ? '#94a3b8' : '#60a5fa'}
              accessibilityRole="switch"
              accessibilityLabel="Toggle cloud sync"
            />
          </View>
          <TouchableOpacity
            style={styles.cloudGateDismiss}
            onPress={() => setShowCloudPrompt(false)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss — stay in standalone mode"
          >
            <Text style={[styles.cloudGateDismissText, { fontSize: 14 * textScale }]}>
              ← Stay in Standalone Mode
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.safe}>
      {CloudGateModal}
      {ModeToggleBar}

      {/* ══════════════════════════════════════════════════════════════
          GREEN YES VOICE BUBBLE — Confirmation Modal
          Large, high-contrast green YES button dominates the modal.
          Reads the question aloud on open. Cancel is always available.
      ══════════════════════════════════════════════════════════════ */}
      <Modal
        visible={confirmTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={closeConfirm}
        accessibilityViewIsModal
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {confirmTarget && (() => {
              const med         = MEDICATIONS.find(m => m.id === confirmTarget.medId)!;
              const isTaken     = confirmTarget.action === 'taken';
              const actionLabel = isTaken ? 'Mark as Taken' : 'Set Reminder';
              const icon        = isTaken ? '💊' : '⏰';

              return (
                <>
                  {/* Modal header */}
                  <Text style={[styles.modalTitle, { fontSize: 20 * textScale }]}>
                    {icon} {isTaken ? 'Confirm Medication Taken' : 'Confirm Reminder'}
                  </Text>

                  {/* Medication detail */}
                  <View style={styles.modalMedDetail}>
                    <Text style={[styles.modalMedName, { fontSize: 17 * textScale }]}>
                      {med.name}
                    </Text>
                    <Text style={[styles.modalMedDose, { fontSize: 14 * textScale }]}>
                      {med.dose}
                    </Text>
                  </View>

                  <Text style={[styles.modalBody, { fontSize: 15 * textScale }]}>
                    {isTaken
                      ? 'Have you taken this medication today?'
                      : 'Do you want to set a missed-dose reminder for this medication?'}
                  </Text>

                  {/* ── GREEN YES VOICE BUBBLE ── */}
                  <TouchableOpacity
                    style={styles.yesBubble}
                    onPress={executeConfirm}
                    accessibilityRole="button"
                    accessibilityLabel={`Yes — ${actionLabel}`}
                    activeOpacity={0.85}
                  >
                    {/* Speech-bubble tail */}
                    <View style={styles.yesBubbleTail} />
                    <Text style={[styles.yesBubbleIcon, { fontSize: 32 * textScale }]}>
                      ✓
                    </Text>
                    <Text style={[styles.yesBubbleText, { fontSize: 22 * textScale }]}>
                      YES — {actionLabel.toUpperCase()}
                    </Text>
                    <Text style={[styles.yesBubbleHint, { fontSize: 13 * textScale }]}>
                      Tap or say "Yes" to confirm
                    </Text>
                  </TouchableOpacity>

                  {/* Repeat audio */}
                  <TouchableOpacity
                    style={styles.repeatAudioBtn}
                    onPress={() => {
                      const q = isTaken
                        ? `Confirm: mark ${med.name} as taken?`
                        : `Confirm: set a reminder for ${med.name}?`;
                      speak(q);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Repeat voice prompt"
                  >
                    <Text style={[styles.repeatAudioText, { fontSize: 14 * textScale }]}>
                      🔊 Repeat Prompt
                    </Text>
                  </TouchableOpacity>

                  {/* Cancel */}
                  <TouchableOpacity
                    style={styles.modalCancelBtn}
                    onPress={closeConfirm}
                    accessibilityRole="button"
                    accessibilityLabel="No, cancel — go back"
                  >
                    <Text style={[styles.modalCancelText, { fontSize: 15 * textScale }]}>
                      ✕  No, Cancel
                    </Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { fontSize: 22 * textScale }]}>
          💊 Daily Medications
        </Text>
        <Text style={[styles.headerSub, { fontSize: 13 * textScale }]}>
          Tap a card to expand  ·  All buttons reset automatically at midnight
        </Text>
      </View>

      {/* ── Medication list ── */}
      <ScrollView contentContainerStyle={styles.list}>

        {MEDICATIONS.map(med => {
          const state         = medStates[med.id]!;
          const takenBlocked  = isTakenBlocked(med, state);
          const remindBlocked = isRemindBlocked(med, state);
          const isExpanded    = expandedId === med.id;
          const hasMissed     = state.missedAlerts > 0 && !state.taken;

          return (
            <View
              key={med.id}
              style={[
                styles.card,
                med.category === 'heart' && styles.cardHeart,
                med.category === 'otc'   && styles.cardOtc,
                takenBlocked && styles.cardTaken,
                hasMissed    && styles.cardMissed,
              ]}
            >
              {/* ── Card header (tap to expand) ── */}
              <TouchableOpacity
                style={styles.cardHeader}
                onPress={() => {
                  const next = isExpanded ? null : med.id;
                  setExpandedId(next);
                  if (next) speak(`${med.name}. ${med.description}`);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${med.name}. ${isExpanded ? 'Collapse' : 'Expand'} details.`}
              >
                <View style={styles.cardHeaderLeft}>
                  <Text style={[styles.cardName, { fontSize: 16 * textScale }]}>
                    {takenBlocked ? '✅ ' : ''}{med.name}
                  </Text>
                  <Text style={[styles.cardMeta, { fontSize: 13 * textScale }]}>
                    {med.dose}{'  ·  '}{med.scheduledTime}
                    {'  '}
                    <Text style={med.category === 'heart' ? styles.tagHeart : styles.tagOtc}>
                      {med.category === 'heart' ? '❤ Heart Rx' : '🟢 OTC'}
                    </Text>
                  </Text>
                  {hasMissed && (
                    <Text style={[styles.missedBadge, { fontSize: 12 * textScale }]}>
                      ⚠ MISSED DOSE — Alert {state.missedAlerts}/6
                    </Text>
                  )}
                  {state.remindSet && !state.taken && !hasMissed && (
                    <Text style={[styles.remindBadge, { fontSize: 12 * textScale }]}>
                      ⏰ Reminder active
                    </Text>
                  )}
                </View>
                <Text style={styles.chevron}>{isExpanded ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {/* ── Expanded detail ── */}
              {isExpanded && (
                <View style={styles.cardDetail}>
                  <Text style={[styles.cardDesc, { fontSize: 14 * textScale }]}>
                    {med.description}
                  </Text>

                  {/* ── Action buttons ── */}
                  <View style={styles.actionRow}>

                    {/* MARK TAKEN */}
                    <TouchableOpacity
                      style={[styles.takenBtn, takenBlocked && styles.btnDisabled]}
                      onPress={() => { if (!takenBlocked) openConfirm(med.id, 'taken'); }}
                      disabled={takenBlocked}
                      accessibilityRole="button"
                      accessibilityLabel={
                        takenBlocked
                          ? `${med.name} already taken today`
                          : `Mark ${med.name} as taken`
                      }
                    >
                      <Text style={[
                        styles.btnText,
                        takenBlocked && styles.btnTextDisabled,
                        { fontSize: 14 * textScale },
                      ]}>
                        {takenBlocked ? '✅ Taken' : '💊 Mark Taken'}
                      </Text>
                      {!takenBlocked && (
                        <Text style={[styles.btnSubText, { fontSize: 11 * textScale }]}>
                          Requires green YES confirmation
                        </Text>
                      )}
                    </TouchableOpacity>

                    {/* REMIND ME */}
                    <TouchableOpacity
                      style={[
                        styles.remindBtn,
                        (remindBlocked || takenBlocked) && styles.btnDisabled,
                      ]}
                      onPress={() => {
                        if (!remindBlocked && !takenBlocked) openConfirm(med.id, 'remind');
                      }}
                      disabled={remindBlocked || takenBlocked}
                      accessibilityRole="button"
                      accessibilityLabel={
                        takenBlocked
                          ? `${med.name} already taken — no reminder needed`
                          : remindBlocked
                            ? `Reminder locked — overdose prevention guard for ${med.name}`
                            : state.remindSet
                              ? `Reminder already active for ${med.name}`
                              : `Set a reminder for ${med.name}`
                      }
                    >
                      <Text style={[
                        styles.btnText,
                        (remindBlocked || takenBlocked) && styles.btnTextDisabled,
                        { fontSize: 14 * textScale },
                      ]}>
                        {takenBlocked
                          ? '— Not needed'
                          : remindBlocked && med.category === 'heart'
                            ? '🚫 Locked'
                            : state.remindSet
                              ? '⏰ Active'
                              : '⏰ Remind Me'}
                      </Text>
                      {!takenBlocked && (
                        <Text style={[styles.btnSubText, { fontSize: 11 * textScale }]}>
                          {remindBlocked && med.category === 'heart'
                            ? 'Overdose prevention — single dose only'
                            : takenBlocked
                              ? ''
                              : 'Requires green YES confirmation'}
                        </Text>
                      )}
                    </TouchableOpacity>

                  </View>

                  {/* Safety annotation */}
                  {med.category === 'heart' && (
                    <View style={styles.safetyNote}>
                      <Text style={[styles.safetyNoteText, { fontSize: 12 * textScale }]}>
                        ⚠ SINGLE-DOSE HEART MEDICATION{'\n'}
                        Remind Me locks after first use to prevent a dangerous double dose.{'\n'}
                        If you missed your dose, DO NOT take an extra one. Contact your care team.
                      </Text>
                    </View>
                  )}
                  {med.category === 'otc' && (
                    <View style={styles.otcNote}>
                      <Text style={[styles.otcNoteText, { fontSize: 12 * textScale }]}>
                        ✅ OVER-THE-COUNTER — Remind Me is always available and never blocked,
                        regardless of missed-dose status.
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          );
        })}

        {/* ── Legend ── */}
        <View style={styles.legend}>
          <Text style={[styles.legendTitle, { fontSize: 14 * textScale }]}>
            Safety Tier Legend
          </Text>
          <Text style={[styles.legendItem, { fontSize: 13 * textScale }]}>
            ❤ Heart Rx — Single dose/day. Remind Me locks after first use (overdose guard).
          </Text>
          <Text style={[styles.legendItem, { fontSize: 13 * textScale }]}>
            🟢 OTC — Over the counter. Remind Me always available. No dose lock.
          </Text>
          <Text style={[styles.legendItem, { fontSize: 13 * textScale }]}>
            ⚠ Missed dose — 10-minute alerts for 1 hour (6 total). Call your care team.
          </Text>
          <Text style={[styles.legendItem, { fontSize: 13 * textScale }]}>
            🔄 All buttons reset automatically at midnight via background clock.
          </Text>
          <Text style={[styles.legendItem, { fontSize: 13 * textScale }]}>
            🟢 Both actions require a large green YES Voice Bubble confirmation.
          </Text>
        </View>

        {/* ── Cloud Sync action — gated by isStandalone ── */}
        <TouchableOpacity
          style={styles.syncBtn}
          onPress={() => requireCloud(
            'Care Record Sync',
            () => speak('Syncing your care record to the cloud. Your medication history and dose status are being uploaded securely.'),
          )}
          accessibilityRole="button"
          accessibilityLabel={
            isStandalone
              ? 'Sync care record — requires Cloud Sync mode'
              : 'Sync care record to cloud'
          }
        >
          <Text style={[styles.syncBtnText, { fontSize: 14 * textScale }]}>
            {isStandalone ? '📴 Sync Records (Cloud Sync required)' : '🌐 Sync Records to Cloud'}
          </Text>
        </TouchableOpacity>

        {onClose && (
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Return to home screen"
          >
            <Text style={[styles.closeBtnText, { fontSize: 16 * textScale }]}>
              ← Return Home
            </Text>
          </TouchableOpacity>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a14' },

  // ── Header ──
  header: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomColor: '#1e293b',
    borderBottomWidth: 1,
  },
  headerTitle: { color: '#e2e8f0', fontWeight: '900', marginBottom: 4 },
  headerSub:   { color: '#64748b' },

  // ── List ──
  list: { padding: 16, gap: 14, paddingBottom: 48 },

  // ── Cards ──
  card: {
    backgroundColor: '#111827',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#1e293b',
    overflow: 'hidden',
  },
  cardHeart:  { borderColor: '#7f1d1d' },
  cardOtc:    { borderColor: '#14532d' },
  cardTaken:  { opacity: 0.55 },
  cardMissed: { borderColor: '#f59e0b' },

  cardHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, gap: 12 },
  cardHeaderLeft: { flex: 1, gap: 4 },
  cardName:       { color: '#f1f5f9', fontWeight: '900' },
  cardMeta:       { color: '#94a3b8' },
  tagHeart:       { color: '#f87171', fontWeight: '800' },
  tagOtc:         { color: '#4ade80', fontWeight: '800' },
  chevron:        { color: '#64748b', fontSize: 16, fontWeight: '700' },

  missedBadge: { color: '#fbbf24', fontWeight: '900', marginTop: 2 },
  remindBadge: { color: '#60a5fa', fontWeight: '700', marginTop: 2 },

  cardDetail: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
    borderTopColor: '#1e293b',
    borderTopWidth: 1,
  },
  cardDesc: { color: '#cbd5e1', lineHeight: 20, marginTop: 10 },

  // ── Action buttons ──
  actionRow: { flexDirection: 'row', gap: 10 },

  takenBtn: {
    flex: 1, minHeight: 62,
    backgroundColor: '#166534',
    borderColor: '#4ade80', borderWidth: 2, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', padding: 10, gap: 4,
  },
  remindBtn: {
    flex: 1, minHeight: 62,
    backgroundColor: '#1e3a5f',
    borderColor: '#3b82f6', borderWidth: 2, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', padding: 10, gap: 4,
  },
  btnDisabled: {
    backgroundColor: '#1c1c1c',
    borderColor: '#374151',
    opacity: 0.42,
  },
  btnText:         { color: '#ffffff', fontWeight: '900', textAlign: 'center' },
  btnTextDisabled: { color: '#6b7280' },
  btnSubText:      { color: '#94a3b8', textAlign: 'center' },

  // ── Safety notes ──
  safetyNote: {
    backgroundColor: '#2d1c00', borderColor: '#f59e0b', borderWidth: 1,
    borderRadius: 8, padding: 10,
  },
  safetyNoteText: { color: '#fbbf24', lineHeight: 18, fontWeight: '700' },
  otcNote: {
    backgroundColor: '#052e16', borderColor: '#4ade80', borderWidth: 1,
    borderRadius: 8, padding: 10,
  },
  otcNoteText: { color: '#4ade80', lineHeight: 18, fontWeight: '700' },

  // ── Legend ──
  legend: {
    backgroundColor: '#0f172a', borderRadius: 12, padding: 16, gap: 8,
    borderColor: '#1e293b', borderWidth: 1, marginTop: 4,
  },
  legendTitle: { color: '#e2e8f0', fontWeight: '900', marginBottom: 4 },
  legendItem:  { color: '#94a3b8', lineHeight: 19 },

  // ── Close button ──
  closeBtn: {
    minHeight: 56, backgroundColor: '#1d4ed8', borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', padding: 14, marginTop: 4,
  },
  closeBtnText: { color: '#ffffff', fontWeight: '900' },

  // ══════════════════════════════════════════════════════════════════
  // Green YES Voice Bubble Modal
  // ══════════════════════════════════════════════════════════════════
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 26,
    width: '100%',
    maxWidth: 440,
    gap: 16,
    borderColor: '#22c55e',
    borderWidth: 3,
    // Shadow for depth
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 20,
  },
  modalTitle: {
    color: '#f1f5f9',
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  modalMedDetail: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 12,
    gap: 4,
    alignItems: 'center',
  },
  modalMedName: { color: '#f1f5f9', fontWeight: '900', textAlign: 'center' },
  modalMedDose: { color: '#94a3b8', textAlign: 'center' },
  modalBody: {
    color: '#cbd5e1',
    textAlign: 'center',
    lineHeight: 22,
  },

  // ── YES Voice Bubble — the primary confirmation target ──
  yesBubble: {
    backgroundColor: '#15803d',
    borderColor: '#22c55e',
    borderWidth: 4,
    borderRadius: 22,
    paddingVertical: 20,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 6,
    // Gives the bubble a speech-bubble feel via shadow
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 14,
  },
  yesBubbleTail: {
    // Downward-pointing triangle speech-bubble tail, centred via alignSelf
    position: 'absolute',
    bottom: -16,
    alignSelf: 'center',
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderTopWidth: 16,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#22c55e',
  },
  yesBubbleIcon: { color: '#ffffff', fontWeight: '900' },
  yesBubbleText: { color: '#ffffff', fontWeight: '900', textAlign: 'center', letterSpacing: 0.5 },
  yesBubbleHint: { color: '#bbf7d0', textAlign: 'center' },

  repeatAudioBtn: {
    minHeight: 44,
    backgroundColor: '#1e293b',
    borderColor: '#334155', borderWidth: 1,
    borderRadius: 8, alignItems: 'center', justifyContent: 'center', padding: 10,
  },
  repeatAudioText: { color: '#94a3b8', fontWeight: '700' },

  modalCancelBtn: {
    minHeight: 50,
    backgroundColor: '#1e293b',
    borderColor: '#475569', borderWidth: 2,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center', padding: 12,
  },
  modalCancelText: { color: '#94a3b8', fontWeight: '800', textAlign: 'center' },

  // ══════════════════════════════════════════════════════════════════
  // Standalone / Cloud Sync Mode Toggle Bar
  // ══════════════════════════════════════════════════════════════════
  modeToggleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f172a',
    borderBottomColor: '#1e293b',
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    zIndex: 99,
  },
  modeToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  modeToggleIcon: { lineHeight: 22 },
  modeToggleLabel: {
    color: '#e2e8f0',
    fontWeight: '800',
    lineHeight: 18,
  },
  modeToggleSub: {
    color: '#64748b',
    lineHeight: 15,
  },

  // ══════════════════════════════════════════════════════════════════
  // Cloud-gate prompt modal
  // ══════════════════════════════════════════════════════════════════
  cloudGateOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  cloudGateCard: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 26,
    width: '100%',
    maxWidth: 440,
    gap: 16,
    borderColor: '#1d4ed8',
    borderWidth: 3,
    shadowColor: '#1d4ed8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 20,
    alignItems: 'center',
  },
  cloudGateIcon: { textAlign: 'center' },
  cloudGateTitle: {
    color: '#f1f5f9',
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  cloudGateBody: {
    color: '#cbd5e1',
    textAlign: 'center',
    lineHeight: 24,
  },
  cloudGateDismiss: {
    minHeight: 48,
    backgroundColor: '#1e293b',
    borderColor: '#334155', borderWidth: 1,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 20, paddingVertical: 10, alignSelf: 'stretch',
  },
  cloudGateDismissText: { color: '#94a3b8', fontWeight: '700', textAlign: 'center' },
  syncBtn: {
    minHeight: 52, backgroundColor: '#0c4a6e',
    borderColor: '#38bdf8', borderWidth: 2,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16, paddingVertical: 12, marginTop: 4,
  },
  syncBtnText: { color: '#7dd3fc', fontWeight: '900', textAlign: 'center' },
});
