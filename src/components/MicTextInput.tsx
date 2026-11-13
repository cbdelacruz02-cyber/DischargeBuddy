/**
 * MicTextInput — ST-1 Universal Accessibility
 * Rounded text input with an embedded 🎤 icon on the right.
 * Tapping the icon starts / stops voice recognition.
 */
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ViewStyle,
  type TextStyle,
} from 'react-native';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onMicPress: () => void;
  isListening: boolean;
  placeholder?: string;
  placeholderTextColor?: string;
  /** Container override */
  style?: ViewStyle;
  /** Text style override */
  inputStyle?: TextStyle;
  accessibilityLabel?: string;
  autoFocus?: boolean;
};

export function MicTextInput({
  value,
  onChangeText,
  onMicPress,
  isListening,
  placeholder = 'Speak or type…',
  placeholderTextColor = '#64748b',
  style,
  inputStyle,
  accessibilityLabel = 'Text input with microphone',
  autoFocus = false,
}: Props) {
  return (
    <View style={[styles.container, style]}>
      <TextInput
        style={[styles.input, inputStyle]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        accessibilityLabel={accessibilityLabel}
        autoFocus={autoFocus}
        multiline={false}
        returnKeyType="done"
      />
      <TouchableOpacity
        style={[styles.micBtn, isListening && styles.micBtnActive]}
        onPress={onMicPress}
        accessibilityRole="button"
        accessibilityLabel={isListening ? 'Stop microphone' : 'Start microphone'}
        accessibilityState={{ selected: isListening }}
      >
        <Text style={styles.micIcon}>🎤</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#334155',
    paddingLeft: 12,
    minHeight: 52,
  },
  input: {
    flex: 1,
    color: '#f1f5f9',
    fontSize: 16,
    paddingVertical: 10,
    paddingRight: 4,
  },
  micBtn: {
    width: 48,
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 2,
  },
  micBtnActive: {
    backgroundColor: '#7f1d1d',
  },
  micIcon: {
    fontSize: 22,
  },
});
