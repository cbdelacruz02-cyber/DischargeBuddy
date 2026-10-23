import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { useEffect, useRef, useState } from 'react';
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

type EmergencyFlowProps = {
  languageLabel: LanguageLabel;
  fontScale: number;
  soundLevel: number;
  speechRate: number;
  onClose: () => void;
};

export function EmergencyFlow({ languageLabel, fontScale, soundLevel, speechRate, onClose }: EmergencyFlowProps) {
  const language = getLanguage(languageLabel);
  const copy = getUiCopy(languageLabel);
  const voiceVolume = Math.min(1, Math.max(0, soundLevel / 100));
  const textScale = Math.min(1.75, Math.max(1.25, fontScale));
  const [countdown, setCountdown] = useState(10);
  const [pauseSeconds, setPauseSeconds] = useState(2);
  const [phase, setPhase] = useState<'pause' | 'pain' | 'countdown' | 'yellow' | 'simulated' | 'cancelled'>('pause');
  const [painScore, setPainScore] = useState<number | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const frameFlash = useRef(new Animated.Value(0.2)).current;

  const speak = (text: string) => {
    AccessibilityInfo.announceForAccessibility(text);
    const startSpeech = () => Speech.speak(text, {
      language: language.code,
      rate: speechRate,
      volume: voiceVolume,
    });
    void Speech.stop().then(startSpeech, startSpeech);
  };

  useEffect(() => {
    speak(language.emergencyPrompt);
    return () => {
      Speech.stop();
      Vibration.cancel();
    };
  }, [language.code, language.emergencyPrompt]);

  useEffect(() => {
    if (phase === 'pause') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Vibration.vibrate([0, 300, 200, 300]);
    }
    if (phase === 'pain' || phase === 'countdown') {
      const vibration = setInterval(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        Vibration.vibrate([0, 250, 150, 250]);
      }, 1200);
      return () => {
        clearInterval(vibration);
        Vibration.cancel();
      };
    }
  }, [phase]);

  useEffect(() => {
    if (phase === 'pause' && [2, 1, 0].includes(pauseSeconds)) {
      AccessibilityInfo.announceForAccessibility(`${pauseSeconds} second safety pause.`);
    }
  }, [pauseSeconds, phase]);

  useEffect(() => {
    if ((phase !== 'pain' && phase !== 'countdown') || countdown > 3) {
      pulse.setValue(1);
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.12, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [countdown, phase, pulse]);

  useEffect(() => {
    if (phase !== 'pause' && phase !== 'pain' && phase !== 'countdown') {
      frameFlash.setValue(0);
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(frameFlash, { toValue: 0.9, duration: 650, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(frameFlash, { toValue: 0.2, duration: 650, easing: Easing.linear, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [frameFlash, phase]);

  useEffect(() => {
    if (phase === 'pain') speak(`${copy.painScale} ${copy.painHint} ${copy.noResponseDemo}`);
    if (phase === 'countdown') speak(language.emergencyConfirmationPrompt);
    if (phase === 'yellow') speak(language.yellowTierPrompt);
    if (phase === 'simulated') speak(language.simulatedEscalationPrompt);
    if (phase === 'cancelled') speak(language.cancelledPrompt);
  }, [phase, language.code, pauseSeconds, copy.painScale, copy.painHint, copy.noResponseDemo]);

  useEffect(() => {
    if ((phase === 'pain' || phase === 'countdown') && [10, 5, 3, 2, 1, 0].includes(countdown)) {
      AccessibilityInfo.announceForAccessibility(copy.secondsRemaining(countdown));
    }
  }, [countdown, phase, copy]);

  useEffect(() => {
    if (phase === 'pause') {
      if (pauseSeconds === 0) {
        setCountdown(10);
        setPhase('pain');
        return;
      }
      const pauseTimer = setTimeout(() => setPauseSeconds(value => value - 1), 1000);
      return () => clearTimeout(pauseTimer);
    }
    if (phase !== 'pain' && phase !== 'countdown') return;
    if (countdown === 0) {
      setPhase('simulated');
      return;
    }
    const timer = setTimeout(() => setCountdown(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, phase]);

  const cancel = () => {
    Speech.stop();
    Vibration.cancel();
    setPhase('cancelled');
  };

  const confirm = () => {
    Speech.stop();
    Vibration.cancel();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPhase('simulated');
  };

  const showStatus = phase === 'yellow' || phase === 'simulated' || phase === 'cancelled';
  if (showStatus) {
    const title = phase === 'yellow'
      ? copy.yellowTier
      : phase === 'simulated'
        ? copy.simulatedEscalation
        : copy.cancelled;
    const message = phase === 'yellow'
      ? copy.yellowTierExplanation
      : phase === 'simulated'
        ? copy.simulatedNoAction
        : copy.noCall;

    return (
      <SafeAreaView style={[styles.statusScreen, phase === 'yellow' && styles.yellowScreen]}>
        <Text style={[styles.statusTitle, { fontSize: 28 * textScale }]}>{title}</Text>
        <Text style={[styles.statusBody, { fontSize: 18 * textScale }]}>{message}</Text>
        <TouchableOpacity style={styles.exitButton} onPress={onClose} accessibilityRole="button" accessibilityLabel={copy.returnHome}>
          <Text style={[styles.actionText, { fontSize: 18 * textScale }]}>{copy.returnHome}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[
      styles.safe,
      (phase === 'pause' || phase === 'pain') && styles.amberScreen,
      phase === 'countdown' && styles.redScreen,
    ]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { fontSize: 27 * textScale }]}>{copy.alertTitle}</Text>
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
          onPress={() => speak(language.emergencyPrompt)}
          accessibilityRole="button"
          accessibilityLabel={copy.repeatPrompt}
        >
          <Text style={[styles.actionText, { fontSize: 17 * textScale }]}>{copy.repeatPrompt}</Text>
        </TouchableOpacity>

        {phase === 'pause' && (
          <View style={styles.pauseBox}>
            <Text style={[styles.countdownNumber, { fontSize: 66 * textScale }]}>{pauseSeconds}</Text>
            <Text style={[styles.countdownLabel, { fontSize: 16 * textScale }]}>{copy.safetyPause(pauseSeconds)}</Text>
          </View>
        )}

        {phase === 'pain' && (
          <>
            <Animated.View style={[
              styles.countdown,
              countdown <= 3 && styles.countdownUrgent,
              { transform: [{ scale: pulse }] },
            ]}>
              <Text style={[styles.countdownNumber, countdown <= 3 && styles.countdownNumberUrgent, { fontSize: 60 * textScale }]}>
                {countdown}
              </Text>
              <Text style={[styles.countdownLabel, { fontSize: 15 * textScale }]}>{copy.secondsRemaining(countdown)}</Text>
            </Animated.View>
            <Text style={[styles.painHint, { fontSize: 16 * textScale }]}>{copy.painHint}</Text>
            <View style={styles.painGrid}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(score => (
                <TouchableOpacity
                  key={score}
                  style={[styles.painButton, painScore === score && styles.painSelected]}
                  onPress={() => {
                    setPainScore(score);
                    Haptics.selectionAsync();
                    setCountdown(10);
                    setPhase(score >= 8 ? 'countdown' : 'yellow');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={copy.painScore(score)}
                >
                  <Text style={[styles.painButtonText, { fontSize: 18 * textScale }]}>{score}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.demoNotice, { fontSize: 15 * textScale }]}>{copy.scoreThreshold}</Text>
            <TouchableOpacity
              style={styles.yesButton}
              onPress={() => {
                setCountdown(10);
                setPhase('countdown');
              }}
              accessibilityRole="button"
              accessibilityLabel={copy.yesAmbulance}
            >
              <Text style={[styles.actionText, { fontSize: 17 * textScale }]}>{copy.yesAmbulance}</Text>
            </TouchableOpacity>
          </>
        )}

        {phase === 'countdown' && (
          <>
            <Animated.View style={[
              styles.countdown,
              countdown <= 3 && styles.countdownUrgent,
              { transform: [{ scale: pulse }] },
            ]}>
              <Text style={[styles.countdownNumber, countdown <= 3 && styles.countdownNumberUrgent, { fontSize: 66 * textScale }]}>
                {countdown}
              </Text>
              <Text style={[styles.countdownLabel, { fontSize: 16 * textScale }]}>{copy.secondsRemaining(countdown)}</Text>
            </Animated.View>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.noButton} onPress={cancel} accessibilityRole="button" accessibilityLabel={copy.noCancel}>
                <Text style={[styles.actionText, { fontSize: 17 * textScale }]}>{copy.noCancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.yesButton} onPress={confirm} accessibilityRole="button" accessibilityLabel={copy.yesSimulate}>
                <Text style={[styles.actionText, { fontSize: 17 * textScale }]}>{copy.yesSimulate}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {(phase === 'pause' || phase === 'pain') && (
          <TouchableOpacity style={styles.noButton} onPress={cancel} accessibilityRole="button" accessibilityLabel={copy.noCancel}>
            <Text style={[styles.actionText, { fontSize: 17 * textScale }]}>{copy.noCancel}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#140900' },
  amberScreen: { backgroundColor: '#211900' },
  redScreen: { backgroundColor: '#210808' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingBottom: 32, gap: 14 },
  title: { color: '#facc15', textAlign: 'center', fontWeight: '900' },
  language: { color: '#ffffff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  prompt: { color: '#ffffff', textAlign: 'center', lineHeight: 27, fontWeight: '700' },
  demoNotice: { color: '#fff4c2', textAlign: 'center', fontSize: 15, lineHeight: 22, fontWeight: '800' },
  emergencyFrame: { ...StyleSheet.absoluteFillObject, borderWidth: 12, borderRadius: 12 },
  amberFrame: { borderColor: '#facc15' },
  redFrame: { borderColor: '#ff453a' },
  repeatButton: { minHeight: 60, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1d4ed8', borderRadius: 10, padding: 14 },
  pauseBox: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#211500', borderColor: '#facc15', borderWidth: 3, borderRadius: 10, padding: 18, gap: 8 },
  actionText: { color: '#ffffff', fontWeight: '900', textAlign: 'center' },
  countdown: { alignItems: 'center', backgroundColor: '#211500', borderColor: '#facc15', borderWidth: 3, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20 },
  countdownUrgent: { backgroundColor: '#2b0909', borderColor: '#ff453a' },
  countdownNumber: { color: '#facc15', fontWeight: '900' },
  countdownNumberUrgent: { color: '#ff453a' },
  countdownLabel: { color: '#ffffff', textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10 },
  noButton: { flex: 1, minHeight: 76, justifyContent: 'center', backgroundColor: '#854d0e', borderColor: '#facc15', borderWidth: 3, borderRadius: 10, padding: 12 },
  yesButton: { flex: 1, minHeight: 76, justifyContent: 'center', backgroundColor: '#b91c1c', borderColor: '#ffffff', borderWidth: 3, borderRadius: 10, padding: 12 },
  painPrompt: { color: '#ffffff', textAlign: 'center', fontWeight: '800' },
  painGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  painButton: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: '#242424', borderColor: '#facc15', borderWidth: 2, borderRadius: 8 },
  painSelected: { backgroundColor: '#9a3412' },
  painButtonText: { color: '#ffffff', fontWeight: '800' },
  painHint: { color: '#ffaaaa', textAlign: 'center', lineHeight: 22 },
  statusScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 18, backgroundColor: '#111111' },
  yellowScreen: { backgroundColor: '#082f49' },
  statusTitle: { color: '#facc15', fontWeight: '900', textAlign: 'center' },
  statusBody: { color: '#ffffff', textAlign: 'center', lineHeight: 28 },
  exitButton: { alignSelf: 'stretch', minHeight: 62, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1d4ed8', borderRadius: 10, padding: 14 },
});
