"""
Local STT server — SenseVoice-Small qua sherpa-onnx (không cần torch)
Nhận audio bytes qua HTTP POST, trả về văn bản transcribe.

Cài đặt:
    pip install sherpa-onnx av

Chạy:
    python stt-server.py [port]   (mặc định port 8765)
"""

import sys
import os
import re
import tempfile
import threading
import urllib.request
import tarfile
import numpy as np
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)
sys.stderr = open(sys.stderr.fileno(), mode='w', encoding='utf-8', buffering=1)

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

# ── Auto-download model ────────────────────────────────────────
CACHE_DIR   = os.path.join(os.path.expanduser('~'), '.cache', 'sense-voice-sherpa')
MODEL_FILE  = os.path.join(CACHE_DIR, 'model.int8.onnx')
TOKENS_FILE = os.path.join(CACHE_DIR, 'tokens.txt')
TAR_URL     = ('https://github.com/k2-fsa/sherpa-onnx/releases/download/'
               'asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2')

def _progress(block, block_size, total):
    if total > 0:
        pct = min(block * block_size, total) * 100 // total
        print(f'\r[STT] Tải mô hình... {pct}%', end='', flush=True)

def download_model():
    if os.path.exists(MODEL_FILE) and os.path.exists(TOKENS_FILE):
        return
    os.makedirs(CACHE_DIR, exist_ok=True)
    print('[STT] Lần đầu chạy: tải SenseVoice-Small (~110MB)...', flush=True)
    tar_path = os.path.join(CACHE_DIR, '_download.tar.bz2')
    urllib.request.urlretrieve(TAR_URL, tar_path, _progress)
    print('', flush=True)
    with tarfile.open(tar_path, 'r:bz2') as tf:
        for member in tf.getmembers():
            base = os.path.basename(member.name)
            if base in ('model.int8.onnx', 'tokens.txt'):
                member.name = base
                tf.extract(member, CACHE_DIR)
    os.unlink(tar_path)
    print('[STT] Tải xong.', flush=True)

download_model()

# ── Khởi tạo recognizer ───────────────────────────────────
print('[STT] Đang tải SenseVoice-Small (sherpa-onnx)...', flush=True)
import sherpa_onnx

_num_threads = min(4, os.cpu_count() or 2)
recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
    model=MODEL_FILE,
    tokens=TOKENS_FILE,
    num_threads=_num_threads,
    sample_rate=16000,
    feature_dim=80,
    decoding_method='greedy_search',
    debug=False,
    provider='cpu',
    language='auto',
    use_itn=True,
)
print(f'[STT] Model sẵn sàng, đang lắng nghe port {PORT}', flush=True)

_lock = threading.Lock()

# ── Decode audio WebM/OGG → numpy float32 @ 16kHz ────────────────
import av

def decode_audio(path):
    """Trả về numpy float32 mono 16kHz."""
    try:
        container = av.open(path)
        resampler = av.AudioResampler(format='s16', layout='mono', rate=16000)
        chunks = []
        for frame in container.decode(audio=0):
            for r in resampler.resample(frame):
                chunks.append(r.to_ndarray())
        container.close()
        if not chunks:
            return np.array([], dtype=np.float32)
        return np.concatenate(chunks, axis=1).flatten().astype(np.float32) / 32768.0
    except Exception as e:
        print(f'[STT] Lỗi decode audio: {e}', flush=True)
        return np.array([], dtype=np.float32)

# ── Tách câu ngắn ─────────────────────────────────────────────
_SPLIT_RE = re.compile(r'(?<=[.!?\u3002\uff01\uff1f])\s*')

def split_sentences(text, max_words=20):
    parts = [s.strip() for s in _SPLIT_RE.split(text) if s.strip()]
    if not parts:
        parts = [text.strip()]
    result = []
    for part in parts:
        words = part.split()
        while len(words) > max_words:
            result.append(' '.join(words[:max_words]))
            words = words[max_words:]
        if words:
            result.append(' '.join(words))
    return result


# ── HTTP Server ──────────────────────────────────────────────


class STTHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            ext    = self.headers.get('X-Audio-Ext', 'webm')
            data   = self.rfile.read(length)
            if not data:
                self._reply(200, '')
                return

            with tempfile.NamedTemporaryFile(suffix=f'.{ext}', delete=False) as f:
                f.write(data)
                tmpfile = f.name

            try:
                samples = decode_audio(tmpfile)
                if samples.size < 1600:   # < 0.1s — bỏ qua
                    self._reply(200, '')
                    return

                with _lock:
                    stream = recognizer.create_stream()
                    stream.accept_waveform(16000, samples)
                    recognizer.decode_stream(stream)
                    raw = stream.result.text.strip()

                sentences = [s for part in [raw] for s in split_sentences(part) if s]
                self._reply(200, '\n'.join(sentences))
            finally:
                try:
                    os.unlink(tmpfile)
                except Exception:
                    pass

        except Exception as e:
            print(f'[STT] Lỗi transcribe: {e}', flush=True)
            self._reply(500, '')

    def _reply(self, code, text):
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # tắt access log


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """Mỗi request chạy trên thread riêng — không block nhau khi queue"""
    daemon_threads = True


if __name__ == "__main__":
    server = ThreadedHTTPServer(("127.0.0.1", PORT), STTHandler)
    print(f"[STT] Server sẵn sàng trên port {PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
