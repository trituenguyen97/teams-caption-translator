#!/usr/bin/env python
"""
export-punc-ja.py — Export model phục hồi dấu câu tiếng Nhật (bobfromjapan/bert_japanese_punctuation)
sang ONNX int4 (MatMulNBits) để app dùng offline qua onnxruntime-node. CHẠY 1 LẦN ở máy dev trước khi đóng
gói (người dùng cuối KHÔNG cần Python/torch). Output: bin/punc/ja/model.int4.onnx (~78MB) + vocab.txt.

Model: token-classifier char-level trên tohoku-nlp/bert-base-japanese-char-v3 (91.4M tham số),
2 nhãn (、 / 。). Char-level nên KHÔNG cần MeCab — tokenize bằng tra ký tự→id (xem src/punctuate-ja.js).

Cần: pip install torch transformers onnx onnxruntime huggingface_hub
"""
import os, shutil, sys
import torch
from transformers import BertModel
from huggingface_hub import hf_hub_download

BASE = "tohoku-nlp/bert-base-japanese-char-v3"
REPO = "bobfromjapan/bert_japanese_punctuation"
OUT  = os.path.join(os.path.dirname(__file__), "..", "bin", "punc", "ja")

class PunctPredictor(torch.nn.Module):
    def __init__(self, base):
        super().__init__()
        self.base_model = base
        self.dropout = torch.nn.Dropout(0.2)
        self.linear = torch.nn.Linear(768, 2)
    def forward(self, input_ids, attention_mask):
        h = self.base_model(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
        return self.linear(self.dropout(h))

def main():
    os.makedirs(OUT, exist_ok=True)
    print("[export-punc-ja] tải base + weights…")
    base = BertModel.from_pretrained(BASE)
    m = PunctPredictor(base)
    w = hf_hub_download(REPO, "weight/punctuation_position_model.pth")
    m.load_state_dict(torch.load(w, map_location="cpu"))
    m.eval()

    fp32 = os.path.join(OUT, "model.fp32.onnx")
    int4 = os.path.join(OUT, "model.int4.onnx")
    dummy_ids = torch.ones(1, 16, dtype=torch.long)
    dummy_mask = torch.ones(1, 16, dtype=torch.long)
    print("[export-punc-ja] export ONNX (seq length động, opset 14)…")
    torch.onnx.export(
        m, (dummy_ids, dummy_mask), fp32,
        input_names=["input_ids", "attention_mask"], output_names=["logits"],
        dynamic_axes={"input_ids": {0: "b", 1: "t"}, "attention_mask": {0: "b", 1: "t"}, "logits": {0: "b", 1: "t"}},
        opset_version=14, do_constant_folding=True,
    )
    print("[export-punc-ja] lượng tử hoá int4 (MatMulNBits, block 32)…")
    import onnx
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
    model_onnx = onnx.load(fp32)
    try: q = MatMulNBitsQuantizer(model_onnx, block_size=32, is_symmetric=True)
    except TypeError: q = MatMulNBitsQuantizer(model_onnx)
    q.process()
    try: q.model.save_model_to_file(int4, use_external_data_format=False)
    except Exception: onnx.save(getattr(q.model, "model", q.model), int4)
    for f in os.listdir(OUT):           # dọn fp32 + external data
        if f.startswith("model.fp32"): os.remove(os.path.join(OUT, f))

    v = hf_hub_download(BASE, "vocab.txt")
    shutil.copy(v, os.path.join(OUT, "vocab.txt"))
    sz = os.path.getsize(int4) / 1e6
    print(f"[export-punc-ja] xong → bin/punc/ja/model.int4.onnx ({sz:.0f} MB) + vocab.txt")

if __name__ == "__main__":
    main()
