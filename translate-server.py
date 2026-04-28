#!/usr/bin/env python3
"""
translate-server.py — CTranslate2 NLLB-200 inference server.

Protocol (JSON-line qua stdin/stdout):
  stdin:   {"id": 1, "text": "...", "srcLang": "jpn_Jpan", "tgtLang": "vie_Latn"}
  stdout:  {"type": "ready"}                   — khi model đã load xong
  stdout:  {"type": "result", "id": 1, "text": "..."}
  stdout:  {"type": "error", "msg": "..."}     — lỗi fatal
"""
# Phải set trước khi import transformers để suppress warning Mistral-regex
import os
import sys
import io
import warnings
os.environ.setdefault('TRANSFORMERS_NO_ADVISORY_WARNINGS', '1')
os.environ.setdefault('HF_HUB_DISABLE_PROGRESS_BARS', '1')
warnings.filterwarnings('ignore')  # suppress all Python warnings (tokenizer regex, etc.)

# Force stdin/stdout UTF-8 — cần thiết trên Windows vì console mặc định dùng cp932/cp1252
if hasattr(sys.stdin, 'reconfigure'):
    sys.stdin.reconfigure(encoding='utf-8')
else:
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8', errors='replace')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
else:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import json


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def eprint(*a):
    print(*a, file=sys.stderr, flush=True)


# Mapping langdetect code → NLLB FLORES-200 code
_LANG_MAP = {
    'ja': 'jpn_Jpan', 'en': 'eng_Latn', 'zh-cn': 'zho_Hans', 'zh-tw': 'zho_Hant',
    'ko': 'kor_Hang', 'vi': 'vie_Latn', 'fr': 'fra_Latn', 'de': 'deu_Latn',
    'es': 'spa_Latn', 'pt': 'por_Latn', 'ru': 'rus_Cyrl', 'ar': 'arb_Arab',
    'th': 'tha_Thai', 'id': 'ind_Latn', 'ms': 'zsm_Latn',
}

try:
    from langdetect import detect as _ld_detect
    _HAS_LANGDETECT = True
except ImportError:
    _HAS_LANGDETECT = False

def detect_src_lang(text):
    """Tự detect ngôn ngữ nguồn, trả về NLLB FLORES-200 code."""
    if _HAS_LANGDETECT:
        try:
            code = _ld_detect(text).lower()
            return _LANG_MAP.get(code, 'jpn_Jpan')
        except Exception:
            pass
    return 'jpn_Jpan'  # fallback mặc định


def main():
    model_dir = sys.argv[1] if len(sys.argv) > 1 else "nllb-ct2"

    try:
        import ctranslate2
        from transformers import AutoTokenizer
    except ImportError as e:
        emit({"type": "error", "msg": f"Thiếu gói Python: {e}. Chạy: pip install ctranslate2 transformers sentencepiece"})
        sys.exit(1)

    eprint(f"[nllb] Đang load model từ {model_dir} ...")

    try:
        # inter_threads=1: 1 request tại 1 thời điểm
        # intra_threads=2: dùng 2 CPU thread cho mỗi request — đủ nhanh, không chiếm quá nhiều
        translator = ctranslate2.Translator(
            model_dir,
            device="cpu",
            compute_type="int8",
            inter_threads=1,
            intra_threads=2,
        )
        # Load tokenizer từ HF hub cache (local, không cần internet sau lần đầu tải)
        # Dùng "facebook/nllb-200-distilled-600M" thay vì local dir để đảm bảo
        # tokenization đúng (local dir có thể có file tokenizer sai do save_pretrained bug)
        from transformers import NllbTokenizer
        try:
            tokenizer = NllbTokenizer.from_pretrained(
                "facebook/nllb-200-distilled-600M",
                local_files_only=True,  # chỉ dùng HF local cache — không gọi internet
            )
        except Exception:
            # Fallback: load từ local nllb-ct2/ nếu HF cache chưa có
            tokenizer = NllbTokenizer.from_pretrained(model_dir)
    except Exception as e:
        emit({"type": "error", "msg": f"Load model thất bại: {e}"})
        sys.exit(1)

    eprint("[nllb] Model sẵn sàng")
    emit({"type": "ready"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        msg = {}
        try:
            msg = json.loads(line)
            req_id   = msg["id"]
            text     = msg["text"]
            tgt_lang = msg["tgtLang"]

            # Auto-detect ngôn ngữ nguồn qua langdetect → map sang NLLB code
            src_lang = detect_src_lang(text)

            tokenizer.src_lang = src_lang
            encoded = tokenizer(text)
            source_tokens = [
                t for t in tokenizer.convert_ids_to_tokens(encoded["input_ids"])
                if t is not None
            ]

            results = translator.translate_batch(
                [source_tokens],
                target_prefix=[[tgt_lang]],
                beam_size=1,          # greedy: nhanh ~4×, ít RAM hơn beam search
                max_decoding_length=150,
                no_repeat_ngram_size=3,
            )

            # Bỏ token đầu (tgt_lang prefix), decode phần còn lại
            target_tokens = results[0].hypotheses[0][1:]
            target_ids    = tokenizer.convert_tokens_to_ids(target_tokens)
            translation   = tokenizer.decode(target_ids, skip_special_tokens=True)

            emit({"type": "result", "id": req_id, "text": translation})

        except json.JSONDecodeError as e:
            eprint(f"[nllb] JSON decode lỗi: {e} | raw repr: {repr(line[:80])}")
        except Exception as e:
            eprint(f"[nllb] Lỗi dịch id={msg.get('id','?')}: {type(e).__name__}: {e}")
            emit({"type": "result", "id": msg.get("id", -1), "text": msg.get("text", "")})


if __name__ == "__main__":
    main()
