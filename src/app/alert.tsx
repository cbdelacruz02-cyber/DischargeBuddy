import type { LanguageLabel } from '@/constants/safety-content';
import { EmergencyFlow } from '@/components/emergency-flow';
import { useAppLanguage } from '@/contexts/language-context';
import { router, useLocalSearchParams } from 'expo-router';

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
      speechRate={Number(params.speechRate) || 0.65}
      onClose={() => router.back()}
    />
  );
}
