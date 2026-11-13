import type { LanguageLabel } from '@/constants/safety-content';

export type UiCopy = {
  homeTab: string;
  exploreTab: string;
  welcomeBack: string;
  condition: string;
  medications: string;
  medsComplete: (taken: number, total: number) => string;
  dueAt: (time: string) => string;
  markTaken: string;
  taken: string;
  takenDone: string;
  remindMe: string;
  reminderOn: string;
  nextAppointment: string;
  doctor: string;
  appointmentLocation: string;
  cancelReminder: string;
  moveOneDay: string;
  appointmentDateChanged: string;
  offlineSample: string;
  help: string;
  helpSubtitle: string;
  moreTools: string;
  hideTools: string;
  accessibilityControls: string;
  foregroundReminderNote: string;
  testReminder: string;
  cancelTestReminder: string;
  highContrast: string;
  fontSize: (percent: number) => string;
  voiceVolume: (percent: number) => string;
  voicePace: (pace: string) => string;
  language: string;
  currentLanguage: (language: string) => string;
  chooseLanguage: string;
  detectionSimulationNote: string;
  simulateLanguage: string;
  confirmationChoices: string;
  candidateLanguage: (language: string) => string;
  confirmLanguageFirst: string;
  rejectLanguageFirst: string;
  fallbackThreeAttempts: string;
  speakEmergencyScript: string;
  emergencyDemo: string;
  noCall: string;
  educationEyebrow: string;
  recoveryGuide: string;
  educationSubtitle: string;
  dischargeInstructions: string;
  readAloud: string;
  guardrail: string;
  guardrailBody: string;
  alertTitle: string;
  promptLanguage: (language: string) => string;
  emergencyQuestion: string;
  demoOnlyNotice: string;
  repeatPrompt: string;
  secondsRemaining: (seconds: number) => string;
  painScale: string;
  painScore: (score: number) => string;
  painHint: string;
  yesAmbulance: string;
  yesSimulate: string;
  noCancel: string;
  cancelled: string;
  returnHome: string;
  yellowTier: string;
  simulatedEscalation: string;
  simulatedNoAction: string;
  yellowTierExplanation: string;
  safetyPause: (seconds: number) => string;
  scoreThreshold: string;
  noResponseDemo: string;
  // ── Emergency flow optional keys ────────────────────────────────────────
  greenTierPrompt?: string;
  greenTierTitle?: string;
  yellowNurseLine?: string;
  greenCardDischarge?: string;
  greenCardDischargeBody?: string;
  greenCardFollowUp?: string;
  greenCardFollowUpBody?: string;
  greenCardMeds?: string;
  greenCardMedsBody?: string;
  greenCardEmergency?: string;
  greenCardEmergencyBody?: string;
  // ── Voice trigger 4-step flow ───────────────────────────────────────────
  /** Instruction spoken immediately on tap — "Bring mouth closer" */
  triggerInstruction: string;
  /** Step 1: prompt shown on screen after instruction fires */
  voiceTriggerPrompt: (phrase: string) => string;
  /** Step 1: mic listening indicator */
  listeningIndicator: string;
  /** Step 1: fallback tap-to-confirm label */
  tapToConfirm: string;
  /** Step 2: countdown screen title */
  dispatchCountdownTitle: string;
  /** Step 2: "clear the air" label shown during 5-second silent countdown */
  clearTheAirInstruction: string;
  /** Step 3: living situation question (spoken + shown) */
  livingQuestion: string;
  /** Step 3: green button — yes, with someone */
  livingWithSomeone: string;
  /** Step 3: red button — no, live alone */
  livingAlone: string;
  /** Step 3: legacy alone question key */
  areYouAlone: string;
  /** Step 4: help coming message — no "is" or "on its way" */
  helpIsOnTheWay: string;
  /** Cancel button during voice trigger flow */
  cancelAmbulance: string;
  /** Return to main page button */
  returnToMainPage: string;
  // ── Name capture / verification ─────────────────────────────────────────
  namePromptSpeak: string;
  iHeard: (name: string) => string;
  replayName: string;
  /** Auto-announce: "Your name is [name]. Is that correct?" */
  nameIsCorrect: (name: string) => string;
  editName: string;
  spellFirstName: string;
  spellLastName: string;
  nameSpelledFirst: (name: string) => string;
  nameSpelledLast: (name: string) => string;
  // ── Speaker / Read-All controls ─────────────────────────────────────────
  speakerOn: string;
  speakerOff: string;
  readAll: string;
  stopReading: string;
};

