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
export const I18N_LOCALES = [   // ngôn ngữ GIAO DIỆN (UI) — chỉ vi/en/ja
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
];

export const I18N = {
  vi: {
    settings: 'Cài đặt', 'settings.apiKey': 'Gemini API key', 'settings.source': 'Nguồn âm thanh',
    'settings.layout': 'Giao diện dịch', 'layout.translation': 'Chỉ bản dịch', 'layout.stacked': 'Gốc trên, dịch dưới', 'layout.columns': 'Gốc trái, dịch phải', 'settings.zoom': 'Cỡ chữ',
    'settings.targetLang': 'Ngôn ngữ đích', 'uilang.title': 'Ngôn ngữ giao diện', 'popout.title': 'Mở trong tab riêng',
    'apiKey.ph': 'AIza…', 'source.mic': '🎤 Micro', 'source.screen': '🔊 Âm thanh (tab / màn hình / cửa sổ)',
    'lang.transcribe': '📝 Chép lời', 'voice.off': '🔇 Tắt đọc', 'voice.title': 'Giọng đọc',
    'btn.start': '▶ Bắt đầu', 'btn.stop': '⏹ Dừng',
    'footer.auto': '↓ Auto', 'footer.autoTitle': 'Tự cuộn', 'footer.summary': '📋 Tóm tắt',
    'footer.exportTitle': 'Xuất transcript', 'footer.clearTitle': 'Xoá', 'footer.orig': 'Gốc', 'footer.origTitle': 'Hiện/ẩn lời gốc',
    'summary.title': 'Tóm tắt', 'summary.full': '📊 Tổng thể', 'summary.fullTitle': 'Báo cáo tổng thể (khi đã dừng)', 'summary.fullDisabledTitle': 'Chỉ tóm tắt được khi đã dừng dịch',
    'summary.copyTitle': 'Copy', 'summary.exportTitle': 'Tải .md', 'summary.dlHtmlTitle': 'Tải báo cáo HTML', 'summary.editTitle': 'Sửa yêu cầu tóm tắt',
    'summary.empty': 'Chưa có tóm tắt.', 'summary.extraPh': 'VD: tập trung vào quyết định & deadline', 'summary.save': 'Lưu', 'summary.updating': 'Đang cập nhật tóm tắt…',
    count: '{n} câu',
    'status.ready': 'Sẵn sàng. Bấm Bắt đầu.', 'status.readyNoKey': 'Nhập API key (⚙️) rồi bấm Bắt đầu.',
    'status.needKey': 'Nhập Gemini API key trước.', 'status.listeningMic': 'Đang nghe micro…',
    'status.listeningAudio': 'Đang nghe âm thanh đã chọn…', 'status.stopped': 'Đã dừng.',
    'status.canceled': 'Đã huỷ chọn nguồn âm thanh.', 'status.captureErr': 'Lỗi thu âm: {err}',
    'status.checking': 'Đang kiểm tra…', 'status.keyOk': '✓ Key hợp lệ', 'status.keyBad': '✕ Key không hợp lệ',
    'status.copied': 'Đã copy tóm tắt.', 'status.makingFull': 'Đang tạo báo cáo tổng thể…',
    'status.fullDone': 'Xong báo cáo tổng thể.', 'status.fullErr': 'Báo cáo lỗi: {err}',
    'status.noContent': 'Chưa có nội dung.', 'status.summaryErr': 'Tóm tắt: {err}',
    'status.stopFirst': 'Dừng ghi trước khi tạo báo cáo tổng thể.', 'status.popoutErr': 'Không mở được cửa sổ riêng: {err}', 'pip.title': 'Ghim cửa sổ nổi (PiP — luôn trên cùng)', 'pip.active': 'Đang hiển thị ở cửa sổ ghim (PiP). Đóng PiP để đưa nội dung về đây.', 'status.pipUnsupported': 'Trình duyệt không hỗ trợ Document Picture-in-Picture.', 'status.pipErr': 'Lỗi mở PiP: {err}', 'pip.return': 'Quay về cửa sổ gốc', 'status.micPermNeeded': 'Đang xin quyền micro ở cửa sổ vừa mở — chọn "Cho phép" rồi bấm Bắt đầu lại.', 'status.micGranted': '✅ Đã cấp quyền micro.', 'status.micPermHint': '🎤 Micro chưa được cấp quyền — bấm Bắt đầu để cấp.',
    'status.summaryApplied': 'Đã áp dụng yêu cầu & tóm tắt lại.', 'status.noKeyShort': 'Thiếu API key.', 'status.geminiErr': 'Gemini: {err}',
  },
  en: {
    settings: 'Settings', 'settings.apiKey': 'Gemini API key', 'settings.source': 'Audio source',
    'settings.layout': 'Translation layout', 'layout.translation': 'Translation only', 'layout.stacked': 'Original top, translation below', 'layout.columns': 'Original left, translation right', 'settings.zoom': 'Text size',
    'settings.targetLang': 'Target language', 'uilang.title': 'Interface language', 'popout.title': 'Open in a separate tab',
    'apiKey.ph': 'AIza…', 'source.mic': '🎤 Microphone', 'source.screen': '🔊 Audio (tab / screen / window)',
    'lang.transcribe': '📝 Transcribe', 'voice.off': '🔇 Voice off', 'voice.title': 'Voice',
    'btn.start': '▶ Start', 'btn.stop': '⏹ Stop',
    'footer.auto': '↓ Auto', 'footer.autoTitle': 'Auto-scroll', 'footer.summary': '📋 Summary',
    'footer.exportTitle': 'Export transcript', 'footer.clearTitle': 'Clear', 'footer.orig': 'Source', 'footer.origTitle': 'Show/hide original',
    'summary.title': 'Summary', 'summary.full': '📊 Full report', 'summary.fullTitle': 'Full meeting report (after stopping)', 'summary.fullDisabledTitle': 'Available only after you stop translating',
    'summary.copyTitle': 'Copy', 'summary.exportTitle': 'Download .md', 'summary.dlHtmlTitle': 'Download HTML report', 'summary.editTitle': 'Edit summary instructions',
    'summary.empty': 'No summary yet.', 'summary.extraPh': 'e.g. focus on decisions & deadlines', 'summary.save': 'Save', 'summary.updating': 'Updating summary…',
    count: '{n} lines',
    'status.ready': 'Ready. Click Start.', 'status.readyNoKey': 'Enter API key (⚙️) then click Start.',
    'status.needKey': 'Enter your Gemini API key first.', 'status.listeningMic': 'Listening to microphone…',
    'status.listeningAudio': 'Listening to selected audio…', 'status.stopped': 'Stopped.',
    'status.canceled': 'Audio source selection canceled.', 'status.captureErr': 'Capture error: {err}',
    'status.checking': 'Checking…', 'status.keyOk': '✓ Key valid', 'status.keyBad': '✕ Invalid key',
    'status.copied': 'Summary copied.', 'status.makingFull': 'Generating full report…',
    'status.fullDone': 'Full report done.', 'status.fullErr': 'Report error: {err}',
    'status.noContent': 'No content yet.', 'status.summaryErr': 'Summary: {err}',
    'status.stopFirst': 'Stop recording before generating the full report.', 'status.popoutErr': 'Could not open separate window: {err}', 'pip.title': 'Pin floating window (PiP — always on top)', 'pip.active': 'Now shown in the pinned (PiP) window. Close PiP to bring it back here.', 'status.pipUnsupported': 'Browser does not support Document Picture-in-Picture.', 'status.pipErr': 'PiP error: {err}', 'pip.return': 'Return to original window', 'status.micPermNeeded': 'Requesting mic permission in the opened window — choose "Allow", then press Start again.', 'status.micGranted': '✅ Microphone permission granted.', 'status.micPermHint': '🎤 Microphone not granted yet — press Start to grant.',
    'status.summaryApplied': 'Instructions applied & re-summarized.', 'status.noKeyShort': 'Missing API key.', 'status.geminiErr': 'Gemini: {err}',
  },
  ja: {
    settings: '設定', 'settings.apiKey': 'Gemini API キー', 'settings.source': '音声ソース',
    'settings.layout': '表示レイアウト', 'layout.translation': '訳のみ', 'layout.stacked': '原文(上)/訳(下)', 'layout.columns': '原文(左)/訳(右)', 'settings.zoom': '文字サイズ',
    'settings.targetLang': '翻訳先の言語', 'uilang.title': '表示言語', 'popout.title': '別タブで開く',
    'apiKey.ph': 'AIza…', 'source.mic': '🎤 マイク', 'source.screen': '🔊 音声（タブ / 画面 / ウィンドウ）',
    'lang.transcribe': '📝 文字起こし', 'voice.off': '🔇 読み上げオフ', 'voice.title': '読み上げ音声',
    'btn.start': '▶ 開始', 'btn.stop': '⏹ 停止',
    'footer.auto': '↓ 自動', 'footer.autoTitle': '自動スクロール', 'footer.summary': '📋 要約',
    'footer.exportTitle': '文字起こしを書き出す', 'footer.clearTitle': 'クリア', 'footer.orig': '原文', 'footer.origTitle': '原文の表示/非表示',
    'summary.title': '要約', 'summary.full': '📊 全体レポート', 'summary.fullTitle': '会議全体のレポート（停止後）', 'summary.fullDisabledTitle': '翻訳を停止すると要約できます',
    'summary.copyTitle': 'コピー', 'summary.exportTitle': '.md を保存', 'summary.dlHtmlTitle': 'HTML レポートを保存', 'summary.editTitle': '要約の指示を編集',
    'summary.empty': 'まだ要約はありません。', 'summary.extraPh': '例：決定事項と期限を重視', 'summary.save': '保存', 'summary.updating': '要約を更新中…',
    count: '{n} 行',
    'status.ready': '準備完了。開始を押してください。', 'status.readyNoKey': 'API キー（⚙️）を入力してから開始を押してください。',
    'status.needKey': '先に Gemini API キーを入力してください。', 'status.listeningMic': 'マイクを聞いています…',
    'status.listeningAudio': '選択した音声を聞いています…', 'status.stopped': '停止しました。',
    'status.canceled': '音声ソースの選択をキャンセルしました。', 'status.captureErr': '録音エラー: {err}',
    'status.checking': '確認中…', 'status.keyOk': '✓ キーは有効です', 'status.keyBad': '✕ キーが無効です',
    'status.copied': '要約をコピーしました。', 'status.makingFull': '全体レポートを作成中…',
    'status.fullDone': '全体レポート完了。', 'status.fullErr': 'レポートエラー: {err}',
    'status.noContent': '内容がまだありません。', 'status.summaryErr': '要約: {err}',
    'status.stopFirst': '全体レポートを作成する前に停止してください。', 'status.popoutErr': '別ウィンドウを開けません: {err}', 'pip.title': 'フローティング固定（PiP・常に最前面）', 'pip.active': '固定（PiP）ウィンドウに表示中。PiP を閉じるとここに戻ります。', 'status.pipUnsupported': 'このブラウザは Document Picture-in-Picture に対応していません。', 'status.pipErr': 'PiP エラー: {err}', 'pip.return': '元のウィンドウに戻す', 'status.micPermNeeded': '開いたウィンドウでマイク権限をリクエスト中 — 「許可」を選んでから「開始」を押し直してください。', 'status.micGranted': '✅ マイク権限を許可しました。', 'status.micPermHint': '🎤 マイク未許可 —「開始」で許可してください。',
    'status.summaryApplied': '指示を適用して再要約しました。', 'status.noKeyShort': 'API キーがありません。', 'status.geminiErr': 'Gemini: {err}',
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
