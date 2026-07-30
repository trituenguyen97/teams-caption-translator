# -*- coding: utf-8 -*-
"""bitnet_sidecar.py — Sidecar dịch JA<->VI bằng model BitNet v7a 1.58-bit (i2_s GGUF).

Vì sao cần sidecar (không gọi thẳng llama-server từ Node):
  1. Model i2_s chỉ chạy được bằng build BitNet trong WSL (llama.cpp Windows mainline
     không hỗ trợ quant i2_s).
  2. Tokenizer spm_vija_32k là UNIGRAM — llm_tokenizer_spm của llama.cpp là greedy
     bigram-merge, tách sai hoàn toàn (Bit-Translate ISSUES.md #4). BẮT BUỘC tokenize
     bằng sentencepiece Python + normalize_for_model rồi POST token ids thô.

Kiến trúc:  app Node --HTTP:8790--> sidecar này --HTTP:8811--> llama-server (WSL)

API:
  GET  /health              -> {"ok": true, "upstream": true|false}
  POST /translate           {"text": "...", "direction": "ja2vi"|"vi2ja"}
                            -> {"translation": "...", "ms": 123}
  POST /shutdown            tắt llama-server WSL + thoát sidecar
"""
import json
import os
import re
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import sentencepiece as _spm

HERE = Path(__file__).resolve().parent

# ── Cấu hình (ghi đè bằng env) ────────────────────────
MODEL_WSL = os.environ.get("BITNET_MODEL", "/mnt/d/Bit-Translate-data/dist/v7a_avg_i2s.gguf")
LLAMA_BIN = os.environ.get("BITNET_LLAMA_BIN", "/home/tuent/BitNet-test/build/bin/llama-server")
LLAMA_PORT = int(os.environ.get("BITNET_LLAMA_PORT", "8811"))
SIDECAR_PORT = int(os.environ.get("BITNET_SIDECAR_PORT", "8790"))
THREADS = int(os.environ.get("BITNET_THREADS", "4"))
SPM_MODEL = str(HERE / "spm_vija_32k.model")

# ── Tokenizer + normalize (y hệt lúc train — xem Bit-Translate/scripts/text_norm.py) ──
sp = _spm.SentencePieceProcessor(model_file=SPM_MODEL)
BOS = sp.piece_to_id("<s>")
EOS = sp.piece_to_id("</s>")
TAG = {"ja2vi": sp.piece_to_id(">>vie<<"), "vi2ja": sp.piece_to_id(">>jpn<<")}
print(f"[sidecar] ids: bos={BOS} eos={EOS} vie={TAG['ja2vi']} jpn={TAG['vi2ja']}", flush=True)


def normalize_for_model(text: str) -> str:
    t = unicodedata.normalize("NFKC", text)
    return re.sub(r"\s+", " ", t).strip()


_SENT_SPLIT = re.compile(r"(?<=[。！？!?])\s*")


def split_sentences(text: str) -> list:
    """Data train chủ yếu 1 câu/dòng — input nhiều câu phải tách rồi dịch từng câu."""
    return [p for p in _SENT_SPLIT.split(text) if p.strip()]


_DASH_PREFIX = re.compile(r"^\s*[-–—]\s*")


def clean_output(text: str) -> str:
    return _DASH_PREFIX.sub("", text.strip())


def restore_ja_fullwidth(text: str) -> str:
    return text.replace("?", "？").replace("!", "！").replace("%", "％")


# ── llama-server (WSL) lifecycle ──────────────────────
_llama_proc = None
_llama_lock = threading.Lock()
_infer_lock = threading.Lock()   # memory-bound: 1 request một lúc


def _kill_orphans():
    subprocess.run(["wsl", "-e", "bash", "-lc", f"pkill -f 'llama-server.*--port {LLAMA_PORT}'"],
                   capture_output=True)


def _upstream_alive(timeout=2) -> bool:
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{LLAMA_PORT}/health", timeout=timeout)
        return True
    except urllib.error.HTTPError as e:
        return e.code != 503   # 503 = đang nạp model
    except Exception:
        return False


