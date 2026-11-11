/**
 * useVoiceRecognition — reusable cross-platform speech-to-text hook
 *
 * • Web:    uses window.SpeechRecognition / window.webkitSpeechRecognition
 *           in continuous mode, switching language dynamically.
 * • Native: uses expo-speech-recognition with requiresOnDeviceRecognition=true
 *           so it works fully offline; falls back gracefully if unavailable.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

export type UseVoiceRecognitionOptions = {
  /** BCP-47 language code, e.g. 'en-US', 'es-ES', 'ja-JP' */
  languageCode: string;
  /** Called each time a result arrives (isFinal = true means confirmed word) */
  onResult?: (text: string, isFinal: boolean) => void;
  /** Called on any recognition error */
  onError?: (error: string) => void;
};

export type UseVoiceRecognitionReturn = {
  isListening: boolean;
  transcript: string;
  startListening: () => void;
  stopListening: () => void;
  clearTranscript: () => void;
  supported: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Web SpeechRecognition type shim
// ─────────────────────────────────────────────────────────────────────────────
type WebSpeechResult = { [key: number]: { transcript: string }; isFinal: boolean };
type WebSpeechResultEvent = {
  results: { [key: number]: WebSpeechResult };
  resultIndex: number;
};
type WebSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: WebSpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => WebSpeechRecognition;
    webkitSpeechRecognition?: new () => WebSpeechRecognition;
  }
}

function getWebSpeechClass(): (new () => WebSpeechRecognition) | null {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────
export function useVoiceRecognition({
  languageCode,
  onResult,
  onError,
}: UseVoiceRecognitionOptions): UseVoiceRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript,  setTranscript]  = useState('');
  // Lazy initializer: check support synchronously on first render, never updates after mount
  const [supported] = useState<boolean>(() => {
    if (Platform.OS === 'web') {
      return !!getWebSpeechClass();
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ExpoSpeechRecognitionModule: M } = require('expo-speech-recognition') as typeof import('expo-speech-recognition');
      return M.isRecognitionAvailable();
    } catch {
      return false;
    }
  });

  const onResultRef    = useRef(onResult);
  const onErrorRef     = useRef(onError);
  const userStoppedRef = useRef(false);
  const webRecRef      = useRef<WebSpeechRecognition | null>(null);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { onErrorRef.current  = onError;  }, [onError]);

  // ── Check support (lazy initializer — avoids setting state in an effect) ──
  // Using a function inside useState initial value runs synchronously once.
  // No effect needed because this never changes after mount.
  // (The `supported` useState below uses a lazy initializer instead.)

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (Platform.OS === 'web') {
        webRecRef.current?.abort();
        webRecRef.current = null;
      } else {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { ExpoSpeechRecognitionModule: M } = require('expo-speech-recognition') as typeof import('expo-speech-recognition');
          M.abort();
        } catch { /* ignore */ }
      }
    };
  }, []);

  // ── Native event subscription ─────────────────────────────────────────────
  // This effect runs only on native. On web, the require will succeed but
  // useSpeechRecognitionEvent won't be called because we return early.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let resultUnsub: (() => void) | undefined;
    let errorUnsub:  (() => void) | undefined;
    let endUnsub:    (() => void) | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ExpoSpeechRecognitionModule: M } = require('expo-speech-recognition') as typeof import('expo-speech-recognition');
      const resultSub = M.addListener('result', (event: import('expo-speech-recognition').ExpoSpeechRecognitionResultEvent) => {
        const text = event.results?.[0]?.transcript ?? '';
        if (text) {
          setTranscript(t => t ? `${t} ${text}` : text);
          onResultRef.current?.(text, event.isFinal ?? true);
        }
      });
      const errorSub = M.addListener('error', (event: import('expo-speech-recognition').ExpoSpeechRecognitionErrorEvent) => {
        const msg = event.message ?? event.error ?? 'Unknown error';
        onErrorRef.current?.(msg);
        setIsListening(false);
      });
      const endSub = M.addListener('end', () => {
        setIsListening(false);
      });
      resultUnsub = () => resultSub.remove();
      errorUnsub  = () => errorSub.remove();
      endUnsub    = () => endSub.remove();
    } catch { /* module not available */ }
    return () => {
      resultUnsub?.();
      errorUnsub?.();
      endUnsub?.();
    };
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // startListening
  // ─────────────────────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    setTranscript('');
    userStoppedRef.current = false;

    if (Platform.OS === 'web') {
      const Cls = getWebSpeechClass();
      if (!Cls) return;
      webRecRef.current?.abort();
      webRecRef.current = null;

      const rec = new Cls();
      rec.lang            = languageCode;
      rec.continuous      = true;
      rec.interimResults  = true;
      rec.maxAlternatives = 1;

      rec.onresult = (event: WebSpeechResultEvent) => {
        let finalText = '', interim = '';
        const n = Object.keys(event.results).length;
        for (let i = event.resultIndex; i < n; i++) {
          const r = event.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else           interim   += r[0].transcript;
        }
        const text = finalText || interim;
        if (text) {
          setTranscript(t => t ? `${t} ${text}` : text);
          onResultRef.current?.(text, !!finalText);
        }
      };
      rec.onerror = (event: { error: string }) => {
        if (event.error !== 'no-speech') onErrorRef.current?.(event.error);
        setIsListening(false);
      };
      rec.onend = () => {
        if (!userStoppedRef.current && webRecRef.current) {
          try { rec.start(); } catch { setIsListening(false); }
        } else {
          setIsListening(false);
        }
      };
      webRecRef.current = rec;
      try { rec.start(); setIsListening(true); }
      catch { onErrorRef.current?.('Could not start microphone.'); }

    } else {
      // Native
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { ExpoSpeechRecognitionModule: M } = require('expo-speech-recognition') as typeof import('expo-speech-recognition');
        M.requestPermissionsAsync().then(() => {
          try {
            M.start({
              lang: languageCode,
              interimResults: true,
              maxAlternatives: 1,
              requiresOnDeviceRecognition: true,
              addsPunctuation: false,
              contextualStrings: ['help', 'yes', 'no', 'cancel', 'ambulance'],
            });
            setIsListening(true);
          } catch {
            // Fallback without on-device
            try {
              M.start({ lang: languageCode, interimResults: true, maxAlternatives: 1, requiresOnDeviceRecognition: false, addsPunctuation: false });
              setIsListening(true);
            } catch (e2) { onErrorRef.current?.((e2 as Error).message ?? 'Mic unavailable'); }
          }
        }).catch((err: Error) => { onErrorRef.current?.(err.message ?? 'Permission denied'); });
      } catch { onErrorRef.current?.('expo-speech-recognition not available'); }
    }
  }, [languageCode]);

  // ─────────────────────────────────────────────────────────────────────────
  // stopListening
  // ─────────────────────────────────────────────────────────────────────────
  const stopListening = useCallback(() => {
    userStoppedRef.current = true;
    if (Platform.OS === 'web') {
      webRecRef.current?.stop();
      webRecRef.current = null;
      setIsListening(false);
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { ExpoSpeechRecognitionModule: M } = require('expo-speech-recognition') as typeof import('expo-speech-recognition');
        M.stop();
      } catch { /* ignore */ }
      setIsListening(false);
    }
  }, []);

  const clearTranscript = useCallback(() => setTranscript(''), []);

  return { isListening, transcript, startListening, stopListening, clearTranscript, supported };
}
