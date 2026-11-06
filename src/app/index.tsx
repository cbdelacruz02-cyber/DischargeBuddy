import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
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

        {/* ── Header zone: sticky bar + settings dropdown ── */}
        <View style={styles.headerZone}>

          {/* Status bar row */}
          <View style={[styles.standaloneBar, !isStandalone && styles.standaloneBarCloud]}>
            <View style={styles.standaloneLeft}>
              <Text style={styles.standaloneIcon}>{isStandalone ? '\u25CF' : '\u25CF'}</Text>
              <Text style={styles.standaloneMode}>
                {isStandalone ? 'Offline mode \u2014 no internet needed' : 'Connected \u00B7 cloud features active'}
              </Text>
            </View>
            {/* Language & Accessibility button */}
            <TouchableOpacity
              activeOpacity={0.7}
              style={[styles.gearButton, showAccessibility && styles.gearButtonActive]}
              onPress={() => {
                setShowAccessibility(v => !v);
              }}
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

            {/* Divider */}
            <View style={styles.settingsDivider} />

            {/* Accessibility controls */}
            <Text style={[styles.settingsSectionLabel, { fontSize: 11 * fontScale }]}>ACCESSIBILITY</Text>
            <Text style={[styles.bodyText, { fontSize: 13 * fontScale }]}>{copy.foregroundReminderNote}</Text>

            {/* Offline / Cloud toggle */}
            <View style={styles.switchRow}>
              <Text style={[styles.switchLabel, { fontSize: 13 * fontScale }]}>
                {isStandalone ? 'Offline mode' : 'Cloud Sync on'}
              </Text>
              <Switch
                value={!isStandalone}
                onValueChange={(on: boolean) => {
                  const next = !on;
                  setIsStandalone(next);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  speak(
                    next
                      ? 'Offline mode activated. All features running from local device. No internet required.'
                      : 'Cloud Sync activated. Connected mode enabled.',
                  );
                }}
                trackColor={{ false: '#334155', true: '#1d4ed8' }}
                thumbColor={isStandalone ? '#94a3b8' : '#60a5fa'}
                ios_backgroundColor="#334155"
                accessibilityRole="switch"
                accessibilityLabel={
                  isStandalone
                    ? 'Offline mode is ON. Slide right to enable Cloud Sync.'
                    : 'Cloud Sync is ON. Slide left to enable Offline mode.'
                }
              />
            </View>

            <TouchableOpacity style={styles.secondaryButton} onPress={speakDashboard} accessibilityRole="button">
              <Text style={[styles.actionText, { fontSize: 14 * fontScale }]}>{copy.speakPrompt}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={toggleTestReminder} accessibilityRole="button">
              <Text style={[styles.actionText, { fontSize: 14 * fontScale }]}>
                {testReminderActive ? copy.cancelTestReminder : copy.testReminder}
              </Text>
            </TouchableOpacity>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setContrastMode(v => v === 'high' ? 'standard' : 'high')} accessibilityRole="button">
                <Text style={[styles.actionText, { fontSize: 13 * fontScale }]}>{copy.highContrast}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setFontScale(v => v >= 1.75 ? 1.25 : v + 0.25)} accessibilityRole="button">
                <Text style={[styles.actionText, { fontSize: 13 * fontScale }]}>{copy.fontSize(Math.round(fontScale * 100))}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setSoundLevel(v => v >= 100 ? 50 : v + 10)} accessibilityRole="button">
                <Text style={[styles.actionText, { fontSize: 13 * fontScale }]}>{copy.voiceVolume(soundLevel)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setSpeechRate(v => v >= 1 ? 0.65 : Number((v + 0.1).toFixed(2)))} accessibilityRole="button">
                <Text style={[styles.actionText, { fontSize: 13 * fontScale }]}>{copy.voicePace(speechRate.toFixed(2))}</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.bodyText, { fontSize: 13 * fontScale }]}>{copy.detectionSimulationNote}</Text>
            <TouchableOpacity style={styles.secondaryButton} onPress={requestSimulatedLanguageMatch} accessibilityRole="button">
              <Text style={[styles.actionText, { fontSize: 14 * fontScale }]}>{copy.simulateLanguage}</Text>
            </TouchableOpacity>
            {pendingLanguage && (
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.takenButton} onPress={confirmSimulatedLanguage} accessibilityRole="button">
                  <Text style={[styles.actionText, { fontSize: 13 * fontScale }]}>
                    {getLanguage(pendingLanguage).confirmLanguageAction(pendingLanguage)}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.reminderButton} onPress={rejectSimulatedLanguage} accessibilityRole="button">
                  <Text style={[styles.actionText, { fontSize: 13 * fontScale }]}>
                    {getLanguage(pendingLanguage).rejectLanguageAction}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            {showLanguageFallback && (
              <Text style={[styles.bodyText, { fontSize: 13 * fontScale }]}>{copy.fallbackThreeAttempts}</Text>
            )}
            </View>
          )}

        </View>{/* end headerZone */}

        {/* ── Scrollable content below the sticky toggle ── */}
        <ScrollView contentContainerStyle={styles.scroll}>

          {/* ── Combined patient overview + appointment card ─────────────── */}
          <View style={[styles.header, isHighContrast && styles.cardHighContrast]}>
            <Text style={[styles.appName, { fontSize: 14 * fontScale }]}>DischargeBuddy AI Assist</Text>

            {/* Two-column row: patient info left, appointment right */}
            <View style={styles.headerColumns}>

              {/* Left column — patient / meds */}
              <View style={styles.headerLeft}>
                <Text style={[styles.greeting, { fontSize: 26 * fontScale }]}>{copy.welcomeBack}, {patient.name}</Text>
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
                  <TouchableOpacity style={styles.apptButton} onPress={toggleAppointmentReminder} accessibilityRole="button">
                    <Text style={[styles.apptButtonText, { fontSize: 12 * fontScale }]}>
                      {appointmentReminderActive ? copy.cancelReminder : copy.remindMe}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.apptButton} onPress={moveAppointmentOneDay} accessibilityRole="button">
                    <Text style={[styles.apptButtonText, { fontSize: 12 * fontScale }]}>{copy.moveOneDay}</Text>
                  </TouchableOpacity>
                </View>
              </View>

            </View>
          </View>

          {/* Today's medications */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { fontSize: 22 * fontScale }]}>{copy.medications}</Text>
            {medications.map((medication, index) => (
              <View key={medication.name} style={[styles.medicationRow, medication.taken && styles.medicationRowTaken]}>
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

          {/* HELP button — launches full 7-guardrail emergency flow */}
          <Animated.View style={{ transform: [{ scale: helpPulse }] }}>
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
              <Text style={[styles.helpSubtitle, { fontSize: 16 * fontScale }]}>{copy.helpSubtitle}</Text>
            </TouchableOpacity>
          </Animated.View>

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
  safe:             { flex: 1, backgroundColor: '#0a0a0a' },
  safeHighContrast: { backgroundColor: '#000000' },
  cardHighContrast: { backgroundColor: '#111827', borderColor: '#facc15', borderWidth: 3 },

  // Header zone — wraps sticky bar + dropdown so z-index stacks above ScrollView
  headerZone: { zIndex: 10 },

  // Standalone toggle — outside ScrollView so it never scrolls away
  standaloneBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111827',
    borderBottomColor: '#1e293b',
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  standaloneBarCloud: {
    backgroundColor: '#0c1a2e',
    borderBottomColor: '#1d4ed8',
  },
  standaloneLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  standaloneIcon: {
    color: '#94a3b8',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  standaloneMode: {
    color: '#e2e8f0',
    fontWeight: '700',
    fontSize: 17,
    letterSpacing: 0.2,
    lineHeight: 24,
  },
  standaloneSub: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 18,
  },

  // Scrollable area
  scroll: { padding: 16, paddingBottom: 40, gap: 14 },

  // Language & Accessibility button — top-right of sticky bar
  gearButton:       { minHeight: 56, minWidth: 80, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1e293b', borderWidth: 2, borderColor: '#d97706', justifyContent: 'center', alignItems: 'center' },
  gearButtonActive: { backgroundColor: '#1d4ed8', borderColor: '#60a5fa' },
  gearIcon:         { fontSize: 32, color: '#d97706', textAlign: 'center' },
  gearLabel:        { color: '#e2e8f0', fontSize: 13, fontWeight: '700', lineHeight: 17, textAlign: 'center' },

  // Settings dropdown panel — sits below the sticky bar (not absolute, flows naturally)
  settingsPanel:        { width: '100%', backgroundColor: '#111827', borderBottomWidth: 1, borderColor: '#1e293b', padding: 16, gap: 10, zIndex: 100 },
  settingsSectionLabel: { color: '#475569', fontWeight: '700', letterSpacing: 0.8, marginBottom: 2 },
  settingsDivider:      { height: 1, backgroundColor: '#1e293b', marginVertical: 4 },
  panelHeader:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelCloseButton:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1d4ed8', borderWidth: 1, borderColor: '#60a5fa' },
  panelCloseText:       { color: '#ffffff', fontWeight: '700', fontSize: 14 },

  // Language chips — inside settings panel
  langPicker:          { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  langChip:            { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#1e293b' },
  langChipSelected:    { backgroundColor: '#1d4ed8', borderColor: '#60a5fa' },
  langChipText:        { color: '#94a3b8', fontWeight: '500' },
  langChipTextSelected:{ color: '#ffffff', fontWeight: '600' },

  // Patient header — combined with appointment
  header:         { backgroundColor: '#111827', borderColor: '#1e293b', borderWidth: 1, borderRadius: 12, padding: 16, gap: 8 },
  appName:        { color: '#60a5fa', fontWeight: '600', fontSize: 14, letterSpacing: 0.3 },
  greeting:       { color: '#f1f5f9', fontWeight: '700', lineHeight: 34 },
  bodyText:       { color: '#94a3b8', lineHeight: 20 },
  summary:        { color: '#93c5fd', fontWeight: '600' },
  offlineText:    { color: '#facc15', fontWeight: '600', marginTop: 4, fontSize: 11 },

  // Two-column header layout
  headerColumns:  { flexDirection: 'row', gap: 12, marginTop: 4 },
  headerLeft:     { flex: 3, gap: 4 },
  headerDivider:  { width: 1, backgroundColor: '#1e293b', alignSelf: 'stretch' },
  headerRight:    { flex: 2, gap: 4 },

  // Appointment right column
  apptLabel:      { color: '#475569', fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  apptActions:    { flexDirection: 'column', gap: 6, marginTop: 6 },
  apptButton:     { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 6, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155', alignItems: 'center' },
  apptButtonText: { color: '#e2e8f0', fontWeight: '500', textAlign: 'center' },

  // Progress bar (medication completion)
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#1e293b', marginTop: 8 },
  progressFill:  { height: 6, borderRadius: 3, backgroundColor: '#16a34a' },

  // HELP button
  helpButton:    { minHeight: 120, justifyContent: 'center', alignItems: 'center', backgroundColor: '#991b1b', borderColor: '#fecaca', borderWidth: 3, borderRadius: 12, padding: 16, gap: 6 },
  helpTitle:     { color: '#ffffff', fontWeight: '700', textAlign: 'center' },
  helpSubtitle:  { color: '#fecaca', textAlign: 'center', lineHeight: 22, fontSize: 14 },

  // Sections
  section:          { gap: 10, marginTop: 4 },
  sectionTitle:     { color: '#f1f5f9', fontWeight: '600' },
  medicationRow:    { backgroundColor: '#111827', borderColor: '#1e293b', borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
  medicationRowTaken: { backgroundColor: '#0d2818', borderColor: '#16a34a', borderWidth: 1 },
  medicationName:   { color: '#f1f5f9', fontWeight: '600' },
  appointment:      { backgroundColor: '#111827', borderColor: '#1e293b', borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },

  // Buttons — Mark Taken is primary (flex:2), Remind Me is secondary (flex:1)
  actionRow:       { flexDirection: 'row', gap: 8 },
  takenButton:     { flex: 2, minHeight: 56, justifyContent: 'center', alignItems: 'center', backgroundColor: '#15803d', borderRadius: 8, padding: 10 },
  reminderButton:  { flex: 1, minHeight: 56, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1e3a6e', borderRadius: 8, padding: 10 },
  secondaryButton: { flex: 1, minHeight: 52, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1, borderRadius: 8, padding: 10 },
  actionText:      { color: '#ffffff', textAlign: 'center', fontWeight: '600' },

  // Accessibility panel
  accessibilityPanel: { backgroundColor: '#111827', borderColor: '#1e293b', borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },

  // Switch row inside accessibility panel
  switchRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  switchLabel: { color: '#cbd5e1', fontWeight: '500', flex: 1 },
});
