"""TongPing local transcription service (optional, for subtitles).

Started by the worker when installed (`npm run asr:install`). Nothing leaves
this computer except the one-time model download.

Protocol (one JSON object per line):
  stdin : {"id": "...", "path": "clip.wav", "language": "zh"?}
  stdout: {"ready": true, "model": "...", "device": "cuda|cpu"}       once, at start
          {"id": "...", "segments": [{"start": s, "end": s, "text": "..."}], "language": "zh"}
Segment times are relative to the start of the clip.

Environment:
  TONGPING_ASR_DEVICE     auto (default) | cuda | cpu
  TONGPING_ASR_MODEL      model used on GPU (default large-v3-turbo)
  TONGPING_ASR_CPU_MODEL  model used on CPU (default small)
  HF_ENDPOINT             e.g. https://hf-mirror.com when huggingface.co is unreachable
"""

import json
import os
import site
import sys


def add_cuda_dll_dirs() -> None:
    # pip's nvidia-cublas / nvidia-cudnn wheels ship their DLLs under
    # site-packages/nvidia/*/bin; ctranslate2 needs them on the DLL path (Windows).
    if os.name != "nt":
        preload_linux_cuda_libs()
        return
    for base in site.getsitepackages():
        nvidia = os.path.join(base, "nvidia")
        if not os.path.isdir(nvidia):
            continue
        for name in os.listdir(nvidia):
            bin_dir = os.path.join(nvidia, name, "bin")
            if os.path.isdir(bin_dir):
                os.add_dll_directory(bin_dir)
                os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")


def preload_linux_cuda_libs() -> None:
    # On Linux the pip CUDA wheels are not on the loader path; load them once
    # with RTLD_GLOBAL so ctranslate2 can find cuBLAS / cuDNN.
    import ctypes
    import glob

    for base in site.getsitepackages():
        for pattern in ("nvidia/cublas/lib/libcublas*.so*", "nvidia/cudnn/lib/libcudnn*.so*"):
            for lib in sorted(glob.glob(os.path.join(base, pattern))):
                try:
                    ctypes.CDLL(lib, mode=ctypes.RTLD_GLOBAL)
                except OSError:
                    pass


def emit(message: dict) -> None:
    print(json.dumps(message, ensure_ascii=False), flush=True)


def load_model():
    from faster_whisper import WhisperModel

    device = os.environ.get("TONGPING_ASR_DEVICE", "auto").strip().lower() or "auto"
    gpu_model = os.environ.get("TONGPING_ASR_MODEL", "large-v3-turbo").strip() or "large-v3-turbo"
    cpu_model = os.environ.get("TONGPING_ASR_CPU_MODEL", "small").strip() or "small"
    if device in ("auto", "cuda"):
        try:
            return WhisperModel(gpu_model, device="cuda", compute_type="float16"), gpu_model, "cuda"
        except Exception as error:  # no usable GPU: slower, but still works
            if device == "cuda":
                raise
            emit({"warning": "cuda unavailable, using cpu: " + str(error)[:300]})
    return WhisperModel(cpu_model, device="cpu", compute_type="int8"), cpu_model, "cpu"


def main() -> None:
    add_cuda_dll_dirs()
    try:
        model, model_name, device = load_model()
    except Exception as error:
        emit({"ready": False, "error": str(error)[:500]})
        sys.exit(1)
    emit({"ready": True, "model": model_name, "device": device})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = ""
        try:
            request = json.loads(line)
            request_id = str(request.get("id", ""))
            segments, info = model.transcribe(
                request["path"],
                language=request.get("language") or None,
                vad_filter=True,
                beam_size=1,
                condition_on_previous_text=False,
            )
            out = [
                {"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()}
                for seg in segments
                if seg.text.strip()
            ]
            emit({"id": request_id, "segments": out, "language": info.language})
        except Exception as error:
            emit({"id": request_id, "error": str(error)[:500]})


if __name__ == "__main__":
    main()