const copies: Record<LanguageLabel, UiCopy> = {
  English: {
    homeTab: 'Home', exploreTab: 'Explore', welcomeBack: 'Welcome back', condition: 'Post-Cardiac Surgery Recovery',
    medications: "Today's Medications", medsComplete: (taken, total) => `${taken}/${total} meds complete today`,
    dueAt: time => `Due at ${time}`,
    markTaken: 'Taken',
    taken: 'Taken',
    takenDone: 'Taken ✓',
    remindMe: 'Remind Me', reminderOn: 'Reminder On',
    nextAppointment: 'Next Appointment', doctor: 'Dr. Reyes — Cardiology', appointmentLocation: 'Heart Care Clinic, Room 204',
    cancelReminder: 'Cancel Reminder', moveOneDay: 'Move +1 Day', appointmentDateChanged: 'Demo appointment moved one day later. Set the reminder again.', offlineSample: 'OFFLINE DEMO · SAMPLE PATIENT DATA',
    help: 'HELP', helpSubtitle: 'Emergency alert demo · No call placed', moreTools: 'Language & Accessibility', hideTools: 'Hide Language & Accessibility',
    accessibilityControls: 'Accessibility Controls', foregroundReminderNote: 'In-app reminder demo only. Keep DischargeBuddy open.',
    testReminder: 'Test Reminder · 10 sec', cancelTestReminder: 'Cancel Reminder Test',
    highContrast: 'High Contrast', fontSize: percent => `A+ ${percent}%`, voiceVolume: percent => `Voice ${percent}%`, voicePace: pace => `Voice pace ${pace}`,
    language: 'Language', currentLanguage: language => `Current language: ${language}`, chooseLanguage: 'Choose a prompt language.',
    detectionSimulationNote: 'Tap 🎤 to speak your name or use the text field below.',
    simulateLanguage: 'Simulate Language Match', confirmationChoices: 'Language confirmation choices',
    candidateLanguage: language => `Confirming: ${language}`, confirmLanguageFirst: 'Confirm language after selecting one.',
    rejectLanguageFirst: 'Select a language before rejecting it.', fallbackThreeAttempts: 'Three attempts used. Do not guess. Choose a language manually or ask an interpreter.',
    speakEmergencyScript: 'Speak Emergency Script', emergencyDemo: 'Emergency Alert Demo', noCall: 'No call will be placed.',
    educationEyebrow: 'GREEN TIER · OFFLINE DEMO', recoveryGuide: 'Recovery information',
    educationSubtitle: 'Bundled sample guidance. No internet search or external AI is used.',
    dischargeInstructions: 'Your discharge instructions', readAloud: 'Read aloud', guardrail: 'Safety guardrail',
    guardrailBody: 'If the app is unsure, it must not guess. Unknown or unclear input is not confirmation. This demo cannot contact a nurse, interpreter, or emergency service.',
    alertTitle: 'RED TIER · EMERGENCY DEMO', promptLanguage: language => `Prompt language: ${language}`,
    emergencyQuestion: 'Are you actively experiencing a medical emergency right now?', demoOnlyNotice: 'DEMO ONLY · No emergency service will be contacted.',
    repeatPrompt: 'Repeat Voice Prompt', secondsRemaining: seconds => `${seconds} seconds remaining`, painScale: 'Rate your pain or discomfort (1–10):',
    painScore: score => `Pain score ${score}`, painHint: 'Green 1–3 is mild. Yellow 4–7 is moderate. Red 8–10 is severe.',
    yesAmbulance: 'YES · AMBULANCE', yesSimulate: 'YES · SIMULATE ESCALATION', noCancel: 'NO · CANCEL',
    cancelled: 'ALERT CANCELLED', returnHome: 'Return to Dashboard', yellowTier: 'YELLOW TIER · CARE PATHWAY DEMO',
    simulatedEscalation: 'DEMO ESCALATION SELECTED',
    simulatedNoAction: 'No ambulance was called. No message or patient information was sent.',
    yellowTierExplanation: 'A live system would connect you with a clinic nurse or interpreter. This demo cannot contact them.',
    safetyPause: seconds => `Safety pause. Pain evaluation begins in ${seconds} seconds.`,
    scoreThreshold: 'DEMO SCORE CHECK · 8+ RED · 1–7 YELLOW',
    noResponseDemo: 'No response selects the simulated Red outcome. No call will be placed.',
    triggerInstruction: 'Bring your mouth closer to the microphone and speak the text indicated in the box.',
    voiceTriggerPrompt: phrase => `Say "${phrase}" now. The microphone is listening.`,
    listeningIndicator: '🎤 Listening…',
    tapToConfirm: 'Tap to Confirm / Type',
    dispatchCountdownTitle: '🚨 Listening — speak "Cancel" to stop',
    clearTheAirInstruction: 'Microphone listening. Say "Cancel" to stop. Stay silent to continue.',
    livingQuestion: 'Are you with someone or do you live alone? Say "with someone" or "live alone", or press a button.',
    livingWithSomeone: 'Yes, with someone',
    livingAlone: 'No, live alone',
    areYouAlone: 'Are you with someone, or do you live alone?',
    helpIsOnTheWay: 'Help coming.',
    cancelAmbulance: 'Cancel Help',
    returnToMainPage: 'Return to Main Page',
    namePromptSpeak: 'Please bring the phone close to your mouth and speak your name slowly.',
    iHeard: name => `I heard: ${name}`,
    replayName: '🔊 Replay Name',
    nameIsCorrect: name => `Your name is ${name}. Is that correct?`,
    editName: '✏ Edit Name',
    spellFirstName: 'Please spell your first name slowly, one letter at a time.',
    spellLastName: 'Now please spell your last name, one letter at a time.',
    nameSpelledFirst: name => `Your first name is ${name}. Is that correct?`,
    nameSpelledLast: name => `Your last name is ${name}. Is that correct?`,
    speakerOn: 'Speaker is activated',
    speakerOff: 'Speaker off',
    readAll: '📢 Read All',
    stopReading: '■ Stop Reading',
  },
  Español: {
    homeTab: 'Inicio', exploreTab: 'Guía', welcomeBack: 'Bienvenida', condition: 'Recuperación después de cirugía cardíaca',
    medications: 'Medicamentos de hoy', medsComplete: (taken, total) => `${taken} de ${total} medicamentos completados hoy`,
    dueAt: time => `A las ${time}`,
    markTaken: 'Tomado',
    taken: 'Tomado',
    takenDone: 'Tomado ✓',
    remindMe: 'Recordarme', reminderOn: 'Aviso activo',
    nextAppointment: 'Próxima cita', doctor: 'Dr. Reyes — Cardiología', appointmentLocation: 'Clínica Cardíaca, consultorio 204',
    cancelReminder: 'Cancelar aviso', moveOneDay: 'Mover +1 día', appointmentDateChanged: 'La cita de demostración se movió un día. Configure el recordatorio otra vez.', offlineSample: 'DEMOSTRACIÓN SIN CONEXIÓN · DATOS DE EJEMPLO',
    help: 'AYUDA', helpSubtitle: 'Demostración de alerta · No se realiza ninguna llamada', moreTools: 'Idioma y accesibilidad', hideTools: 'Ocultar idioma y accesibilidad',
    accessibilityControls: 'Controles de accesibilidad', foregroundReminderNote: 'Recordatorios de demostración. Mantenga DischargeBuddy abierto.',
    testReminder: 'Probar aviso · 10 s', cancelTestReminder: 'Cancelar prueba',
    highContrast: 'Alto contraste', fontSize: percent => `Texto ${percent}%`, voiceVolume: percent => `Voz ${percent}%`, voicePace: pace => `Ritmo ${pace}`,
    language: 'Idioma', currentLanguage: language => `Idioma actual: ${language}`, chooseLanguage: 'Elija el idioma de los avisos.',
    detectionSimulationNote: 'Toque 🎤 para decir su nombre o use el campo de texto.',
    simulateLanguage: 'Simular idioma', confirmationChoices: 'Confirmación del idioma',
    candidateLanguage: language => `Por confirmar: ${language}`, confirmLanguageFirst: 'Elija un idioma antes de confirmar.',
    rejectLanguageFirst: 'Elija un idioma antes de rechazarlo.', fallbackThreeAttempts: 'Se usaron tres intentos. No adivine. Elija un idioma manualmente o pida ayuda a un intérprete.',
    speakEmergencyScript: 'Leer guion de emergencia', emergencyDemo: 'Demostración de emergencia', noCall: 'No se realizará ninguna llamada.',
    educationEyebrow: 'NIVEL VERDE · DEMOSTRACIÓN SIN CONEXIÓN', recoveryGuide: 'Información de recuperación',
    educationSubtitle: 'Guía de ejemplo incluida. No se usa internet ni inteligencia artificial externa.',
    dischargeInstructions: 'Instrucciones de alta', readAloud: 'Leer en voz alta', guardrail: 'Regla de seguridad',
    guardrailBody: 'Si la aplicación no está segura, no debe adivinar. Una respuesta desconocida o poco clara no es una confirmación. Esta demostración no puede contactar a personal médico ni a un intérprete.',
    alertTitle: 'NIVEL ROJO · DEMOSTRACIÓN', promptLanguage: language => `Idioma del aviso: ${language}`,
    emergencyQuestion: '¿Está experimentando una emergencia médica ahora?', demoOnlyNotice: 'SOLO DEMOSTRACIÓN · No se contactará a emergencias.',
    repeatPrompt: 'Repetir aviso de voz', secondsRemaining: seconds => `${seconds} segundos restantes`, painScale: 'Califique el dolor o malestar (1–10):',
    painScore: score => `Nivel de dolor ${score}`, painHint: 'Verde 1–3 leve. Amarillo 4–7 moderado. Rojo 8–10 severo.',
    yesAmbulance: 'SÍ · AMBULANCIA', yesSimulate: 'SÍ · SIMULAR ESCALACIÓN', noCancel: 'NO · CANCELAR',
    cancelled: 'ALERTA CANCELADA', returnHome: 'Volver al inicio', yellowTier: 'NIVEL AMARILLO · DEMOSTRACIÓN',
    simulatedEscalation: 'ESCALACIÓN DE DEMOSTRACIÓN',
    simulatedNoAction: 'No se llamó a una ambulancia ni se envió ningún mensaje o dato del paciente.',
    yellowTierExplanation: 'Un sistema real le conectaría con una enfermera o un intérprete. Esta demostración no puede contactarlos.',
    safetyPause: seconds => `Pausa de seguridad. La evaluación del dolor comienza en ${seconds} segundos.`,
    scoreThreshold: 'EVALUACIÓN DE DEMOSTRACIÓN · 8+ ROJO · 1–7 AMARILLO',
    noResponseDemo: 'Si no hay respuesta, se selecciona el resultado rojo simulado. No se realizará ninguna llamada.',
    triggerInstruction: 'Acerque la boca al micrófono y diga el texto indicado en el recuadro.',
    voiceTriggerPrompt: phrase => `Diga "${phrase}" ahora. El micrófono está escuchando.`,
    listeningIndicator: '🎤 Escuchando…',
    tapToConfirm: 'Toque para confirmar / escribir',
    dispatchCountdownTitle: '🚨 Escuchando — diga "Cancelar" para detener',
    clearTheAirInstruction: 'Micrófono escuchando. Diga "Cancelar" para detener. Guarde silencio para continuar.',
    livingQuestion: '¿Está con alguien o vive solo? Diga "con alguien" o "vivo solo", o presione un botón.',
    livingWithSomeone: 'Sí, con alguien',
    livingAlone: 'No, vivo solo',
    areYouAlone: '¿Está con alguien o vive solo?',
    helpIsOnTheWay: 'Ayuda en camino.',
    cancelAmbulance: 'Cancelar ayuda',
    returnToMainPage: 'Volver a la página principal',
    namePromptSpeak: 'Acerque el teléfono a su boca y diga su nombre despacio.',
    iHeard: name => `Escuché: ${name}`,
    replayName: '🔊 Repetir nombre',
    nameIsCorrect: name => `Su nombre es ${name}. ¿Es correcto?`,
    editName: '✏ Editar nombre',
    spellFirstName: 'Por favor deletree su nombre de pila, una letra a la vez.',
    spellLastName: 'Ahora por favor deletree su apellido, una letra a la vez.',
    nameSpelledFirst: name => `Su nombre de pila es ${name}. ¿Es correcto?`,
    nameSpelledLast: name => `Su apellido es ${name}. ¿Es correcto?`,
    speakerOn: 'Altavoz activado',
    speakerOff: 'Altavoz apagado',
    readAll: '📢 Leer todo',
    stopReading: '■ Detener lectura',
  },
  日本語: {
    homeTab: 'ホーム', exploreTab: 'ガイド', welcomeBack: 'おかえりなさい', condition: '心臓手術後の回復',
    medications: '今日の薬', medsComplete: (taken, total) => `今日の服薬 ${total} 件中 ${taken} 件完了`,
    dueAt: time => `${time} に服用`,
    markTaken: '服用する',
    taken: '服用する',
    takenDone: '服用済み ✓',
    remindMe: '通知を設定', reminderOn: '通知設定済み',
    nextAppointment: '次回の診察', doctor: 'レイエス医師 — 循環器科', appointmentLocation: 'ハートケア診療所 204号室',
    cancelReminder: '通知を取消', moveOneDay: '1日後に変更', appointmentDateChanged: 'デモの診察日を1日後に変更しました。リマインダーを再設定してください。', offlineSample: 'オフラインデモ · サンプル患者データ',
    help: 'ヘルプ', helpSubtitle: '緊急アラートのデモ · 電話はかけません', moreTools: '言語とアクセシビリティ', hideTools: '言語とアクセシビリティを閉じる',
    accessibilityControls: 'アクセシビリティ設定', foregroundReminderNote: 'アプリ内リマインダーのデモです。アプリを開いたままにしてください。',
    testReminder: '通知テスト · 10秒', cancelTestReminder: '通知テストを取消',
    highContrast: '高コントラスト', fontSize: percent => `文字サイズ ${percent}%`, voiceVolume: percent => `音量 ${percent}%`, voicePace: pace => `読み上げ速度 ${pace}`,
    language: '言語', currentLanguage: language => `現在の言語: ${language}`, chooseLanguage: '案内の言語を選んでください。',
    detectionSimulationNote: '🎤 をタップしてお名前を話すか、以下のテキスト欄に入力してください。',
    simulateLanguage: '言語検出をシミュレート', confirmationChoices: '言語の確認',
    candidateLanguage: language => `確認中: ${language}`, confirmLanguageFirst: '確認する言語を先に選んでください。',
    rejectLanguageFirst: '拒否する前に言語を選んでください。', fallbackThreeAttempts: '3回試しました。推測しないでください。言語を選択するか通訳者に助けを求めてください。',
    speakEmergencyScript: '緊急案内を読み上げる', emergencyDemo: '緊急アラートのデモ', noCall: '電話はかけません。',
    educationEyebrow: 'グリーン段階 · オフラインデモ', recoveryGuide: '回復に関する情報',
    educationSubtitle: 'サンプル情報を端末に収録しています。インターネットや外部AIは使用しません。',
    dischargeInstructions: '退院時の指示', readAloud: '読み上げる', guardrail: '安全ルール',
    guardrailBody: 'アプリが確信できない場合は推測しません。不明または曖昧な入力は確認として扱いません。このデモでは看護師、通訳、救急サービスには連絡できません。',
    alertTitle: 'レッド段階 · 緊急デモ', promptLanguage: language => `案内言語: ${language}`,
    emergencyQuestion: '現在、医療上の緊急事態ですか？', demoOnlyNotice: 'デモのみ · 救急サービスには連絡しません。',
    repeatPrompt: '音声案内を繰り返す', secondsRemaining: seconds => `残り${seconds}秒`, painScale: '痛みや不快感を1〜10で評価してください:',
    painScore: score => `痛みのレベル ${score}`, painHint: '緑1〜3は軽度。黄4〜7は中度。赤8〜10は重度。',
    yesAmbulance: 'はい · 救急車', yesSimulate: 'はい · 対応をシミュレーション', noCancel: 'いいえ · キャンセル',
    cancelled: 'アラートをキャンセルしました', returnHome: 'ホームに戻る', yellowTier: 'イエロー段階 · ケア経路デモ',
    simulatedEscalation: '緊急対応のデモを選択しました',
    simulatedNoAction: '救急車への通報、メッセージ送信、患者情報の送信は行われていません。',
    yellowTierExplanation: '実際のシステムでは看護師または通訳につなぎます。このデモでは連絡できません。',
    safetyPause: seconds => `安全確認のため一時停止します。${seconds}秒後に痛みを評価します。`,
    scoreThreshold: 'デモ判定 · 8以上はレッド · 1〜7はイエロー',
    noResponseDemo: '応答がない場合はレッド段階のデモ結果になります。電話はかけません。',
    triggerInstruction: 'マイクに口を近づけて、ボックスに表示されている言葉を話してください。',
    voiceTriggerPrompt: phrase => `「${phrase}」と今すぐ言ってください。マイクが聞いています。`,
    listeningIndicator: '🎤 聞き取り中…',
    tapToConfirm: 'タップして確認 / 入力',
    dispatchCountdownTitle: '🚨 聞き取り中 — 「キャンセル」と言って停止',
    clearTheAirInstruction: 'マイクが聞いています。停止するには「キャンセル」と言ってください。続ける場合は沈黙してください。',
    livingQuestion: '誰かと一緒にいますか、それとも一人ですか？「一緒にいる」か「一人」と言うか、ボタンを押してください。',
    livingWithSomeone: 'はい、一緒にいる',
    livingAlone: 'いいえ、一人',
    areYouAlone: '誰かと一緒にいますか、それとも一人ですか？',
    helpIsOnTheWay: '助けが向かっています。',
    cancelAmbulance: '助けをキャンセル',
    returnToMainPage: 'メインページに戻る',
    namePromptSpeak: '携帯電話を口元に近づけて、お名前をゆっくりお話しください。',
    iHeard: name => `聞こえました: ${name}`,
    replayName: '🔊 名前を再生',
    nameIsCorrect: name => `お名前は${name}ですね。正しいですか？`,
    editName: '✏ 名前を編集',
    spellFirstName: 'お名前を一文字ずつゆっくりスペルしてください。',
    spellLastName: '次に苗字を一文字ずつスペルしてください。',
    nameSpelledFirst: name => `お名前は${name}ですね。正しいですか？`,
    nameSpelledLast: name => `苗字は${name}ですね。正しいですか？`,
    speakerOn: 'スピーカーが有効です',
    speakerOff: 'スピーカーオフ',
    readAll: '📢 すべて読む',
    stopReading: '■ 読み上げ停止',
  },
};

export function getUiCopy(label: LanguageLabel): UiCopy {
  return copies[label] ?? copies.English;
}