def ensure_upstream(wait_s=120) -> bool:
    global _llama_proc
    with _llama_lock:
        if _upstream_alive():
            return True
        _kill_orphans()
        print(f"[sidecar] spawn llama-server WSL port {LLAMA_PORT}…", flush=True)
        _llama_proc = subprocess.Popen(
            ["wsl", "-e", "bash", "-lc",
             f"exec {LLAMA_BIN} -m {MODEL_WSL} -t {THREADS} -c 256 "
             f"--host 127.0.0.1 --port {LLAMA_PORT} 2>/dev/null"],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        for _ in range(wait_s):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{LLAMA_PORT}/health", timeout=2)
                print("[sidecar] llama-server sẵn sàng", flush=True)
                return True
            except urllib.error.HTTPError as e:
                if e.code == 503:
                    time.sleep(1)
                    continue
                return True   # server sống, endpoint khác 503 -> coi là sẵn sàng
            except Exception:
                time.sleep(1)
        print("[sidecar] llama-server KHÔNG lên nổi", flush=True)
        return False


def shutdown_llama():
    global _llama_proc
    try:
        if _llama_proc:
            _llama_proc.terminate()
    except Exception:
        pass
    _kill_orphans()
    _llama_proc = None


# ── Dịch ──────────────────────────────────────────────
def _infer_one(sent: str, tag: int) -> str:
    ids = [BOS, tag] + sp.encode(normalize_for_model(sent)) + [EOS]
    if len(ids) > 180:            # ctx 256, chừa chỗ cho output — model train max 256 vị trí
        ids = ids[:179] + [EOS]
    body = json.dumps({
        "prompt": ids,
        "n_predict": min(200, 250 - len(ids)),
        "temperature": 0.0,
        "repeat_penalty": 1.0,
        "cache_prompt": False,
    }).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{LLAMA_PORT}/completion", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        j = json.loads(r.read().decode("utf-8"))
    return clean_output(j.get("content", ""))


def translate(text: str, direction: str) -> str:
    # vi2ja bị KHOÁ: các vòng KD v5-v7 chỉ luyện ja->vi, chiều ngược đã thoái hoá
    # (đo 2026-07-30: input vi ra output vi). Chỉ mở lại sau khi train hai chiều.
    if direction != "ja2vi":
        raise ValueError(f"direction chưa hỗ trợ: {direction} (chỉ ja2vi)")
    tag = TAG[direction]
    with _infer_lock:
        if not _upstream_alive():
            if not ensure_upstream():
                raise RuntimeError("llama-server không sẵn sàng")
        # ja2vi: tách câu (data train 1 câu/dòng). vi2ja: caption vi->ja hiếm khi nhiều câu.
        parts = split_sentences(text) if direction == "ja2vi" else [text]
        outs = [_infer_one(p, tag) for p in parts]
    out = " ".join(o for o in outs if o).strip()
    if direction == "vi2ja":
        out = restore_ja_fullwidth(out)
    return out


# ── HTTP server ───────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):   # tắt access log mặc định (ồn)
        pass

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True, "upstream": _upstream_alive()})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/shutdown":
            self._send(200, {"ok": True})
            threading.Thread(target=lambda: (time.sleep(0.2), shutdown_llama(), os._exit(0)),
                             daemon=True).start()
            return
        if self.path != "/translate":
            self._send(404, {"error": "not found"})
            return
        try:
            n = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(n).decode("utf-8"))
            text = (payload.get("text") or "").strip()
            direction = payload.get("direction") or "ja2vi"
            if not text:
                self._send(400, {"error": "text rỗng"})
                return
            t0 = time.time()
            out = translate(text, direction)
            self._send(200, {"translation": out, "ms": int((time.time() - t0) * 1000)})
            print(f"[sidecar] {direction} {int((time.time()-t0)*1000)}ms: "
                  f"{text[:40]!r} -> {out[:40]!r}", flush=True)
        except Exception as e:
            print(f"[sidecar] lỗi: {e}", flush=True)
            self._send(500, {"error": str(e)})


def main():
    if not Path(SPM_MODEL).exists():
        print(f"[sidecar] THIẾU tokenizer: {SPM_MODEL}", flush=True)
        sys.exit(1)
    ok = subprocess.run(["wsl", "-e", "bash", "-lc", f"test -f {MODEL_WSL}"],
                        capture_output=True).returncode == 0
    if not ok:
        print(f"[sidecar] THIẾU model: {MODEL_WSL}", flush=True)
        sys.exit(1)
    threading.Thread(target=ensure_upstream, daemon=True).start()   # nạp model song song
    srv = ThreadingHTTPServer(("127.0.0.1", SIDECAR_PORT), Handler)
    print(f"[sidecar] nghe 127.0.0.1:{SIDECAR_PORT} | model {MODEL_WSL} | llama :{LLAMA_PORT}",
          flush=True)
    try:
        srv.serve_forever()
    finally:
        shutdown_llama()


if __name__ == "__main__":
    main()
