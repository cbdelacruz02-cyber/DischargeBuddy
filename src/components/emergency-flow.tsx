/**
 * emergency-flow.tsx  —  DischargeBuddy Standalone Emergency Flow
 *
 * OFFLINE ONLY — zero internet required. All subsystems run locally:
 *   • expo-speech         (TTS, pacing rate ≤ 0.65)
 *   • expo-haptics        (vibration motor)
 *   • React Native Vibration API
 *   • React Native Animated API
 *   • Native setInterval / setTimeout
 *
 * ═══════════════════════════════════════════════════════════════════
 *  7-GUARDRAIL EVALUATION SEQUENCE  (Milestones A → E)
 * ═══════════════════════════════════════════════════════════════════
 *
 *  'pause'        Mandatory 2-s system-clear on entry (noise drain)
 *  'word-check'   A   — AI word scan: danger vs. educational
 *                       5-s silence → auto-escalates to active-check
 *  'active-check' C.1 — "Are you actively experiencing this NOW?"
 *                       10-s silence → auto-escalates to validation
 *  'validation'   D   — Double-Tile Safety Gate (amber NO / red YES)
 *  'alone-check'  D.6 — "Are you completely alone?"
 *  'pain'         D.4 — Pain scale 1–10, 10-s silence → countdown
 *  'countdown'    E   — 10-s Red Tier auto-dispatch + instant cancel
 *  'yellow'       M2  — Blue tile, globe, nurse-line + lang detection
 *  'lang-detect'  M2D — Language identifier (3-attempt)
 *  'lang-confirm' M2D — Green YES / Red NO language confirmation
 *  'green'        M3  — Educational cards + accessibility controls
 *  'simulated'    Ambulance dispatched (demo outcome)
 *  'cancelled'    User aborted at any point
 *  'inter-pause'  2-s audio-clear buffer between every transition
 *
 * CANCEL / FALSE ALARM — visible & tappable at EVERY phase.
 * Any voice phrase matching CANCEL_PHRASES triggers it immediately.
 *
 * BUG FIXES:
 *   • pauseSeconds NOT in useEffect deps (state-driven rerender)
 *   • spokenPhase.current = null set in transitionTo() BEFORE inter-pause
 *   • All Speech.stop() void-prefixed
 *   • SILENCE_PHASE_MAP hoisted outside component
 */

import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getLanguage, type LanguageLabel } from '@/constants/safety-content';
import { getUiCopy } from '@/constants/ui-copy';
import { useVoiceRecognition } from '@/hooks/use-voice-recognition';

// ─────────────────────────────────────────────────────────────────────────────
// Phase type
// ─────────────────────────────────────────────────────────────────────────────

type Phase =
  | 'pause'
  | 'inter-pause'
  | 'word-check'
  | 'active-check'
  | 'validation'
  | 'alone-check'
  | 'pain'
  | 'countdown'
  | 'yellow'
  | 'lang-detect'
  | 'lang-confirm'
  | 'green'
  | 'simulated'
  | 'cancelled';

