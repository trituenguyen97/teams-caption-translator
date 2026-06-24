// i18n.js — đa ngôn ngữ giao diện (5 locale) + cờ SVG (emoji cờ không hiện trên Windows Chrome).
// Dùng: setLocale(code); applyI18n(root) cho [data-i18n]/[data-i18n-title]/[data-i18n-ph]; t(key, vars) cho chuỗi động.

// Cờ SVG nhỏ gọn (viewBox 30x20), CSS chỉnh kích thước.
export const FLAGS = {
  vi: `<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#da251d"/><path d="M15 4.2l1.62 4.98h5.24l-4.24 3.08 1.62 4.98L15 14.14l-4.24 3.08 1.62-4.98-4.24-3.08h5.24z" fill="#ff0"/></svg>`,
  en: `<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><g fill="#b22234"><rect width="30" height="2" y="0"/><rect width="30" height="2" y="4"/><rect width="30" height="2" y="8"/><rect width="30" height="2" y="12"/><rect width="30" height="2" y="16"/></g><rect width="13" height="11" fill="#3c3b6e"/></svg>`,
  ja: `<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="5.5" fill="#bc002d"/></svg>`,
  ko: `<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="5" fill="#cd2e3a"/><path d="M15 5a2.5 2.5 0 0 1 0 5 2.5 2.5 0 0 0 0 5 5 5 0 0 1 0-10z" fill="#0047a0"/></svg>`,
  'zh-CN': `<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#de2910"/><path d="M6 3.6l1.13 3.48h3.66l-2.96 2.15 1.13 3.48L6 10.56l-2.96 2.15 1.13-3.48L1.21 7.08h3.66z" fill="#ffde00"/><g fill="#ffde00"><circle cx="12" cy="3" r=".8"/><circle cx="14" cy="5.2" r=".8"/><circle cx="14" cy="8.2" r=".8"/><circle cx="12" cy="10.4" r=".8"/></g></svg>`,
};
export const flag = (code) => FLAGS[code] || FLAGS[(code || '').split('-')[0]] || '';

// Locale + ngôn ngữ đích dùng chung danh sách (autonym).
export const I18N_LOCALES = [
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'zh-CN', name: '中文' },
];

