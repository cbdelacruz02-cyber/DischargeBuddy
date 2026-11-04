import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Modal,
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

// ─── Patient demo data ────────────────────────────────────────────────────────
const patient = {
  name:            'Maria Johnson',
  doctor:          'Dr. Reyes \u2014 Cardiology',   // clean em-dash, no encoding artifacts
  location:        'Heart Care Clinic, Room 204',
  appointmentTime: '10:30 AM',
};

function getDemoAppointmentDate(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 3);
  date.setHours(10, 30, 0, 0);
  return date;
}

const initialMedications = [
  { name: 'Metoprolol 25mg',  time: '8:00 AM',  hour: 8,  minute: 0, taken: false },
  { name: 'Lisinopril 10mg',  time: '12:00 PM', hour: 12, minute: 0, taken: false },
  { name: 'Aspirin 81mg',     time: '8:00 PM',  hour: 20, minute: 0, taken: false },
];

type ReminderKey = string;

export default function HomeScreen() {
  const { languageLabel, setLanguageLabel } = useAppLanguage();
  const language    = getLanguage(languageLabel);
  const copy        = getUiCopy(languageLabel);
  const languageRef = useRef(language);
  const timers      = useRef<Record<ReminderKey, ReturnType<typeof setTimeout>>>({});

  const [medications,              setMedications]              = useState(initialMedications);
  const [contrastMode,             setContrastMode]             = useState<'standard' | 'high'>('high');
  const [fontScale,                setFontScale]                = useState(1.25);
  const [soundLevel,               setSoundLevel]               = useState(80);
  const [speechRate,               setSpeechRate]               = useState(0.65);
  const [showAccessibility,        setShowAccessibility]        = useState(false);
  const [appointmentAt,            setAppointmentAt]            = useState(getDemoAppointmentDate);
  const [appointmentReminderActive,setAppointmentReminderActive]= useState(false);
  const [medicationReminders,      setMedicationReminders]      = useState<Record<string, boolean>>({});
  const [testReminderActive,       setTestReminderActive]       = useState(false);
  const [showEmergency,            setShowEmergency]            = useState(false);
  const [detectionAttempts,        setDetectionAttempts]        = useState(0);
  const [pendingLanguage,          setPendingLanguage]          = useState<LanguageLabel | null>(null);
  const [showLanguageFallback,     setShowLanguageFallback]     = useState(false);

  // ── Standalone / Cloud Sync — single source of truth for the entire app ─────
  // Lives at the root so it is always visible in the sticky header above the
  // scroll view. Passed to EmergencyFlow via isStandaloneOverride prop.
  const [isStandalone, setIsStandalone] = useState(true);

  useEffect(() => { languageRef.current = language; }, [language]);

  useEffect(() => () => {
    Object.values(timers.current).forEach(clearTimeout);
    void Speech.stop();
  }, []);

  // ── TTS helper (offline — expo-speech only) ───────────────────────────────
  const speak = (text: string, promptLanguage = languageRef.current) => {
    AccessibilityInfo.announceForAccessibility(text);
    const go = () => Speech.speak(text, {
      language: promptLanguage.code,
      rate:     Math.min(0.65, speechRate),   // pacing guard — never rush vulnerable users
      volume:   soundLevel / 100,
    });
    void Speech.stop().then(go, go);
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
    setPendingLanguage(null);
    setShowLanguageFallback(false);
    Haptics.selectionAsync();
    speak(next.languageChangedPrompt, next);
  };

  const requestSimulatedLanguageMatch = () => {
    // Use hardcoded safe label strings — no encoding-dependent characters
    const candidate: LanguageLabel = detectionAttempts % 2 === 0 ? 'English' : 'English';
    const candidateLanguage = getLanguage(candidate);
    setPendingLanguage(candidate);
    setDetectionAttempts(c => c + 1);
    setShowLanguageFallback(false);
    speak(candidateLanguage.languageConfirmationPrompt(candidate), candidateLanguage);
  };

  const confirmSimulatedLanguage = () => {
    if (!pendingLanguage) return;
    selectLanguage(pendingLanguage);
    setDetectionAttempts(0);
  };

  const rejectSimulatedLanguage = () => {
    const rejected = pendingLanguage ? getLanguage(pendingLanguage) : language;
    setPendingLanguage(null);
    if (detectionAttempts >= 3) {
      setShowLanguageFallback(true);
      speak(language.languageFallbackPrompt, language);
      return;
    }
    speak(rejected.languageRetryPrompt, rejected);
  };

  // ── Medication helpers ─────────────────────────────────────────────────────
  const toggleMedication = (index: number) => {
    const medication = medications[index];
    setMedications(current =>
      current.map((item, i) => i === index ? { ...item, taken: !item.taken } : item),
    );
    Haptics.selectionAsync();
    speak(language.medicationTakenPrompt(medication.name, !medication.taken));
  };

  const scheduleDailyMedicationReminder = (medication: (typeof initialMedications)[number]) => {
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
      const al       = languageRef.current;
      const apptStr  = `${appointmentAt.toLocaleDateString(al.code, dateOptions)} ${patient.appointmentTime}`;
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

  const toggleTestReminder = () => {
    if (testReminderActive) {
      clearTimeout(timers.current.test);
      setTestReminderActive(false);
      speak(language.testReminderCancelled);
      return;
    }
    timers.current.test = setTimeout(() => {
      const al = languageRef.current;
      setTestReminderActive(false);
      showReminder(al.testReminderTitle, al.testReminderBody, al);
    }, 10000);
    setTestReminderActive(true);
    speak(language.testReminderSet);
  };

  const isHighContrast = contrastMode === 'high';
  const takenCount     = medications.filter(m => m.taken).length;
  const speakDashboard = () =>
    speak(`${copy.welcomeBack}, ${patient.name}. ${copy.medsComplete(takenCount, medications.length)}.`);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <SafeAreaView style={[styles.safe, isHighContrast && styles.safeHighContrast]}>

        {/* ══════════════════════════════════════════════════════════════════
            STANDALONE / CLOUD SYNC TOGGLE — PINNED STICKY ABOVE SCROLL VIEW
            Not inside ScrollView. Always visible. Cannot be scrolled away.
            Single source of truth — passed to EmergencyFlow as a prop.
        ══════════════════════════════════════════════════════════════════ */}
        <View
          style={[styles.standaloneBar, !isStandalone && styles.standaloneBarCloud]}
          accessibilityRole="none"
        >
          <View style={styles.standaloneLeft}>
            <Text style={styles.standaloneIcon}>{isStandalone ? '[OFF]' : '[NET]'}</Text>
            <View>
              <Text style={styles.standaloneMode}>
                {isStandalone ? 'STANDALONE MODE' : 'CLOUD SYNC ON'}
              </Text>
              <Text style={styles.standaloneSub}>
                {isStandalone
                  ? 'All offline \u00B7 TTS \u00B7 timers \u00B7 haptics \u2014 no internet'
                  : 'Connected \u00B7 cloud features active'}
              </Text>
            </View>
          </View>
          <Switch
            value={!isStandalone}
            onValueChange={(on: boolean) => {
              const next = !on;
              setIsStandalone(next);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              speak(
                next
                  ? 'Standalone Mode activated. All subsystems running from local device memory. No internet required.'
                  : 'Cloud Sync activated. Connected mode enabled.',
              );
            }}
            trackColor={{ false: '#374151', true: '#1d4ed8' }}
            thumbColor={isStandalone ? '#94a3b8' : '#60a5fa'}
            ios_backgroundColor="#374151"
            accessibilityRole="switch"
            accessibilityLabel={
              isStandalone
                ? 'Standalone Mode is ON. Slide right to enable Cloud Sync.'
                : 'Cloud Sync is ON. Slide left to enable Standalone Mode.'
            }
          />
        </View>

        {/* ── Scrollable content below the sticky toggle ── */}
        <ScrollView contentContainerStyle={styles.scroll}>

          {/* Language bar */}
          <View style={[styles.languageBar, isHighContrast && styles.cardHighContrast]}>
            <Text style={[styles.languageLabel, { fontSize: 17 * fontScale }]}>
              {copy.currentLanguage(language.label)}
            </Text>
            <View style={styles.languageChoices}>
              {languages.map(option => (
                <TouchableOpacity
                  key={option.label}
                  style={[
                    styles.languageButton,
                    languageLabel === option.label && styles.languageButtonSelected,
                  ]}
                  onPress={() => selectLanguage(option.label)}
                  accessibilityRole="button"
                  accessibilityLabel={copy.currentLanguage(option.label)}
                  accessibilityState={{ selected: languageLabel === option.label }}
                >
                  <Text style={[styles.languageButtonText, { fontSize: 15 * fontScale }]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Patient overview header */}
          <View style={[styles.header, isHighContrast && styles.cardHighContrast]}>
            <Text style={[styles.appName,   { fontSize: 20 * fontScale }]}>DischargeBuddy AI Assist</Text>
            <Text style={[styles.greeting,  { fontSize: 29 * fontScale }]}>{copy.welcomeBack}, {patient.name}</Text>
            <Text style={[styles.bodyText,  { fontSize: 17 * fontScale }]}>{copy.condition}</Text>
            <Text style={[styles.bodyText, styles.summary, { fontSize: 16 * fontScale }]}>
              {copy.medsComplete(takenCount, medications.length)}
            </Text>
            <Text style={[styles.offlineText, { fontSize: 14 * fontScale }]}>{copy.offlineSample}</Text>
          </View>

          {/* HELP button — launches full 7-guardrail emergency flow */}
          <TouchableOpacity
            style={styles.helpButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              setShowEmergency(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${copy.help}. ${copy.emergencyDemo}`}
            accessibilityHint="Opens the full 7-guardrail emergency evaluation sequence. Demo only — no real calls placed."
          >
            <Text style={[styles.helpTitle,    { fontSize: 29 * fontScale }]}>{copy.help}</Text>
            <Text style={[styles.helpSubtitle, { fontSize: 17 * fontScale }]}>{copy.helpSubtitle}</Text>
          </TouchableOpacity>

          {/* Today's medications */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { fontSize: 22 * fontScale }]}>{copy.medications}</Text>
            {medications.map((medication, index) => (
              <View key={medication.name} style={styles.medicationRow}>
                <Text style={[styles.medicationName, { fontSize: 18 * fontScale }]}>{medication.name}</Text>
                <Text style={[styles.bodyText,       { fontSize: 16 * fontScale }]}>{copy.dueAt(medication.time)}</Text>
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.takenButton}
                    onPress={() => toggleMedication(index)}
                    accessibilityRole="button"
                    accessibilityLabel={`${medication.name}: ${medication.taken ? copy.taken : copy.markTaken}`}
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
                </View>
              </View>
            ))}
          </View>

          {/* Next appointment */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { fontSize: 22 * fontScale }]}>{copy.nextAppointment}</Text>
            <View style={styles.appointment}>
              <Text style={[styles.medicationName, { fontSize: 18 * fontScale }]}>{copy.doctor}</Text>
              <Text style={[styles.bodyText, { fontSize: 16 * fontScale }]}>
                {appointmentAt.toLocaleDateString(language.code, dateOptions)}
              </Text>
              <Text style={[styles.bodyText, { fontSize: 16 * fontScale }]}>{patient.appointmentTime}</Text>
              <Text style={[styles.bodyText, { fontSize: 16 * fontScale }]}>{copy.appointmentLocation}</Text>
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.reminderButton} onPress={toggleAppointmentReminder} accessibilityRole="button">
                  <Text style={[styles.actionText, { fontSize: 16 * fontScale }]}>
                    {appointmentReminderActive ? copy.cancelReminder : copy.remindMe}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} onPress={moveAppointmentOneDay} accessibilityRole="button">
                  <Text style={[styles.actionText, { fontSize: 16 * fontScale }]}>{copy.moveOneDay}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Accessibility panel toggle */}
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setShowAccessibility(v => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showAccessibility }}
          >
            <Text style={[styles.actionText, { fontSize: 18 * fontScale }]}>
              {showAccessibility ? copy.hideTools : copy.moreTools}
            </Text>
          </TouchableOpacity>

          {showAccessibility && (
            <View style={styles.accessibilityPanel}>
              <Text style={[styles.sectionTitle, { fontSize: 21 * fontScale }]}>{copy.accessibilityControls}</Text>
              <Text style={[styles.bodyText,     { fontSize: 16 * fontScale }]}>{copy.foregroundReminderNote}</Text>
              <TouchableOpacity style={styles.secondaryButton} onPress={speakDashboard} accessibilityRole="button">
                <Text style={[styles.actionText, { fontSize: 16 * fontScale }]}>{copy.speakPrompt}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={toggleTestReminder} accessibilityRole="button">
                <Text style={[styles.actionText, { fontSize: 16 * fontScale }]}>
                  {testReminderActive ? copy.cancelTestReminder : copy.testReminder}
                </Text>
              </TouchableOpacity>
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => setContrastMode(v => v === 'high' ? 'standard' : 'high')} accessibilityRole="button">
                  <Text style={[styles.actionText, { fontSize: 15 * fontScale }]}>{copy.highContrast}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => setFontScale(v => v >= 1.75 ? 1.25 : v + 0.25)} accessibilityRole="button">
                  <Text style={[styles.actionText, { fontSize: 15 * fontScale }]}>{copy.fontSize(Math.round(fontScale * 100))}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => setSoundLevel(v => v >= 100 ? 50 : v + 10)} accessibilityRole="button">
                  <Text style={[styles.actionText, { fontSize: 15 * fontScale }]}>{copy.voiceVolume(soundLevel)}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => setSpeechRate(v => v >= 1 ? 0.65 : Number((v + 0.1).toFixed(2)))} accessibilityRole="button">
                  <Text style={[styles.actionText, { fontSize: 15 * fontScale }]}>{copy.voicePace(speechRate.toFixed(2))}</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.bodyText, { fontSize: 15 * fontScale }]}>{copy.detectionSimulationNote}</Text>
              <TouchableOpacity style={styles.secondaryButton} onPress={requestSimulatedLanguageMatch} accessibilityRole="button">
                <Text style={[styles.actionText, { fontSize: 16 * fontScale }]}>{copy.simulateLanguage}</Text>
              </TouchableOpacity>
              {pendingLanguage && (
                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.takenButton} onPress={confirmSimulatedLanguage} accessibilityRole="button">
                    <Text style={[styles.actionText, { fontSize: 15 * fontScale }]}>
                      {getLanguage(pendingLanguage).confirmLanguageAction(pendingLanguage)}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.reminderButton} onPress={rejectSimulatedLanguage} accessibilityRole="button">
                    <Text style={[styles.actionText, { fontSize: 15 * fontScale }]}>
                      {getLanguage(pendingLanguage).rejectLanguageAction}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              {showLanguageFallback && (
                <Text style={[styles.bodyText, { fontSize: 15 * fontScale }]}>{copy.fallbackThreeAttempts}</Text>
              )}
            </View>
          )}

        </ScrollView>
      </SafeAreaView>

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
          onClose={() => setShowEmergency(false)}
        />
      </Modal>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: '#050505' },
  safeHighContrast: { backgroundColor: '#000000' },
  cardHighContrast: { backgroundColor: '#111827', borderColor: '#facc15', borderWidth: 3 },

  // Standalone toggle — outside ScrollView so it never scrolls away
  standaloneBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1c1917',
    borderBottomColor: '#78716c',
    borderBottomWidth: 2,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  standaloneBarCloud: {
    backgroundColor: '#0c2340',
    borderBottomColor: '#1d4ed8',
  },
  standaloneLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  standaloneIcon: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  standaloneMode: {
    color: '#e2e8f0',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 0.8,
    lineHeight: 19,
  },
  standaloneSub: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 15,
  },

  // Scrollable area
  scroll: { padding: 16, paddingBottom: 40, gap: 14 },

  // Language bar
  languageBar:            { backgroundColor: '#111827', borderColor: '#facc15', borderWidth: 2, borderRadius: 10, padding: 12, gap: 8 },
  languageLabel:          { color: '#facc15', fontWeight: '800' },
  languageChoices:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  languageButton:         { minHeight: 52, minWidth: 82, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14, borderRadius: 8, borderWidth: 2, borderColor: '#94a3b8', backgroundColor: '#1f2937' },
  languageButtonSelected: { backgroundColor: '#1d4ed8', borderColor: '#ffffff' },
  languageButtonText:     { color: '#ffffff', fontWeight: '800' },

  // Patient header
  header:      { backgroundColor: '#111827', borderColor: '#facc15', borderWidth: 2, borderRadius: 10, padding: 16, gap: 4 },
  appName:     { color: '#60a5fa', fontWeight: '900' },
  greeting:    { color: '#ffffff', fontWeight: '900', lineHeight: 38 },
  bodyText:    { color: '#f3f4f6', lineHeight: 24 },
  summary:     { color: '#bfdbfe', fontWeight: '800' },
  offlineText: { color: '#facc15', fontWeight: '800', marginTop: 6 },

  // HELP button
  helpButton:    { minHeight: 100, justifyContent: 'center', alignItems: 'center', backgroundColor: '#991b1b', borderColor: '#fecaca', borderWidth: 3, borderRadius: 10, padding: 16, gap: 6 },
  helpTitle:     { color: '#ffffff', fontWeight: '900', textAlign: 'center' },
  helpSubtitle:  { color: '#ffffff', textAlign: 'center', lineHeight: 24 },

  // Sections
  section:       { gap: 10, marginTop: 4 },
  sectionTitle:  { color: '#ffffff', fontWeight: '900' },
  medicationRow: { backgroundColor: '#111827', borderColor: '#facc15', borderWidth: 2, borderRadius: 10, padding: 14, gap: 8 },
  medicationName:{ color: '#ffffff', fontWeight: '800' },
  appointment:   { backgroundColor: '#111827', borderColor: '#facc15', borderWidth: 2, borderRadius: 10, padding: 14, gap: 8 },

  // Buttons
  actionRow:       { flexDirection: 'row', gap: 8 },
  takenButton:     { flex: 1, minHeight: 62, justifyContent: 'center', alignItems: 'center', backgroundColor: '#15803d', borderRadius: 8, padding: 10 },
  reminderButton:  { flex: 1, minHeight: 62, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1d4ed8', borderRadius: 8, padding: 10 },
  secondaryButton: { flex: 1, minHeight: 58, justifyContent: 'center', alignItems: 'center', backgroundColor: '#27272a', borderColor: '#facc15', borderWidth: 2, borderRadius: 8, padding: 10 },
  actionText:      { color: '#ffffff', textAlign: 'center', fontWeight: '800' },

  // Accessibility panel
  accessibilityPanel: { backgroundColor: '#111827', borderColor: '#facc15', borderWidth: 2, borderRadius: 10, padding: 14, gap: 10 },
});