type EmergencyFlowProps = {
  languageLabel: LanguageLabel;
  fontScale: number;
  soundLevel: number;
  speechRate: number;
  onClose: () => void;
  /** When provided by a parent (e.g. HomeScreen), this overrides the
   *  component's internal isStandalone state so the single dashboard
   *  toggle is the authoritative source of truth. */
  isStandaloneOverride?: boolean;
  /** Callback so the component can bubble toggle changes back up to the
   *  parent when the user flips the switch from inside the modal. */
  onStandaloneChange?: (standalone: boolean) => void;
  /**
   * Pre-seeded phrase from the home screen voice trigger panel.
   * "help"          → instant dispatch (skip pain scale)
   * "chest hurts"   → word-check → pain scale
   * "can't breathe" → word-check → pain scale
   */
  initialPhrase?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Danger phrases — instant multi-sensory activation on match (Milestone A.3)
// ─────────────────────────────────────────────────────────────────────────────

const DANGER_PHRASES = [
  'chest pain', 'i feel chest pain', 'i have chest pain', 'chest hurts',
  "can't breathe", 'cannot breathe', 'trouble breathing', 'hard to breathe',
  "i can't breathe", 'shortness of breath',
  'severe pain', 'severe stomach pain', 'stomach pain i never had',
  'i feel dizzy', 'i am dizzy', 'i fell', 'i have fallen',
  'i need an ambulance', 'send an ambulance', 'get an ambulance',
  'call an ambulance', 'call 911',
  'help', 'help me', 'emergency', 'i need help',
  'heart attack', 'i think i am having a heart attack',
  'stroke', 'i cannot move', 'i cannot feel',
  'bleeding badly', 'unconscious', 'collapsed',
] as const;

// Instant-dispatch trigger phrases (Milestone C.2) — countdown → 0 immediately
const INSTANT_DISPATCH_PHRASES = [
  'i need an ambulance', 'send an ambulance', 'get an ambulance',
  'call an ambulance', 'help', 'help me', 'help!',
] as const;

// Cancel phrases — voice abort at any second
const CANCEL_PHRASES = [
  'no ambulance', 'cancel', 'false alarm', 'stop', 'no', 'cancel ambulance',
] as const;

// Educational / safe phrases — route directly to Green Tier (Milestone A.2)
const EDUCATIONAL_PHRASES = [
  'what should i do', 'what do i do if', 'what happens if',
  'how do i know if', 'is it normal', 'is this normal',
  'tell me about', 'explain', 'what is', 'what are',
  'information about', 'learn about',
] as const;

// Language-not-understood triggers (Milestone 2D)
const LANG_FALLBACK_PHRASES = [
  'i do not understand english', 'no english', 'no hablo ingles',
  'je ne comprends pas', 'i do not understand',
] as const;

function containsDanger(input: string): boolean {
  const l = input.toLowerCase().trim();
  return DANGER_PHRASES.some(p => l.includes(p));
}
function containsInstantDispatch(input: string): boolean {
  const l = input.toLowerCase().trim();
  return INSTANT_DISPATCH_PHRASES.some(p => l.includes(p));
}
function containsCancel(input: string): boolean {
  const l = input.toLowerCase().trim();
  return CANCEL_PHRASES.some(p => l.includes(p));
}
function containsEducational(input: string): boolean {
  const l = input.toLowerCase().trim();
  return EDUCATIONAL_PHRASES.some(p => l.includes(p));
}
function containsLangFallback(input: string): boolean {
  const l = input.toLowerCase().trim();
  return LANG_FALLBACK_PHRASES.some(p => l.includes(p));
}


// ─────────────────────────────────────────────────────────────────────────────
// Silence phase map — static, outside component
// Maps response-required phases to their escalation target.
//   word-check   →  5 s → active-check
//   active-check → 10 s → validation
//   pain         → 10 s → countdown
// ─────────────────────────────────────────────────────────────────────────────

const SILENCE_PHASE_MAP: Partial<Record<Phase, { target: Phase; seconds: number }>> = {
  'word-check':    { target: 'active-check', seconds: 5  },
  'active-check':  { target: 'validation',   seconds: 10 },
  'pain':          { target: 'countdown',    seconds: 10 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Supported demo languages (Milestone 2D)
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_LANGUAGES = [
  { code: 'en-US', label: 'English' },
  { code: 'es-ES', label: 'Spanish / Español' },
  { code: 'fr-FR', label: 'French / Français' },
  { code: 'zh-CN', label: 'Mandarin / 普通话' },
  { code: 'ar-SA', label: 'Arabic / العربية' },
  { code: 'pt-BR', label: 'Portuguese / Português' },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function EmergencyFlow({
  languageLabel,
  fontScale,
  soundLevel,
  speechRate,
  onClose,
  isStandaloneOverride,
  onStandaloneChange,
  initialPhrase,
}: EmergencyFlowProps) {
  const language    = getLanguage(languageLabel);
  const copy        = getUiCopy(languageLabel);
  // voiceVolume is intentionally superseded by localVolume below (Milestone 3F)
  // Pacing guard — never rush elderly / blind / immobile users
  const safeRate    = Math.min(0.65, Math.max(0.4, speechRate));

  // ── Accessibility overrides (Milestone 3F) ─────────────────────────────────
  const [localFontScale,  setLocalFontScale]  = useState(fontScale);
  const [localSound,      setLocalSound]      = useState(soundLevel);
  const [highContrast,    setHighContrast]    = useState(true);
  const textScale   = Math.min(1.75, Math.max(1.25, localFontScale));
  const localVolume = Math.min(1, Math.max(0, localSound / 100));

  // ── Core phase state ───────────────────────────────────────────────────────
  const [phase, setPhase]               = useState<Phase>('pause');
  const [pauseSeconds, setPauseSeconds] = useState(2);
  const [nextPhase, setNextPhase]       = useState<Phase | null>(null);
  const [interSeconds, setInterSeconds] = useState(2);

  // ── Countdown / silence ────────────────────────────────────────────────────
  const [countdown, setCountdown]         = useState(5);
  const [silenceLeft, setSilenceLeft]     = useState(10);
  const [silenceActive, setSilenceActive] = useState(false);
  const [silenceCap, setSilenceCap]       = useState(10);

  // ── Pain / emergency state ─────────────────────────────────────────────────
  const [painScore, setPainScore]         = useState<number | null>(null);
  const [wordScanResult, setWordScanResult] = useState<'danger' | 'safe' | null>(null);
  const [isAlone, setIsAlone]             = useState<boolean | null>(null);

  // ── Language detection state (Milestone 2D) ────────────────────────────────
  const [langAttempts, setLangAttempts]   = useState(0);
  const [detectedLang, setDetectedLang]   = useState<string | null>(null);
  const [selectedLangCode, setSelectedLangCode] = useState<string>(language.code);

  // ── Appointment routing state (Milestone 2C) ───────────────────────────────
  const [appointmentRequested, setAppointmentRequested] = useState(false);

  // ── Animation refs ─────────────────────────────────────────────────────────
  const pulse        = useRef(new Animated.Value(1)).current;
  const frameFlash   = useRef(new Animated.Value(0.2)).current;
  const wavePulse    = useRef(new Animated.Value(1)).current;
  const globeRotate  = useRef(new Animated.Value(0)).current;  // Yellow globe spin
  const silenceWidth = useRef(new Animated.Value(1)).current;

  // ── TTS dedup guard ────────────────────────────────────────────────────────
  const spokenPhase = useRef<string | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // speak — ALL TTS routed here. Strictly offline.
  // replace=true → stop immediately before new utterance.
  // Uses localVolume so Milestone 3F sound control works at runtime.
  // ─────────────────────────────────────────────────────────────────────────
  const speak = useCallback(
    (text: string, replace = false) => {
      AccessibilityInfo.announceForAccessibility(text);
      const opts = { language: selectedLangCode, rate: safeRate, volume: localVolume };
      if (replace) {
        void Speech.stop().then(
          () => Speech.speak(text, opts),
          () => Speech.speak(text, opts),
        );
      } else {
        Speech.speak(text, opts);
      }
    },
    [selectedLangCode, safeRate, localVolume],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Voice recognition — active mic for alone-check, active-check, word-check
  // Uses refs for handler callbacks to avoid dependency ordering issues.
  // ─────────────────────────────────────────────────────────────────────────
  const phaseRef          = useRef(phase);
  const aloneHandlerRef   = useRef<((alone: boolean) => void) | null>(null);
  const wordScanHandlerRef= useRef<((input: string) => void) | null>(null);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const {
    isListening:    emgIsListening,
    startListening: emgStartListening,
    stopListening:  emgStopListening,
    supported:      emgMicSupported,
  } = useVoiceRecognition({
    languageCode: selectedLangCode,
    onResult: (text: string, isFinal: boolean) => {
      if (!isFinal) return;
      const lower = text.toLowerCase().trim();
      if (!lower) return;
      emgStopListening();
      const curPhase = phaseRef.current;
      if (curPhase === 'alone-check') {
        const isYes = /\b(yes|sí|si|はい|oui)\b/.test(lower);
        const isNo  = /\b(no|no|いいえ|non)\b/.test(lower);
        if (isYes) { aloneHandlerRef.current?.(true);  return; }
        if (isNo)  { aloneHandlerRef.current?.(false); return; }
      }
      if (curPhase === 'word-check' || curPhase === 'active-check' || curPhase === 'validation') {
        wordScanHandlerRef.current?.(lower);
      }
    },
  });

  // Stop mic when leaving phases that need it
  useEffect(() => {
    const micPhases: Phase[] = ['alone-check', 'word-check', 'active-check', 'validation'];
    if (!micPhases.includes(phase)) {
      emgStopListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ─────────────────────────────────────────────────────────────────────────
  // Standalone / Cloud Sync master toggle
  // isStandalone = true  → dead-zone mode — all subsystems run from local memory
  //                         (TTS, intervals, overdose locks, silence timeouts)
  // isStandalone = false → Cloud Sync connected mode
  // requireCloud() gates any action that needs a network, showing a prompt
  //                with instructions to slide the toggle back to connect.
  // ─────────────────────────────────────────────────────────────────────────
  // Internal state — used when no parent override is supplied (standalone usage)
  const [isStandaloneInternal, setIsStandaloneInternal] = useState(true);
  const [showCloudPrompt,  setShowCloudPrompt]  = useState(false);
  const [cloudActionLabel, setCloudActionLabel] = useState('');

  // Effective value: parent override wins when provided, otherwise use internal state
  const isStandalone = isStandaloneOverride !== undefined
    ? isStandaloneOverride
    : isStandaloneInternal;

  // Setter: update internal state AND bubble up to parent if a callback was provided
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
      true,
    );
  }, [isStandalone, speak]);

  // ─────────────────────────────────────────────────────────────────────────
  // softChime — plays a soft triple-tone vibration sequence as a chime
  // (Milestone 2A — audio chime before Yellow Tier questions)
  // ─────────────────────────────────────────────────────────────────────────
  const softChime = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 220);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),  440);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // doubleBeep — sharp double haptic confirmation (Milestone 2D.3)
  // ─────────────────────────────────────────────────────────────────────────
  const doubleBeep = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 160);
    Vibration.vibrate([0, 120, 80, 120]);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // multiSensoryBurst — exact millisecond a danger word is caught (A.4)
  // ─────────────────────────────────────────────────────────────────────────
  const multiSensoryBurst = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 120);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 280);
    Vibration.vibrate([0, 400, 100, 400, 100, 600]);
    frameFlash.setValue(0.95);
  }, [frameFlash]);

  // ─────────────────────────────────────────────────────────────────────────
  // transitionTo — inserts 2-second audio-clear inter-pause buffer.
  // spokenPhase.current nulled BEFORE inter-pause so dest phase speaks.
  // ─────────────────────────────────────────────────────────────────────────
  const transitionTo = useCallback((target: Phase) => {
    void Speech.stop();
    Vibration.cancel();
    setSilenceActive(false);
    const cfg = SILENCE_PHASE_MAP[target as Phase];
    setSilenceLeft(cfg ? cfg.seconds : 10);
    setSilenceCap(cfg ? cfg.seconds : 10);
    silenceWidth.setValue(1);
    spokenPhase.current = null;
    setNextPhase(target);
    setInterSeconds(2);
    setPhase('inter-pause');
  }, [silenceWidth]);

  // ─────────────────────────────────────────────────────────────────────────
  // cancel — immediate abort. Available at every absolute second.
  // ─────────────────────────────────────────────────────────────────────────
  const cancel = useCallback(() => transitionTo('cancelled'), [transitionTo]);

  // ─────────────────────────────────────────────────────────────────────────
  // MOUNT: clear lingering audio
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    void Speech.stop();
    return () => {
      void Speech.stop();
      Vibration.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // initialPhrase — pre-route from home screen voice trigger panel
  // Runs once on mount after the phase effect has fired for 'pause'.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!initialPhrase) return;
    const lower = initialPhrase.toLowerCase().trim();
    if (containsInstantDispatch(lower)) {
      // "help" → instant dispatch, skip pain scale
      const go = () => {
        multiSensoryBurst();
        setCountdown(5);
        speak('Confirmed. Ambulance coming.', true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Vibration.vibrate([0, 500, 200, 500]);
        setTimeout(() => transitionTo('simulated'), 2500);
      };
      // Delay slightly so mount TTS has cleared
      setTimeout(go, 800);
    } else if (containsDanger(lower)) {
      // "chest hurts" / "can't breathe" → word-check → pain scale
      const go = () => {
        multiSensoryBurst();
        setCountdown(5);
        speak('Emergency phrase detected. Opening pain evaluation.', true);
        setTimeout(() => transitionTo('pain'), 2500);
      };
      setTimeout(go, 800);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Entry 2-second pause countdown
  // NOTE: pauseSeconds intentionally NOT in dep array — state-driven rerender.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'pause') return;
    if (pauseSeconds === 0) {
      spokenPhase.current = null;
      setPhase('pain');          // Framework §1: boot directly to pain assessment
      return;
    }
    const t = setTimeout(() => setPauseSeconds((v: number) => v - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, pauseSeconds]);

  // ─────────────────────────────────────────────────────────────────────────
  // Inter-phase pause countdown
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'inter-pause') return;
    if (interSeconds === 0 && nextPhase !== null) {
      const target = nextPhase;
      setNextPhase(null);
      setPhase(target);
      return;
    }
    const t = setTimeout(() => setInterSeconds((v: number) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, interSeconds, nextPhase]);

  // ─────────────────────────────────────────────────────────────────────────
  // Phase-change TTS  (fires ONCE per phase — spokenPhase guard)
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (spokenPhase.current === phase) return;
    spokenPhase.current = phase;

    // Milestone A — word-check
    if (phase === 'word-check') {
      speak(
        'DischargeBuddy is ready. Please describe what you are experiencing, ' +
        'or press one of the symptom buttons below.',
        true,
      );
    }

    // Milestone C.1 — active-check
    if (phase === 'active-check') {
      speak(
        'Are you actively experiencing this medical emergency right now? ' +
        'Say Yes or press Yes. To cancel, say No or press Cancel.',
        true,
      );
      // Repeat with distinct pause gap — blind / hearing-impaired accessibility
      setTimeout(() => {
        speak(
          'Are you in a medical emergency right now? ' +
          'Say Yes to continue. Say No or press Cancel to stop.',
        );
      }, 9000);
    }

    // Milestone D — validation gate
    if (phase === 'validation') {
      speak(
        'Ambulance coming. ' +
        'To cancel, say "No Ambulance" or press the amber No Ambulance button. ' +
        'To confirm, say "Yes Ambulance" or press the red Yes Ambulance button.',
        true,
      );
      // Distinct pause then repeat
      setTimeout(() => {
        speak(
          'Say "No Ambulance" to cancel. ' +
          'Say "Yes Ambulance" to confirm ambulance dispatch right now.',
        );
      }, 10000);
    }

    // Milestone D.6 — alone-check
    if (phase === 'alone-check') {
      speak(
        'Are you currently completely alone with zero direct physical help around you? ' +
        'Press Yes if you are alone. Press No if someone is nearby.',
        true,
      );
    }

    // Milestone D.4/5 — pain scale
    if (phase === 'pain') {
      speak(
        'On a scale of 1 to 10, what is your pain or discomfort? ' +
        '8, 9, or 10 will immediately send an ambulance. ' +
        '7 or lower connects you to the nurse line. Tap your number or say it now.',
        true,
      );
      setTimeout(() => {
        speak(
          'To cancel this emergency alert at any time, press the orange Cancel button at the top of the screen.',
        );
      }, 10000);
    }

    // Milestone E — countdown
    if (phase === 'countdown') {
      speak(
        language.emergencyConfirmationPrompt ??
        'Ambulance is being dispatched. Press Cancel to stop at any time.',
        true,
      );
    }

    // Milestone 2 — Yellow Tier
    if (phase === 'yellow') {
      softChime();
      setTimeout(() => {
        speak(
          language.yellowTierPrompt ??
          'Your pain level is moderate. DischargeBuddy AI Assist is activated and will connect you directly to your clinic nurse and care provider. Proceed with making an appointment?',
          true,
        );
      }, 800); // short pause after chime
    }

    // Milestone 2D — language detection
    if (phase === 'lang-detect') {
      softChime();
      setTimeout(() => {
        speak(
          'DischargeBuddy AI Assist needs to find your language. ' +
          'Please hold the phone close and speak very slowly into the phone. ' +
          'What is your name?',
          true,
        );
      }, 800);
    }

    // Milestone 2D.3 — language confirmation
    if (phase === 'lang-confirm') {
      doubleBeep();
      setTimeout(() => {
        const lang = DEMO_LANGUAGES.find(l => l.code === detectedLang)?.label ?? 'Unknown';
        speak(
          `Is ${lang} correct? Say Yes or No, or press the screen button.`,
          true,
        );
      }, 600);
    }

    // Milestone 3 — Green Tier
    if (phase === 'green') {
      speak(
        copy.greenTierPrompt ??
        'You are in educational mode. Tap any card to hear detailed information. ' +
        'A short double-tap will confirm each completed step.',
        true,
      );
    }

    // Simulated
    if (phase === 'simulated') {
      speak(
        language.simulatedEscalationPrompt ??
        'Confirmed. Ambulance is coming. Stay calm and stay on the line. Help is on the way.',
        true,
      );
    }

    // Cancelled
    if (phase === 'cancelled') {
      speak(
        language.cancelledPrompt ??
        'Alert cancelled. No emergency call was made. You are safe.',
        true,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ─────────────────────────────────────────────────────────────────────────
  // Haptics per phase
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'pause') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Vibration.vibrate([0, 300, 200, 300]);
      return;
    }

    // Word-check / active-check: steady medium pulse
    if (phase === 'word-check' || phase === 'active-check') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const iv = setInterval(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Vibration.vibrate([0, 200, 300]);
      }, 2500);
      return () => { clearInterval(iv); Vibration.cancel(); };
    }

    // Validation gate: sharp twin pulses
    if (phase === 'validation') {
      const twin = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 180);
        Vibration.vibrate([0, 300, 120, 300]);
      };
      twin();
      const iv = setInterval(twin, 3500);
      return () => { clearInterval(iv); Vibration.cancel(); };
    }

    // Alone-check + pain: fast sharp shakes (Milestone D.4)
    if (phase === 'alone-check' || phase === 'pain') {
      const sharp = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        Vibration.vibrate([0, 250, 150, 250]);
      };
      sharp();
      const iv = setInterval(sharp, 1500);
      return () => { clearInterval(iv); Vibration.cancel(); };
    }

    // Red Tier countdown: calm heavy impacts every second (5-second simulation)
    if (phase === 'countdown') {
      const iv = setInterval(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        Vibration.vibrate([0, 200, 300]);
      }, 1000);
      return () => { clearInterval(iv); Vibration.cancel(); };
    }

    // Yellow Tier: slow calm wave (Milestone 2A)
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

    // Lang-detect: slow steady pulse (Milestone 2D)
    if (phase === 'lang-detect') {
      const iv = setInterval(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Vibration.vibrate([0, 150, 400]);
      }, 2000);
      return () => { clearInterval(iv); Vibration.cancel(); };
    }

    // Lang-confirm: fast alternating pulses (Milestone 2D.3)
    if (phase === 'lang-confirm') {
      Vibration.vibrate([0, 100, 80, 100, 80, 100]);
      return;
    }

    // Green Tier: gentle single tap
    if (phase === 'green') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [phase]);

  // ─────────────────────────────────────────────────────────────────────────
  // Flashing border — amber on all alarm phases, red on countdown
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const alarmPhases: Phase[] = [
      'pause', 'word-check', 'active-check', 'validation',
      'alone-check', 'pain', 'countdown',
    ];
    if (!alarmPhases.includes(phase)) {
      frameFlash.setValue(0);
      return;
    }
    const dur = phase === 'countdown' ? 600 : 650;
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(frameFlash, { toValue: 0.95, duration: dur, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(frameFlash, { toValue: 0.15, duration: dur, easing: Easing.linear, useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [frameFlash, phase]);

  // ─────────────────────────────────────────────────────────────────────────
  // Pulse animation — countdown bubble when ≤ 3 s remain
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'countdown' || countdown > 3) { pulse.setValue(1); return; }
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.14, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1,    duration: 280, easing: Easing.in(Easing.quad),  useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [countdown, phase, pulse]);

  // ─────────────────────────────────────────────────────────────────────────
  // Yellow Tier slow-wave animation (Milestone 2A)
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'yellow' && phase !== 'lang-detect' && phase !== 'lang-confirm') {
      wavePulse.setValue(1);
      return;
    }
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(wavePulse, { toValue: 1.05, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(wavePulse, { toValue: 1,    duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [phase, wavePulse]);

  // ─────────────────────────────────────────────────────────────────────────
  // Globe rotation animation — Yellow Tier / lang phases (Milestone 2A)
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const isGlobePhase = phase === 'yellow' || phase === 'lang-detect' || phase === 'lang-confirm';
    if (!isGlobePhase) { globeRotate.setValue(0); return; }
    const anim = Animated.loop(
      Animated.timing(globeRotate, {
        toValue: 1,
        duration: 6000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [phase, globeRotate]);

  // ─────────────────────────────────────────────────────────────────────────
  // Silence / Zero-Response Safety Cutoff
  // Arms after TTS finishes (10 s arm delay for slow-rate speech).
  // word-check has a 5-s cap; others use 10-s.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const cfg = SILENCE_PHASE_MAP[phase as Phase];
    if (!cfg) {
      setSilenceActive(false);
      setSilenceLeft(10);
      setSilenceCap(10);
      silenceWidth.setValue(1);
      return;
    }
    setSilenceLeft(cfg.seconds);
    setSilenceCap(cfg.seconds);
    // Arm delay: give TTS time to finish before silence countdown starts.
    // word-check uses a 5-s cap so arm after 4 s; all others arm after 10 s.
    const armMs = cfg.seconds <= 5 ? 4000 : 10000;
    const armDelay = setTimeout(() => setSilenceActive(true), armMs);
    return () => clearTimeout(armDelay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    const cfg = SILENCE_PHASE_MAP[phase as Phase];
    if (!silenceActive || !cfg) return;
    if (silenceLeft === 0) {
      transitionTo(cfg.target);
      return;
    }
    Animated.timing(silenceWidth, {
      toValue: (silenceLeft - 1) / silenceCap,
      duration: 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
    if (silenceLeft <= 3) {
      AccessibilityInfo.announceForAccessibility(
        `${silenceLeft} second${silenceLeft !== 1 ? 's' : ''} until automatic emergency dispatch.`,
      );
    }
    const t = setTimeout(() => setSilenceLeft((v: number) => v - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [silenceActive, silenceLeft, phase]);

  // ─────────────────────────────────────────────────────────────────────────
  // Red Tier countdown timer (10 → 0 → auto-dispatch)
  //
  // handlePainScore always sets countdown=10 before calling transitionTo.
  // The only edge case is an instant-dispatch path that sets countdown=0
  // then goes straight to 'simulated' — it never reaches this phase,
  // so countdown will always be ≥ 1 when this effect fires normally.
  //
  // If somehow countdown arrives at 0 on phase entry (race condition),
  // we skip the tick and trigger dispatch on the next render instead
  // via the dispatch-at-zero guard.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      transitionTo('simulated');
      return;
    }
    if ([10, 5, 3, 2, 1].includes(countdown)) {
      AccessibilityInfo.announceForAccessibility(
        copy.secondsRemaining?.(countdown) ?? `${countdown} seconds remaining.`,
      );
    }
    const t = setTimeout(() => setCountdown((v: number) => v - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, phase]);

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Milestone A — word scan.
   * 1. Instant dispatch trigger phrases → countdown to 0 immediately (C.2).
   * 2. Danger words → multi-sensory burst + escalate (A.4).
   * 3. Educational → Green Tier (A.2 safe route).
   * 4. Language fallback → lang-detect (M2D).
   * 5. Cancel words → abort.
   */
  const handleWordScan = useCallback((input: string) => {
    // Cancel voice phrase — abort immediately
    if (containsCancel(input)) {
      cancel();
      return;
    }
    // Language fallback
    if (containsLangFallback(input)) {
      speak('Understood. Starting language identification.', true);
      setTimeout(() => transitionTo('lang-detect'), 1500);
      return;
    }
    // Educational safe route
    if (containsEducational(input) && !containsDanger(input)) {
      setWordScanResult('safe');
      speak('I understand. This is an educational question. Routing you to care information.', true);
      setTimeout(() => transitionTo('green'), 2500);
      return;
    }
    // Instant dispatch trigger — terminates countdown to zero immediately (C.2)
    if (containsInstantDispatch(input)) {
      setWordScanResult('danger');
      multiSensoryBurst();
      setCountdown(0); // ← master clock terminated instantly (Milestone A)
      speak('Confirmed. Ambulance coming.', true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Vibration.vibrate([0, 500, 200, 500]);
      // Mandatory 2-second noise-clear pause (C.4) then dispatch
      setTimeout(() => transitionTo('simulated'), 2500);
      return;
    }
    // Danger word — activate full protocol
    if (containsDanger(input) || input.trim().length > 0) {
      setWordScanResult('danger');
      multiSensoryBurst();
      setCountdown(10); // start master 10-second clock (A.5)
      speak('I hear you. Activating emergency protocol now. Help is coming.', true);
      setTimeout(() => transitionTo('active-check'), 2500);
    }
  }, [speak, transitionTo, cancel, multiSensoryBurst]);

  /** Predefined danger button shortcut */
  const handleDangerButton = useCallback(() => {
    multiSensoryBurst();
    setCountdown(10);
    speak('Emergency detected. Activating alert immediately.', true);
    setTimeout(() => transitionTo('active-check'), 2500);
  }, [multiSensoryBurst, speak, transitionTo]);

  /** Educational / safe shortcut */
  const handleSafeButton = useCallback(() => {
    speak('Routing you to educational care information.', true);
    setTimeout(() => transitionTo('green'), 1800);
  }, [speak, transitionTo]);

  /**
   * Milestone C.2 — Instant dispatch trigger (on active-check screen).
   * Terminates countdown to zero, mandatory 2-second noise-clear pause,
   * then immediately dispatches (simulated).
   */
  const handleInstantDispatch = useCallback(() => {
    void Speech.stop();
    setCountdown(0); // terminate clock immediately
    speak('Confirmed. Ambulance coming.', true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Vibration.vibrate([0, 500, 200, 500]);
    // Mandatory 2-second noise-clear pause (C.4)
    setTimeout(() => transitionTo('simulated'), 2500);
  }, [speak, transitionTo]);

  /** Milestone D — amber NO Ambulance tile */
  const handleValidationNo = useCallback(() => {
    void Speech.stop();
    speak('Alert cancelled. No ambulance was sent.', true);
    setTimeout(() => transitionTo('cancelled'), 1200);
  }, [speak, transitionTo]);

  /** Milestone D — red YES Ambulance tile */
  const handleValidationYes = useCallback(() => {
    speak('Confirmed. Ambulance dispatched.', true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Vibration.vibrate([0, 400, 150, 600]);
    setTimeout(() => transitionTo('alone-check'), 2500);
  }, [speak, transitionTo]);

  /** Milestone D.6 — alone check */
  const handleAloneAnswer = useCallback((alone: boolean) => {
    setIsAlone(alone);
    const msg = alone
      ? 'Understood. Your location and medical records have been saved. Paramedics have been alerted you are alone. Proceeding to pain assessment.'
      : 'Understood. Please have someone nearby remain with you. Proceeding to pain assessment.';
    speak(msg, true);
    setTimeout(() => transitionTo('pain'), 3500);
  }, [speak, transitionTo]);

  // Wire refs so the voice recognition callback can call these handlers
  useEffect(() => { aloneHandlerRef.current   = handleAloneAnswer;  }, [handleAloneAnswer]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleWordScanForRef = useCallback((input: string) => handleWordScan(input), [handleWordScan]);
  useEffect(() => { wordScanHandlerRef.current = handleWordScanForRef; }, [handleWordScanForRef]);

  /** Milestone D.5 — pain score selection (instant one-tap routing, no extra submit) */
  const handlePainScore = useCallback((score: number) => {
    setPainScore(score);
    setSilenceActive(false);
    Haptics.selectionAsync();
    if (score >= 8) {
      // Red Tier → 2-second environmental pause → Double-Tile Safety Gate → calm 5s countdown
      setCountdown(5);
      speak(`Pain level ${score}. Red tier. Ambulance dispatch starting now.`, true);
      setTimeout(() => transitionTo('countdown'), 1500);
    } else if (score >= 4) {
      // Yellow Tier → blue screen, globe, triple-tone chime, wave vibration
      speak(`Pain level ${score}. Moderate. Connecting you to your clinic nurse.`, true);
      setTimeout(() => transitionTo('yellow'), 1500);
    } else {
      // Green Tier (1–3) → local discharge files, sharp double-tap haptic
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 140);
      speak(`Pain level ${score}. Mild. Opening your care and recovery information.`, true);
      setTimeout(() => transitionTo('green'), 1500);
    }
  }, [speak, transitionTo]);

  /** Milestone 2C — appointment routing YES */
  const handleAppointmentYes = useCallback(() => {
    setAppointmentRequested(true);
    speak(
      'Connecting you directly to your clinic nurse. Please stay on the line. ' +
      'DischargeBuddy AI Assist is bypassing local menus to call the primary clinic front office now.',
      true,
    );
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [speak]);

  /** Milestone 2D — language detection: select a demo language */
  const handleLangSelect = useCallback((code: string) => {
    setDetectedLang(code);
    doubleBeep();
    setLangAttempts(0);
    transitionTo('lang-confirm');
  }, [doubleBeep, transitionTo]);

  /** Milestone 2D.3 — language confirmation YES */
  const handleLangConfirmYes = useCallback(() => {
    if (!detectedLang) return;
    setSelectedLangCode(detectedLang);
    setLangAttempts(0);
    speak('Language confirmed. Returning to your care pathway.', true);
    setTimeout(() => transitionTo('yellow'), 2000);
  }, [detectedLang, speak, transitionTo]);

  /** Milestone 2D.3 — language confirmation NO */
  const handleLangConfirmNo = useCallback(() => {
    const next = langAttempts + 1;
    setLangAttempts(next);
    if (next >= 3) {
      // 3-attempt threshold exceeded — critical emergency default (M2E)
      speak(
        'Language recognition failed after three attempts. ' +
        'Connecting directly to the emergency 911 ambulance switchboard dispatcher.',
        true,
      );
      setTimeout(() => transitionTo('simulated'), 3000);
    } else {
      speak(`Attempt ${next} of 3. Let us try again. Please hold the phone close and speak very slowly.`, true);
      setTimeout(() => transitionTo('lang-detect'), 2000);
    }
  }, [langAttempts, speak, transitionTo]);

  const handleGreenTier       = useCallback(() => transitionTo('green'),       [transitionTo]);
  const handleConfirmDispatch = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    transitionTo('simulated');
  }, [transitionTo]);

  // ─────────────────────────────────────────────────────────────────────────
  // Globe rotation interpolation (degrees 0→360)
  // ─────────────────────────────────────────────────────────────────────────
  const globeSpin = globeRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Global Cancel / False Alarm banner — top of EVERY phase
  // Also includes "No Ambulance" text so voice intent is visible
  // ─────────────────────────────────────────────────────────────────────────
  const CancelBanner = (
    <View style={styles.cancelBannerRow}>
      <TouchableOpacity
        style={[styles.cancelBanner, { flex: 1 }]}
        onPress={cancel}
        accessibilityRole="button"
        accessibilityLabel='Cancel. False Alarm. Say "No Ambulance" or press to stop immediately.'
        activeOpacity={0.7}
      >
        <Text style={[styles.cancelBannerText, { fontSize: 15 * textScale }]}>
          ✕  CANCEL / FALSE ALARM  ·  say &quot;No Ambulance&quot;
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.cancelBannerSpeak}
        onPress={() => speak('Press Cancel or say No Ambulance to stop the alert immediately.', true)}
        accessibilityRole="button"
        accessibilityLabel="Read cancel instructions aloud"
      >
        <Text style={{ fontSize: 20 }}>🔊</Text>
      </TouchableOpacity>
    </View>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Silence countdown bar
  // ─────────────────────────────────────────────────────────────────────────
  const SilenceBar = silenceActive ? (
    <View style={styles.silenceBarContainer}>
      <Text style={[styles.silenceLabel, { fontSize: 13 * textScale }]}>
        No response — auto-dispatch in {silenceLeft}s
      </Text>
      <View style={styles.silenceTrack}>
        <Animated.View
          style={[
            styles.silenceFill,
            {
              width: silenceWidth.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </View>
    </View>
  ) : null;

  // ─────────────────────────────────────────────────────────────────────────
  // Rotating globe graphic (Yellow Tier / lang phases)
  // ─────────────────────────────────────────────────────────────────────────
  const Globe = (
    <Animated.Text
      style={[styles.globeIcon, { transform: [{ rotate: globeSpin }] }]}
      accessibilityLabel="Rotating globe — language identification active"
    >
      🌐
    </Animated.Text>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Standalone / Cloud Sync toggle bar — rendered at the TOP of EVERY screen
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
            speak('Standalone Mode activated. Running entirely from local device memory. No internet required.', true);
          } else {
            speak('Cloud Sync activated. Connected mode enabled.', true);
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
  // Cloud-gate prompt modal — shown when a network action is attempted
  // while isStandalone = true. Explains how to activate cloud sync.
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
          {/* Show the toggle inline so user can act immediately */}
          <View style={[styles.modeToggleBar, { borderRadius: 12, marginTop: 4 }]}>
            <View style={styles.modeToggleLeft}>
              <Text style={{ fontSize: 16 }}>
                {isStandalone ? '📴' : '🌐'}
              </Text>
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
                  // They just enabled Cloud Sync — close prompt and proceed
                  setShowCloudPrompt(false);
                  speak('Cloud Sync activated. Proceeding.', true);
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

  // ═══════════════════════════════════════════════════════════════════
  //  RENDER: inter-phase buffer
  // ═══════════════════════════════════════════════════════════════════
  if (phase === 'inter-pause') {
    return (
      <SafeAreaView style={styles.interPauseScreen}>
        {CloudGateModal}
        {ModeToggleBar}
        {CancelBanner}
        <Text style={[styles.interPauseText, { fontSize: 18 * textScale }]}>
          {interSeconds > 0 ? `${interSeconds}` : '…'}
        </Text>
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  RENDER: Milestone 3 — Green Tier educational cards + M3F controls
  // ═══════════════════════════════════════════════════════════════════
  if (phase === 'green') {
    const cards = [
      { id: 'discharge', label: copy.greenCardDischarge  ?? 'Discharge Instructions', body: copy.greenCardDischargeBody  ?? 'Review your discharge paperwork carefully. Ask your nurse to confirm medication dosages.' },
      { id: 'followup',  label: copy.greenCardFollowUp   ?? 'Follow-Up Appointment',  body: copy.greenCardFollowUpBody   ?? 'Schedule your follow-up within 48–72 hours. Call the clinic if symptoms worsen.' },
      { id: 'meds',      label: copy.greenCardMeds       ?? 'Medication Reminders',   body: copy.greenCardMedsBody       ?? 'Set phone alarms for each dose. Do not skip doses even if you feel better.' },
      { id: 'emergency', label: copy.greenCardEmergency  ?? 'When to Call 911',       body: copy.greenCardEmergencyBody  ?? 'Chest pain, difficulty breathing, confusion, or sudden severe pain are emergencies.' },
    ];
    return (
      <SafeAreaView style={[styles.greenScreen, highContrast && styles.greenScreenHighContrast]}>
        {CloudGateModal}
        {ModeToggleBar}
        {CancelBanner}
        <ScrollView contentContainerStyle={styles.greenContent}>

          {/* Title */}
          <Text style={[styles.greenTitle, { fontSize: 24 * textScale }]}>
            {copy.greenTierTitle ?? '📋 Care Information'}
          </Text>

          {/* Cards */}
          {cards.map(card => (
            <TouchableOpacity
              key={card.id}
              style={[styles.greenCard, highContrast && styles.greenCardHighContrast]}
              onPress={() => {
                speak(card.body, true);
                // Milestone 3 — short double-tap vibration on task completion
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), 100);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${card.label}. Tap to hear.`}
            >
              <Text style={[styles.greenCardLabel, { fontSize: 17 * textScale }]}>{card.label}</Text>
              <Text style={[styles.greenCardBody,  { fontSize: 15 * textScale }]}>{card.body}</Text>
            </TouchableOpacity>
          ))}

          {/* ── Milestone 3F: Accessibility Controls ── */}
          <View style={styles.a11yControls}>
            <Text style={[styles.a11yTitle, { fontSize: 15 * textScale }]}>
              ⚙ Accessibility Controls
            </Text>

            {/* Visual Contrast Control (M3F.1) */}
            <View style={styles.a11yRow}>
              <Text style={[styles.a11yLabel, { fontSize: 14 * textScale }]}>
                High Contrast
              </Text>
              <TouchableOpacity
                style={[styles.a11yToggle, highContrast && styles.a11yToggleOn]}
                onPress={() => setHighContrast((v: boolean) => !v)}
                accessibilityRole="switch"
                accessibilityLabel={`High contrast ${highContrast ? 'on' : 'off'}`}
              >
                <Text style={[styles.a11yToggleText, { fontSize: 13 * textScale }]}>
                  {highContrast ? 'ON' : 'OFF'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Font Sizing Control (M3F.2) */}
            <View style={styles.a11yRow}>
              <Text style={[styles.a11yLabel, { fontSize: 14 * textScale }]}>
                Text Size: {localFontScale.toFixed(2)}×
              </Text>
              <View style={styles.a11yBtnRow}>
                <TouchableOpacity
                  style={styles.a11yBtn}
                  onPress={() => setLocalFontScale((v: number) => Math.max(1.0, parseFloat((v - 0.1).toFixed(1))))}
                  accessibilityRole="button"
                  accessibilityLabel="Decrease text size"
                >
                  <Text style={[styles.a11yBtnText, { fontSize: 18 * textScale }]}>A−</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.a11yBtn}
                  onPress={() => setLocalFontScale((v: number) => Math.min(2.0, parseFloat((v + 0.1).toFixed(1))))}
                  accessibilityRole="button"
                  accessibilityLabel="Increase text size"
                >
                  <Text style={[styles.a11yBtnText, { fontSize: 18 * textScale }]}>A+</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Sound Level Control (M3F.3) */}
            <View style={styles.a11yRow}>
              <Text style={[styles.a11yLabel, { fontSize: 14 * textScale }]}>
                Volume: {localSound}%
              </Text>
              <View style={styles.a11yBtnRow}>
                <TouchableOpacity
                  style={styles.a11yBtn}
                  onPress={() => setLocalSound((v: number) => Math.max(0, v - 10))}
                  accessibilityRole="button"
                  accessibilityLabel="Decrease volume"
                >
                  <Text style={[styles.a11yBtnText, { fontSize: 18 * textScale }]}>🔉</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.a11yBtn}
                  onPress={() => setLocalSound((v: number) => Math.min(100, v + 10))}
                  accessibilityRole="button"
                  accessibilityLabel="Increase volume"
                >
                  <Text style={[styles.a11yBtnText, { fontSize: 18 * textScale }]}>🔊</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <TouchableOpacity style={styles.exitButton} onPress={onClose} accessibilityRole="button" accessibilityLabel={copy.returnHome ?? 'Return home'}>
            <Text style={[styles.actionText, { fontSize: 17 * textScale }]}>{copy.returnHome ?? 'Return Home'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  RENDER: Milestone 2 — Yellow Tier (Blue tile, globe, nurse line)
  // ═══════════════════════════════════════════════════════════════════
  if (phase === 'yellow') {
    return (
      <SafeAreaView style={styles.yellowScreen}>
        {CloudGateModal}
        {ModeToggleBar}
        {CancelBanner}
        <Animated.View style={[styles.yellowCard, { transform: [{ scale: wavePulse }] }]}>
          {Globe}
          <Text style={[styles.statusTitle, { fontSize: 26 * textScale }]}>
            {copy.yellowTier ?? '🟡 Managed Clinical Pathway'}
          </Text>
          <Text style={[styles.statusBody, { fontSize: 17 * textScale }]}>
            {copy.yellowTierExplanation ??
              'Your pain level is moderate. DischargeBuddy AI Assist is activated.'}
          </Text>
          <Text style={[styles.yellowNurseLine, { fontSize: 15 * textScale }]}>
            {copy.yellowNurseLine ?? '📞 Connecting to your clinic nurse and care provider…'}
          </Text>
          {isAlone && (
            <Text style={[styles.yellowAloneWarning, { fontSize: 14 * textScale }]}>
              ⚠ Recorded: patient is alone — paramedics will bring entry tools.
            </Text>
          )}
        </Animated.View>

        {/* Milestone 2C — Appointment routing engine */}
        {!appointmentRequested ? (
          <View style={styles.yellowActions}>
            <Text style={[styles.sectionBody, { fontSize: 16 * textScale, textAlign: 'center', color: '#e2e8f0' }]}>
              Proceed with making an appointment?
            </Text>
            <View style={styles.twoButtonRow}>
              <TouchableOpacity style={styles.noButton} onPress={() => transitionTo('green')} accessibilityRole="button" accessibilityLabel="No — view care information">
                <Text style={[styles.actionText, { fontSize: 17 * textScale }]}>No</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.yesButton}
                onPress={() => requireCloud('Clinic Nurse Line', handleAppointmentYes)}
                accessibilityRole="button"
                accessibilityLabel="Yes — proceed with appointment"
              >
                <Text style={[styles.actionText, { fontSize: 17 * textScale }]}>Yes</Text>
              </TouchableOpacity>
            </View>
            {/* Language fallback (Milestone 2D) */}
            <TouchableOpacity
              style={styles.langFallbackBtn}
              onPress={() => requireCloud('Language Identification', () => transitionTo('lang-detect'))}
              accessibilityRole="button"
              accessibilityLabel="I do not understand English — find my language"
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                {Globe}
                <Text style={[styles.actionText, { fontSize: 14 * textScale }]}>
                  I Do Not Understand English
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.greenTierBtn} onPress={handleGreenTier} accessibilityRole="button" accessibilityLabel={copy.greenTierTitle ?? 'View care information'}>
              <Text style={[styles.actionText, { fontSize: 15 * textScale }]}>{copy.greenTierTitle ?? '📋 Care Information'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.exitButton} onPress={onClose} accessibilityRole="button" accessibilityLabel={copy.returnHome ?? 'Return home'}>
              <Text style={[styles.actionText, { fontSize: 15 * textScale }]}>{copy.returnHome ?? 'Return Home'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.yellowActions}>
            <Text style={[styles.yellowNurseLine, { fontSize: 16 * textScale }]}>
              ✅ Clinic is being called. Please stay on the line.
            </Text>
            <TouchableOpacity style={styles.exitButton} onPress={onClose} accessibilityRole="button" accessibilityLabel={copy.returnHome ?? 'Return home'}>
              <Text style={[styles.actionText, { fontSize: 15 * textScale }]}>{copy.returnHome ?? 'Return Home'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  RENDER: Milestone 2D — Language Detection
  // ═══════════════════════════════════════════════════════════════════
  if (phase === 'lang-detect') {
    return (
      <SafeAreaView style={styles.yellowScreen}>
        {CloudGateModal}
        {ModeToggleBar}
        {CancelBanner}
        <Animated.View style={[styles.yellowCard, { transform: [{ scale: wavePulse }] }]}>
          {Globe}
          <Text style={[styles.statusTitle, { fontSize: 22 * textScale }]}>
            Finding Your Language
          </Text>
          <Text style={[styles.statusBody, { fontSize: 16 * textScale }]}>
            Attempt {langAttempts + 1} of 3. Please hold the phone close and speak very slowly.
          </Text>
          <Text style={[styles.yellowNurseLine, { fontSize: 15 * textScale }]}>
            What is your name?
          </Text>
        </Animated.View>
        {/* Language tap-select grid (simulates audio analysis) */}
        <View style={styles.langGrid}>
          {DEMO_LANGUAGES.map(lang => (
            <TouchableOpacity
              key={lang.code}
              style={styles.langBtn}
              onPress={() => handleLangSelect(lang.code)}
              accessibilityRole="button"
              accessibilityLabel={`Select ${lang.label}`}
            >
              <Text style={[styles.langBtnText, { fontSize: 15 * textScale }]}>
                {lang.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  RENDER: Milestone 2D.3 — Language Confirmation Gate
  // ═══════════════════════════════════════════════════════════════════
  if (phase === 'lang-confirm') {
    const langLabel = DEMO_LANGUAGES.find(l => l.code === detectedLang)?.label ?? '…';
    return (
      <SafeAreaView style={styles.langConfirmScreen}>
        {CloudGateModal}
        {ModeToggleBar}
        {CancelBanner}
        <Animated.View style={[styles.yellowCard, { transform: [{ scale: wavePulse }] }]}>
          {Globe}
          <Text style={[styles.statusTitle, { fontSize: 22 * textScale }]}>
            Is this your language?
          </Text>
          <Text style={[styles.langDetectedLabel, { fontSize: 28 * textScale }]}>
            {langLabel}
          </Text>
        </Animated.View>
        <View style={styles.langConfirmRow}>
          {/* Solid bright GREEN — YES (Milestone 2D.3) */}
          <TouchableOpacity
            style={styles.langConfirmYes}
            onPress={handleLangConfirmYes}
            accessibilityRole="button"
            accessibilityLabel={`Yes — ${langLabel} is correct`}
          >
            <Text style={[styles.langConfirmBtnText, { fontSize: 30 * textScale }]}>YES</Text>
          </TouchableOpacity>
          {/* Solid bright RED — NO */}
          <TouchableOpacity
            style={styles.langConfirmNo}
            onPress={handleLangConfirmNo}
            accessibilityRole="button"
            accessibilityLabel={`No — ${langLabel} is not correct, try again`}
          >
            <Text style={[styles.langConfirmBtnText, { fontSize: 30 * textScale }]}>NO</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.sectionHint, { fontSize: 13 * textScale, marginTop: 12 }]}>
          Say &quot;Yes&quot; or &quot;No&quot;, or press the button. Attempt {langAttempts + 1} of 3.
        </Text>
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  RENDER: Simulated / Cancelled outcomes
  // ═══════════════════════════════════════════════════════════════════
  if (phase === 'simulated' || phase === 'cancelled') {
    const title   = phase === 'simulated'
      ? (copy.simulatedEscalation ?? '🚨 Ambulance Dispatched')
      : (copy.cancelled           ?? '✅ Alert Cancelled');
    const message = phase === 'simulated'
      ? (copy.simulatedNoAction ?? 'This is a demonstration. In a real emergency, help is on the way.')
      : (copy.noCall            ?? 'No emergency call was made. You are safe.');
    return (
      <SafeAreaView style={[styles.statusScreen, phase === 'cancelled' && styles.cancelledScreen]}>
        {CloudGateModal}
        {ModeToggleBar}
        <Text style={[styles.statusTitle, { fontSize: 28 * textScale }]}>{title}</Text>
        <Text style={[styles.statusBody,  { fontSize: 18 * textScale }]}>{message}</Text>
        {phase === 'simulated' && (
          <Text style={[styles.simulatedDispatchNote, { fontSize: 15 * textScale }]}>
            🚑 Offline Ambulance Dispatch Simulated — No real call was made
          </Text>
        )}
        {phase === 'simulated' && isAlone && (
          <Text style={[styles.statusNote, { fontSize: 14 * textScale }]}>
            📍 Saved: patient is alone — medical team has been alerted.
          </Text>
        )}
        <TouchableOpacity style={styles.exitButton} onPress={onClose} accessibilityRole="button" accessibilityLabel={copy.returnHome ?? 'Return home'}>
          <Text style={[styles.actionText, { fontSize: 18 * textScale }]}>{copy.returnHome ?? 'Return Home'}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  RENDER: Milestone D — Double-Tile Safety Validation Gate
  // ═══════════════════════════════════════════════════════════════════
  if (phase === 'validation') {
    return (
      <SafeAreaView style={[styles.safe, styles.validationScreen]}>
        {CloudGateModal}
        {ModeToggleBar}
        {CancelBanner}
        {SilenceBar}
        <View style={styles.validationContent}>
          <Text style={[styles.validationTitle, { fontSize: 22 * textScale }]}>
            🚨 Ambulance Coming
          </Text>
          <Text style={[styles.validationSub, { fontSize: 16 * textScale }]}>
            Say or press your choice:
          </Text>
          <View style={styles.validationTileRow}>
            {/* Amber NO tile */}
            <TouchableOpacity
              style={styles.tileNo}
              onPress={handleValidationNo}
              accessibilityRole="button"
              accessibilityLabel='No Ambulance. Press to cancel.'
              activeOpacity={0.8}
            >
              <Text style={[styles.tileNoIcon, { fontSize: 40 * textScale }]}>🚫</Text>
              <Text style={[styles.tileNoText, { fontSize: 20 * textScale }]}>No{'\n'}Ambulance</Text>
              <Text style={[styles.tileHint, { fontSize: 13 * textScale }]}>Tap or say{'\n'}"No Ambulance"</Text>
            </TouchableOpacity>
            {/* Red YES tile — flashing */}
            <Animated.View style={{ flex: 1, opacity: frameFlash.interpolate({ inputRange: [0.15, 0.95], outputRange: [0.85, 1] }) }}>
              <TouchableOpacity
                style={styles.tileYes}
                onPress={handleValidationYes}
                accessibilityRole="button"
                accessibilityLabel='Yes Ambulance. Press to confirm dispatch.'
                activeOpacity={0.8}
              >
                <Text style={[styles.tileYesIcon, { fontSize: 40 * textScale }]}>🚑</Text>
                <Text style={[styles.tileYesText, { fontSize: 20 * textScale }]}>Yes{'\n'}Ambulance</Text>
                <Text style={[styles.tileHint, { fontSize: 13 * textScale }]}>Tap or say{'\n'}"Yes Ambulance"</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </View>
        <Animated.View pointerEvents="none" style={[styles.emergencyFrame, styles.redFrame, { opacity: frameFlash }]} />
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  RENDER: Main alarm phases
  //  (pause / word-check / active-check / alone-check / pain / countdown)
  // ═══════════════════════════════════════════════════════════════════
  return (
    <SafeAreaView
      style={[
        styles.safe,
        (phase === 'pause' || phase === 'word-check' ||
         phase === 'active-check' || phase === 'alone-check' ||
         phase === 'pain') && styles.amberScreen,
        phase === 'countdown' && styles.redScreen,
      ]}
    >
      {CloudGateModal}
      {ModeToggleBar}
      {CancelBanner}

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { fontSize: 27 * textScale }]}>
          {copy.alertTitle ?? '🚨 EMERGENCY ALERT'}
        </Text>
        <Text style={styles.language}>
          {copy.promptLanguage?.(language.label) ?? language.label}
        </Text>
        <Text style={styles.demoNotice}>
          {copy.demoOnlyNotice ?? 'DEMO — no real calls are placed'}
        </Text>

        {/* ── PAUSE — 2-second system clear ── */}
        {phase === 'pause' && (
          <View style={styles.pauseBox}>
            <Text style={[styles.countdownNumber, { fontSize: 72 * textScale }]}>
              {pauseSeconds}
            </Text>
            <Text style={[styles.countdownLabel, { fontSize: 16 * textScale }]}>
              {copy.safetyPause?.(pauseSeconds) ?? `${pauseSeconds}-second system clear`}
            </Text>
          </View>
        )}

        {/* ── WORD-CHECK — Milestone A ── */}
        {phase === 'word-check' && (
          <View style={styles.wordCheckBox}>
            <Text style={[styles.sectionTitle, { fontSize: 20 * textScale }]}>
              What are you experiencing?
            </Text>
            <Text style={[styles.sectionBody, { fontSize: 16 * textScale }]}>
              DischargeBuddy is scanning your symptoms to determine the correct care path.
            </Text>
            {SilenceBar}
            <View style={styles.wordGrid}>
              <TouchableOpacity style={styles.wordBtnDanger} onPress={() => handleWordScan('I feel chest pain')} accessibilityRole="button" accessibilityLabel="I feel chest pain">
                <Text style={[styles.wordBtnText, { fontSize: 15 * textScale }]}>💢 Chest Pain</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.wordBtnDanger} onPress={() => handleWordScan("I can't breathe")} accessibilityRole="button" accessibilityLabel="I cannot breathe">
                <Text style={[styles.wordBtnText, { fontSize: 15 * textScale }]}>😤 Can't Breathe</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.wordBtnDanger} onPress={() => handleWordScan('I need an ambulance')} accessibilityRole="button" accessibilityLabel="I need an ambulance — instant dispatch">
                <Text style={[styles.wordBtnText, { fontSize: 15 * textScale }]}>🚑 Need Ambulance</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.wordBtnDanger} onPress={() => handleWordScan('severe stomach pain I never had before')} accessibilityRole="button" accessibilityLabel="Severe stomach pain">
                <Text style={[styles.wordBtnText, { fontSize: 15 * textScale }]}>🤢 Severe Pain</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.wordBtnDanger} onPress={() => handleWordScan('help')} accessibilityRole="button" accessibilityLabel="Help — instant dispatch trigger">
                <Text style={[styles.wordBtnText, { fontSize: 15 * textScale }]}>🆘 HELP!</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.wordBtnSafe} onPress={() => handleWordScan('what should I do if I get chest pain')} accessibilityRole="button" accessibilityLabel="Educational question">
                <Text style={[styles.wordBtnTextSafe, { fontSize: 15 * textScale }]}>❓ What if I get chest pain?</Text>
              </TouchableOpacity>
            </View>
            {wordScanResult === 'danger' && (
              <Text style={[styles.wordResultDanger, { fontSize: 15 * textScale }]}>
                ⚡ Danger words detected — emergency protocol activated
              </Text>
            )}
            {wordScanResult === 'safe' && (
              <Text style={[styles.wordResultSafe, { fontSize: 15 * textScale }]}>
                ✅ Safe query — routing to care information
              </Text>
            )}
            <TouchableOpacity style={styles.yesButton} onPress={handleDangerButton} accessibilityRole="button" accessibilityLabel="I am having an emergency right now">
              <Text style={[styles.actionText, { fontSize: 17 * textScale }]}>🆘 I Am Having an Emergency</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.greenTierBtn} onPress={handleSafeButton} accessibilityRole="button" accessibilityLabel="I have a general question">
              <Text style={[styles.actionText, { fontSize: 15 * textScale }]}>📋 I Have a General Question</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── ACTIVE-CHECK — Milestone C.1 ── */}
        {phase === 'active-check' && (
          <View style={styles.activeCheckBox}>
            <Text style={[styles.sectionTitle, { fontSize: 22 * textScale }]}>
              Are you actively experiencing this medical emergency right now?
            </Text>
            {SilenceBar}
            <View style={styles.twoButtonRow}>
              <TouchableOpacity style={styles.noButton} onPress={cancel} accessibilityRole="button" accessibilityLabel="No — cancel emergency">
                <Text style={[styles.actionText, { fontSize: 18 * textScale }]}>No</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.yesButton} onPress={() => transitionTo('validation')} accessibilityRole="button" accessibilityLabel="Yes — I need help now">
                <Text style={[styles.actionText, { fontSize: 18 * textScale }]}>Yes</Text>
              </TouchableOpacity>
            </View>
            {/* Instant dispatch — terminates countdown to zero (Milestone C.2) */}
            <TouchableOpacity style={styles.instantDispatchBtn} onPress={handleInstantDispatch} accessibilityRole="button" accessibilityLabel="Send ambulance immediately — instant dispatch">
              <Text style={[styles.actionText, { fontSize: 16 * textScale }]}>🚑 Send Ambulance NOW</Text>
            </TouchableOpacity>
            <Text style={[styles.sectionHint, { fontSize: 13 * textScale }]}>
              Say "I need an ambulance" or "Help" for instant dispatch. Say "No Ambulance" to cancel.
            </Text>
          </View>
        )}

        {/* ── ALONE-CHECK — Milestone D.6 ── */}
        {phase === 'alone-check' && (
          <View style={styles.aloneCheckBox}>
            <Text style={[styles.sectionTitle, { fontSize: 22 * textScale }]}>
              {copy.areYouAlone ?? 'Are you completely alone right now?'}
            </Text>
            <Text style={[styles.sectionBody, { fontSize: 15 * textScale }]}>
              This will be permanently saved with your medical dispatch record to inform paramedics.
            </Text>
            {/* 🎤 Mic button for voice yes/no */}
            {emgMicSupported && (
              <TouchableOpacity
                style={[styles.micBtnEmg, emgIsListening && styles.micBtnEmgActive]}
                onPress={() => emgIsListening ? emgStopListening() : emgStartListening()}
                accessibilityRole="button"
                accessibilityLabel={emgIsListening ? 'Stop microphone' : 'Tap mic and say Yes or No'}
              >
                <Text style={{ fontSize: 24 }}>🎤</Text>
                <Text style={[styles.actionText, { fontSize: 13 * textScale }]}>
                  {emgIsListening
                    ? (copy.listeningIndicator ?? '🎤 Listening…')
                    : (copy.tapToConfirm ?? 'Tap 🎤 to answer by voice')}
                </Text>
              </TouchableOpacity>
            )}
            <View style={styles.twoButtonRow}>
              <TouchableOpacity style={styles.aloneNoBtn} onPress={() => handleAloneAnswer(false)} accessibilityRole="button" accessibilityLabel="No — someone is nearby">
                <Text style={[styles.actionText, { fontSize: 18 * textScale }]}>No — Someone{'\n'}Is Nearby</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.aloneYesBtn} onPress={() => handleAloneAnswer(true)} accessibilityRole="button" accessibilityLabel="Yes — I am completely alone">
                <Text style={[styles.actionText, { fontSize: 18 * textScale }]}>Yes — I Am{'\n'}Alone</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── PAIN — Milestone D.4/5 (elderly-first redesign) ── */}
        {phase === 'pain' && (
          <View style={styles.painSection}>
            <Text style={[styles.sectionTitle, { fontSize: 22 * textScale }]}>
              How bad is your pain right now?
            </Text>

            {/* Tier badges — colour meaning inline, no separate legend to read */}
            <View style={styles.painTierBadges}>
              <View style={[styles.painTierBadge, styles.painTierBadgeGreen]}>
                <Text style={[styles.painTierBadgeText, { fontSize: 12 * textScale, color: '#4ade80' }]}>● Mild  1–3</Text>
              </View>
              <View style={[styles.painTierBadge, styles.painTierBadgeAmber]}>
                <Text style={[styles.painTierBadgeText, { fontSize: 12 * textScale, color: '#fbbf24' }]}>● Moderate  4–7</Text>
              </View>
              <View style={[styles.painTierBadge, styles.painTierBadgeRed]}>
                <Text style={[styles.painTierBadgeText, { fontSize: 12 * textScale, color: '#ff453a' }]}>● Severe  8–10</Text>
              </View>
            </View>

            {SilenceBar}

            {/* Row 1: 1–5 */}
            <View style={styles.painRow}>
              {[1, 2, 3, 4, 5].map(score => (
                <TouchableOpacity
                  key={score}
                  style={[
                    styles.painButton,
                    score <= 3 ? styles.painButtonGreen : styles.painButtonAmber,
                    painScore === score && styles.painSelected,
                  ]}
                  onPress={() => handlePainScore(score)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    copy.painScore?.(score) ??
                    `Pain level ${score}. ${score >= 8 ? 'Severe — ambulance.' : score >= 4 ? 'Moderate — nurse line.' : 'Mild — care information.'}`
                  }
                >
                  <Text style={[styles.painButtonText, { fontSize: 22 * textScale }]}>{score}</Text>
                  <Text style={[styles.painButtonSubLabel, { fontSize: 11 * textScale },
                    score <= 3 ? { color: '#4ade80' } : { color: '#fbbf24' },
                  ]}>
                    {score <= 3 ? 'Mild' : 'Mod'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Row 2: 6–10 */}
            <View style={styles.painRow}>
              {[6, 7, 8, 9, 10].map(score => (
                <TouchableOpacity
                  key={score}
                  style={[
                    styles.painButton,
                    score <= 7 ? styles.painButtonAmber : styles.painButtonRed,
                    painScore === score && styles.painSelected,
                  ]}
                  onPress={() => handlePainScore(score)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    copy.painScore?.(score) ??
                    `Pain level ${score}. ${score >= 8 ? 'Severe — ambulance.' : 'Moderate — nurse line.'}`
                  }
                >
                  <Text style={[styles.painButtonText, { fontSize: 22 * textScale }]}>{score}</Text>
                  <Text style={[styles.painButtonSubLabel, { fontSize: 11 * textScale },
                    score <= 7 ? { color: '#fbbf24' } : { color: '#ff453a' },
                  ]}>
                    {score <= 7 ? 'Mod' : 'Severe'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Repeat prompt — promoted above "I Feel Fine" so it's thumb-reachable */}
            <TouchableOpacity
              style={styles.repeatButton}
              onPress={() => speak(language.emergencyPrompt ?? 'Are you having an emergency?', true)}
              accessibilityRole="button"
              accessibilityLabel={copy.repeatPrompt ?? 'Repeat voice prompt'}
            >
              <Text style={[styles.actionText, { fontSize: 17 * textScale }]}>
                {copy.repeatPrompt ?? '🔊 Hear Again'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.greenTierBtn} onPress={handleGreenTier} accessibilityRole="button" accessibilityLabel="I feel fine — view care information">
              <Text style={[styles.actionText, { fontSize: 17 * textScale }]}>✅ I Feel Fine</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── COUNTDOWN — Milestone E + instant cancel ── */}
        {phase === 'countdown' && (
          <View style={styles.countdownSection}>
            <Text style={[styles.sectionTitle, { fontSize: 22 * textScale }]}>
              🚨 Ambulance Being Dispatched
            </Text>
            <Animated.View style={[
              styles.countdownBox,
              countdown <= 3 && styles.countdownUrgent,
              { transform: [{ scale: pulse }] },
            ]}>
              <Text style={[
                styles.countdownNumber,
                countdown <= 3 && styles.countdownNumberUrgent,
                { fontSize: 80 * textScale },
              ]}>
                {countdown}
              </Text>
              <Text style={[styles.countdownLabel, { fontSize: 16 * textScale }]}>
                {copy.secondsRemaining?.(countdown) ?? `${countdown} seconds`}
              </Text>
            </Animated.View>

            {/* User error cancellation — visible at every absolute second (Milestone A) */}
            <View style={styles.countdownCancelRow}>
              <TouchableOpacity
                style={styles.countdownCancelBtn}
                onPress={cancel}
                accessibilityRole="button"
                accessibilityLabel='Cancel. False Alarm. Say "No Ambulance" or press to stop dispatch.'
                activeOpacity={0.75}
              >
                <Text style={[styles.countdownCancelText, { fontSize: 18 * textScale }]}>
                  ✕  NO AMBULANCE — Cancel
                </Text>
                <Text style={[styles.countdownCancelHint, { fontSize: 12 * textScale }]}>
                  Say "No Ambulance" or tap to stop
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.confirmButton} onPress={handleConfirmDispatch} accessibilityRole="button" accessibilityLabel="Confirm dispatch immediately">
              <Text style={[styles.actionText, { fontSize: 18 * textScale }]}>✔ Confirm Dispatch Now</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Repeat prompt button — hidden on pain phase (has its own promoted copy above) */}
        {phase !== 'pain' && (
          <TouchableOpacity
            style={styles.repeatButton}
            onPress={() => speak(language.emergencyPrompt ?? 'Are you having an emergency?', true)}
            accessibilityRole="button"
            accessibilityLabel={copy.repeatPrompt ?? 'Repeat voice prompt'}
          >
            <Text style={[styles.actionText, { fontSize: 15 * textScale }]}>
              {copy.repeatPrompt ?? '🔊 Repeat Prompt'}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Flashing border overlay */}
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
  safe:          { flex: 1, backgroundColor: '#140900' },
  amberScreen:   { backgroundColor: '#211900' },
  redScreen:     { backgroundColor: '#210808' },
  content:       { flexGrow: 1, justifyContent: 'center', padding: 20, paddingBottom: 32, gap: 14 },
  title:         { color: '#facc15', textAlign: 'center', fontWeight: '900' },
  language:      { color: '#ffffff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  demoNotice:    { color: '#fff4c2', textAlign: 'center', fontSize: 15, lineHeight: 22, fontWeight: '800' },
  actionText:    { color: '#ffffff', fontWeight: '900', textAlign: 'center' },

  // ── Cancel Banner ──
  cancelBannerRow: { flexDirection: 'row', alignItems: 'stretch', zIndex: 100 },
  cancelBanner: {
    backgroundColor: '#7c2d12', borderBottomColor: '#facc15', borderBottomWidth: 3,
    paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center',
  },
  cancelBannerText: { color: '#ffffff', fontWeight: '900', letterSpacing: 1.2, textAlign: 'center' },
  cancelBannerSpeak: { backgroundColor: '#78350f', borderBottomColor: '#facc15', borderBottomWidth: 3, minWidth: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },

  // ── Section text ──
  sectionTitle: { color: '#ffffff', fontWeight: '900', textAlign: 'center', lineHeight: 30 },
  sectionBody:  { color: '#cbd5e1', textAlign: 'center', lineHeight: 22 },
  sectionHint:  { color: '#94a3b8', textAlign: 'center', lineHeight: 18 },

  // ── Buttons ──
  repeatButton:       { minHeight: 52, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1d4ed8', borderRadius: 10, padding: 12 },
  exitButton:         { alignSelf: 'stretch', minHeight: 62, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1d4ed8', borderRadius: 10, padding: 14 },
  noButton:           { flex: 1, minHeight: 76, justifyContent: 'center', alignItems: 'center', backgroundColor: '#854d0e', borderColor: '#facc15', borderWidth: 3, borderRadius: 10, padding: 12 },
  yesButton:          { flex: 1, minHeight: 76, justifyContent: 'center', alignItems: 'center', backgroundColor: '#b91c1c', borderColor: '#ffffff', borderWidth: 3, borderRadius: 10, padding: 12 },
  confirmButton:      { minHeight: 72, justifyContent: 'center', alignItems: 'center', backgroundColor: '#991b1b', borderColor: '#ff453a', borderWidth: 3, borderRadius: 10, padding: 12 },
  greenTierBtn:       { minHeight: 56, justifyContent: 'center', alignItems: 'center', backgroundColor: '#14532d', borderColor: '#4ade80', borderWidth: 2, borderRadius: 10, padding: 12 },
  instantDispatchBtn: { minHeight: 64, justifyContent: 'center', alignItems: 'center', backgroundColor: '#7f1d1d', borderColor: '#ff453a', borderWidth: 3, borderRadius: 12, padding: 14 },
  twoButtonRow:       { flexDirection: 'row', gap: 12, marginTop: 8 },
  langFallbackBtn:    { minHeight: 52, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1, borderRadius: 10, padding: 12 },

  // ── Countdown phase cancel row (user error cancellation) ──
  countdownCancelRow: { alignSelf: 'stretch' },
  countdownCancelBtn: {
    minHeight: 80, justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#78350f', borderColor: '#f59e0b', borderWidth: 4,
    borderRadius: 14, padding: 14, gap: 4,
  },
  countdownCancelText: { color: '#fbbf24', fontWeight: '900', textAlign: 'center', letterSpacing: 1 },
  countdownCancelHint: { color: '#d97706', textAlign: 'center' },

  // ── Inter-phase buffer ──
  interPauseScreen: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
  interPauseText:   { color: '#475569', fontWeight: '900', textAlign: 'center' },

  // ── Entry pause box ──
  pauseBox: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#211500', borderColor: '#facc15', borderWidth: 3, borderRadius: 10, padding: 18, gap: 8,
  },

  // ── Word-check ──
  wordCheckBox:     { gap: 14 },
  wordGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  wordBtnDanger:    { paddingVertical: 12, paddingHorizontal: 14, backgroundColor: '#3a0000', borderColor: '#ff453a', borderWidth: 2, borderRadius: 10, alignItems: 'center' },
  wordBtnSafe:      { paddingVertical: 12, paddingHorizontal: 14, backgroundColor: '#14532d', borderColor: '#4ade80', borderWidth: 2, borderRadius: 10, alignItems: 'center' },
  wordBtnText:      { color: '#ffffff', fontWeight: '800' },
  wordBtnTextSafe:  { color: '#4ade80', fontWeight: '800' },
  wordResultDanger: { color: '#ff453a', fontWeight: '900', textAlign: 'center' },
  wordResultSafe:   { color: '#4ade80', fontWeight: '900', textAlign: 'center' },

  // ── Active-check ──
  activeCheckBox: { gap: 14 },

  // ── Validation gate (Double-Tile) ──
  validationScreen:  { backgroundColor: '#1a0000' },
  validationContent: { flex: 1, padding: 16, gap: 14, justifyContent: 'center' },
  validationTitle:   { color: '#ffffff', fontWeight: '900', textAlign: 'center' },
  validationSub:     { color: '#cbd5e1', textAlign: 'center' },
  validationTileRow: { flexDirection: 'row', gap: 12, flex: 1, minHeight: 280 },
  tileNo:    { flex: 1, backgroundColor: '#78350f', borderColor: '#f59e0b', borderWidth: 4, borderRadius: 16, alignItems: 'center', justifyContent: 'center', padding: 16, gap: 10 },
  tileYes:   { flex: 1, backgroundColor: '#7f1d1d', borderColor: '#ff453a', borderWidth: 4, borderRadius: 16, alignItems: 'center', justifyContent: 'center', padding: 16, gap: 10, height: '100%' },
  tileNoIcon:  { textAlign: 'center' },
  tileNoText:  { color: '#fbbf24', fontWeight: '900', textAlign: 'center' },
  tileYesIcon: { textAlign: 'center' },
  tileYesText: { color: '#ff453a', fontWeight: '900', textAlign: 'center' },
  tileHint:    { color: '#94a3b8', textAlign: 'center', lineHeight: 18 },

  // ── Alone-check ──
  aloneCheckBox: { gap: 14 },
  aloneNoBtn:    { flex: 1, minHeight: 100, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0c4a6e', borderColor: '#38bdf8', borderWidth: 3, borderRadius: 12, padding: 12 },
  aloneYesBtn:   { flex: 1, minHeight: 100, justifyContent: 'center', alignItems: 'center', backgroundColor: '#7c2d12', borderColor: '#f97316', borderWidth: 3, borderRadius: 12, padding: 12 },
  micBtnEmg:     { alignSelf: 'stretch', flexDirection: 'row', minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#1e293b', borderColor: '#475569', borderWidth: 2, borderRadius: 10, padding: 10 },
  micBtnEmgActive: { backgroundColor: '#0f3460', borderColor: '#3b82f6' },

  // ── Pain grid (elderly-first redesign) ──
  painSection:         { gap: 14 },
  // Two rows of 5, filling the full width
  painRow:             { flexDirection: 'row', gap: 8 },
  // Buttons are tall, flex to fill equal width in each row
  painButton:          { flex: 1, minHeight: 72, alignItems: 'center', justifyContent: 'center', backgroundColor: '#242424', borderColor: '#64748b', borderWidth: 3, borderRadius: 10, paddingVertical: 6 },
  painButtonGreen:     { borderColor: '#22c55e', backgroundColor: '#14532d' },
  painButtonAmber:     { borderColor: '#f59e0b', backgroundColor: '#78350f' },
  painButtonRed:       { borderColor: '#ff453a', backgroundColor: '#7f1d1d' },
  painSelected:        { opacity: 0.75 },
  painButtonText:      { color: '#ffffff', fontWeight: '900', textAlign: 'center' },
  painButtonSubLabel:  { fontWeight: '700', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.4 },
  // Tier badge row (replaces guardrailLegend on pain screen)
  painTierBadges:      { flexDirection: 'row', gap: 6, justifyContent: 'center' },
  painTierBadge:       { flex: 1, paddingVertical: 5, paddingHorizontal: 4, borderRadius: 6, alignItems: 'center' },
  painTierBadgeGreen:  { backgroundColor: '#052e16' },
  painTierBadgeAmber:  { backgroundColor: '#431407' },
  painTierBadgeRed:    { backgroundColor: '#3b0000' },
  painTierBadgeText:   { fontWeight: '800', textAlign: 'center' },

  // ── Countdown section ──
  countdownSection:      { gap: 14, alignItems: 'center' },
  countdownBox:          { alignItems: 'center', backgroundColor: '#211500', borderColor: '#facc15', borderWidth: 3, borderRadius: 10, paddingVertical: 16, paddingHorizontal: 24 },
  countdownUrgent:       { backgroundColor: '#2b0909', borderColor: '#ff453a' },
  countdownNumber:       { color: '#facc15', fontWeight: '900' },
  countdownNumberUrgent: { color: '#ff453a' },
  countdownLabel:        { color: '#ffffff', textAlign: 'center' },

  // ── Silence bar ──
  silenceBarContainer: { gap: 6, backgroundColor: '#1e1e1e', borderRadius: 8, padding: 10, borderColor: '#ff453a', borderWidth: 1 },
  silenceLabel: { color: '#ff453a', fontWeight: '800', textAlign: 'center' },
  silenceTrack: { height: 12, backgroundColor: '#3a0000', borderRadius: 6, overflow: 'hidden' },
  silenceFill:  { height: '100%', backgroundColor: '#ff453a', borderRadius: 6 },

  // ── Flashing frame ──
  emergencyFrame: { ...StyleSheet.absoluteFill, borderWidth: 12, borderRadius: 12 },
  amberFrame:     { borderColor: '#facc15' },
  redFrame:       { borderColor: '#ff453a' },

  // ── Yellow Tier / Milestone 2 ──
  yellowScreen:       { flex: 1, backgroundColor: '#082f49', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18 },
  yellowCard:         { alignSelf: 'stretch', backgroundColor: '#0c4a6e', borderRadius: 16, padding: 24, gap: 12, alignItems: 'center' },
  yellowNurseLine:    { color: '#7dd3fc', textAlign: 'center', fontWeight: '700', marginTop: 8 },
  yellowAloneWarning: { color: '#fbbf24', textAlign: 'center', fontWeight: '700', marginTop: 6 },
  yellowActions:      { alignSelf: 'stretch', gap: 10 },
  globeIcon:          { fontSize: 52, textAlign: 'center' },

  // ── Language detection (Milestone 2D) ──
  langGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', padding: 16 },
  langBtn:     { paddingVertical: 14, paddingHorizontal: 18, backgroundColor: '#1e3a5f', borderColor: '#38bdf8', borderWidth: 2, borderRadius: 12, alignItems: 'center', minWidth: 140 },
  langBtnText: { color: '#e2e8f0', fontWeight: '800', textAlign: 'center' },

  // ── Language confirmation (Milestone 2D.3) ──
  langConfirmScreen:   { flex: 1, backgroundColor: '#082f49', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18 },
  langConfirmRow:      { flexDirection: 'row', gap: 14, alignSelf: 'stretch' },
  langConfirmYes:      { flex: 1, minHeight: 120, backgroundColor: '#15803d', borderColor: '#22c55e', borderWidth: 4, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  langConfirmNo:       { flex: 1, minHeight: 120, backgroundColor: '#991b1b', borderColor: '#ff453a', borderWidth: 4, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  langConfirmBtnText:  { color: '#ffffff', fontWeight: '900' },
  langDetectedLabel:   { color: '#7dd3fc', fontWeight: '900', textAlign: 'center' },

  // ── Green Tier / Milestone 3 ──
  greenScreen:              { flex: 1, backgroundColor: '#000000' },
  greenScreenHighContrast:  { backgroundColor: '#0a0a0a' },
  greenContent:             { padding: 20, paddingBottom: 32, gap: 16 },
  greenTitle:               { color: '#ffffff', fontWeight: '900', textAlign: 'center', marginBottom: 4 },
  greenCard:                { backgroundColor: '#111111', borderColor: '#ffffff', borderWidth: 1, borderRadius: 12, padding: 18, gap: 8 },
  greenCardHighContrast:    { backgroundColor: '#000000', borderColor: '#ffffff', borderWidth: 2 },
  greenCardLabel:           { color: '#ffffff', fontWeight: '900' },
  greenCardBody:            { color: '#d1d5db', lineHeight: 22 },

  // ── Milestone 3F accessibility controls ──
  a11yControls: { backgroundColor: '#111827', borderRadius: 12, padding: 16, gap: 12, borderColor: '#1e293b', borderWidth: 1 },
  a11yTitle:    { color: '#e2e8f0', fontWeight: '900', marginBottom: 4 },
  a11yRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  a11yLabel:    { color: '#94a3b8', flex: 1 },
  a11yBtnRow:   { flexDirection: 'row', gap: 8 },
  a11yBtn:      { minWidth: 50, minHeight: 44, backgroundColor: '#1e293b', borderRadius: 8, alignItems: 'center', justifyContent: 'center', padding: 8 },
  a11yBtnText:  { color: '#ffffff', fontWeight: '900' },
  a11yToggle:   { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#1e293b', borderRadius: 8, borderColor: '#334155', borderWidth: 1 },
  a11yToggleOn: { backgroundColor: '#166534', borderColor: '#4ade80' },
  a11yToggleText: { color: '#ffffff', fontWeight: '900' },

  // ── Outcome screens ──
  statusScreen:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 18, backgroundColor: '#cc0000' },
  cancelledScreen: { backgroundColor: '#001a0e' },
  statusTitle:     { color: '#ffffff', fontWeight: '900', textAlign: 'center' },
  statusBody:      { color: '#ffcccc', textAlign: 'center', lineHeight: 28 },
  statusNote:             { color: '#fbbf24', textAlign: 'center', lineHeight: 20 },
  simulatedDispatchNote:  { color: '#86efac', fontWeight: '800', textAlign: 'center', backgroundColor: '#052e16', borderColor: '#4ade80', borderWidth: 2, borderRadius: 10, padding: 12, lineHeight: 22 },

  // ══════════════════════════════════════════════════════════════════
  // Standalone / Cloud Sync Mode Toggle Bar
  // ══════════════════════════════════════════════════════════════════
  modeToggleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f172a',
    borderBottomColor: '#1e3a5f',
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
});
