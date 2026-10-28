import type { LanguageLabel } from '@/constants/safety-content';
import { getLanguage } from '@/constants/safety-content';
import { getUiCopy } from '@/constants/ui-copy';
import { useAppLanguage } from '@/contexts/language-context';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View
} from 'react-native';

export default function AlertScreen() {
  const params = useLocalSearchParams<{
    language?: string;
    fontScale?: string;
    soundLevel?: string;
    speechRate?: string;
  }>();
  const { languageLabel } = useAppLanguage();

  return (
    <EmergencyFlow
      languageLabel={(params.language as LanguageLabel | undefined) ?? languageLabel}
      fontScale={Number(params.fontScale) || 1.25}
      soundLevel={Number(params.soundLevel) || 80}
      speechRate={Number(params.speechRate) || 0.8}
      onExit={() => router.back()}
    />
  );
}


type EmergencyFlowProps = {
  languageLabel: LanguageLabel;
  fontScale: number;
  soundLevel: number;
  speechRate: number;
  onExit: () => void;
};

type Phase = 'countdown' | 'confirm' | 'yellow' | 'simulated' | 'cancelled';

export function EmergencyFlow({ languageLabel, fontScale, soundLevel, speechRate, onExit }: EmergencyFlowProps) {
  // ── State declarations ────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('countdown');
  const [countdown, setCountdown] = useState<number>(10);
  const [painScore, setPainScore] = useState<number | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ── Derived values ────────────────────────────────────────────────────────
  const language = getLanguage(languageLabel);
  const copy = getUiCopy(languageLabel);
  const voiceVolume = Math.min(1, Math.max(0, soundLevel / 100));

  // ── TTS wrapper ───────────────────────────────────────────────────────────
  const speak = useCallback((text: string) => {
    AccessibilityInfo.announceForAccessibility(text);
    const startSpeech = () => Speech.speak(text, {
      language: language.code,
      rate: speechRate,
      volume: voiceVolume,
    });
    void Speech.stop().then(startSpeech, startSpeech);
  }, [language.code, speechRate, voiceVolume]);

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    speak(language.emergencyPrompt);
    return () => {
      Speech.stop();
    };
  }, [speak, language.emergencyPrompt]);

  // Haptic vibration loop
  useEffect(() => {
    if (phase !== 'countdown') return;
    const hapticLoop = setInterval(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      Vibration.vibrate();
    }, 1200);
    return () => {
      clearInterval(hapticLoop);
      Vibration.cancel();
    };
  }, [phase]);

  // Phase-change voice prompts
  useEffect(() => {
    if (phase === 'confirm') {
      speak(language.emergencyConfirmationPrompt);
    }
    if (phase === 'yellow') {
      speak(language.yellowTierPrompt);
    }
    if (phase === 'simulated') {
      speak(language.simulatedEscalationPrompt);
    }
    if (phase === 'cancelled') {
      speak(language.cancelledPrompt);
    }
  }, [phase, language, speechRate, voiceVolume]);

  // Countdown accessibility announcements
  useEffect(() => {
    if (phase === 'countdown' && [10, 5, 3, 2, 1, 0].includes(countdown)) {
      AccessibilityInfo.announceForAccessibility(`${countdown} seconds remaining in the emergency demo.`);
    }
  }, [countdown, phase]);

  // Countdown timer
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown === 0) {
      handleDispatch();
      return;
    }
    const timer = setTimeout(() => setCountdown(current => current - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, countdown]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function stopAlert() {
    Speech.stop();
    Vibration.cancel();
  }

  function handleDispatch() {
    stopAlert();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPhase('simulated');
  }

  function handleCancel() {
    stopAlert();
    setPhase('cancelled');
  }

  function handlePainScore(score: number) {
    setPainScore(score);
    if (score >= 8) {
      stopAlert();
      setPhase('confirm');
    } else {
      stopAlert();
      setPhase('yellow');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (phase === 'simulated') {
    return (
      <View style={styles.dispatchedScreen}>
        <Text style={styles.dispatchedIcon}>⚠</Text>
        <Text style={styles.dispatchedTitle}>{copy.simulatedEscalation}</Text>
        <Text style={styles.dispatchedSub}>{copy.simulatedNoAction}</Text>
        <TouchableOpacity style={styles.confirmBtn} onPress={onExit} accessibilityRole="button" accessibilityLabel={copy.returnHome}>
          <Text style={styles.confirmBtnText}>{copy.returnHome}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'yellow') {
    return (
      <View style={styles.yellowScreen}>
        <Text style={styles.dispatchedTitle}>{copy.yellowTier}</Text>
        <Text style={styles.dispatchedSub}>{copy.yellowTierExplanation}</Text>
        <TouchableOpacity style={styles.confirmBtn} onPress={onExit} accessibilityRole="button" accessibilityLabel={copy.returnHome}>
          <Text style={styles.confirmBtnText}>{copy.returnHome}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'cancelled') {
    return (
      <View style={styles.cancelledScreen}>
        <Text style={styles.cancelledIcon}>✔</Text>
        <Text style={styles.cancelledTitle}>{copy.cancelled}</Text>
        <Text style={styles.cancelledSub}>{copy.noCall}</Text>
        <TouchableOpacity style={styles.confirmBtn} onPress={onExit} accessibilityRole="button" accessibilityLabel={copy.returnHome}>
          <Text style={styles.confirmBtnText}>{copy.returnHome}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      {/* Header */}
      <Text style={[styles.alertLabel, { fontSize: 36 * fontScale }]}>{copy.alertTitle}</Text>
      <Text style={styles.demoNotice}>{copy.promptLanguage(language.label)}</Text>
      <Text style={[styles.alertSub, { fontSize: 18 * fontScale }]}>
        {phase === 'confirm' ? language.emergencyConfirmationPrompt : copy.emergencyQuestion}
      </Text>
      <Text style={styles.demoNotice}>{copy.demoOnlyNotice}</Text>
      <TouchableOpacity style={styles.repeatPromptBtn} onPress={() => {
        speak(language.emergencyPrompt);
      }} accessibilityRole="button" accessibilityLabel={copy.repeatPrompt}>
        <Text style={styles.confirmBtnText}>{copy.repeatPrompt}</Text>
      </TouchableOpacity>

      {/* Countdown */}
      <Animated.View style={[
        styles.countdownBox,
        countdown <= 3 && styles.countdownBoxUrgent,
        { transform: [{ scale: pulseAnim }] },
      ]}>
        <Text style={[styles.countdownNumber, countdown <= 3 && styles.countdownNumberUrgent, { fontSize: 72 * fontScale }]}>{countdown}</Text>
        <Text style={[styles.countdownLabel, { fontSize: 14 * fontScale }]}>{copy.secondsRemaining(countdown)}</Text>
      </Animated.View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={handleCancel}
          accessibilityRole="button"
          accessibilityLabel={copy.noCancel}
        >
          <Text style={styles.cancelBtnText}>{copy.noCancel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.confirmBtn}
          onPress={phase === 'confirm' ? handleDispatch : () => setPhase('confirm')}
          accessibilityRole="button"
          accessibilityLabel={phase === 'confirm' ? copy.yesSimulate : copy.yesAmbulance}
        >
          <Text style={styles.confirmBtnText}>{phase === 'confirm' ? copy.yesSimulate : copy.yesAmbulance}</Text>
        </TouchableOpacity>
      </View>

      {/* Pain Score */}
      <Text style={[styles.painLabel, { fontSize: 16 * fontScale }]}>{copy.painScale}</Text>
      <View style={styles.painRow}>
        {[1,2,3,4,5,6,7,8,9,10].map(score => (
          <TouchableOpacity
            key={score}
            style={[styles.painBtn, painScore === score && styles.painBtnSelected]}
            onPress={() => handlePainScore(score)}
            accessibilityRole="button"
            accessibilityLabel={`${copy.painScore(score)}. ${score >= 8 ? copy.yesSimulate : copy.yellowTier}`}
          >
            <Text style={styles.painBtnText}>{score}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={[styles.painHint, { fontSize: 12 * fontScale }]}>{copy.painHint}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  yellowScreen: {
    flex: 1,
    backgroundColor: '#082f49',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 18,
  },
  demoNotice: {
    color: '#fff4c2',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 22,
  },
  repeatPromptBtn: {
    minHeight: 56,
    backgroundColor: '#1d4ed8',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  screen: {
    flex: 1,
    backgroundColor: '#140900',
    padding: 24,
  },
  screenContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  alertLabel: {
    color: '#ffcc00',
    fontSize: 36,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 2,
    marginBottom: 12,
  },
  alertSub: {
    color: '#ffffff',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 26,
  },
  countdownBox: {
    backgroundColor: '#211500',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginBottom: 18,
    borderWidth: 3,
    borderColor: '#facc15',
  },
  countdownBoxUrgent: {
    backgroundColor: '#2b0909',
    borderColor: '#ff453a',
  },
  countdownNumber: {
    color: '#facc15',
    fontSize: 72,
    fontWeight: '900',
  },
  countdownNumberUrgent: {
    color: '#ff453a',
  },
  countdownLabel: {
    color: '#ffcccc',
    fontSize: 14,
    marginTop: 4,
  },
  painLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  painRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  painBtn: {
    backgroundColor: '#3a0000',
    borderRadius: 8,
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#ff4444',
  },
  painBtnSelected: {
    backgroundColor: '#ff0000',
  },
  painBtnText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  painHint: {
    color: '#ffaaaa',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 28,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginTop: 12,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#b45309',
    borderRadius: 10,
    padding: 14,
    minHeight: 78,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fbbf24',
  },
  cancelBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: '#cc0000',
    borderRadius: 10,
    padding: 14,
    minHeight: 78,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ff4444',
  },
  confirmBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  dispatchedScreen: {
    flex: 1,
    backgroundColor: '#cc0000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  dispatchedIcon: {
    fontSize: 80,
    marginBottom: 20,
  },
  dispatchedTitle: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 16,
  },
  dispatchedSub: {
    color: '#ffcccc',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 26,
  },
  cancelledScreen: {
    flex: 1,
    backgroundColor: '#001a0e',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  cancelledIcon: {
    fontSize: 80,
    marginBottom: 20,
  },
  cancelledTitle: {
    color: '#00ff88',
    fontSize: 32,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 16,
  },
  cancelledSub: {
    color: '#88ffcc',
    fontSize: 18,
    textAlign: 'center',
  },
});
