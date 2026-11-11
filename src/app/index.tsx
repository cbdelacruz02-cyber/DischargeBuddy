import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  AccessibilityInfo,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getLanguage, languages } from '@/constants/safety-content';
import type { LanguageLabel } from '@/constants/safety-content';
import { getUiCopy } from '@/constants/ui-copy';
import { useAppLanguage } from '@/contexts/language-context';
import { EmergencyFlow } from '@/components/emergency-flow';

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
  interval: 'Morning' | 'Afternoon' | 'Evening';
  intervalEmoji: string;
  intervalColor: string;
};

const initialMedications: Medication[] = [
  { name: 'Metoprolol 25mg',  time: '8:00 AM',  hour: 8,  minute: 0, taken: false, interval: 'Morning',   intervalEmoji: '🌅', intervalColor: '#fbbf24' },
  { name: 'Lisinopril 10mg',  time: '12:00 PM', hour: 12, minute: 0, taken: false, interval: 'Afternoon', intervalEmoji: '☀️', intervalColor: '#f97316' },
  { name: 'Aspirin 81mg',     time: '8:00 PM',  hour: 20, minute: 0, taken: false, interval: 'Evening',   intervalEmoji: '🌙', intervalColor: '#3b82f6' },
];

type ReminderKey = string;

// ─── Overdue alarm helpers ────────────────────────────────────────────────────
function isMissedDose(med: Medication): boolean {
  const now = new Date();
  const due = new Date();
  due.setHours(med.hour, med.minute, 0, 0);
  return !med.taken && now > due;
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

  // ── Language / name setup flow ─────────────────────────────────────────────
  const [nameSetupPhrase, setNameSetupPhrase] = useState('');
  const [nameSetupStep,   setNameSetupStep]   = useState<'idle' | 'speaking' | 'input' | 'confirm'>('idle');

  // ── Overdue alarm state ────────────────────────────────────────────────────
  const overdueTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const [overdueAlarm, setOverdueAlarm] = useState<Medication | null>(null);

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
    void Speech.stop();
  }, []);

  // ── TTS helper (offline — expo-speech only) ───────────────────────────────
  const speak = (text: string, promptLanguage = languageRef.current) => {
    AccessibilityInfo.announceForAccessibility(text);
    const go = () => Speech.speak(text, {
      language: promptLanguage.code,
      rate:     Math.min(0.65, speechRate),
      volume:   soundLevel / 100,
    });
    if (Platform.OS === 'web' && !voicesReady.current) {
      waitForVoices().then(() => { voicesReady.current = true; void Speech.stop().then(go, go); });
    } else {
      void Speech.stop().then(go, go);
    }
  };

  const showReminder = (title: string, message: string, promptLanguage = languageRef.current) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    speak(message, promptLanguage);
    Alert.alert(title, message);
  };

  // ── Language helpers ───────────────────────────────────────────────────────
  const selectLanguage = (label: LanguageLabel) => {
    const next = getLanguage(label);
    setLanguageLabel(label);
    Haptics.selectionAsync();
    // Speak immediately in new language
    const go = () => {
      speak(next.languageChangedPrompt, next);
      // After language change prompt, guide name setup
      setTimeout(() => {
        setNameSetupStep('speaking');
        speak(
          'Please bring the phone close to your mouth and speak your name slowly.',
          next,
        );
        // After 4 seconds pause, show text input fallback
        setTimeout(() => setNameSetupStep('input'), 4000);
      }, 2000);
    };
    if (Platform.OS === 'web' && !voicesReady.current) {
      waitForVoices().then(() => { voicesReady.current = true; go(); });
    } else {
      go();
    }
  };

  const confirmNameSetup = () => {
    const trimmed = nameSetupPhrase.trim();
    if (trimmed) setPatientName(trimmed);
    setNameSetupStep('confirm');
    // Ascending chime (3 haptic taps) for YES
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 150);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),  300);
    speak(`Thank you. I will remember your name.`);
    setTimeout(() => setNameSetupStep('idle'), 2000);
  };

  const rejectNameSetup = () => {
    // Descending chime for NO
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 150);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),  300);
    setNameSetupPhrase('');
    setNameSetupStep('speaking');
    speak("Let's try again. Please say your name slowly.");
    setTimeout(() => setNameSetupStep('input'), 4000);
  };

  // ── Medication helpers ─────────────────────────────────────────────────────
  const confirmAndToggleMedication = (index: number) => {
    const medication = medications[index];
    if (!medication.taken) {
      // Show Green YES Voice Bubble confirmation before marking taken
      setPendingTakeMed({ med: medication, index });
      speak(`${medication.intervalEmoji} ${medication.interval} medication: ${medication.name}. Please confirm you are taking this dose now.`);
    } else {
      // Untaking — no extra confirmation needed
      setMedications(current =>
        current.map((item, i) => i === index ? { ...item, taken: false } : item),
      );
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      speak(language.medicationTakenPrompt(medication.name, false));
    }
  };

  const commitTakeMedication = () => {
    if (!pendingTakeMed) return;
    const { index } = pendingTakeMed;
    const medication = medications[index];
    setMedications(current =>
      current.map((item, i) => i === index ? { ...item, taken: true } : item),
    );
    // Double-tap haptic confirms single-dose completion
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 140);
    speak(language.medicationTakenPrompt(medication.name, true));
    // Clear overdue alarm for this med
    if (overdueTimers.current[medication.name]) {
      clearInterval(overdueTimers.current[medication.name]);
      delete overdueTimers.current[medication.name];
    }
    setPendingTakeMed(null);
  };

  // ── Overdue alarm engine ───────────────────────────────────────────────────
  const startOverdueAlarm = (med: Medication) => {
    if (overdueTimers.current[med.name]) return; // already running
    const tick = () => {
      if (med.taken) { clearInterval(overdueTimers.current[med.name]); return; }
      setOverdueAlarm(med);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      speak(`Missed dose alert: ${med.name} was due at ${med.time}. Please take it now or cancel this reminder.`);
    };
    tick();
    overdueTimers.current[med.name] = setInterval(tick, 10 * 60 * 1000); // every 10 min
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
  }, [medications]);

  // ── Midnight reset ─────────────────────────────────────────────────────────
  useEffect(() => {
    const now      = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();
    const t = setTimeout(() => {
      setMedications(initialMedications.map(m => ({ ...m, taken: false })));
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

  const isHighContrast  = contrastMode === 'high';
  const takenCount      = medications.filter(m => m.taken).length;
  const speakDashboard  = () =>
    speak(`${copy.welcomeBack}, ${patientName}. ${copy.medsComplete(takenCount, medications.length)}.`);

  // ── Trigger emergency flow with optional phrase ────────────────────────────
  const triggerEmergency = (phrase?: string) => {
    setEmergencyPhrase(phrase);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setShowEmergency(true);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <SafeAreaView style={[styles.safe, isHighContrast && styles.safeHighContrast]}>

        {/* ── Header zone: sticky bar + settings dropdown ── */}
        <View style={styles.headerZone}>

          {/* ── Persistent dual mode toggles — always visible ── */}
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

              {/* ── Guided name setup (appears after language tap) ── */}
              {nameSetupStep !== 'idle' && (
                <View style={styles.nameSetupBox}>
                  <Text style={[styles.nameSetupPrompt, { fontSize: 13 * fontScale }]}>
                    🎙 Please say or type your name below:
                  </Text>
                  {(nameSetupStep === 'input' || nameSetupStep === 'confirm') && (
                    <TextInput
                      style={[styles.nameInput, { fontSize: 15 * fontScale }]}
                      value={nameSetupPhrase}
                      onChangeText={setNameSetupPhrase}
                      placeholder="Your name…"
                      placeholderTextColor="#64748b"
                      autoFocus
                      accessibilityLabel="Type your name here"
                    />
                  )}
                  {nameSetupStep === 'input' && (
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
                  {nameSetupStep === 'speaking' && (
                    <Text style={[styles.bodyText, { fontSize: 12 * fontScale }]}>
                      Listening… please speak clearly. ⏳
                    </Text>
                  )}
                </View>
              )}

              {/* Divider */}
              <View style={styles.settingsDivider} />

              {/* Accessibility controls */}
              <Text style={[styles.settingsSectionLabel, { fontSize: 11 * fontScale }]}>ACCESSIBILITY</Text>
              <Text style={[styles.bodyText, { fontSize: 13 * fontScale }]}>{copy.foregroundReminderNote}</Text>

              {/* Speak Prompt */}
              <TouchableOpacity style={styles.secondaryButton} onPress={speakDashboard} accessibilityRole="button">
                <Text style={[styles.actionText, { fontSize: 14 * fontScale }]}>{copy.speakPrompt}</Text>
              </TouchableOpacity>

              {/* High Contrast toggle with ✓/✗ badge */}
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

              {/* 🔊 Volume stepper */}
              <View style={styles.stepperRow}>
                <Text style={[styles.stepperLabel, { fontSize: 13 * fontScale }]}>🔊 Volume: {soundLevel}%</Text>
                <View style={styles.stepperBtns}>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => setSoundLevel(v => Math.max(0, v - 10))}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease volume"
                  >
                    <Text style={[styles.actionText, { fontSize: 16 * fontScale }]}>−</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => setSoundLevel(v => Math.min(100, v + 10))}
                    accessibilityRole="button"
                    accessibilityLabel="Increase volume"
                  >
                    <Text style={[styles.actionText, { fontSize: 16 * fontScale }]}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Speech speed stepper */}
              <View style={styles.stepperRow}>
                <Text style={[styles.stepperLabel, { fontSize: 13 * fontScale }]}>Speech: {speechRate.toFixed(2)}×</Text>
                <View style={styles.stepperBtns}>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => setSpeechRate(v => Math.max(0.4, +(v - 0.05).toFixed(2)))}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease speech speed"
                  >
                    <Text style={[styles.actionText, { fontSize: 16 * fontScale }]}>−</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => setSpeechRate(v => Math.min(1.0, +(v + 0.05).toFixed(2)))}
                    accessibilityRole="button"
                    accessibilityLabel="Increase speech speed"
                  >
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
                    <TextInput
                      style={[styles.nameEditInput, { fontSize: 20 * fontScale }]}
                      value={draftName}
                      onChangeText={setDraftName}
                      autoFocus
                      accessibilityLabel="Edit patient name"
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
                  {/* Remind Me — teal */}
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
                  {/* Move +1 Day — blue */}
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
            {medications.map((medication, index) => (
              <View key={medication.name} style={[styles.medicationRow, medication.taken && styles.medicationRowTaken]}>
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
                    style={[styles.takenButton, medication.taken && styles.takenButtonDone]}
                    onPress={() => confirmAndToggleMedication(index)}
                    accessibilityRole="button"
                    accessibilityLabel={`${medication.name}: ${medication.taken ? copy.taken : copy.markTaken}`}
                    disabled={medication.taken}
                  >
                    <Text style={[styles.actionText, { fontSize: 16 * fontScale }]}>
                      {medication.taken ? copy.taken : copy.markTaken}
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
            ))}
          </View>

          {/* HELP button — launches full 7-guardrail emergency flow */}
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

          {/* ── Voice shortcut panel for judges (simulates hands-free triggers) ── */}
          <View style={styles.voiceShortcutPanel}>
            <Text style={[styles.sectionTitle, { fontSize: 14 * fontScale }]}>
              🎙 SIMULATE VOICE TRIGGER (Judges Demo)
            </Text>
            <Text style={[styles.bodyText, { fontSize: 12 * fontScale }]}>
              Tap a phrase to simulate a patient speaking it hands-free.
            </Text>
            <View style={styles.actionRow}>
              {(['Help', 'My chest hurts', "I can't breathe"] as const).map(phrase => (
                <View key={phrase} style={styles.triggerBtnWrap}>
                  <TouchableOpacity
                    style={styles.voiceTriggerBtn}
                    onPress={() => {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                      speak(phrase);
                      setTimeout(() => triggerEmergency(phrase === 'Help' ? 'help' : phrase === 'My chest hurts' ? 'chest hurts' : "can't breathe"), 800);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Simulate patient saying: ${phrase}`}
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
          </View>

          {/* NOTE: greenTierBtn (I AM OKAY) removed — accessed via pain scale 1–3 */}

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
            <TouchableOpacity
              style={styles.stepperBtnSmall}
              onPress={() => setSoundLevel(v => Math.max(0, v - 10))}
              accessibilityRole="button"
              accessibilityLabel="Decrease volume"
            >
              <Text style={[styles.bottomAccessBtnText, { fontSize: 14 * fontScale }]}>−</Text>
            </TouchableOpacity>
            <Text style={[styles.bottomAccessBtnText, { fontSize: 12 * fontScale }]}>🔊 {soundLevel}%</Text>
            <TouchableOpacity
              style={styles.stepperBtnSmall}
              onPress={() => setSoundLevel(v => Math.min(100, v + 10))}
              accessibilityRole="button"
              accessibilityLabel="Increase volume"
            >
              <Text style={[styles.bottomAccessBtnText, { fontSize: 14 * fontScale }]}>+</Text>
            </TouchableOpacity>
          </View>

          {/* Floating Explore double-tap button — bottom right */}
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
            <Text style={styles.overdueBody}>
              {overdueAlarm ? `${overdueAlarm.name} was due at ${overdueAlarm.time}. Please take it now.` : ''}
            </Text>
            <TouchableOpacity
              style={styles.overdueCancel}
              onPress={() => {
                if (overdueAlarm) {
                  clearInterval(overdueTimers.current[overdueAlarm.name]);
                  delete overdueTimers.current[overdueAlarm.name];
                }
                setOverdueAlarm(null);
                speak('Reminder cancelled.');
              }}
              accessibilityRole="button"
              accessibilityLabel="Cancel overdue reminder"
            >
              <Text style={styles.actionText}>✕ Cancel Reminder</Text>
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

      {/* Emergency flow modal — receives isStandalone from the root toggle */}
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

  // Header zone — wraps sticky bar + dropdown so z-index stacks above ScrollView
  headerZone: { zIndex: 10 },

  // Scrollable area
  scroll: { padding: 16, paddingBottom: 40, gap: 14 },

  // Language & Accessibility button — top-right of sticky bar
  gearButton:       { minHeight: 56, minWidth: 80, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1e293b', borderWidth: 2, borderColor: '#d97706', justifyContent: 'center', alignItems: 'center' },
  gearButtonActive: { backgroundColor: '#1d4ed8', borderColor: '#60a5fa' },
  gearIcon:         { fontSize: 32, color: '#d97706', textAlign: 'center' },
  gearLabel:        { color: '#e2e8f0', fontSize: 13, fontWeight: '700', lineHeight: 17, textAlign: 'center' },

  // Settings dropdown panel
  settingsPanel:        { width: '100%', backgroundColor: '#111827', borderBottomWidth: 1, borderColor: '#1e293b', padding: 16, gap: 10, zIndex: 100 },
  settingsSectionLabel: { color: '#475569', fontWeight: '700', letterSpacing: 0.8, marginBottom: 2 },
  settingsDivider:      { height: 1, backgroundColor: '#1e293b', marginVertical: 4 },
  panelHeader:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelCloseButton:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1d4ed8', borderWidth: 1, borderColor: '#60a5fa' },
  panelCloseText:       { color: '#ffffff', fontWeight: '700', fontSize: 14 },

  // High contrast active indicator
  contrastActive: { backgroundColor: '#14532d', borderColor: '#4ade80', borderWidth: 2 },

  // Stepper row (volume / speech speed)
  stepperRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 },
  stepperLabel: { color: '#e2e8f0', fontWeight: '600', flex: 1 },
  stepperBtns:  { flexDirection: 'row', gap: 8 },
  stepperBtn:   { minWidth: 44, minHeight: 44, backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

  // Language chips
  langPicker:          { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  langChip:            { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#1e293b' },
  langChipSelected:    { backgroundColor: '#1d4ed8', borderColor: '#60a5fa' },
  langChipText:        { color: '#94a3b8', fontWeight: '500' },
  langChipTextSelected:{ color: '#ffffff', fontWeight: '600' },

  // Guided name setup box
  nameSetupBox:   { backgroundColor: '#0f172a', borderColor: '#1d4ed8', borderWidth: 2, borderRadius: 10, padding: 14, gap: 10, marginTop: 4 },
  nameSetupPrompt:{ color: '#93c5fd', fontWeight: '700', textAlign: 'center' },
  nameInput:      { backgroundColor: '#1e293b', color: '#f1f5f9', borderRadius: 8, padding: 10, borderColor: '#475569', borderWidth: 1 },
  nameConfirmRow: { flexDirection: 'row', gap: 10 },
  nameYesBtn:     { flex: 1, minHeight: 52, backgroundColor: '#15803d', borderColor: '#4ade80', borderWidth: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  nameNoBtn:      { flex: 1, minHeight: 52, backgroundColor: '#991b1b', borderColor: '#ff453a', borderWidth: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

  // Patient header
  header:         { backgroundColor: '#111827', borderColor: '#1e293b', borderWidth: 1, borderRadius: 12, padding: 16, gap: 8 },
  appNameRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  appName:        { color: '#60a5fa', fontWeight: '600', fontSize: 14, letterSpacing: 0.3 },
  greeting:       { color: '#f1f5f9', fontWeight: '700', lineHeight: 34 },
  bodyText:       { color: '#94a3b8', lineHeight: 20 },
  summary:        { color: '#93c5fd', fontWeight: '600' },
  offlineText:    { color: '#facc15', fontWeight: '600', marginTop: 4, fontSize: 11 },

  // Editable name
  nameRow:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editPencil:    { fontSize: 16 },
  nameEditRow:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameEditInput: { flex: 1, color: '#f1f5f9', fontWeight: '700', borderBottomWidth: 2, borderColor: '#60a5fa', paddingVertical: 2 },
  nameEditSave:  { padding: 4 },

  // Two-column header layout
  headerColumns:  { flexDirection: 'row', gap: 12, marginTop: 4 },
  headerLeft:     { flex: 3, gap: 4 },
  headerDivider:  { width: 1, backgroundColor: '#1e293b', alignSelf: 'stretch' },
  headerRight:    { flex: 2, gap: 4 },

  // Appointment right column
  apptLabel:          { color: '#475569', fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  apptActions:        { flexDirection: 'column', gap: 6, marginTop: 6 },
  apptBtnRow:         { flexDirection: 'row', alignItems: 'center', gap: 4 },
  apptButton:         { flex: 1, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 6, borderWidth: 1, alignItems: 'center' },
  apptButtonRemind:   { backgroundColor: '#0d4b45', borderColor: '#0d9488' },   // teal/green
  apptButtonMove:     { backgroundColor: '#1e3a6e', borderColor: '#1d4ed8' },   // blue
  apptButtonText:     { color: '#e2e8f0', fontWeight: '500', textAlign: 'center' },

  // Progress bar
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#1e293b', marginTop: 8 },
  progressFill:  { height: 6, borderRadius: 3, backgroundColor: '#16a34a' },

  // HELP button row (button + speaker)
  helpButtonRow:  { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  helpButton:     { minHeight: 120, justifyContent: 'center', alignItems: 'center', backgroundColor: '#991b1b', borderColor: '#fecaca', borderWidth: 3, borderRadius: 12, padding: 16, gap: 6 },
  helpTitle:      { color: '#ffffff', fontWeight: '700', textAlign: 'center' },
  helpSubtitle:   { color: '#fecaca', textAlign: 'center', lineHeight: 22, fontSize: 14 },

  // Sections
  section:          { gap: 10, marginTop: 4 },
  sectionTitle:     { color: '#f1f5f9', fontWeight: '600' },
  medicationRow:    { backgroundColor: '#111827', borderColor: '#1e293b', borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
  medicationRowTaken: { backgroundColor: '#0d2818', borderColor: '#16a34a', borderWidth: 1 },
  medicationName:   { color: '#f1f5f9', fontWeight: '600' },
  medNameRow:       { flexDirection: 'row', alignItems: 'center', gap: 6 },

  // Interval badge
  intervalBadge:     { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 2 },
  intervalBadgeText: { fontWeight: '700', letterSpacing: 0.3 },

  // Buttons
  actionRow:       { flexDirection: 'row', gap: 8 },
  takenButton:     { flex: 2, minHeight: 56, justifyContent: 'center', alignItems: 'center', backgroundColor: '#15803d', borderRadius: 8, padding: 10 },
  takenButtonDone: { backgroundColor: '#1c3b22', opacity: 0.7 },
  reminderButton:  { flex: 1.5, minHeight: 60, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1e3a6e', borderRadius: 8, padding: 10 },
  secondaryButton: { flex: 1, minHeight: 52, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1, borderRadius: 8, padding: 10 },
  actionText:      { color: '#ffffff', textAlign: 'center', fontWeight: '600' },

  // Speaker icon buttons
  speakerIconBtn:     { minWidth: 36, minHeight: 36, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 8, borderWidth: 1, borderColor: '#334155' },
  speakerIconBtnLarge:{ minWidth: 52, minHeight: 52, justifyContent: 'center', alignItems: 'center', backgroundColor: '#7c1d1d', borderRadius: 10, borderColor: '#ff453a', borderWidth: 2 },

  // Trigger button with speaker
  triggerBtnWrap: { flex: 1, gap: 4 },

  // ── Voice shortcut panel (judges demo panel) ──────────────────────────────────
  voiceShortcutPanel: {
    backgroundColor: '#1a0a00',
    borderColor: '#d97706',
    borderWidth: 2,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    marginTop: 4,
  },
  voiceTriggerBtn: {
    flex: 1,
    minHeight: 56,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#3a0000',
    borderColor: '#ff453a',
    borderWidth: 2,
    borderRadius: 8,
    padding: 8,
  },

  // ── Dual mode toggle row ──────────────────────────────────────────────────
  modeToggleRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#0a0a0a',
    borderBottomColor: '#1e293b',
    borderBottomWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
  },
  modeBtn: {
    flex: 1,
    minHeight: 64,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: '#334155',
    borderRadius: 10,
    paddingVertical: 6,
    gap: 2,
  },
  modeBtnStandaloneActive: { backgroundColor: '#292524', borderColor: '#d97706' },
  modeBtnCloudActive:      { backgroundColor: '#0c1a2e', borderColor: '#1d4ed8' },
  modeBtnIcon:  { fontSize: 22, textAlign: 'center' },
  modeBtnLabel: { color: '#f1f5f9', fontWeight: '800', textAlign: 'center', lineHeight: 16 },
  modeBtnBadge: { color: '#4ade80', fontSize: 10, fontWeight: '800', textAlign: 'center' },

  // ── Fixed bottom accessibility bar ────────────────────────────────────────
  bottomAccessBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderTopColor: '#1e293b',
    borderTopWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
  },
  bottomAccessBtn: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  bottomAccessBtnText: { color: '#e2e8f0', fontWeight: '700', textAlign: 'center' },

  // Volume stepper in bottom bar
  volumeStepperBar: { flex: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#1e293b', borderRadius: 8, borderWidth: 1, borderColor: '#334155', minHeight: 48, paddingHorizontal: 4 },
  stepperBtnSmall:  { minWidth: 28, minHeight: 36, justifyContent: 'center', alignItems: 'center' },

  // ── Floating Explore double-tap button ────────────────────────────────────
  exploreFloatBtn: {
    minWidth: 60,
    minHeight: 56,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#60a5fa',
    paddingHorizontal: 8,
  },
  exploreFloatText: { color: '#ffffff', fontWeight: '800', textAlign: 'center', lineHeight: 16 },

  // ── Overdue alarm modal ───────────────────────────────────────────────────
  overdueOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  overdueCard:    { backgroundColor: '#3b0000', borderColor: '#ff453a', borderWidth: 3, borderRadius: 16, padding: 24, gap: 14, width: '100%', maxWidth: 400, alignItems: 'center' },
  overdueTitle:   { color: '#ff453a', fontWeight: '900', fontSize: 22, textAlign: 'center' },
  overdueBody:    { color: '#fecaca', fontSize: 16, textAlign: 'center', lineHeight: 22 },
  overdueCancel:  { minHeight: 52, backgroundColor: '#7c2d12', borderColor: '#f59e0b', borderWidth: 2, borderRadius: 10, padding: 12, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },

  // ── Confirm take medication modal ─────────────────────────────────────────
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  confirmCard:    { backgroundColor: '#052e16', borderColor: '#4ade80', borderWidth: 3, borderRadius: 16, padding: 24, gap: 14, width: '100%', maxWidth: 400, alignItems: 'center' },
  confirmTitle:   { color: '#4ade80', fontWeight: '900', fontSize: 22, textAlign: 'center' },
  confirmBody:    { color: '#f1f5f9', fontSize: 16, textAlign: 'center', lineHeight: 24 },
  confirmHint:    { color: '#86efac', fontSize: 13, textAlign: 'center' },
  confirmBtnRow:  { flexDirection: 'row', gap: 14, alignSelf: 'stretch' },
  confirmYes:     { flex: 1, minHeight: 80, backgroundColor: '#15803d', borderColor: '#4ade80', borderWidth: 3, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  confirmNo:      { flex: 1, minHeight: 80, backgroundColor: '#991b1b', borderColor: '#ff453a', borderWidth: 3, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
