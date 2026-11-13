import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AccessibilityInfo,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getLanguage, languages } from '@/constants/safety-content';
import type { LanguageLabel } from '@/constants/safety-content';
import { getUiCopy } from '@/constants/ui-copy';
import { useAppLanguage } from '@/contexts/language-context';
import { EmergencyFlow } from '@/components/emergency-flow';
import { MicTextInput } from '@/components/MicTextInput';
import { useVoiceRecognition } from '@/hooks/use-voice-recognition';

// ─── Accessible speech rate cap ───────────────────────────────────────────────
// Slightly below the previous 0.65 — lower pitch/rate aids elderly + hearing-impaired
const ACCESSIBLE_RATE = 0.6;

// ─── Patient demo data ────────────────────────────────────────────────────────
const PATIENT_DEFAULT_NAME = 'Maria Johnson';
const patient = {
  doctor:          'Dr. Reyes \u2014 Cardiology',
  location:        'Heart Care Clinic, Room 204',
  appointmentTime: '10:30 AM',
};

function getDemoAppointmentDate(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 3);
  date.setHours(10, 30, 0, 0);
  return date;
}

// ─── Medications with interval labels ────────────────────────────────────────
type Medication = {
  name: string;
  time: string;
  hour: number;
  minute: number;
  taken: boolean;
  /** locked = missed & 6-alert lockout expired; grayed but NOT shown as taken ✓ */
  locked?: boolean;
  interval: 'Morning' | 'Afternoon' | 'Evening';
  intervalEmoji: string;
  intervalColor: string;
};

const initialMedications: Medication[] = [
  { name: 'Lisinopril 10mg', time: '8:00 AM',  hour: 8,  minute: 0, taken: false, interval: 'Morning',   intervalEmoji: '🌅', intervalColor: '#fbbf24' },
  { name: 'Lisinopril 10mg', time: '12:00 PM', hour: 12, minute: 0, taken: false, interval: 'Afternoon', intervalEmoji: '☀️', intervalColor: '#f97316' },
  { name: 'Lisinopril 10mg', time: '6:00 PM',  hour: 18, minute: 0, taken: false, interval: 'Evening',   intervalEmoji: '🌙', intervalColor: '#3b82f6' },
];

type ReminderKey = string;

// ─── Overdue alarm helpers ────────────────────────────────────────────────────
function isMissedDose(med: Medication): boolean {
  if (med.taken || med.locked) return false;
  const now = new Date();
  const due = new Date();
  due.setHours(med.hour, med.minute, 0, 0);
  return now > due;
}

