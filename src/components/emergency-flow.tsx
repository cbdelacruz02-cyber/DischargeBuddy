import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getLanguage, type LanguageLabel } from '@/constants/safety-content';
import { getUiCopy } from '@/constants/ui-copy';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Phase =
  | 'pause'       // mandatory 2-second system pause on entry
  | 'inter-pause' // mandatory 2-second buffer between phase transitions
  | 'pain'        // pain score evaluation screen
  | 'countdown'   // Red Tier: score 8-10, 10-second automation countdown
  | 'yellow'      // Yellow Tier: score 1-7, calm nurse-line screen
  | 'green'       // Green Tier: educational / standard info cards
  | 'simulated'   // Red Tier auto-dispatch outcome
  | 'cancelled';  // user cancelled

type EmergencyFlowProps = {
  languageLabel: LanguageLabel;
  fontScale: number;
  soundLevel: number;
  speechRate: number;
  onClose: () => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function EmergencyFlow({
  languageLabel,
  fontScale,
  soundLevel,
  speechRate,
  onClose,
}: EmergencyFlowProps) {
  const language = getLanguage(languageLabel);
  const copy     = getUiCopy(languageLabel);
  const voiceVolume = Math.min(1, Math.max(0, soundLevel / 100));
  const textScale   = Math.min(1.75, Math.max(1.25, fontScale));

  // ── State ──────────────────────────────────────────────────────────────────
  const [phase, setPhase]             = useState<Phase>('pause');
  const [pauseSeconds, setPauseSeconds] = useState(2);
  const [countdown, setCountdown]     = useState(10);
  const [painScore, setPainScore]     = useState<number | null>(null);
  // nextPhase holds the phase queued behind an inter-pause
  const [nextPhase, setNextPhase]     = useState<Phase | null>(null);
  const [interSeconds, setInterSeconds] = useState(2);

  // ── Animation refs ─────────────────────────────────────────────────────────
  const pulse      = useRef(new Animated.Value(1)).current;
  const frameFlash = useRef(new Animated.Value(0.2)).current;
  const wavePulse  = useRef(new Animated.Value(1)).current;   // Yellow Tier slow wave

  // ── TTS guard ──────────────────────────────────────────────────────────────
  const spokenPhase = useRef<string | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // speak
  // replace=false (default): queue — lets current speech finish first.
  // replace=true: stop current speech then start immediately (e.g. repeat btn).
  // ─────────────────────────────────────────────────────────────────────────
  const speak = useCallback(
    (text: string, replace = false) => {
      AccessibilityInfo.announceForAccessibility(text);
      const opts = { language: language.code, rate: speechRate, volume: voiceVolume };
      if (replace) {
        void Speech.stop().then(() => Speech.speak(text, opts), () => Speech.speak(text, opts));
      } else {
        Speech.speak(text, opts);
      }
    },
    [language.code, speechRate, voiceVolume],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // transitionTo — always inserts a 2-second inter-phase audio-clear pause
  // before switching to any new phase, preventing TTS/haptic collisions.
  // ─────────────────────────────────────────────────────────────────────────
  const transitionTo = useCallback((target: Phase) => {
    Speech.stop();
    Vibration.cancel();
    spokenPhase.current = null;
    setNextPhase(target);
    setInterSeconds(2);
    setPhase('inter-pause');
  }, []);

  // ── Initial mount prompt ───────────────────────────────────────────────────
  useEffect(() => {
    speak(language.emergencyPrompt);
    return () => {
      Speech.stop();
      Vibration.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Entry pause timer (2 s before first pain screen) ──────────────────────
  useEffect(() => {
    if (phase !== 'pause') return;
    if (pauseSeconds === 0) {
      setPhase('pain');
      return;
    }
    if ([2, 1].includes(pauseSeconds)) {
      AccessibilityInfo.announceForAccessibility(`${pauseSeconds} second safety pause.`);
    }
    const t = setTimeout(() => setPauseSeconds(v => v - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, pauseSeconds]);

  // ── Inter-phase pause timer (2 s buffer between any two phases) ───────────
  useEffect(() => {
    if (phase !== 'inter-pause') return;
    if (interSeconds === 0 && nextPhase !== null) {
      const target = nextPhase;
      setNextPhase(null);
      setPhase(target);
      return;
    }
    const t = setTimeout(() => setInterSeconds(v => v - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, interSeconds, nextPhase]);

  // ── Phase-change TTS (fires ONCE per phase) ───────────────────────────────
  useEffect(() => {
    if (spokenPhase.current === phase) return;
    spokenPhase.current = phase;

    if (phase === 'pain')      speak(`${copy.painScale} ${copy.painHint} ${copy.noResponseDemo}`);
    if (phase === 'countdown') speak(language.emergencyConfirmationPrompt);
    if (phase === 'yellow')    speak(language.yellowTierPrompt);
    if (phase === 'green')     speak(copy.greenTierPrompt ?? 'Educational mode. Tap any card to hear more.');
    if (phase === 'simulated') speak(language.simulatedEscalationPrompt);
    if (phase === 'cancelled') speak(language.cancelledPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Haptics per tier ───────────────────────────────────────────────────────
  useEffect(() => {
    // Entry pause: single warning burst
    if (phase === 'pause') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Vibration.vibrate([0, 300, 200, 300]);
      return;
    }
    // Red Tier: urgent rhythmic heavy impacts
    if (phase === 'pain' || phase === 'countdown') {
      const iv = setInterval(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        Vibration.vibrate([0, 250, 150, 250]);
      }, 1200);
      return () => { clearInterval(iv); Vibration.cancel(); };
    }
    // Yellow Tier: slow wave — light → medium → heavy → medium → light
    if (phase === 'yellow') {
      const wave = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 200);
        setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),  400);
        setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 600);
        setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),  800);
      };
      wave();
      const iv = setInterval(wave, 4000);
      return () => clearInterval(iv);
    }
    // Green Tier: gentle single tap on entry only
    if (phase === 'green') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [phase]);

  // ── Red Tier: countdown accessibility announcements ───────────────────────
  useEffect(() => {
    if (
      (phase === 'pain' || phase === 'countdown') &&
      [10, 5, 3, 2, 1, 0].includes(countdown)
    ) {
      AccessibilityInfo.announceForAccessibility(copy.secondsRemaining(countdown));
    }
  }, [countdown, phase, copy]);

  // ── Red Tier: countdown timer ─────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'pain' && phase !== 'countdown') return;
    if (countdown === 0) {
      transitionTo('simulated');
      return;
    }
    const t = setTimeout(() => setCountdown(v => v - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, phase, transitionTo]);

  // ── Red Tier: urgent pulse animation (countdown ≤ 3) ─────────────────────
  useEffect(() => {
    if ((phase !== 'pain' && phase !== 'countdown') || countdown > 3) {
      pulse.setValue(1);
      return;
    }
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.12, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1,    duration: 320, easing: Easing.in(Easing.quad),  useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [countdown, phase, pulse]);

  // ── Red Tier: flashing border overlay ────────────────────────────────────
  useEffect(() => {
    if (phase !== 'pause' && phase !== 'pain' && phase !== 'countdown') {
      frameFlash.setValue(0);
      return;
    }
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(frameFlash, { toValue: 0.9, duration: 650, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(frameFlash, { toValue: 0.2, duration: 650, easing: Easing.linear, useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [frameFlash, phase]);

  // ── Yellow Tier: slow wave pulse animation ────────────────────────────────
  useEffect(() => {
    if (phase !== 'yellow') {
      wavePulse.setValue(1);
      return;
    }
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(wavePulse, { toValue: 1.06, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(wavePulse, { toValue: 1,    duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [phase, wavePulse]);

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────

  const cancel = () => transitionTo('cancelled');

  const confirm = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    transitionTo('simulated');
  };

  const handlePainScore = (score: number) => {
    setPainScore(score);
    Haptics.selectionAsync();
    setCountdown(10);
    if (score >= 8) {
      transitionTo('countdown');  // Red Tier
    } else {
      transitionTo('yellow');     // Yellow Tier
    }
  };

  const handleGreenTier = () => transitionTo('green');

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────

  // Inter-phase buffer screen
  if (phase === 'inter-pause') {
    return (
      <SafeAreaView style={styles.interPauseScreen}>
        <Text style={[styles.interPauseText, { fontSize: 18 * textScale }]}>
          {interSeconds > 0 ? `${interSeconds}` : '…'}
        </Text>
      </SafeAreaView>
    );
  }

  // ── Green Tier ─────────────────────────────────────────────────────────────
  if (phase === 'green') {
    const cards = [
      { id: 'discharge', label: copy.greenCardDischarge  ?? 'Discharge Instructions', body: copy.greenCardDischargeBody  ?? 'Review your discharge paperwork carefully. Ask your nurse to confirm medication dosages.' },
      { id: 'followup',  label: copy.greenCardFollowUp   ?? 'Follow-Up Appointment',  body: copy.greenCardFollowUpBody   ?? 'Schedule your follow-up within 48–72 hours. Call the clinic if symptoms worsen.' },
      { id: 'meds',      label: copy.greenCardMeds       ?? 'Medication Reminders',   body: copy.greenCardMedsBody       ?? 'Set phone alarms for each dose. Do not skip doses even if you feel better.' },
      { id: 'emergency', label: copy.greenCardEmergency  ?? 'When to Call 911',       body: copy.greenCardEmergencyBody  ?? 'Chest pain, difficulty breathing, confusion, or sudden severe pain are emergencies.' },
    ];
    return (
      <SafeAreaView style={styles.greenScreen}>
        <ScrollView contentContainerStyle={styles.greenContent}>
          <Text style={[styles.greenTitle, { fontSize: 24 * textScale }]}>
            {copy.greenTierTitle ?? 'Care Information'}
          </Text>
          {cards.map(card => (
            <TouchableOpacity
              key={card.id}
              style={styles.greenCard}
              onPress={() => speak(card.body, true)}
              onLongPress={() => speak(card.body, true)}
              accessibilityRole="button"
              accessibilityLabel={`${card.label}. Double tap to hear.`}
            >
              <Text style={[styles.greenCardLabel, { fontSize: 17 * textScale }]}>
                {card.label}
              </Text>
              <Text style={[styles.greenCardBody, { fontSize: 15 * textScale }]}>
                {card.body}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.exitButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={copy.returnHome}
          >
            <Text style={[styles.actionText, { fontSize: 17 * textScale }]}>
              {copy.returnHome}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Yellow Tier ────────────────────────────────────────────────────────────
  if (phase === 'yellow') {
    return (
      <SafeAreaView style={styles.yellowScreen}>
        <Animated.View style={[styles.yellowCard, { transform: [{ scale: wavePulse }] }]}>
          <Text style={[styles.statusTitle, { fontSize: 26 * textScale }]}>
            {copy.yellowTier}
          </Text>
          <Text style={[styles.statusBody, { fontSize: 17 * textScale }]}>
            {copy.yellowTierExplanation}
          </Text>
          <Text style={[styles.yellowNurseLine, { fontSize: 15 * textScale }]}>
            {copy.yellowNurseLine ?? 'Connecting you to the nurse line…'}
          </Text>
        </Animated.View>
        <View style={styles.yellowActions}>
          <TouchableOpacity
            style={styles.greenTierBtn}
            onPress={handleGreenTier}
            accessibilityRole="button"
            accessibilityLabel={copy.greenTierTitle ?? 'View care information'}
          >
            <Text style={[styles.actionText, { fontSize: 16 * textScale }]}>
              {copy.greenTierTitle ?? '📋 Care Information'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.exitButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={copy.returnHome}
          >
            <Text style={[styles.actionText, { fontSize: 16 * textScale }]}>
              {copy.returnHome}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Simulated / Cancelled outcome screens ─────────────────────────────────
  if (phase === 'simulated' || phase === 'cancelled') {
    const title   = phase === 'simulated' ? copy.simulatedEscalation : copy.cancelled;
    const message = phase === 'simulated' ? copy.simulatedNoAction   : copy.noCall;
    return (
      <SafeAreaView style={[styles.statusScreen, phase === 'cancelled' && styles.cancelledScreen]}>
        <Text style={[styles.statusTitle, { fontSize: 28 * textScale }]}>{title}</Text>
        <Text style={[styles.statusBody,  { fontSize: 18 * textScale }]}>{message}</Text>
        <TouchableOpacity
          style={styles.exitButton}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={copy.returnHome}
        >
          <Text style={[styles.actionText, { fontSize: 18 * textScale }]}>
            {copy.returnHome}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Main flow: pause / pain / countdown (Red Tier) ────────────────────────
  return (
    <SafeAreaView
      style={[
        styles.safe,
        (phase === 'pause' || phase === 'pain') && styles.amberScreen,
        phase === 'countdown' && styles.redScreen,
      ]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { fontSize: 27 * textScale }]}>
          {copy.alertTitle}
        </Text>
        <Text style={styles.language}>{copy.promptLanguage(language.label)}</Text>
        <Text style={[styles.prompt, { fontSize: 18 * textScale }]}>
          {phase === 'pause'
            ? copy.emergencyQuestion
            : phase === 'pain'
              ? copy.painScale
              : language.emergencyConfirmationPrompt}
        </Text>
        <Text style={styles.demoNotice}>{copy.demoOnlyNotice}</Text>

        <TouchableOpacity
          style={styles.repeatButton}
          onPress={() => speak(language.emergencyPrompt, true)}
          accessibilityRole="button"
          accessibilityLabel={copy.repeatPrompt}
        >
          <Text style={[styles.actionText, { fontSize: 17 * textScale }]}>
            {copy.repeatPrompt}
          </Text>
        </TouchableOpacity>

        {/* ── Entry pause countdown ── */}
        {phase === 'pause' && (
          <View style={styles.pauseBox}>
            <Text style={[styles.countdownNumber, { fontSize: 66 * textScale }]}>
              {pauseSeconds}
            </Text>
            <Text style={[styles.countdownLabel, { fontSize: 16 * textScale }]}>
              {copy.safetyPause(pauseSeconds)}
            </Text>
          </View>
        )}

        {/* ── Pain score grid (shown during pain and countdown phases) ── */}
        {(phase === 'pain' || phase === 'countdown') && (
          <>
            <Animated.View
              style={[
                styles.countdown,
                countdown <= 3 && styles.countdownUrgent,
                { transform: [{ scale: pulse }] },
              ]}
            >
              <Text
                style={[
                  styles.countdownNumber,
                  countdown <= 3 && styles.countdownNumberUrgent,
                  { fontSize: phase === 'countdown' ? 66 * textScale : 60 * textScale },
                ]}
              >
                {countdown}
              </Text>
              <Text style={[styles.countdownLabel, { fontSize: 15 * textScale }]}>
                {copy.secondsRemaining(countdown)}
              </Text>
            </Animated.View>

            {phase === 'pain' && (
              <>
                <Text style={[styles.painHint, { fontSize: 16 * textScale }]}>
                  {copy.painHint}
                </Text>
                <View style={styles.painGrid}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(score => (
                    <TouchableOpacity
                      key={score}
                      style={[
                        styles.painButton,
                        score >= 8 && styles.painButtonRed,
                        painScore === score && styles.painSelected,
                      ]}
                      onPress={() => handlePainScore(score)}
                      accessibilityRole="button"
                      accessibilityLabel={copy.painScore(score)}
                    >
                      <Text style={[styles.painButtonText, { fontSize: 18 * textScale }]}>
                        {score}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[styles.demoNotice, { fontSize: 14 * textScale }]}>
                  {copy.scoreThreshold}
                </Text>
                {/* Green Tier shortcut */}
                <TouchableOpacity
                  style={styles.greenTierBtn}
                  onPress={handleGreenTier}
                  accessibilityRole="button"
                  accessibilityLabel={copy.greenTierTitle ?? 'View care information'}
                >
                  <Text style={[styles.actionText, { fontSize: 15 * textScale }]}>
                    {copy.greenTierTitle ?? '📋 View Care Info'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.yesButton}
                  onPress={() => {
                    setCountdown(10);
                    transitionTo('countdown');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={copy.yesAmbulance}
                >
                  <Text style={[styles.actionText, { fontSize: 17 * textScale }]}>
                    {copy.yesAmbulance}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {phase === 'countdown' && (
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.noButton}
                  onPress={cancel}
                  accessibilityRole="button"
                  accessibilityLabel={copy.noCancel}
                >
                  <Text style={[styles.actionText, { fontSize: 17 * textScale }]}>
                    {copy.noCancel}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.yesButton}
                  onPress={confirm}
                  accessibilityRole="button"
                  accessibilityLabel={copy.yesSimulate}
                >
                  <Text style={[styles.actionText, { fontSize: 17 * textScale }]}>
                    {copy.yesSimulate}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {/* Cancel available during pause and pain */}
        {(phase === 'pause' || phase === 'pain') && (
          <TouchableOpacity
            style={styles.noButton}
            onPress={cancel}
            accessibilityRole="button"
            accessibilityLabel={copy.noCancel}
          >
            <Text style={[styles.actionText, { fontSize: 17 * textScale }]}>
              {copy.noCancel}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Red Tier flashing border */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.emergencyFrame,
          phase === 'countdown' && countdown <= 3 ? styles.redFrame : styles.amberFrame,
          { opacity: frameFlash },
        ]}
      />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Shared ──
  safe:         { flex: 1, backgroundColor: '#140900' },
  amberScreen:  { backgroundColor: '#211900' },
  redScreen:    { backgroundColor: '#210808' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingBottom: 32, gap: 14 },
  title:    { color: '#facc15', textAlign: 'center', fontWeight: '900' },
  language: { color: '#ffffff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  prompt:   { color: '#ffffff', textAlign: 'center', lineHeight: 27, fontWeight: '700' },
  demoNotice: { color: '#fff4c2', textAlign: 'center', fontSize: 15, lineHeight: 22, fontWeight: '800' },
  actionText: { color: '#ffffff', fontWeight: '900', textAlign: 'center' },
  exitButton: {
    alignSelf: 'stretch', minHeight: 62, justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#1d4ed8', borderRadius: 10, padding: 14,
  },
  repeatButton: {
    minHeight: 60, justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#1d4ed8', borderRadius: 10, padding: 14,
  },
  actions: { flexDirection: 'row', gap: 10 },
  noButton: {
    flex: 1, minHeight: 76, justifyContent: 'center',
    backgroundColor: '#854d0e', borderColor: '#facc15', borderWidth: 3, borderRadius: 10, padding: 12,
  },
  yesButton: {
    flex: 1, minHeight: 76, justifyContent: 'center',
    backgroundColor: '#b91c1c', borderColor: '#ffffff', borderWidth: 3, borderRadius: 10, padding: 12,
  },

  // ── Inter-phase buffer ──
  interPauseScreen: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
  interPauseText:   { color: '#475569', fontWeight: '900', textAlign: 'center' },

  // ── Entry pause ──
  pauseBox: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#211500', borderColor: '#facc15', borderWidth: 3, borderRadius: 10, padding: 18, gap: 8,
  },

  // ── Red Tier countdown ──
  emergencyFrame: { ...StyleSheet.absoluteFillObject, borderWidth: 12, borderRadius: 12 },
  amberFrame:     { borderColor: '#facc15' },
  redFrame:       { borderColor: '#ff453a' },
  countdown: {
    alignItems: 'center', backgroundColor: '#211500',
    borderColor: '#facc15', borderWidth: 3, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20,
  },
  countdownUrgent:       { backgroundColor: '#2b0909', borderColor: '#ff453a' },
  countdownNumber:       { color: '#facc15', fontWeight: '900' },
  countdownNumberUrgent: { color: '#ff453a' },
  countdownLabel:        { color: '#ffffff', textAlign: 'center' },

  // ── Pain grid ──
  painHint:   { color: '#ffaaaa', textAlign: 'center', lineHeight: 22 },
  painGrid:   { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  painButton: {
    width: 56, height: 56, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#242424', borderColor: '#facc15', borderWidth: 2, borderRadius: 8,
  },
  painButtonRed: { borderColor: '#ff453a', backgroundColor: '#3a0000' }, // scores 8-10
  painSelected:  { backgroundColor: '#9a3412' },
  painButtonText: { color: '#ffffff', fontWeight: '800' },

  // ── Yellow Tier ──
  yellowScreen:  { flex: 1, backgroundColor: '#082f49', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18 },
  yellowCard:    { alignSelf: 'stretch', backgroundColor: '#0c4a6e', borderRadius: 16, padding: 24, gap: 12, alignItems: 'center' },
  yellowNurseLine: { color: '#7dd3fc', textAlign: 'center', fontWeight: '700', marginTop: 8 },
  yellowActions: { alignSelf: 'stretch', gap: 10 },
  greenTierBtn:  {
    minHeight: 56, justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#14532d', borderColor: '#4ade80', borderWidth: 2, borderRadius: 10, padding: 12,
  },

  // ── Green Tier ──
  greenScreen:  { flex: 1, backgroundColor: '#000000' },
  greenContent: { padding: 20, paddingBottom: 32, gap: 16 },
  greenTitle:   { color: '#ffffff', fontWeight: '900', textAlign: 'center', marginBottom: 4 },
  greenCard: {
    backgroundColor: '#111111', borderColor: '#ffffff', borderWidth: 1,
    borderRadius: 12, padding: 18, gap: 8,
  },
  greenCardLabel: { color: '#ffffff', fontWeight: '900' },
  greenCardBody:  { color: '#d1d5db', lineHeight: 22 },

  // ── Status screens ──
  statusScreen:   { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 18, backgroundColor: '#cc0000' },
  cancelledScreen: { backgroundColor: '#001a0e' },
  statusTitle:    { color: '#ffffff', fontWeight: '900', textAlign: 'center' },
  statusBody:     { color: '#ffcccc', textAlign: 'center', lineHeight: 28 },
});
