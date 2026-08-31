"""Loopback-only IndexTTS-2.5 JSON bridge for GitHub Video Studio."""

import base64
import json
import os
import sys
import tempfile
import traceback
from threading import Lock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(os.environ.get("INDEXTTS_ROOT", r"D:\AI\indextts"))
sys.path.insert(0, str(ROOT))

MODEL = None
MODEL_LOCK = Lock()


def load_model():
    global MODEL
    if MODEL is not None:
        return MODEL
    from indextts.infer_v2_5 import IndexTTS2

    MODEL = IndexTTS2(
        cfg_path=str(ROOT / "checkpoints" / "config.yaml"),
        model_dir=str(ROOT / "checkpoints"),
        use_bf16=True,
        device=None,
        use_cuda_kernel=os.environ.get("INDEXTTS_USE_CUDA_KERNEL", "0").lower() in {"1", "true", "yes"},
        use_qwen_emo=False,
    )
    return MODEL


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"ok": True, "model": "IndexTTS-2.5"})
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/v1/synthesize":
            self.send_json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            text = str(payload["text"]).strip()
            voice = Path(str(payload["voicePath"])).resolve()
            if not text or not voice.is_file():
                raise ValueError("text and an existing voicePath are required")
            output_fd, output_name = tempfile.mkstemp(suffix=".wav")
            os.close(output_fd)
            output = Path(output_name)
            with MODEL_LOCK:
                model = load_model()
                model.infer(
                    spk_audio_prompt=str(voice),
                    text=text,
                    output_path=str(output),
                    lang=str(payload.get("lang", "zh")),
                    emo_vector=[0.15, 0, 0, 0, 0, 0, 0.1, 0.4],
                    duration_factor=1.0,
                    interval_silence=180,
                )
            audio = output.read_bytes()
            output.unlink(missing_ok=True)
            if not audio:
                raise RuntimeError("IndexTTS produced an empty audio file")
            import wave

            with wave.open(__import__("io").BytesIO(audio), "rb") as wav:
                duration_ms = round(wav.getnframes() / wav.getframerate() * 1000)
                sample_rate = wav.getframerate()
            self.send_json(200, {"audioBase64": base64.b64encode(audio).decode("ascii"), "durationMs": duration_ms, "sampleRate": sample_rate})
        except Exception as exc:
            traceback.print_exc()
            self.send_json(500, {"error": str(exc), "traceback": traceback.format_exc()})


if __name__ == "__main__":
    port = int(os.environ.get("INDEXTTS_PORT", "8125"))
    print(f"IndexTTS Bridge listening on http://127.0.0.1:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