// ─── Voice readiness (web speechSynthesis gate) ──────────────────────────────
async function waitForVoices(): Promise<void> {
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined') return;
  const synth = (window as typeof window & { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  if (!synth) return;
  if (synth.getVoices().length > 0) return;
  return new Promise<void>(resolve => {
    const handler = () => { synth.removeEventListener('voiceschanged', handler); resolve(); };
    synth.addEventListener('voiceschanged', handler);
    // Safety timeout: resolve after 3 s regardless
    setTimeout(resolve, 3000);
  });
}

// ─── Name setup step type ────────────────────────────────────────────────────
type NameStep =
  | 'idle'
  | 'verify'           // auto-announce on load: "Your name is X. Is that correct?"
  | 'attempt1'         // first NO: mic listening for spoken name
  | 'attempt1-confirm' // heard name — YES/NO confirm
  | 'spell-first'      // second NO: spell first name
  | 'spell-first-confirm'
  | 'spell-last'       // spell last name
  | 'spell-last-confirm'
  | 'speaking'         // legacy: after language change
  | 'listening'
  | 'input'
  | 'confirm';

export default function HomeScreen() {
  const { languageLabel, setLanguageLabel } = useAppLanguage();
  const language    = getLanguage(languageLabel);
  const copy        = getUiCopy(languageLabel);
  const languageRef = useRef(language);
  const timers      = useRef<Record<ReminderKey, ReturnType<typeof setTimeout>>>({});
  // Web voice readiness flag — set to true once waitForVoices() resolves
  const voicesReady = useRef(false);

  const [medications,               setMedications]               = useState(initialMedications);
  const [patientName,               setPatientName]               = useState(PATIENT_DEFAULT_NAME);
  const [editingName,               setEditingName]               = useState(false);
  const [draftName,                 setDraftName]                 = useState(PATIENT_DEFAULT_NAME);
  const [contrastMode,              setContrastMode]              = useState<'standard' | 'high'>('high');
  const [fontScale,                 setFontScale]                 = useState(1.25);
  const [soundLevel,                setSoundLevel]                = useState(80);
  const [speechRate,                setSpeechRate]                = useState(0.65);
  const [showAccessibility,         setShowAccessibility]         = useState(false);
  const [appointmentAt,             setAppointmentAt]             = useState(getDemoAppointmentDate);
  const [appointmentReminderActive, setAppointmentReminderActive] = useState(false);
  const [medicationReminders,       setMedicationReminders]       = useState<Record<string, boolean>>({});
  const [showEmergency,             setShowEmergency]             = useState(false);
  const [emergencyPhrase,           setEmergencyPhrase]           = useState<string | undefined>(undefined);

  // ── Speaker switch & Read-All (ST-5) ───────────────────────────────────────
  const [speakerEnabled, setSpeakerEnabled]   = useState(false);
  const [isReadingAll,   setIsReadingAll]     = useState(false);

  // ── Language / name setup flow ─────────────────────────────────────────────
  const [nameSetupPhrase,   setNameSetupPhrase]   = useState('');
  const [nameSetupStep,     setNameSetupStep]     = useState<NameStep>('idle');
  const [heardName,         setHeardName]         = useState('');
  const [nameAttempt,       setNameAttempt]       = useState(0);
  const [spellBuffer,       setSpellBuffer]       = useState('');
  const [confirmedFirst,    setConfirmedFirst]    = useState('');

  // ── Overdue alarm state ────────────────────────────────────────────────────
  const overdueTimers    = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const overdueStartTime = useRef<Record<string, number>>({});
  const [overdueAlarm, setOverdueAlarm] = useState<Medication | null>(null);

  // ── Voice trigger 4-step state ─────────────────────────────────────────────
  type VoiceStep = 'idle' | 'step1-listen' | 'step2-countdown' | 'step3-alone' | 'step4-onway';
  const [voiceStep,       setVoiceStep]       = useState<VoiceStep>('idle');
  const [voicePhrase,     setVoicePhrase]     = useState('');
  const [voiceCountdown,  setVoiceCountdown]  = useState(5);
  const [voicePauseLeft,  setVoicePauseLeft]  = useState(30);
  const voiceTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ── Confirm-before-take modal ──────────────────────────────────────────────
  const [pendingTakeMed, setPendingTakeMed] = useState<{ med: Medication; index: number } | null>(null);

  // ── HELP button pulse animation ───────────────────────────────────────────
  const helpPulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(helpPulse, { toValue: 1.015, duration: 1000, useNativeDriver: true }),
        Animated.timing(helpPulse, { toValue: 1,     duration: 1000, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [helpPulse]);

  // ── Standalone / Cloud Sync ────────────────────────────────────────────────
  const [isStandalone, setIsStandalone] = useState(true);

  // Double-tap detector for the Explore floating button
  const exploreTapRef  = useRef<number>(0);
  const exploreTapTime = useRef<number>(0);

  useEffect(() => { languageRef.current = language; }, [language]);

  // Initialise web voice readiness on mount
  useEffect(() => {
    waitForVoices().then(() => { voicesReady.current = true; });
  }, []);

  useEffect(() => () => {
    Object.values(timers.current).forEach(clearTimeout);
    Object.values(overdueTimers.current).forEach(clearInterval);
    voiceTimersRef.current.forEach(clearTimeout);
    void Speech.stop();
  }, []);

  // ── TTS helper (offline — expo-speech only, pitch 0.95 for intelligibility) ─
  const speak = useCallback((text: string, promptLanguage = languageRef.current) => {
    AccessibilityInfo.announceForAccessibility(text);
    const go = () => Speech.speak(text, {
      language: promptLanguage.code,
      rate:     Math.min(ACCESSIBLE_RATE, speechRate),
      pitch:    0.95,
      volume:   soundLevel / 100,
    });
    if (Platform.OS === 'web' && !voicesReady.current) {
      waitForVoices().then(() => { voicesReady.current = true; void Speech.stop().then(go, go); });
    } else {
      void Speech.stop().then(go, go);
    }
  }, [speechRate, soundLevel]);

  const showReminder = (title: string, message: string, promptLanguage = languageRef.current) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    speak(message, promptLanguage);
    Alert.alert(title, message);
  };

  // ── Voice recognition (name setup) ───────────────────────────────────────
  const nameSetupStepRef = useRef(nameSetupStep);
  useEffect(() => { nameSetupStepRef.current = nameSetupStep; }, [nameSetupStep]);

  const {
    isListening:    nameIsListening,
    startListening: nameStartListening,
    stopListening:  nameStopListening,
    supported:      micSupported,
  } = useVoiceRecognition({
    languageCode: language.code,
    onResult: (text, isFinal) => {
      if (!isFinal) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      nameStopListening();
      const step = nameSetupStepRef.current;

      // Spell steps: accumulate letters from the transcript
      if (step === 'spell-first' || step === 'spell-last') {
        // Convert spoken letters "H E L P" → "HELP", or accept plain word
        const letters = trimmed.toUpperCase().replace(/\s+/g, '');
        const word = letters.length > 0 ? letters : trimmed;
        if (step === 'spell-first') {
          setSpellBuffer(word);
          setNameSetupStep('spell-first-confirm');
          speak(getUiCopy(languageLabel).nameSpelledFirst(word));
        } else {
          setSpellBuffer(word);
          setNameSetupStep('spell-last-confirm');
          speak(getUiCopy(languageLabel).nameSpelledLast(word));
        }
        return;
      }

      // Regular name capture
      setHeardName(trimmed);
      setNameSetupPhrase(trimmed);
      if (step === 'attempt1') {
        setNameSetupStep('attempt1-confirm');
      } else {
        setNameSetupStep('confirm');
      }
      speak(`${getUiCopy(languageLabel).iHeard(trimmed)}. ${getUiCopy(languageLabel).tapToConfirm}`);
    },
  });

  // ── Chime helpers for voice trigger feedback ──────────────────────────────
  const playAscendingChime = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 140);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),  280);
  }, []);

  const playLowDoubleTone = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 220);
  }, []);

  // ── Voice trigger mic (step1 + step2 cancel detection) ───────────────────
  const voiceStepRef   = useRef(voiceStep);
  useEffect(() => { voiceStepRef.current = voiceStep; }, [voiceStep]);
  const voicePhraseRef = useRef(voicePhrase);
  useEffect(() => { voicePhraseRef.current = voicePhrase; }, [voicePhrase]);

  const {
    isListening:    triggerIsListening,
    startListening: triggerStartListening,
    stopListening:  triggerStopListening,
  } = useVoiceRecognition({
    languageCode: language.code,
    onResult: (text, isFinal) => {
      if (!isFinal) return;
      triggerStopListening();
      const step = voiceStepRef.current;
      const trimmed = text.trim();

      // Step 2: microphone stays open — detect cancel words
      if (step === 'step2-countdown') {
        const lower = trimmed.toLowerCase();
        if (/\b(cancel|stop|no)\b/.test(lower)) {
          cancelVoiceFlow();
        }
        return;
      }

      if (step !== 'step1-listen') return;
      if (trimmed) {
        speak(`I heard: ${trimmed}`);
        const lower   = trimmed.toLowerCase();
        const phrase  = voicePhraseRef.current.toLowerCase();
        const isRecog = lower.includes(phrase) || phrase.split(' ').some(w => lower.includes(w));
        if (isRecog) { playAscendingChime(); } else { playLowDoubleTone(); }
        const t = setTimeout(() => startVoiceStep2(), 1200);
        voiceTimersRef.current = [...voiceTimersRef.current, t];
      }
    },
  });

  // ── Language helpers ───────────────────────────────────────────────────────
  const selectLanguage = (label: LanguageLabel) => {
    const next     = getLanguage(label);
    const nextCopy = getUiCopy(label);
    setLanguageLabel(label);
    Haptics.selectionAsync();
    const go = () => {
      speak(next.languageChangedPrompt, next);
      setTimeout(() => {
        setNameSetupStep('speaking');
        speak(nextCopy.namePromptSpeak, next);
        setTimeout(() => setNameSetupStep('input'), 4000);
      }, 2000);
    };
    if (Platform.OS === 'web' && !voicesReady.current) {
      waitForVoices().then(() => { voicesReady.current = true; go(); });
    } else {
      go();
    }
  };

  // ── Name verification handlers ────────────────────────────────────────────
  const confirmNameSetup = () => {
    const trimmed = nameSetupPhrase.trim() || heardName.trim();
    if (trimmed) setPatientName(trimmed);
    setHeardName('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 150);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),  300);
    speak(`Thank you. I will remember your name.`);
    setTimeout(() => setNameSetupStep('idle'), 2000);
  };

  const rejectNameSetup = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 150);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),  300);
    const attempt = nameAttempt + 1;
    setNameAttempt(attempt);
    setNameSetupPhrase('');
    setHeardName('');
    if (attempt >= 2) {
      // Second rejection → spelling flow
      setNameSetupStep('spell-first');
      speak(copy.spellFirstName);
      // Auto-start mic after TTS
      const t = setTimeout(() => nameStartListening(), 1500);
      voiceTimersRef.current = [...voiceTimersRef.current, t];
    } else {
      // First rejection → attempt1
      setNameSetupStep('attempt1');
      speak('Bring your phone close and say your name slowly.');
      const t = setTimeout(() => nameStartListening(), 1500);
      voiceTimersRef.current = [...voiceTimersRef.current, t];
    }
  };

  const confirmSpelledFirst = () => {
    setConfirmedFirst(spellBuffer);
    setSpellBuffer('');
    setNameSetupStep('spell-last');
    speak(copy.spellLastName);
    const t = setTimeout(() => nameStartListening(), 1500);
    voiceTimersRef.current = [...voiceTimersRef.current, t];
  };

  const rejectSpelledFirst = () => {
    setSpellBuffer('');
    setNameSetupStep('spell-first');
    speak(copy.spellFirstName);
    const t = setTimeout(() => nameStartListening(), 1500);
    voiceTimersRef.current = [...voiceTimersRef.current, t];
  };

  const confirmSpelledLast = () => {
    const fullName = `${confirmedFirst} ${spellBuffer}`.trim();
    setPatientName(fullName);
    setNameSetupPhrase(fullName);
    setSpellBuffer('');
    setConfirmedFirst('');
    speak(`Thank you. Your name is ${fullName}.`);
    setTimeout(() => setNameSetupStep('idle'), 2000);
  };

  const rejectSpelledLast = () => {
    setSpellBuffer('');
    setNameSetupStep('spell-last');
    speak(copy.spellLastName);
    const t = setTimeout(() => nameStartListening(), 1500);
    voiceTimersRef.current = [...voiceTimersRef.current, t];
  };

  // ── On-mount name verification (every launch) ─────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      setNameSetupStep('verify');
      speak(copy.nameIsCorrect(patientName));
    }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Medication helpers ─────────────────────────────────────────────────────
  const confirmAndToggleMedication = (index: number) => {
    const medication = medications[index];
    if (!medication.taken && !medication.locked) {
      setPendingTakeMed({ med: medication, index });
      speak(`${medication.intervalEmoji} ${medication.interval} medication: ${medication.name}. Please confirm you are taking this dose now.`);
    }
  };

  const commitTakeMedication = () => {
    if (!pendingTakeMed) return;
    const { index } = pendingTakeMed;
    const medication = medications[index];
    setMedications(current =>
      current.map((item, i) => i === index ? { ...item, taken: true, locked: false } : item),
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 140);
    speak(language.medicationTakenPrompt(medication.name, true));
    // Clear overdue alarm for this med (key = name__time)
    const key = `${medication.name}__${medication.time}`;
    if (overdueTimers.current[key]) {
      clearInterval(overdueTimers.current[key]);
      delete overdueTimers.current[key];
    }
    setPendingTakeMed(null);
  };

  // ── Overdue alarm engine (max 6 alerts = 1 hour, then lockout) ───────────
  const startOverdueAlarm = (med: Medication) => {
    const key = `${med.name}__${med.time}`;
    if (overdueTimers.current[key]) return;
    overdueStartTime.current[key] = Date.now();
    let alertCount = 0;
    const tick = () => {
      if (med.taken || med.locked) {
        clearInterval(overdueTimers.current[key]);
        delete overdueTimers.current[key];
        return;
      }
      // 1-hour / 6-alert lockout (Condition 2: missed after all 6 alerts)
      if (alertCount >= 6) {
        clearInterval(overdueTimers.current[key]);
        delete overdueTimers.current[key];
        // Gray out — locked flag, NOT taken ✓
        setMedications(current =>
          current.map(item =>
            item.name === med.name && item.time === med.time
              ? { ...item, locked: true }
              : item,
          ),
        );
        speak(`Reminder for ${med.name} at ${med.time} has expired. Dose cannot be taken now.`);
        setOverdueAlarm(null);
        return;
      }
      // Pause while emergency flow is open
      if (showEmergency) return;
      alertCount += 1;
      setOverdueAlarm(med);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      speak(`Missed dose alert: ${med.name} was due at ${med.time}. Please take it now or cancel this reminder.`);
    };
    tick();
    overdueTimers.current[key] = setInterval(tick, 10 * 60 * 1000);
  };

  // Check for overdue doses on mount and every minute
  useEffect(() => {
    const check = () => {
      medications.forEach(med => {
        if (isMissedDose(med)) startOverdueAlarm(med);
      });
    };
    check();
    const iv = setInterval(check, 60 * 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medications, showEmergency]);

  // ── Midnight reset ─────────────────────────────────────────────────────────
  useEffect(() => {
    const now      = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();
    const t = setTimeout(() => {
      setMedications(initialMedications.map(m => ({ ...m, taken: false, locked: false })));
      setMedicationReminders({});
    }, msUntilMidnight);
    return () => clearTimeout(t);
  }, []);

  const scheduleDailyMedicationReminder = (medication: Medication) => {
    if (medicationReminders[medication.name]) {
      clearTimeout(timers.current[medication.name]);
      setMedicationReminders(c => ({ ...c, [medication.name]: false }));
      speak(language.medicationReminderCancelled(medication.name));
      return;
    }
    const firstReminder = new Date();
    firstReminder.setHours(medication.hour, medication.minute, 0, 0);
    if (firstReminder <= new Date()) firstReminder.setDate(firstReminder.getDate() + 1);
    const scheduleNext = (at: Date) => {
      timers.current[medication.name] = setTimeout(() => {
        const al = languageRef.current;
        showReminder(al.medicationReminderTitle, al.medicationReminderBody(medication.name, medication.time), al);
        const next = new Date(at);
        next.setDate(next.getDate() + 1);
        scheduleNext(next);
      }, Math.max(1000, at.getTime() - Date.now()));
    };
    scheduleNext(firstReminder);
    setMedicationReminders(c => ({ ...c, [medication.name]: true }));
    Haptics.selectionAsync();
    speak(language.medicationReminderSet(medication.name, medication.time));
  };

  // ── Appointment helpers ────────────────────────────────────────────────────
  const dateOptions: Intl.DateTimeFormatOptions = {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  };

  const toggleAppointmentReminder = () => {
    if (appointmentReminderActive) {
      clearTimeout(timers.current.appointment);
      setAppointmentReminderActive(false);
      speak(language.appointmentReminderCancelled);
      return;
    }
    const apptDateTime = `${appointmentAt.toLocaleDateString(language.code, dateOptions)} ${patient.appointmentTime}`;
    const reminderAt   = new Date(appointmentAt.getTime() - 60 * 60 * 1000);
    timers.current.appointment = setTimeout(() => {
      const al      = languageRef.current;
      const apptStr = `${appointmentAt.toLocaleDateString(al.code, dateOptions)} ${patient.appointmentTime}`;
      showReminder(al.appointmentReminderTitle, al.appointmentReminderBody(patient.doctor, apptStr), al);
      setAppointmentReminderActive(false);
    }, Math.max(1000, reminderAt.getTime() - Date.now()));
    setAppointmentReminderActive(true);
    Haptics.selectionAsync();
    speak(language.appointmentReminderSet(apptDateTime));
  };

  const moveAppointmentOneDay = () => {
    if (appointmentReminderActive) {
      clearTimeout(timers.current.appointment);
      setAppointmentReminderActive(false);
    }
    setAppointmentAt(current => {
      const next = new Date(current);
      next.setDate(next.getDate() + 1);
      return next;
    });
    speak(copy.appointmentDateChanged);
  };

  const isHighContrast = contrastMode === 'high';
  const takenCount     = medications.filter(m => m.taken).length;

  const speakDashboard = () =>
    speak(`${copy.welcomeBack}, ${patientName}. ${copy.medsComplete(takenCount, medications.length)}.`);

  // ── Read-All helper (ST-5) ────────────────────────────────────────────────
  const buildReadAllText = () => {
    const apptDate = appointmentAt.toLocaleDateString(language.code, dateOptions);
    const medLines = medications.map(m =>
      `${m.name}, due at ${m.time}, ${m.taken ? 'taken' : m.locked ? 'missed' : 'not yet taken'}`,
    ).join('. ');
    return [
      `${copy.welcomeBack}, ${patientName}.`,
      `${copy.medsComplete(takenCount, medications.length)}.`,
      `Medications: ${medLines}.`,
      `Next appointment with ${patient.doctor} on ${apptDate} at ${patient.appointmentTime}.`,
      `Emergency Voice Triggers section: tap Help, My chest hurts, or I can't breathe to activate emergency flow.`,
    ].join(' ');
  };

  const handleReadAll = () => {
    if (isReadingAll) {
      void Speech.stop();
      setIsReadingAll(false);
      return;
    }
    setIsReadingAll(true);
    const text = buildReadAllText();
    AccessibilityInfo.announceForAccessibility(text);
    Speech.speak(text, {
      language: language.code,
      rate:     Math.min(ACCESSIBLE_RATE, speechRate),
      pitch:    0.95,
      volume:   soundLevel / 100,
      onDone:   () => setIsReadingAll(false),
      onStopped:() => setIsReadingAll(false),
      onError:  () => setIsReadingAll(false),
    });
  };

  // ── Trigger emergency flow with optional phrase ────────────────────────────
  const triggerEmergency = (phrase?: string) => {
    setEmergencyPhrase(phrase);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setShowEmergency(true);
  };

  // ── cancelVoiceFlow — stop all timers, TTS, mic ────────────────────────────
  const cancelVoiceFlow = () => {
    voiceTimersRef.current.forEach(clearTimeout);
    voiceTimersRef.current = [];
    triggerStopListening();
    void Speech.stop();
    setVoiceStep('idle');
    setVoiceCountdown(5);
    setVoicePauseLeft(30);
  };

  // ── startVoiceStep2 — 5-second SILENT clear-the-air countdown then step 3 ─
  const startVoiceStep2 = () => {
    // Keep mic open during countdown so user can say "Cancel"
    setVoiceStep('step2-countdown');
    setVoiceCountdown(5);

    // Count down 5 → 0 with haptic every second (no TTS — silent countdown)
    const ticks = [1, 2, 3, 4, 5].map(offset =>
      setTimeout(() => {
        setVoiceCountdown(v => Math.max(0, v - 1));
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }, offset * 1000),
    );

    // After 5 s: speak "Help coming." then transition to step3
    const t = setTimeout(() => {
      ticks.forEach(clearTimeout);
      // "Help coming." — no "is" or "on its way"
      speak(copy.helpIsOnTheWay);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // Transition to Living Situation Question 800 ms after TTS fires
      const t2 = setTimeout(() => {
        setVoiceStep('step3-alone');
        speak(copy.livingQuestion);
        // Auto-start mic 1.5 s after TTS begins
        const t3 = setTimeout(() => triggerStartListening(), 1500);
        voiceTimersRef.current = [...voiceTimersRef.current, t3];
      }, 800);
      voiceTimersRef.current = [...voiceTimersRef.current, t2];
    }, 5500);

    voiceTimersRef.current = [...ticks, t];
  };

  // ── startVoiceStep4 — "Help coming" then 30-second pause ──────────────────
  const startVoiceStep4 = (isAlone: boolean) => {
    void Speech.stop();
    setVoiceStep('step4-onway');
    setVoicePauseLeft(30);

    const ticks = Array.from({ length: 30 }, (_, i) =>
      setTimeout(() => setVoicePauseLeft(v => Math.max(0, v - 1)), (i + 1) * 1000),
    );
    const t = setTimeout(() => {
      ticks.forEach(clearTimeout);
      speak(copy.helpIsOnTheWay);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, 31000);

    const aloneMsg = isAlone
      ? (languageLabel === '日本語' ? '一人であることを記録しました。'
        : languageLabel === 'Español' ? 'Entendido. Estás solo.'
        : 'Understood. You are alone. Help is on the way.')
      : (languageLabel === '日本語' ? '近くにいる方に付き添いをお願いしてください。'
        : languageLabel === 'Español' ? 'Entendido. Quédate con alguien.'
        : 'Understood. Please stay with someone nearby.');
    speak(aloneMsg);

    voiceTimersRef.current = [...ticks, t];
  };

  // ── triggerVoicePanel — tap trigger box → immediate instruction + auto-mic ─
  const triggerVoicePanel = (phrase: string) => {
    cancelVoiceFlow();
    setVoicePhrase(phrase);
    setVoiceStep('step1-listen');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    // Immediately speak: "Bring your mouth closer to the microphone and speak the text indicated in the box."
    speak(copy.triggerInstruction);
    // Auto-start mic 1.5 s after spoken instruction begins (so TTS is not self-captured)
    const t = setTimeout(() => triggerStartListening(), 1500);
    voiceTimersRef.current = [t];
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <SafeAreaView style={[styles.safe, isHighContrast && styles.safeHighContrast]}>

        {/* ── Header zone: sticky bar + settings dropdown ── */}
        <View style={styles.headerZone}>

          {/* ── Persistent dual mode toggles + speaker/read-all — always visible ── */}
          <View style={styles.modeToggleRow}>

            {/* STAND-ALONE MODE button */}
            <TouchableOpacity
              style={[styles.modeBtn, isStandalone && styles.modeBtnStandaloneActive]}
              onPress={() => {
                setIsStandalone(true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                speak('Stand-Alone Mode activated. All features running directly from your device. No internet connection required.');
              }}
              accessibilityRole="button"
              accessibilityLabel="Stand-Alone Mode. Tap to run fully offline."
              accessibilityState={{ selected: isStandalone }}
            >
              <Text style={styles.modeBtnIcon}>📴</Text>
              <Text style={[styles.modeBtnLabel, { fontSize: 12 * fontScale }]}>
                STAND-ALONE{'\n'}MODE
              </Text>
              {isStandalone && <Text style={styles.modeBtnBadge}>● ACTIVE</Text>}
            </TouchableOpacity>

            {/* CLOUD SYNC button */}
            <TouchableOpacity
              style={[styles.modeBtn, !isStandalone && styles.modeBtnCloudActive]}
              onPress={() => {
                setIsStandalone(false);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                speak('Cloud Sync activated. Connected mode is now enabled.');
              }}
              accessibilityRole="button"
              accessibilityLabel="Cloud Sync. Tap to enable connected mode."
              accessibilityState={{ selected: !isStandalone }}
            >
              <Text style={styles.modeBtnIcon}>☁️</Text>
              <Text style={[styles.modeBtnLabel, { fontSize: 12 * fontScale }]}>
                CLOUD{'\n'}SYNC
              </Text>
              {!isStandalone && <Text style={styles.modeBtnBadge}>● ACTIVE</Text>}
            </TouchableOpacity>

            {/* ── ST-5: Speaker Switch ── */}
            <View style={styles.speakerSwitchBox}>
              <Text style={[styles.speakerSwitchLabel, { fontSize: 10 * fontScale }]}>
                🔊 {speakerEnabled ? 'ON' : 'OFF'}
              </Text>
              <Switch
                value={speakerEnabled}
                onValueChange={on => {
                  setSpeakerEnabled(on);
                  if (on) {
                    speak(copy.speakerOn);
                    setTimeout(() => speak(`${copy.welcomeBack}, ${patientName}. ${copy.medsComplete(takenCount, medications.length)}.`), 1200);
                  } else {
                    void Speech.stop();
                  }
                }}
                trackColor={{ false: '#374151', true: '#15803d' }}
                thumbColor={speakerEnabled ? '#4ade80' : '#94a3b8'}
                accessibilityRole="switch"
                accessibilityLabel={speakerEnabled ? copy.speakerOn : copy.speakerOff}
              />
            </View>

            {/* ── ST-5: Read Everything button ── */}
            <TouchableOpacity
              style={[styles.readAllBtn, isReadingAll && styles.readAllBtnActive]}
              onPress={handleReadAll}
              accessibilityRole="button"
              accessibilityLabel={isReadingAll ? copy.stopReading : copy.readAll}
            >
              <Text style={[styles.readAllBtnText, { fontSize: 10 * fontScale }]}>
                {isReadingAll ? copy.stopReading : copy.readAll}
              </Text>
            </TouchableOpacity>

            {/* Language & Accessibility gear button */}
            <TouchableOpacity
              activeOpacity={0.7}
              style={[styles.gearButton, showAccessibility && styles.gearButtonActive]}
              onPress={() => setShowAccessibility(v => !v)}
              accessibilityRole="button"
              accessibilityLabel="Language and Accessibility settings"
              accessibilityState={{ expanded: showAccessibility }}
            >
              <Text style={styles.gearIcon}>
                {showAccessibility ? '\u2715' : '\u267F'}
              </Text>
              {!showAccessibility && (
                <Text style={styles.gearLabel}>Language{'\n'}& Access</Text>
              )}
            </TouchableOpacity>

          </View>

          {/* ── Settings panel — dropdown anchored below the sticky bar ── */}
          {showAccessibility && (
            <View style={styles.settingsPanel}>

              {/* Panel header row with close button */}
              <View style={styles.panelHeader}>
                <Text style={[styles.settingsSectionLabel, { fontSize: 13 * fontScale }]}>LANGUAGE & ACCESSIBILITY</Text>
                <TouchableOpacity
                  style={styles.panelCloseButton}
                  onPress={() => setShowAccessibility(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Close settings panel"
                >
                  <Text style={styles.panelCloseText}>{'\u2715'} Close</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.settingsDivider} />

              {/* Language */}
              <Text style={[styles.settingsSectionLabel, { fontSize: 11 * fontScale }]}>LANGUAGE</Text>
              <View style={styles.langPicker}>
                {languages.map(option => (
                  <TouchableOpacity
                    key={option.label}
                    style={[styles.langChip, languageLabel === option.label && styles.langChipSelected]}
                    onPress={() => selectLanguage(option.label)}
                    accessibilityRole="button"
                    accessibilityLabel={copy.currentLanguage(option.label)}
                    accessibilityState={{ selected: languageLabel === option.label }}
                  >
                    <Text style={[styles.langChipText, languageLabel === option.label && styles.langChipTextSelected, { fontSize: 13 * fontScale }]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* ── Guided name setup (appears after language tap or on initial verify) ── */}
              {nameSetupStep !== 'idle' && (
                <View style={styles.nameSetupBox}>
                  {/* Prompt text changes per step */}
                  <Text style={[styles.nameSetupPrompt, { fontSize: 13 * fontScale }]}>
                    {nameSetupStep === 'verify'
                      ? copy.nameIsCorrect(patientName)
                      : nameSetupStep === 'attempt1' || nameSetupStep === 'attempt1-confirm'
                        ? copy.namePromptSpeak
                        : nameSetupStep === 'spell-first' || nameSetupStep === 'spell-first-confirm'
                          ? copy.spellFirstName
                          : nameSetupStep === 'spell-last' || nameSetupStep === 'spell-last-confirm'
                            ? copy.spellLastName
                            : copy.namePromptSpeak}
                  </Text>

                  {/* ✏ pencil button — available at every step */}
                  <TouchableOpacity
                    style={styles.editNameBtn}
                    onPress={() => { setNameSetupStep('input'); setNameSetupPhrase(patientName); }}
                    accessibilityRole="button"
                    accessibilityLabel={copy.editName}
                  >
                    <Text style={[styles.editNameBtnText, { fontSize: 13 * fontScale }]}>{copy.editName}</Text>
                  </TouchableOpacity>

                  {/* 🎤 Mic button — shown during listening steps */}
                  {micSupported && (
                    nameSetupStep === 'speaking' ||
                    nameSetupStep === 'input' ||
                    nameSetupStep === 'attempt1' ||
                    nameSetupStep === 'spell-first' ||
                    nameSetupStep === 'spell-last'
                  ) && (
                    <TouchableOpacity
                      style={[styles.micBtn, nameIsListening && styles.micBtnActive]}
                      onPress={() => nameIsListening ? nameStopListening() : nameStartListening()}
                      accessibilityRole="button"
                      accessibilityLabel={nameIsListening ? 'Stop microphone' : 'Start microphone to speak name'}
                    >
                      <Text style={{ fontSize: 22 }}>🎤</Text>
                      <Text style={[styles.micBtnLabel, { fontSize: 12 * fontScale }]}>
                        {nameIsListening ? copy.listeningIndicator : '🎤 Tap to speak'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Heard name display */}
                  {heardName !== '' && (
                    <View style={styles.heardNameRow}>
                      <Text style={[styles.heardNameText, { fontSize: 13 * fontScale }]}>
                        {copy.iHeard(heardName)}
                      </Text>
                      <TouchableOpacity
                        style={styles.speakerIconBtn}
                        onPress={() => speak(copy.iHeard(heardName))}
                        accessibilityRole="button"
                        accessibilityLabel="Read heard name aloud"
                      >
                        <Text>{copy.replayName}</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Spelled buffer display */}
                  {spellBuffer !== '' && (
                    <Text style={[styles.heardNameText, { fontSize: 13 * fontScale }]}>
                      {copy.iHeard(spellBuffer)}
                    </Text>
                  )}

                  {/* MicTextInput — for input / confirm steps */}
                  {(nameSetupStep === 'input' || nameSetupStep === 'confirm') && (
                    <MicTextInput
                      value={nameSetupPhrase}
                      onChangeText={setNameSetupPhrase}
                      onMicPress={() => nameIsListening ? nameStopListening() : nameStartListening()}
                      isListening={nameIsListening}
                      placeholder="Your name…"
                      accessibilityLabel="Type your name"
                      inputStyle={{ fontSize: 15 * fontScale }}
                    />
                  )}

                  {/* YES/NO confirmation buttons */}
                  {(nameSetupStep === 'verify' ||
                    nameSetupStep === 'input' ||
                    nameSetupStep === 'confirm' ||
                    nameSetupStep === 'attempt1-confirm') && (
                    <View style={styles.nameConfirmRow}>
                      <TouchableOpacity
                        style={styles.nameYesBtn}
                        onPress={confirmNameSetup}
                        accessibilityRole="button"
                        accessibilityLabel="Confirm name — yes"
                      >
                        <Text style={[styles.actionText, { fontSize: 14 * fontScale }]}>✓ YES</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.nameNoBtn}
                        onPress={rejectNameSetup}
                        accessibilityRole="button"
                        accessibilityLabel="Try name again — no"
                      >
                        <Text style={[styles.actionText, { fontSize: 14 * fontScale }]}>✗ NO</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Spelled first-name confirmation */}
                  {nameSetupStep === 'spell-first-confirm' && (
                    <View style={styles.nameConfirmRow}>
                      <TouchableOpacity style={styles.nameYesBtn} onPress={confirmSpelledFirst} accessibilityRole="button">
                        <Text style={[styles.actionText, { fontSize: 14 * fontScale }]}>✓ YES</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.nameNoBtn} onPress={rejectSpelledFirst} accessibilityRole="button">
                        <Text style={[styles.actionText, { fontSize: 14 * fontScale }]}>✗ NO</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Spelled last-name confirmation */}
                  {nameSetupStep === 'spell-last-confirm' && (
                    <View style={styles.nameConfirmRow}>
                      <TouchableOpacity style={styles.nameYesBtn} onPress={confirmSpelledLast} accessibilityRole="button">
                        <Text style={[styles.actionText, { fontSize: 14 * fontScale }]}>✓ YES</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.nameNoBtn} onPress={rejectSpelledLast} accessibilityRole="button">
                        <Text style={[styles.actionText, { fontSize: 14 * fontScale }]}>✗ NO</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {nameSetupStep === 'speaking' && !nameIsListening && (
                    <Text style={[styles.bodyText, { fontSize: 12 * fontScale }]}>
                      {copy.tapToConfirm}
                    </Text>
                  )}
                </View>
              )}

              <View style={styles.settingsDivider} />

              {/* Accessibility controls */}
              <Text style={[styles.settingsSectionLabel, { fontSize: 11 * fontScale }]}>ACCESSIBILITY</Text>
              <Text style={[styles.bodyText, { fontSize: 13 * fontScale }]}>{copy.foregroundReminderNote}</Text>

              {/* High Contrast toggle */}
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.secondaryButton, isHighContrast && styles.contrastActive]}
                  onPress={() => {
                    setContrastMode(v => v === 'high' ? 'standard' : 'high');
                    Haptics.selectionAsync();
                    speak(isHighContrast ? 'Standard contrast.' : 'High contrast enabled.');
                  }}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: isHighContrast }}
                  accessibilityLabel={`High contrast ${isHighContrast ? 'on' : 'off'}`}
                >
                  <Text style={[styles.actionText, { fontSize: 13 * fontScale }]}>
                    {copy.highContrast} {isHighContrast ? '✓' : '✗'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => setFontScale(v => v >= 2.0 ? 1.0 : v + 0.25)}
                  accessibilityRole="button"
                  accessibilityLabel={`Text size ${Math.round(fontScale * 100)} percent. Tap to increase.`}
                >
                  <Text style={[styles.actionText, { fontSize: 13 * fontScale }]}>{copy.fontSize(Math.round(fontScale * 100))}</Text>
                </TouchableOpacity>
              </View>

              {/* Volume stepper */}
              <View style={styles.stepperRow}>
                <Text style={[styles.stepperLabel, { fontSize: 13 * fontScale }]}>🔊 Volume: {soundLevel}%</Text>
                <View style={styles.stepperBtns}>
                  <TouchableOpacity style={styles.stepperBtn} onPress={() => setSoundLevel(v => Math.max(0, v - 10))} accessibilityRole="button" accessibilityLabel="Decrease volume">
                    <Text style={[styles.actionText, { fontSize: 16 * fontScale }]}>−</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.stepperBtn} onPress={() => setSoundLevel(v => Math.min(100, v + 10))} accessibilityRole="button" accessibilityLabel="Increase volume">
                    <Text style={[styles.actionText, { fontSize: 16 * fontScale }]}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Speech speed stepper */}
              <View style={styles.stepperRow}>
                <Text style={[styles.stepperLabel, { fontSize: 13 * fontScale }]}>Speech: {speechRate.toFixed(2)}×</Text>
                <View style={styles.stepperBtns}>
                  <TouchableOpacity style={styles.stepperBtn} onPress={() => setSpeechRate(v => Math.max(0.4, +(v - 0.05).toFixed(2)))} accessibilityRole="button" accessibilityLabel="Decrease speech speed">
                    <Text style={[styles.actionText, { fontSize: 16 * fontScale }]}>−</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.stepperBtn} onPress={() => setSpeechRate(v => Math.min(1.0, +(v + 0.05).toFixed(2)))} accessibilityRole="button" accessibilityLabel="Increase speech speed">
                    <Text style={[styles.actionText, { fontSize: 16 * fontScale }]}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

            </View>
          )}

        </View>{/* end headerZone */}

        {/* ── Scrollable content below the sticky toggle ── */}
        <ScrollView contentContainerStyle={styles.scroll}>

          {/* ── Combined patient overview + appointment card ─────────────── */}
          <View style={[styles.header, isHighContrast && styles.cardHighContrast]}>
            <View style={styles.appNameRow}>
              <Text style={[styles.appName, { fontSize: 14 * fontScale }]}>DischargeBuddy AI Assist</Text>
              <TouchableOpacity
                style={styles.speakerIconBtn}
                onPress={speakDashboard}
                accessibilityRole="button"
                accessibilityLabel="Read dashboard aloud"
              >
                <Text style={{ fontSize: 18 }}>🔊</Text>
              </TouchableOpacity>
            </View>

            {/* Two-column row: patient info left, appointment right */}
            <View style={styles.headerColumns}>

              {/* Left column — patient / meds */}
              <View style={styles.headerLeft}>
                {/* Editable patient name */}
                {editingName ? (
                  <View style={styles.nameEditRow}>
                    <MicTextInput
                      value={draftName}
                      onChangeText={setDraftName}
                      onMicPress={() => nameIsListening ? nameStopListening() : nameStartListening()}
                      isListening={nameIsListening}
                      accessibilityLabel="Edit patient name"
                      autoFocus
                      inputStyle={{ fontSize: 20 * fontScale, color: '#f1f5f9' }}
                    />
                    <TouchableOpacity
                      style={styles.nameEditSave}
                      onPress={() => { setPatientName(draftName.trim() || patientName); setEditingName(false); }}
                      accessibilityRole="button"
                    >
                      <Text style={{ color: '#4ade80', fontWeight: '700' }}>✓</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.nameRow}
                    onPress={() => { setDraftName(patientName); setEditingName(true); }}
                    accessibilityRole="button"
                    accessibilityLabel={`${copy.welcomeBack}, ${patientName}. Tap to edit name.`}
                  >
                    <Text style={[styles.greeting, { fontSize: 26 * fontScale }]}>{copy.welcomeBack}, {patientName}</Text>
                    <Text style={styles.editPencil}>✏️</Text>
                  </TouchableOpacity>
                )}

                {/* ── ST-2: Name verification prompt shown below the name ── */}
                {(nameSetupStep === 'verify') && !showAccessibility && (
                  <View style={styles.nameVerifyInline}>
                    <Text style={[styles.nameVerifyText, { fontSize: 13 * fontScale }]}>
                      {copy.nameIsCorrect(patientName)}
                    </Text>
                    <View style={styles.nameConfirmRow}>
                      <TouchableOpacity
                        style={styles.nameYesBtn}
                        onPress={confirmNameSetup}
                        accessibilityRole="button"
                        accessibilityLabel="Yes — name is correct"
                      >
                        <Text style={[styles.actionText, { fontSize: 13 * fontScale }]}>✓ YES</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.nameNoBtn}
                        onPress={rejectNameSetup}
                        accessibilityRole="button"
                        accessibilityLabel="No — name is incorrect"
                      >
                        <Text style={[styles.actionText, { fontSize: 13 * fontScale }]}>✗ NO</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.editNameBtn}
                        onPress={() => { setDraftName(patientName); setEditingName(true); setNameSetupStep('idle'); }}
                        accessibilityRole="button"
                        accessibilityLabel={copy.editName}
                      >
                        <Text style={[styles.editNameBtnText, { fontSize: 12 * fontScale }]}>{copy.editName}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                <Text style={[styles.bodyText, { fontSize: 15 * fontScale }]}>{copy.condition}</Text>
                <Text style={[styles.bodyText, styles.summary, { fontSize: 14 * fontScale }]}>
                  {copy.medsComplete(takenCount, medications.length)}
                </Text>
                {/* Medication progress bar */}
                <View style={styles.progressTrack} accessibilityElementsHidden>
                  <View style={[styles.progressFill, { width: `${(takenCount / medications.length) * 100}%` }]} />
                </View>
                <Text style={[styles.offlineText, { fontSize: 11 * fontScale }]}>{copy.offlineSample}</Text>
              </View>

              {/* Vertical divider */}
              <View style={styles.headerDivider} />

              {/* Right column — appointment */}
              <View style={styles.headerRight}>
                <Text style={[styles.apptLabel, { fontSize: 11 * fontScale }]}>{copy.nextAppointment}</Text>
                <Text style={[styles.medicationName, { fontSize: 15 * fontScale }]}>{copy.doctor}</Text>
                <Text style={[styles.bodyText, { fontSize: 13 * fontScale }]}>
                  {appointmentAt.toLocaleDateString(language.code, dateOptions)}
                </Text>
                <Text style={[styles.bodyText, { fontSize: 13 * fontScale }]}>{patient.appointmentTime}</Text>
                <Text style={[styles.bodyText, { fontSize: 12 * fontScale }]}>{copy.appointmentLocation}</Text>
                <View style={styles.apptActions}>
                  <View style={styles.apptBtnRow}>
                    <TouchableOpacity
                      style={[styles.apptButton, styles.apptButtonRemind]}
                      onPress={toggleAppointmentReminder}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.apptButtonText, { fontSize: 12 * fontScale }]}>
                        {appointmentReminderActive ? copy.cancelReminder : copy.remindMe}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.speakerIconBtn}
                      onPress={() => speak(appointmentReminderActive ? copy.cancelReminder : copy.remindMe)}
                      accessibilityRole="button"
                      accessibilityLabel="Read Remind Me aloud"
                    >
                      <Text>🔊</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.apptBtnRow}>
                    <TouchableOpacity
                      style={[styles.apptButton, styles.apptButtonMove]}
                      onPress={moveAppointmentOneDay}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.apptButtonText, { fontSize: 12 * fontScale }]}>{copy.moveOneDay}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.speakerIconBtn}
                      onPress={() => speak(copy.moveOneDay)}
                      accessibilityRole="button"
                      accessibilityLabel="Read Move +1 Day aloud"
                    >
                      <Text>🔊</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

            </View>
          </View>

          {/* Today's medications */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { fontSize: 22 * fontScale }]}>{copy.medications}</Text>
            {medications.map((medication, index) => {
              const isDisabled = medication.taken || !!medication.locked;
              return (
                <View
                  key={`${medication.name}-${medication.time}`}
                  style={[styles.medicationRow, isDisabled && styles.medicationRowTaken]}
                  // ST-7 accessibility: announce missed/locked doses to screen readers
                  accessibilityLiveRegion="polite"
                >
                  {/* Interval badge */}
                  <View style={[styles.intervalBadge, { backgroundColor: medication.intervalColor + '22', borderColor: medication.intervalColor }]}>
                    <Text style={[styles.intervalBadgeText, { color: medication.intervalColor, fontSize: 12 * fontScale }]}>
                      {medication.intervalEmoji} {medication.interval}
                    </Text>
                  </View>
                  <View style={styles.medNameRow}>
                    <Text style={[styles.medicationName, { fontSize: 18 * fontScale }]}>{medication.name}</Text>
                    <TouchableOpacity
                      style={styles.speakerIconBtn}
                      onPress={() => speak(`${medication.intervalEmoji} ${medication.interval} medication: ${medication.name}, due at ${medication.time}.`)}
                      accessibilityRole="button"
                      accessibilityLabel={`Read ${medication.name} aloud`}
                    >
                      <Text>🔊</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={[styles.bodyText, { fontSize: 16 * fontScale }]}>{copy.dueAt(medication.time)}</Text>
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[
                        styles.takenButton,
                        medication.taken && styles.takenButtonDone,
                        medication.locked && styles.takenButtonLocked,
                      ]}
                      onPress={() => !isDisabled && confirmAndToggleMedication(index)}
                      accessibilityRole="button"
                      accessibilityLabel={`${medication.name}: ${medication.taken ? copy.takenDone : medication.locked ? 'Missed — locked' : copy.markTaken}`}
                      disabled={isDisabled}
                    >
                      <Text style={[styles.actionText, { fontSize: 16 * fontScale }]}>
                        {medication.taken
                          ? copy.takenDone
                          : medication.locked
                            ? '✗ Missed'
                            : copy.markTaken}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.reminderButton}
                      onPress={() => scheduleDailyMedicationReminder(medication)}
                      accessibilityRole="button"
                      accessibilityLabel={`${medication.name}: ${medicationReminders[medication.name] ? copy.cancelReminder : copy.remindMe}`}
                    >
                      <Text style={[styles.actionText, { fontSize: 16 * fontScale }]}>
                        {medicationReminders[medication.name] ? copy.reminderOn : copy.remindMe}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.speakerIconBtn}
                      onPress={() => speak(`${medicationReminders[medication.name] ? 'Cancel reminder for' : 'Remind me to take'} ${medication.name}`)}
                      accessibilityRole="button"
                      accessibilityLabel="Read reminder button aloud"
                    >
                      <Text>🔊</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>

          {/* HELP button */}
          <Animated.View style={{ transform: [{ scale: helpPulse }] }}>
            <View style={styles.helpButtonRow}>
              <TouchableOpacity
                style={[styles.helpButton, { flex: 1 }]}
                onPress={() => triggerEmergency(undefined)}
                accessibilityRole="button"
                accessibilityLabel={`${copy.help}. ${copy.emergencyDemo}`}
                accessibilityHint="Opens the full 7-guardrail emergency evaluation sequence. Demo only — no real calls placed."
              >
                <Text style={[styles.helpTitle,    { fontSize: 29 * fontScale }]}>{copy.help}</Text>
                <Text style={[styles.helpSubtitle, { fontSize: 16 * fontScale }]}>{copy.helpSubtitle}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.speakerIconBtnLarge}
                onPress={() => speak(`${copy.help}. ${copy.helpSubtitle}`)}
                accessibilityRole="button"
                accessibilityLabel="Read Help button label aloud"
              >
                <Text style={{ fontSize: 22 }}>🔊</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>

          {/* ── Voice trigger panel — 4-step flow ──────────────────────────────
               idle:          Three phrase buttons
               step1-listen:  Instruction shown, mic auto-active, listening badge
               step2-countdown: 5-second silent "clear the air" countdown
               step3-alone:   Living Situation Question (Yes with someone / No live alone)
               step4-onway:   30-second pause → "Help coming."
          ── */}
          <View style={styles.voiceShortcutPanel}>
            <Text style={[styles.sectionTitle, { fontSize: 14 * fontScale }]}>
              🎙 EMERGENCY VOICE TRIGGERS
            </Text>

            {/* ── idle: three trigger buttons ── */}
            {voiceStep === 'idle' && (
              <>
                <Text style={[styles.bodyText, { fontSize: 12 * fontScale }]}>
                  Tap a phrase to speak to the microphone for immediate emergency activation.
                </Text>
                <View style={styles.actionRow}>
                  {(['Help', 'My chest hurts', "I can't breathe"] as const).map(phrase => (
                    <View key={phrase} style={styles.triggerBtnWrap}>
                      <TouchableOpacity
                        style={styles.voiceTriggerBtn}
                        onPress={() => triggerVoicePanel(phrase)}
                        accessibilityRole="button"
                        accessibilityLabel={`Activate voice trigger: ${phrase}`}
                      >
                        <Text style={[styles.actionText, { fontSize: 13 * fontScale }]}>
                          {'\u201C'}{phrase}{'\u201D'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.speakerIconBtn}
                        onPress={() => speak(phrase)}
                        accessibilityRole="button"
                        accessibilityLabel={`Read "${phrase}" aloud`}
                      >
                        <Text>🔊</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* ── Step 1: Instruction shown, mic auto-listening ── */}
            {voiceStep === 'step1-listen' && (
              <View style={styles.voiceStepBox}>
                {/* Instruction text (verbatim from spec) */}
                <Text style={[styles.nameSetupPrompt, { fontSize: 14 * fontScale, marginBottom: 8 }]}>
                  {copy.triggerInstruction}
                </Text>
                {/* Phrase to say */}
                <Text style={[styles.sectionTitle, { fontSize: 18 * fontScale }]}>
                  {'\u201C'}{voicePhrase}{'\u201D'}
                </Text>
                {/* Mic status badge */}
                <View style={[styles.listeningBadge, triggerIsListening && styles.listeningBadgeActive]}>
                  <Text style={[styles.listeningBadgeText, { fontSize: 13 * fontScale }]}>
                    {triggerIsListening ? copy.listeningIndicator : '🎤 Tap to retry mic'}
                  </Text>
                </View>
                {/* Manual mic fallback */}
                <TouchableOpacity
                  style={[styles.micBtn, triggerIsListening && styles.micBtnActive]}
                  onPress={() => triggerIsListening ? triggerStopListening() : triggerStartListening()}
                  accessibilityRole="button"
                  accessibilityLabel={triggerIsListening ? 'Stop microphone' : 'Start microphone'}
                >
                  <Text style={{ fontSize: 32 }}>🎤</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.voiceCancelBtn} onPress={cancelVoiceFlow} accessibilityRole="button" accessibilityLabel={copy.cancelAmbulance}>
                  <Text style={[styles.actionText, { fontSize: 14 * fontScale }]}>✕ {copy.cancelAmbulance}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.returnHomeBtn}
                  onPress={cancelVoiceFlow}
                  accessibilityRole="button"
                  accessibilityLabel={copy.returnToMainPage}
                >
                  <Text style={[styles.actionText, { fontSize: 13 * fontScale }]}>← {copy.returnToMainPage}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step 2: 5-second silent clear-the-air countdown ── */}
            {voiceStep === 'step2-countdown' && (
              <View style={styles.voiceStepBox}>
                <Text style={[styles.sectionTitle, { fontSize: 18 * fontScale }]}>
                  {copy.dispatchCountdownTitle}
                </Text>
                <Text style={[styles.countdownBig, { fontSize: 72 * fontScale }]}>{voiceCountdown}</Text>
                <Text style={[styles.bodyText, { fontSize: 14 * fontScale }]}>
                  {copy.clearTheAirInstruction}
                </Text>
                {/* Listening badge during countdown */}
                <View style={[styles.listeningBadge, triggerIsListening && styles.listeningBadgeActive]}>
                  <Text style={[styles.listeningBadgeText, { fontSize: 12 * fontScale }]}>
                    {triggerIsListening ? copy.listeningIndicator : '🎤 Mic ready'}
                  </Text>
                </View>
                <TouchableOpacity style={styles.voiceCancelBtn} onPress={cancelVoiceFlow} accessibilityRole="button" accessibilityLabel={copy.cancelAmbulance}>
                  <Text style={[styles.actionText, { fontSize: 14 * fontScale }]}>✕ {copy.cancelAmbulance}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.returnHomeBtn}
                  onPress={cancelVoiceFlow}
                  accessibilityRole="button"
                  accessibilityLabel={copy.returnToMainPage}
                >
                  <Text style={[styles.actionText, { fontSize: 13 * fontScale }]}>← {copy.returnToMainPage}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step 3: Living Situation Question ── */}
            {voiceStep === 'step3-alone' && (
              <View style={styles.voiceStepBox}>
                <Text style={[styles.sectionTitle, { fontSize: 20 * fontScale }]}>
                  {copy.livingQuestion}
                </Text>
                {/* Mic listening badge */}
                <View style={[styles.listeningBadge, triggerIsListening && styles.listeningBadgeActive]}>
                  <Text style={[styles.listeningBadgeText, { fontSize: 12 * fontScale }]}>
                    {triggerIsListening ? copy.listeningIndicator : '🎤 Tap to speak'}
                  </Text>
                </View>
                <View style={styles.aloneRow}>
                  {/* Green: Yes, with someone */}
                  <TouchableOpacity
                    style={[styles.aloneNoBtn, styles.withSomeoneBtn]}
                    onPress={() => startVoiceStep4(false)}
                    accessibilityRole="button"
                    accessibilityLabel={copy.livingWithSomeone}
                  >
                    <Text style={[styles.actionText, { fontSize: 15 * fontScale }]}>{copy.livingWithSomeone}</Text>
                  </TouchableOpacity>
                  {/* Red: No, live alone */}
                  <TouchableOpacity
                    style={[styles.aloneYesBtn, styles.liveAloneBtn]}
                    onPress={() => startVoiceStep4(true)}
                    accessibilityRole="button"
                    accessibilityLabel={copy.livingAlone}
                  >
                    <Text style={[styles.actionText, { fontSize: 15 * fontScale }]}>{copy.livingAlone}</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.voiceCancelBtn} onPress={cancelVoiceFlow} accessibilityRole="button" accessibilityLabel={copy.cancelAmbulance}>
                  <Text style={[styles.actionText, { fontSize: 13 * fontScale }]}>✕ {copy.cancelAmbulance}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.returnHomeBtn}
                  onPress={cancelVoiceFlow}
                  accessibilityRole="button"
                  accessibilityLabel={copy.returnToMainPage}
                >
                  <Text style={[styles.actionText, { fontSize: 13 * fontScale }]}>← {copy.returnToMainPage}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step 4: Help coming — 30-second hold ── */}
            {voiceStep === 'step4-onway' && (
              <View style={styles.voiceStepBox}>
                <Text style={[styles.sectionTitle, { fontSize: 18 * fontScale }]}>
                  🚑 {copy.helpIsOnTheWay}
                </Text>
                <Text style={[styles.bodyText, { fontSize: 14 * fontScale }]}>
                  {voicePauseLeft > 0 ? copy.secondsRemaining(voicePauseLeft) : copy.helpIsOnTheWay}
                </Text>
                <TouchableOpacity style={styles.voiceCancelBtn} onPress={cancelVoiceFlow} accessibilityRole="button" accessibilityLabel={copy.cancelAmbulance}>
                  <Text style={[styles.actionText, { fontSize: 13 * fontScale }]}>✕ {copy.cancelAmbulance}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.returnHomeBtn}
                  onPress={cancelVoiceFlow}
                  accessibilityRole="button"
                  accessibilityLabel={copy.returnToMainPage}
                >
                  <Text style={[styles.actionText, { fontSize: 14 * fontScale }]}>← {copy.returnToMainPage}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

        </ScrollView>

        {/* ── Fixed bottom accessibility bar — never scrolls away ── */}
        <View style={styles.bottomAccessBar}>
          <TouchableOpacity
            style={styles.bottomAccessBtn}
            onPress={() => {
              setContrastMode(v => v === 'high' ? 'standard' : 'high');
              speak(isHighContrast ? 'Standard contrast.' : 'High contrast enabled.');
            }}
            accessibilityRole="button"
            accessibilityLabel="Toggle high contrast"
          >
            <Text style={[styles.bottomAccessBtnText, { fontSize: 12 * fontScale }]}>
              {isHighContrast ? '◑ Contrast ✓' : '◐ Contrast ✗'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.bottomAccessBtn}
            onPress={() => setFontScale(v => v >= 2.0 ? 1.0 : v + 0.25)}
            accessibilityRole="button"
            accessibilityLabel={`Text size ${Math.round(fontScale * 100)} percent. Tap to increase.`}
          >
            <Text style={[styles.bottomAccessBtnText, { fontSize: 12 * fontScale }]}>
              A+ {Math.round(fontScale * 100)}%
            </Text>
          </TouchableOpacity>

          {/* Volume stepper in bottom bar */}
          <View style={styles.volumeStepperBar}>
            <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setSoundLevel(v => Math.max(0, v - 10))} accessibilityRole="button" accessibilityLabel="Decrease volume">
              <Text style={[styles.bottomAccessBtnText, { fontSize: 14 * fontScale }]}>−</Text>
            </TouchableOpacity>
            <Text style={[styles.bottomAccessBtnText, { fontSize: 12 * fontScale }]}>🔊 {soundLevel}%</Text>
            <TouchableOpacity style={styles.stepperBtnSmall} onPress={() => setSoundLevel(v => Math.min(100, v + 10))} accessibilityRole="button" accessibilityLabel="Increase volume">
              <Text style={[styles.bottomAccessBtnText, { fontSize: 14 * fontScale }]}>+</Text>
            </TouchableOpacity>
          </View>

          {/* Floating Explore double-tap button */}
          <TouchableOpacity
            style={styles.exploreFloatBtn}
            onPress={() => {
              const now   = Date.now();
              const delta = now - exploreTapTime.current;
              exploreTapTime.current = now;
              exploreTapRef.current += 1;
              if (exploreTapRef.current >= 2 && delta < 400) {
                exploreTapRef.current = 0;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                speak(`Discharge instructions for ${patientName}. ${language.education}`);
              } else if (exploreTapRef.current === 1) {
                setTimeout(() => { exploreTapRef.current = 0; }, 400);
                speak('Tap again quickly to read discharge paperwork aloud.');
              }
            }}
            accessibilityRole="button"
            accessibilityLabel="Explore. Double-tap to read discharge paperwork aloud."
            accessibilityHint="Tap twice quickly to start reading your discharge instructions."
          >
            <Text style={[styles.exploreFloatText, { fontSize: 11 * fontScale }]}>
              📄{'\n'}EXPLORE
            </Text>
          </TouchableOpacity>
        </View>

      </SafeAreaView>

      {/* ── Overdue alarm modal ── */}
      <Modal
        visible={!!overdueAlarm}
        transparent
        animationType="fade"
        onRequestClose={() => setOverdueAlarm(null)}
        accessibilityViewIsModal
      >
        <View style={styles.overdueOverlay}>
          <View style={styles.overdueCard}>
            <Text style={styles.overdueTitle}>⏰ MISSED DOSE ALERT</Text>
            <Text
              style={styles.overdueBody}
              accessibilityLiveRegion="polite"
            >
              {overdueAlarm ? `${overdueAlarm.name} was due at ${overdueAlarm.time}. Please take it now.` : ''}
            </Text>
            <TouchableOpacity
              style={styles.overdueCancel}
              onPress={() => {
                void Speech.stop();
                if (overdueAlarm) {
                  // Condition 1: user cancels — stop all further alerts for this dose
                  const key = `${overdueAlarm.name}__${overdueAlarm.time}`;
                  clearInterval(overdueTimers.current[key]);
                  delete overdueTimers.current[key];
                  // Gray out the dose (locked — cannot be taken)
                  const med = overdueAlarm;
                  setMedications(current =>
                    current.map(item =>
                      item.name === med.name && item.time === med.time
                        ? { ...item, locked: true }
                        : item,
                    ),
                  );
                }
                setOverdueAlarm(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="Cancel overdue reminder"
            >
              <Text style={styles.actionText}>✕ {copy.cancelReminder}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Green YES Voice Bubble (confirm before marking taken) ── */}
      <Modal
        visible={!!pendingTakeMed}
        transparent
        animationType="slide"
        onRequestClose={() => setPendingTakeMed(null)}
        accessibilityViewIsModal
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>✅ Confirm Medication Taken</Text>
            <Text style={styles.confirmBody}>
              {pendingTakeMed
                ? `${pendingTakeMed.med.intervalEmoji} ${pendingTakeMed.med.interval}: ${pendingTakeMed.med.name}\nDue at ${pendingTakeMed.med.time}`
                : ''}
            </Text>
            <Text style={styles.confirmHint}>
              Say &quot;Yes&quot; or press the green button to confirm.
            </Text>
            <View style={styles.confirmBtnRow}>
              <TouchableOpacity
                style={styles.confirmYes}
                onPress={commitTakeMedication}
                accessibilityRole="button"
                accessibilityLabel="Yes — confirm medication taken"
              >
                <Text style={[styles.actionText, { fontSize: 18 }]}>YES ✓</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmNo}
                onPress={() => setPendingTakeMed(null)}
                accessibilityRole="button"
                accessibilityLabel="No — cancel"
              >
                <Text style={[styles.actionText, { fontSize: 18 }]}>NO ✗</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Emergency flow modal */}
      <Modal
        visible={showEmergency}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setShowEmergency(false)}
      >
        <EmergencyFlow
          languageLabel={languageLabel}
          fontScale={fontScale}
          soundLevel={soundLevel}
          speechRate={speechRate}
          isStandaloneOverride={isStandalone}
          onStandaloneChange={setIsStandalone}
          initialPhrase={emergencyPhrase}
          onClose={() => { setShowEmergency(false); setEmergencyPhrase(undefined); }}
        />
      </Modal>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: '#0a0a0a' },
  safeHighContrast: { backgroundColor: '#000000' },
  cardHighContrast: { backgroundColor: '#111827', borderColor: '#facc15', borderWidth: 3 },

  headerZone: { zIndex: 10 },
  scroll: { padding: 16, paddingBottom: 40, gap: 14 },

  // ── Mode toggle row ──
  modeToggleRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f172a', paddingHorizontal: 8, paddingVertical: 6, gap: 6, flexWrap: 'wrap' },
  modeBtn:       { minHeight: 52, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155', alignItems: 'center', justifyContent: 'center' },
  modeBtnStandaloneActive: { backgroundColor: '#1e3a5f', borderColor: '#3b82f6' },
  modeBtnCloudActive:      { backgroundColor: '#14532d', borderColor: '#22c55e' },
  modeBtnIcon:   { fontSize: 18, textAlign: 'center' },
  modeBtnLabel:  { color: '#e2e8f0', fontWeight: '700', textAlign: 'center', lineHeight: 15 },
  modeBtnBadge:  { color: '#4ade80', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  // ── Speaker switch (ST-5) ──
  speakerSwitchBox: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, gap: 2 },
  speakerSwitchLabel: { color: '#94a3b8', fontWeight: '600', letterSpacing: 0.5 },

  // ── Read All button (ST-5) ──
  readAllBtn:      { minHeight: 44, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#475569', alignItems: 'center', justifyContent: 'center' },
  readAllBtnActive:{ backgroundColor: '#7f1d1d', borderColor: '#ef4444' },
  readAllBtnText:  { color: '#e2e8f0', fontWeight: '700', textAlign: 'center' },

  // Language & Accessibility gear button
  gearButton:       { minHeight: 56, minWidth: 70, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1e293b', borderWidth: 2, borderColor: '#d97706', justifyContent: 'center', alignItems: 'center' },
  gearButtonActive: { backgroundColor: '#1d4ed8', borderColor: '#60a5fa' },
  gearIcon:         { fontSize: 28, color: '#d97706', textAlign: 'center' },
  gearLabel:        { color: '#e2e8f0', fontSize: 11, fontWeight: '700', lineHeight: 14, textAlign: 'center' },

  // Settings dropdown
  settingsPanel:        { width: '100%', backgroundColor: '#111827', borderBottomWidth: 1, borderColor: '#1e293b', padding: 16, gap: 10, zIndex: 100 },
  settingsSectionLabel: { color: '#475569', fontWeight: '700', letterSpacing: 0.8, marginBottom: 2 },
  settingsDivider:      { height: 1, backgroundColor: '#1e293b', marginVertical: 4 },
  panelHeader:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelCloseButton:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1d4ed8', borderWidth: 1, borderColor: '#60a5fa' },
  panelCloseText:       { color: '#ffffff', fontWeight: '700', fontSize: 14 },
  contrastActive:       { backgroundColor: '#14532d', borderColor: '#4ade80', borderWidth: 2 },
  stepperRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 },
  stepperLabel: { color: '#e2e8f0', fontWeight: '600', flex: 1 },
  stepperBtns:  { flexDirection: 'row', gap: 8 },
  stepperBtn:   { minWidth: 44, minHeight: 44, backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  langPicker:           { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  langChip:             { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#1e293b' },
  langChipSelected:     { backgroundColor: '#1d4ed8', borderColor: '#60a5fa' },
  langChipText:         { color: '#94a3b8', fontWeight: '500' },
  langChipTextSelected: { color: '#ffffff', fontWeight: '600' },

  // Name setup
  nameSetupBox:   { backgroundColor: '#0f172a', borderColor: '#1d4ed8', borderWidth: 2, borderRadius: 10, padding: 14, gap: 10, marginTop: 4 },
  nameSetupPrompt:{ color: '#93c5fd', fontWeight: '700', textAlign: 'center' },
  nameInput:      { backgroundColor: '#1e293b', color: '#f1f5f9', borderRadius: 8, padding: 10, borderColor: '#475569', borderWidth: 1 },
  editNameBtn:    { alignSelf: 'flex-end', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#475569' },
  editNameBtnText:{ color: '#94a3b8', fontWeight: '600' },

  // Name verify inline (below greeting)
  nameVerifyInline: { backgroundColor: '#0f172a', borderRadius: 8, borderWidth: 1, borderColor: '#1d4ed8', padding: 10, gap: 6, marginBottom: 4 },
  nameVerifyText:   { color: '#93c5fd', fontWeight: '700' },

  heardNameRow:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heardNameText:  { color: '#93c5fd', fontWeight: '600', flex: 1 },
  nameConfirmRow: { flexDirection: 'row', gap: 8 },
  nameYesBtn:     { flex: 1, backgroundColor: '#14532d', borderRadius: 8, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#4ade80' },
  nameNoBtn:      { flex: 1, backgroundColor: '#7f1d1d', borderRadius: 8, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#f87171' },

  // Mic button
  micBtn:       { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1e293b', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 2, borderColor: '#475569', alignSelf: 'center' },
  micBtnActive: { backgroundColor: '#7f1d1d', borderColor: '#ef4444' },
  micBtnLabel:  { color: '#e2e8f0', fontWeight: '600' },

  // Listening badge (ST-1/ST-3)
  listeningBadge:       { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#475569', alignSelf: 'center', marginVertical: 4 },
  listeningBadgeActive: { backgroundColor: '#7f1d1d', borderColor: '#ef4444' },
  listeningBadgeText:   { color: '#e2e8f0', fontWeight: '700', textAlign: 'center' },

  // Header card
  header:        { backgroundColor: '#0f172a', borderRadius: 16, borderWidth: 2, borderColor: '#1e3a5f', padding: 14, gap: 8 },
  appNameRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  appName:       { color: '#60a5fa', fontWeight: '700', letterSpacing: 0.5 },
  headerColumns: { flexDirection: 'row', gap: 10 },
  headerLeft:    { flex: 1, gap: 4 },
  headerRight:   { flex: 1, gap: 4 },
  headerDivider: { width: 1, backgroundColor: '#1e3a5f' },
  nameRow:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameEditRow:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameEditInput: { flex: 1, backgroundColor: '#1e293b', color: '#f1f5f9', borderRadius: 8, padding: 6, borderColor: '#475569', borderWidth: 1 },
  nameEditSave:  { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: '#14532d', borderRadius: 8 },
  greeting:      { color: '#f1f5f9', fontWeight: '800' },
  editPencil:    { fontSize: 18 },
  summary:       { color: '#60a5fa' },
  progressTrack: { height: 6, backgroundColor: '#1e293b', borderRadius: 3, overflow: 'hidden' },
  progressFill:  { height: '100%', backgroundColor: '#4ade80', borderRadius: 3 },
  offlineText:   { color: '#475569', letterSpacing: 0.5 },
  apptLabel:     { color: '#475569', fontWeight: '700', letterSpacing: 0.8 },
  apptActions:   { gap: 6 },
  apptBtnRow:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  apptButton:    { flex: 1, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, alignItems: 'center' },
  apptButtonRemind: { backgroundColor: '#134e4a', borderWidth: 1, borderColor: '#0d9488' },
  apptButtonMove:   { backgroundColor: '#1e3a5f', borderWidth: 1, borderColor: '#3b82f6' },
  apptButtonText:   { color: '#f1f5f9', fontWeight: '700' },

  // Medications
  section:          { gap: 10 },
  sectionTitle:     { color: '#f1f5f9', fontWeight: '800' },
  bodyText:         { color: '#94a3b8' },
  medicationRow:    { backgroundColor: '#0f172a', borderRadius: 12, borderWidth: 1, borderColor: '#1e3a5f', padding: 12, gap: 6 },
  medicationRowTaken:{ opacity: 0.45 },
  intervalBadge:    { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  intervalBadgeText:{ fontWeight: '700', letterSpacing: 0.5 },
  medNameRow:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  medicationName:   { color: '#f1f5f9', fontWeight: '700', flex: 1 },
  actionRow:        { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  takenButton:      { flex: 1, minHeight: 48, paddingVertical: 10, paddingHorizontal: 8, backgroundColor: '#1d4ed8', borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#3b82f6' },
  takenButtonDone:  { backgroundColor: '#14532d', borderColor: '#4ade80' },
  takenButtonLocked:{ backgroundColor: '#374151', borderColor: '#6b7280', opacity: 0.5 },
  reminderButton:   { flex: 1, minHeight: 48, paddingVertical: 10, paddingHorizontal: 8, backgroundColor: '#134e4a', borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#0d9488' },
  actionText:       { color: '#f1f5f9', fontWeight: '700', textAlign: 'center' },
  speakerIconBtn:   { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1e293b', borderRadius: 8 },
  speakerIconBtnLarge: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1e293b', borderRadius: 8 },
  secondaryButton:  { flex: 1, minHeight: 44, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#1e293b', borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#334155' },

  // HELP
  helpButtonRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  helpButton:    { backgroundColor: '#7f1d1d', borderRadius: 14, borderWidth: 3, borderColor: '#ef4444', padding: 18, alignItems: 'center', justifyContent: 'center', minHeight: 90 },
  helpTitle:     { color: '#ffffff', fontWeight: '900', letterSpacing: 1 },
  helpSubtitle:  { color: '#fca5a5', fontWeight: '600' },

  // Voice shortcut panel
  voiceShortcutPanel: { backgroundColor: '#0f172a', borderRadius: 14, borderWidth: 1, borderColor: '#1e3a5f', padding: 14, gap: 10 },
  voiceStepBox:       { gap: 10, alignItems: 'center' },
  triggerBtnWrap:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  voiceTriggerBtn:    { flex: 1, backgroundColor: '#7f1d1d', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center', borderWidth: 1, borderColor: '#ef4444' },
  countdownBig:       { color: '#ef4444', fontWeight: '900', textAlign: 'center' },
  aloneRow:           { flexDirection: 'row', gap: 12, width: '100%' },
  aloneYesBtn:        { flex: 1, backgroundColor: '#7f1d1d', borderRadius: 12, paddingVertical: 16, alignItems: 'center', borderWidth: 2, borderColor: '#ef4444' },
  aloneNoBtn:         { flex: 1, backgroundColor: '#1e3a5f', borderRadius: 12, paddingVertical: 16, alignItems: 'center', borderWidth: 2, borderColor: '#3b82f6' },
  withSomeoneBtn:     { backgroundColor: '#14532d', borderColor: '#4ade80' },
  liveAloneBtn:       { backgroundColor: '#7f1d1d', borderColor: '#ef4444' },
  voiceCancelBtn:     { backgroundColor: '#1e293b', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: '#475569', alignSelf: 'center' },
  returnHomeBtn:      { backgroundColor: '#1e293b', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: '#475569', alignSelf: 'center' },

  // Bottom access bar
  bottomAccessBar:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f172a', borderTopWidth: 1, borderColor: '#1e293b', paddingHorizontal: 8, paddingVertical: 6, gap: 6 },
  bottomAccessBtn:    { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1e293b' },
  bottomAccessBtnText:{ color: '#94a3b8', fontWeight: '600' },
  volumeStepperBar:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepperBtnSmall:    { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1e293b', borderRadius: 6 },
  exploreFloatBtn:    { marginLeft: 'auto', backgroundColor: '#1e293b', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  exploreFloatText:   { color: '#94a3b8', fontWeight: '700', textAlign: 'center', lineHeight: 14 },

  // Overdue alarm modal
  overdueOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center' },
  overdueCard:    { backgroundColor: '#1f1f1f', borderRadius: 16, borderWidth: 3, borderColor: '#ef4444', padding: 24, width: '85%', gap: 12 },
  overdueTitle:   { color: '#ef4444', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  overdueBody:    { color: '#f1f5f9', fontSize: 16, textAlign: 'center' },
  overdueCancel:  { backgroundColor: '#374151', borderRadius: 10, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#6b7280' },

  // Confirm modal
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'flex-end' },
  confirmCard:    { backgroundColor: '#0f172a', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 2, borderColor: '#4ade80', padding: 24, width: '100%', gap: 12 },
  confirmTitle:   { color: '#4ade80', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  confirmBody:    { color: '#f1f5f9', fontSize: 16, textAlign: 'center', lineHeight: 24 },
  confirmHint:    { color: '#94a3b8', fontSize: 13, textAlign: 'center' },
  confirmBtnRow:  { flexDirection: 'row', gap: 12 },
  confirmYes:     { flex: 1, backgroundColor: '#14532d', borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 2, borderColor: '#4ade80' },
  confirmNo:      { flex: 1, backgroundColor: '#7f1d1d', borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 2, borderColor: '#ef4444' },
});
