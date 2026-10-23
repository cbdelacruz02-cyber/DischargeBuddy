import * as Speech from 'expo-speech';
import {
  AccessibilityInfo,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getLanguage, languages } from '@/constants/safety-content';
import { getUiCopy } from '@/constants/ui-copy';
import { useAppLanguage } from '@/contexts/language-context';

export default function EducationScreen() {
  const { languageLabel, setLanguageLabel } = useAppLanguage();
  const language = getLanguage(languageLabel);
  const copy = getUiCopy(languageLabel);

  const speak = (text: string, promptLanguage = language) => {
    AccessibilityInfo.announceForAccessibility(text);
    void Speech.stop().then(
      () => Speech.speak(text, { language: promptLanguage.code, rate: 0.8 }),
      () => Speech.speak(text, { language: promptLanguage.code, rate: 0.8 }),
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>{copy.educationEyebrow}</Text>
        <Text style={styles.title}>{copy.recoveryGuide}</Text>
        <Text style={styles.subtitle}>{copy.educationSubtitle}</Text>

        <View style={styles.languageRow} accessibilityRole="radiogroup">
          {languages.map(option => (
            <TouchableOpacity
              key={option.label}
              style={[styles.languageButton, languageLabel === option.label && styles.languageSelected]}
              onPress={() => {
                const selectedLanguage = getLanguage(option.label);
                setLanguageLabel(option.label);
                speak(selectedLanguage.languageChangedPrompt, selectedLanguage);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: languageLabel === option.label }}
            >
              <Text style={styles.languageText}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.guidance}>
          <Text style={styles.sectionTitle}>{copy.dischargeInstructions}</Text>
          <Text style={styles.body}>{language.education}</Text>
          <TouchableOpacity
            style={styles.speakButton}
            onPress={() => speak(language.education)}
            accessibilityRole="button"
            accessibilityLabel={copy.readAloud}
          >
            <Text style={styles.speakText}>{copy.readAloud}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.guardrail}>
          <Text style={styles.guardrailTitle}>{copy.guardrail}</Text>
          <Text style={styles.body}>{copy.guardrailBody}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050505' },
  content: { padding: 20, paddingBottom: 48, gap: 18 },
  eyebrow: { color: '#facc15', fontSize: 13, fontWeight: '800' },
  title: { color: '#ffffff', fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#d1d5db', fontSize: 16, lineHeight: 23 },
  languageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  languageButton: {
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: '#171717',
    borderColor: '#a3a3a3',
    borderWidth: 2,
    borderRadius: 8,
  },
  languageSelected: { backgroundColor: '#174ea6', borderColor: '#ffffff' },
  languageText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  guidance: {
    backgroundColor: '#101010',
    borderColor: '#facc15',
    borderWidth: 2,
    borderRadius: 8,
    padding: 16,
    gap: 12,
  },
  sectionTitle: { color: '#ffffff', fontSize: 20, fontWeight: '800' },
  body: { color: '#ffffff', fontSize: 17, lineHeight: 26 },
  speakButton: {
    minHeight: 58,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1d4ed8',
    borderRadius: 8,
  },
  speakText: { color: '#ffffff', fontSize: 17, fontWeight: '800' },
  guardrail: {
    backgroundColor: '#101010',
    borderLeftWidth: 5,
    borderLeftColor: '#facc15',
    padding: 16,
    gap: 8,
  },
  guardrailTitle: { color: '#facc15', fontSize: 18, fontWeight: '800' },
});