export const I18N = {
  vi: {
    settings: 'Cài đặt', 'settings.apiKey': 'Gemini API key', 'settings.source': 'Nguồn âm thanh',
    'settings.targetLang': 'Ngôn ngữ đích', 'uilang.title': 'Ngôn ngữ giao diện', 'popout.title': 'Tách ra cửa sổ riêng',
    'apiKey.ph': 'AIza…', 'source.mic': '🎤 Micro', 'source.screen': '🔊 Âm thanh (tab / màn hình / cửa sổ)',
    'lang.transcribe': '📝 Chép lời', 'voice.off': '🔇 Tắt đọc',
    'btn.start': '▶ Bắt đầu', 'btn.stop': '⏹ Dừng',
    'footer.auto': '↓ Auto', 'footer.autoTitle': 'Tự cuộn', 'footer.summary': '📋 Tóm tắt',
    'footer.exportTitle': 'Xuất transcript', 'footer.clearTitle': 'Xoá',
    'summary.title': 'Tóm tắt', 'summary.full': '📊 Tổng thể', 'summary.fullTitle': 'Báo cáo tổng thể (khi đã dừng)',
    'summary.copyTitle': 'Copy', 'summary.exportTitle': 'Xuất .md', 'summary.editTitle': 'Sửa yêu cầu tóm tắt',
    'summary.empty': 'Chưa có tóm tắt.', 'summary.extraPh': 'VD: tập trung vào quyết định & deadline', 'summary.save': 'Lưu',
    count: '{n} câu',
    'status.ready': 'Sẵn sàng. Bấm Bắt đầu.', 'status.readyNoKey': 'Nhập API key (⚙️) rồi bấm Bắt đầu.',
    'status.needKey': 'Nhập Gemini API key trước.', 'status.listeningMic': 'Đang nghe micro…',
    'status.listeningAudio': 'Đang nghe âm thanh đã chọn…', 'status.stopped': 'Đã dừng.',
    'status.canceled': 'Đã huỷ chọn nguồn âm thanh.', 'status.captureErr': 'Lỗi thu âm: {err}',
    'status.checking': 'Đang kiểm tra…', 'status.keyOk': '✓ Key hợp lệ', 'status.keyBad': '✕ Key không hợp lệ',
    'status.copied': 'Đã copy tóm tắt.', 'status.makingFull': 'Đang tạo báo cáo tổng thể…',
    'status.fullDone': 'Xong báo cáo tổng thể.', 'status.fullErr': 'Báo cáo lỗi: {err}',
    'status.noContent': 'Chưa có nội dung.', 'status.summaryErr': 'Tóm tắt: {err}',
    'status.stopFirst': 'Dừng ghi trước khi tạo báo cáo tổng thể.', 'status.popoutErr': 'Không mở được cửa sổ riêng: {err}',
    'status.summaryApplied': 'Đã áp dụng yêu cầu & tóm tắt lại.', 'status.noKeyShort': 'Thiếu API key.', 'status.geminiErr': 'Gemini: {err}',
  },
  en: {
    settings: 'Settings', 'settings.apiKey': 'Gemini API key', 'settings.source': 'Audio source',
    'settings.targetLang': 'Target language', 'uilang.title': 'Interface language', 'popout.title': 'Pop out to a separate window',
    'apiKey.ph': 'AIza…', 'source.mic': '🎤 Microphone', 'source.screen': '🔊 Audio (tab / screen / window)',
    'lang.transcribe': '📝 Transcribe', 'voice.off': '🔇 Voice off',
    'btn.start': '▶ Start', 'btn.stop': '⏹ Stop',
    'footer.auto': '↓ Auto', 'footer.autoTitle': 'Auto-scroll', 'footer.summary': '📋 Summary',
    'footer.exportTitle': 'Export transcript', 'footer.clearTitle': 'Clear',
    'summary.title': 'Summary', 'summary.full': '📊 Full report', 'summary.fullTitle': 'Full meeting report (after stopping)',
    'summary.copyTitle': 'Copy', 'summary.exportTitle': 'Export .md', 'summary.editTitle': 'Edit summary instructions',
    'summary.empty': 'No summary yet.', 'summary.extraPh': 'e.g. focus on decisions & deadlines', 'summary.save': 'Save',
    count: '{n} lines',
    'status.ready': 'Ready. Click Start.', 'status.readyNoKey': 'Enter API key (⚙️) then click Start.',
    'status.needKey': 'Enter your Gemini API key first.', 'status.listeningMic': 'Listening to microphone…',
    'status.listeningAudio': 'Listening to selected audio…', 'status.stopped': 'Stopped.',
    'status.canceled': 'Audio source selection canceled.', 'status.captureErr': 'Capture error: {err}',
    'status.checking': 'Checking…', 'status.keyOk': '✓ Key valid', 'status.keyBad': '✕ Invalid key',
    'status.copied': 'Summary copied.', 'status.makingFull': 'Generating full report…',
    'status.fullDone': 'Full report done.', 'status.fullErr': 'Report error: {err}',
    'status.noContent': 'No content yet.', 'status.summaryErr': 'Summary: {err}',
    'status.stopFirst': 'Stop recording before generating the full report.', 'status.popoutErr': 'Could not open separate window: {err}',
    'status.summaryApplied': 'Instructions applied & re-summarized.', 'status.noKeyShort': 'Missing API key.', 'status.geminiErr': 'Gemini: {err}',
  },
  ja: {
    settings: '設定', 'settings.apiKey': 'Gemini API キー', 'settings.source': '音声ソース',
    'settings.targetLang': '翻訳先の言語', 'uilang.title': '表示言語', 'popout.title': '別ウィンドウで開く',
    'apiKey.ph': 'AIza…', 'source.mic': '🎤 マイク', 'source.screen': '🔊 音声（タブ / 画面 / ウィンドウ）',
    'lang.transcribe': '📝 文字起こし', 'voice.off': '🔇 読み上げオフ',
    'btn.start': '▶ 開始', 'btn.stop': '⏹ 停止',
    'footer.auto': '↓ 自動', 'footer.autoTitle': '自動スクロール', 'footer.summary': '📋 要約',
    'footer.exportTitle': '文字起こしを書き出す', 'footer.clearTitle': 'クリア',
    'summary.title': '要約', 'summary.full': '📊 全体レポート', 'summary.fullTitle': '会議全体のレポート（停止後）',
    'summary.copyTitle': 'コピー', 'summary.exportTitle': '.md で書き出す', 'summary.editTitle': '要約の指示を編集',
    'summary.empty': 'まだ要約はありません。', 'summary.extraPh': '例：決定事項と期限を重視', 'summary.save': '保存',
    count: '{n} 行',
    'status.ready': '準備完了。開始を押してください。', 'status.readyNoKey': 'API キー（⚙️）を入力してから開始を押してください。',
    'status.needKey': '先に Gemini API キーを入力してください。', 'status.listeningMic': 'マイクを聞いています…',
    'status.listeningAudio': '選択した音声を聞いています…', 'status.stopped': '停止しました。',
    'status.canceled': '音声ソースの選択をキャンセルしました。', 'status.captureErr': '録音エラー: {err}',
    'status.checking': '確認中…', 'status.keyOk': '✓ キーは有効です', 'status.keyBad': '✕ キーが無効です',
    'status.copied': '要約をコピーしました。', 'status.makingFull': '全体レポートを作成中…',
    'status.fullDone': '全体レポート完了。', 'status.fullErr': 'レポートエラー: {err}',
    'status.noContent': '内容がまだありません。', 'status.summaryErr': '要約: {err}',
    'status.stopFirst': '全体レポートを作成する前に停止してください。', 'status.popoutErr': '別ウィンドウを開けません: {err}',
    'status.summaryApplied': '指示を適用して再要約しました。', 'status.noKeyShort': 'API キーがありません。', 'status.geminiErr': 'Gemini: {err}',
  },
  ko: {
    settings: '설정', 'settings.apiKey': 'Gemini API 키', 'settings.source': '오디오 소스',
    'settings.targetLang': '대상 언어', 'uilang.title': '표시 언어', 'popout.title': '별도 창으로 열기',
    'apiKey.ph': 'AIza…', 'source.mic': '🎤 마이크', 'source.screen': '🔊 오디오 (탭 / 화면 / 창)',
    'lang.transcribe': '📝 받아쓰기', 'voice.off': '🔇 음성 끄기',
    'btn.start': '▶ 시작', 'btn.stop': '⏹ 중지',
    'footer.auto': '↓ 자동', 'footer.autoTitle': '자동 스크롤', 'footer.summary': '📋 요약',
    'footer.exportTitle': '전사 내보내기', 'footer.clearTitle': '지우기',
    'summary.title': '요약', 'summary.full': '📊 전체 보고서', 'summary.fullTitle': '전체 회의 보고서 (중지 후)',
    'summary.copyTitle': '복사', 'summary.exportTitle': '.md 내보내기', 'summary.editTitle': '요약 지시 편집',
    'summary.empty': '아직 요약이 없습니다.', 'summary.extraPh': '예: 결정 사항과 마감일 중심', 'summary.save': '저장',
    count: '{n}줄',
    'status.ready': '준비됨. 시작을 누르세요.', 'status.readyNoKey': 'API 키(⚙️)를 입력한 후 시작을 누르세요.',
    'status.needKey': '먼저 Gemini API 키를 입력하세요.', 'status.listeningMic': '마이크를 듣는 중…',
    'status.listeningAudio': '선택한 오디오를 듣는 중…', 'status.stopped': '중지됨.',
    'status.canceled': '오디오 소스 선택이 취소되었습니다.', 'status.captureErr': '녹음 오류: {err}',
    'status.checking': '확인 중…', 'status.keyOk': '✓ 유효한 키', 'status.keyBad': '✕ 잘못된 키',
    'status.copied': '요약을 복사했습니다.', 'status.makingFull': '전체 보고서 생성 중…',
    'status.fullDone': '전체 보고서 완료.', 'status.fullErr': '보고서 오류: {err}',
    'status.noContent': '아직 내용이 없습니다.', 'status.summaryErr': '요약: {err}',
    'status.stopFirst': '전체 보고서를 만들기 전에 녹음을 중지하세요.', 'status.popoutErr': '별도 창을 열 수 없습니다: {err}',
    'status.summaryApplied': '지시를 적용하고 다시 요약했습니다.', 'status.noKeyShort': 'API 키가 없습니다.', 'status.geminiErr': 'Gemini: {err}',
  },
  'zh-CN': {
    settings: '设置', 'settings.apiKey': 'Gemini API 密钥', 'settings.source': '音频来源',
    'settings.targetLang': '目标语言', 'uilang.title': '界面语言', 'popout.title': '在单独窗口中打开',
    'apiKey.ph': 'AIza…', 'source.mic': '🎤 麦克风', 'source.screen': '🔊 音频（标签页 / 屏幕 / 窗口）',
    'lang.transcribe': '📝 转写', 'voice.off': '🔇 关闭朗读',
    'btn.start': '▶ 开始', 'btn.stop': '⏹ 停止',
    'footer.auto': '↓ 自动', 'footer.autoTitle': '自动滚动', 'footer.summary': '📋 摘要',
    'footer.exportTitle': '导出转写', 'footer.clearTitle': '清除',
    'summary.title': '摘要', 'summary.full': '📊 完整报告', 'summary.fullTitle': '完整会议报告（停止后）',
    'summary.copyTitle': '复制', 'summary.exportTitle': '导出 .md', 'summary.editTitle': '编辑摘要要求',
    'summary.empty': '暂无摘要。', 'summary.extraPh': '例如：聚焦决策与截止日期', 'summary.save': '保存',
    count: '{n} 行',
    'status.ready': '就绪。点击开始。', 'status.readyNoKey': '输入 API 密钥（⚙️）后点击开始。',
    'status.needKey': '请先输入 Gemini API 密钥。', 'status.listeningMic': '正在聆听麦克风…',
    'status.listeningAudio': '正在聆听所选音频…', 'status.stopped': '已停止。',
    'status.canceled': '已取消音频来源选择。', 'status.captureErr': '录制错误：{err}',
    'status.checking': '检查中…', 'status.keyOk': '✓ 密钥有效', 'status.keyBad': '✕ 密钥无效',
    'status.copied': '已复制摘要。', 'status.makingFull': '正在生成完整报告…',
    'status.fullDone': '完整报告完成。', 'status.fullErr': '报告错误：{err}',
    'status.noContent': '暂无内容。', 'status.summaryErr': '摘要：{err}',
    'status.stopFirst': '生成完整报告前请先停止录制。', 'status.popoutErr': '无法打开单独窗口：{err}',
    'status.summaryApplied': '已应用要求并重新摘要。', 'status.noKeyShort': '缺少 API 密钥。', 'status.geminiErr': 'Gemini：{err}',
  },
};

let _loc = 'vi';
export function setLocale(code) { if (I18N[code]) _loc = code; }
export function currentLocale() { return _loc; }
export function t(key, vars) {
  const d = I18N[_loc] || I18N.en;
  let s = (d[key] != null) ? d[key] : (I18N.en[key] != null ? I18N.en[key] : key);
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = t(e.getAttribute('data-i18n')); });
  root.querySelectorAll('[data-i18n-title]').forEach(e => { e.title = t(e.getAttribute('data-i18n-title')); });
  root.querySelectorAll('[data-i18n-ph]').forEach(e => { e.setAttribute('placeholder', t(e.getAttribute('data-i18n-ph'))); });
}
