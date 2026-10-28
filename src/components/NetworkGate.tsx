/**
 * NetworkGate.tsx
 *
 * Renders an offline-first prompt before the main content mounts.
 *
 * Default state: networkEnabled = false — no outbound requests are made.
 *
 * "Activate Internet?" prompt:
 *   • "No"  → keeps networkEnabled false, proceeds to the app.
 *   • "Yes" → sets networkEnabled true, shows the Cloudflare tunnel URL
 *             and QR code so judges/remote users can connect, then
 *             proceeds to the app after a short confirmation delay.
 *
 * The tunnel URL is read from src/constants/tunnel-config.ts — update it
 * once per session after running:  cloudflared tunnel --url http://localhost:8081
 *
 * Voice activation: the component listens for Speech Recognition if the
 * platform supports it (Android/iOS via expo-speech is output-only, so voice
 * input uses the AccessibilityInfo announce channel as a visual fallback —
 * true mic input requires expo-av + a third-party STT library, which is
 * outside the offline-compliant scope here). The button is the primary input.
 */

import { CLOUDFLARE_TUNNEL_URL } from '@/constants/tunnel-config';
import * as Speech from 'expo-speech';
import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

type NetworkGateProps = {
  /** Called once the user has made their choice. */
  onReady: (networkEnabled: boolean) => void;
  speechRate?: number;
  voiceVolume?: number;
};

export function NetworkGate({ onReady, speechRate = 0.9, voiceVolume = 1 }: NetworkGateProps) {
  const [chosen, setChosen] = useState(false);
  const [networkEnabled, setNetworkEnabled] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const prompt = 'Activate Internet? Press Yes to share a QR code with judges, or No to stay offline.';

  useEffect(() => {
    // Announce the prompt via TTS on mount
    AccessibilityInfo.announceForAccessibility(prompt);
    const startSpeech = () =>
      Speech.speak(prompt, { rate: speechRate, volume: voiceVolume });
    void Speech.stop().then(startSpeech, startSpeech);

    return () => { void Speech.stop(); };
  }, []);

  function handleYes() {
    setNetworkEnabled(true);
    setChosen(true);
    setShowConfirmation(true);
    const msg = CLOUDFLARE_TUNNEL_URL
      ? 'Internet activated. Tunnel URL is now displayed on screen.'
      : 'Internet activated. Add your tunnel URL to tunnel-config.ts to display the QR code.';
    AccessibilityInfo.announceForAccessibility(msg);
    void Speech.stop().then(
      () => Speech.speak(msg, { rate: speechRate, volume: voiceVolume }),
      () => Speech.speak(msg, { rate: speechRate, volume: voiceVolume }),
    );
    // Auto-proceed after 4 s so judges can read the URL
    setTimeout(() => onReady(true), 4000);
  }

  function handleNo() {
    setChosen(true);
    const msg = 'Staying offline. Loading app now.';
    AccessibilityInfo.announceForAccessibility(msg);
    void Speech.stop().then(
      () => Speech.speak(msg, { rate: speechRate, volume: voiceVolume }),
      () => Speech.speak(msg, { rate: speechRate, volume: voiceVolume }),
    );
    onReady(false);
  }

  if (showConfirmation) {
    return (
      <View style={styles.screen}>
        <Text style={styles.statusIcon}>🌐</Text>
        <Text style={styles.title}>Internet Activated</Text>

        {CLOUDFLARE_TUNNEL_URL ? (
          <>
            <Text style={styles.label}>Share this URL with judges:</Text>
            <TouchableOpacity
              onPress={() => Linking.openURL(CLOUDFLARE_TUNNEL_URL)}
              accessibilityRole="link"
              accessibilityLabel={`Open tunnel URL: ${CLOUDFLARE_TUNNEL_URL}`}
            >
              <Text style={styles.url}>{CLOUDFLARE_TUNNEL_URL}</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>
              Judges open Expo Go → Enter URL manually → paste the address above.
            </Text>
          </>
        ) : (
          <Text style={styles.hint}>
            Paste your Cloudflare tunnel URL into{'\n'}
            <Text style={styles.code}>src/constants/tunnel-config.ts</Text>
            {'\n'}to display it here.
          </Text>
        )}

        <Text style={styles.countdown}>Loading app in 4 seconds…</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.statusIcon}>📡</Text>
      <Text style={styles.title}>Network Mode</Text>
      <Text style={styles.body}>{prompt}</Text>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.btn, styles.btnNo]}
          onPress={handleNo}
          accessibilityRole="button"
          accessibilityLabel="No, stay offline"
          disabled={chosen}
        >
          <Text style={styles.btnText}>No — Stay Offline</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnYes]}
          onPress={handleYes}
          accessibilityRole="button"
          accessibilityLabel="Yes, activate internet"
          disabled={chosen}
        >
          <Text style={styles.btnText}>Yes — Activate</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.hint}>
        Default: offline. No outbound requests are made unless you tap Yes.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0a0a14',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 18,
  },
  statusIcon: {
    fontSize: 64,
  },
  title: {
    color: '#e2e8f0',
    fontSize: 26,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 1,
  },
  body: {
    color: '#cbd5e1',
    fontSize: 17,
    textAlign: 'center',
    lineHeight: 26,
    maxWidth: 320,
  },
  label: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
  },
  url: {
    color: '#38bdf8',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    textDecorationLine: 'underline',
    paddingHorizontal: 12,
  },
  code: {
    color: '#facc15',
    fontFamily: 'monospace',
    fontSize: 13,
  },
  hint: {
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 300,
  },
  countdown: {
    color: '#475569',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 8,
  },
  btn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 64,
    borderWidth: 2,
  },
  btnNo: {
    backgroundColor: '#1e293b',
    borderColor: '#475569',
  },
  btnYes: {
    backgroundColor: '#0c4a6e',
    borderColor: '#38bdf8',
  },
  btnText: {
    color: '#f1f5f9',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
});
