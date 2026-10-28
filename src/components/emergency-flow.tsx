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
  
  // FIX: Tracks the current talking phase so it doesn't double-fire or loop
  const spokenPhase = useRef<string | null>(null);

  // FIX: Gains the replace variable so it queues instead of cutting out audio streams
  const speak = useCallback((text: string, replace = false) => {
    AccessibilityInfo.announceForAccessibility(text);
    const startSpeech = () => Speech.speak(text, {
      language: language.code,
      rate: speechRate,
      volume: voiceVolume,
    });
    if (replace) {
      void Speech.stop().then(startSpeech, startSpeech);
    } else {
      startSpeech();
    }
  }, [language.code, speechRate, voiceVolume]);

  useEffect(() => {
    speak(language.emergencyPrompt);
    return () => {
      Speech.stop();
      Vibration.cancel();
    };
  }, [language.code, language.emergencyPrompt, speak]);

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

  // FIX: Only triggers voice prompts ONCE per phase change, stopping timing collisions!
  useEffect(() => {
    if (spokenPhase.current === phase) return;
    spokenPhase.current = phase;

    if (phase === 'pain') speak(`${copy.painScale} ${copy.painHint} ${copy.noResponseDemo}`);
    if (phase === 'countdown') speak(language.emergencyConfirmationPrompt);
    if (phase === 'yellow') speak(language.yellowTierPrompt);
    if (phase === 'simulated') speak(language.simulatedEscalationPrompt);
    if (phase === 'cancelled') speak(language.cancelledPrompt);
  }, [phase, language.code, copy.painScale, copy.painHint, copy.noResponseDemo, speak]);

  useEffect(() => {
    if ((phase === 'pain' || phase === 'countdown') && [10, 5, 3, 2, 1, 0].includes(countdown)) {
      AccessibilityInfo.announceForAccessibility(copy.secondsRemaining(countdown));
    }
  }, [countdown, phase, copy]);

  useEffect(() => {
    if (phase === 'pause') {
      if (pauseSeconds === 0) {
        spokenPhase.current = null;
        setCountdown(10);
        setPhase('pain');
        return;
      }
      const pauseTimer = setTimeout(() => setPauseSeconds(value => value - 1), 1000);
      return () => clearTimeout(pauseTimer);
    }
    if (phase !== 'pain' && phase !== 'countdown') return;
    if (countdown === 0) {
      spokenPhase.current = null;
      setPhase('simulated');
      return;
    }
    const timer = setTimeout(() => setCountdown(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, phase, pauseSeconds]);

  const cancel = () => {
    spokenPhase.current = null;
    Speech.stop();
    Vibration.cancel();
    setPhase('cancelled');
  };

  const confirm = () => {
    spokenPhase.current = null;
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
          // FIX: Intentionally interrupts audio streams when requested by user click
          onPress={() => speak(language.emergencyPrompt, true)}
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
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, alignItems: 'center' },
  title: { fontWeight: 'bold', color: '#1a1a1a', textAlign: 'center', marginBottom: 10 },
  language: { fontSize: 14, color: '#666', marginBottom: 20 },
  prompt: { textAlign: 'center', color: '#333', marginBottom: 15, lineHeight: 26 },
  demoNotice: { fontSize: 12, color: '#999', marginBottom: 25, textAlign: 'center' },
  repeatButton: { padding: 12, backgroundColor: '#f0f0f0', borderRadius: 8, marginBottom: 30 },
  actionText: { color: '#007aff', fontWeight: '600' },
  pauseBox: { alignItems: 'center', marginTop: 20 },
  countdown: { alignItems: 'center', marginTop: 20, padding: 20, borderRadius: 100, backgroundColor: '#fdf3e7', width: 160, height: 160, justifyContent: 'center' },
  countdownUrgent: { backgroundColor: '#fce8e6' },
  countdownNumber: { fontWeight: 'bold', color: '#e67e22' },
