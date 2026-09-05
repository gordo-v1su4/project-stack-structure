import base64
import json
import os
import re
import threading
import time
from typing import Any

import requests
from fastapi import Body, FastAPI, File, Form, Header, HTTPException, UploadFile

QWEN_MODEL = os.getenv("QWEN_GGUF_MODEL", "Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M")
QWEN_URL = os.getenv("QWEN_LLAMA_URL", "http://qwen-llama:18092/v1/chat/completions").rstrip("/")
QWEN_HEALTH_URL = os.getenv("QWEN_LLAMA_HEALTH_URL", "http://qwen-llama:18092/health")
MAX_TOKENS = int(os.getenv("QWEN_MAX_TOKENS", "180"))
STORY_MAX_TOKENS = int(os.getenv("QWEN_STORY_MAX_TOKENS", "4096"))
TEMPERATURE = float(os.getenv("QWEN_TEMPERATURE", "0.5"))
STORY_TEMPERATURE = float(os.getenv("QWEN_STORY_TEMPERATURE", "0.6"))
TIMEOUT = int(os.getenv("QWEN_TIMEOUT_SECONDS", "300"))
STORY_TIMEOUT = int(os.getenv("QWEN_STORY_TIMEOUT_SECONDS", "600"))
API_TOKEN = os.getenv("CAPTION_API_TOKEN", "")
LOCK_PATH = os.getenv("GPU_LOCK_PATH", "/gpu-lock/stack-structure-gpu.lock")
LOCK_TIMEOUT = float(os.getenv("GPU_LOCK_TIMEOUT_SECONDS", "900"))
_started = time.time()

app = FastAPI(title="Stack Structure staging caption gateway", version="2.0.0")


def require_auth(authorization: str | None) -> None:
    if API_TOKEN and authorization != f"Bearer {API_TOKEN}":
        raise HTTPException(status_code=401, detail="Invalid caption gateway token")


def backend_health() -> dict[str, Any]:
    try:
        response = requests.get(QWEN_HEALTH_URL, timeout=3)
        detail = response.json() if response.text else {}
        return {"ok": response.ok, "status": response.status_code, "detail": detail}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:300]}


class GpuLock:
    def __enter__(self):
        started = time.time()
        while True:
            try:
                self.handle = open(LOCK_PATH, "a+")
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except BlockingIOError:
                if time.time() - started >= LOCK_TIMEOUT:
                    raise HTTPException(status_code=503, detail="GPU lock timeout")
                time.sleep(1)

    def __exit__(self, *_args):
        import fcntl
        fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        self.handle.close()


def prompt_text(prompt: str, context: str, source: str) -> str:
    parts = [
        "You are captioning one representative image for a music-video source clip.",
        "Return compact JSON with keys: caption, shotType, subjects, action, setting, lighting, timeOfDay, weather.",
        "caption must be one concrete searchable natural-language sentence.",
        f"Source: {source}",
    ]
    if context.strip():
        parts.append(f"Project and scene context: {context.strip()}")
    parts.append(prompt.strip() or "Describe the visible scene.")
    return "\n".join(parts)


def parse_caption(value: str) -> dict[str, Any]:
    cleaned = value.strip().strip("`")
    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    return {"caption": re.sub(r"\s+", " ", cleaned).strip()}


def parse_json_object(value: str) -> dict[str, Any]:
    cleaned = value.strip().strip("`")
    if cleaned.lower().startswith("json"):
        cleaned = cleaned.split("\n", 1)[-1].strip()
    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if not match:
        raise ValueError("Qwen returned no JSON object")
    parsed = json.loads(match.group(0))
    if not isinstance(parsed, dict):
        raise ValueError("Qwen story response must be a JSON object")
    return parsed


@app.get("/health")
def health() -> dict[str, Any]:
    backend = backend_health()
    return {
        "ok": True,
        "service": "stack-structure-scene-caption-gateway",
        "runtime": "fastapi-llama-cpp-gguf-container",
        "model": QWEN_MODEL,
        "qwenBackendHealthy": backend["ok"],
        "qwenBackendUrl": QWEN_URL,
        "uptimeSeconds": round(time.time() - _started, 2),
    }


@app.get("/admin/qwen/status")
def qwen_status(authorization: str | None = Header(default=None)):
    require_auth(authorization)
    return {"active": backend_health()["ok"], "backendHealthy": backend_health()["ok"], "mode": "container"}


@app.post("/admin/qwen/start")
def qwen_start(authorization: str | None = Header(default=None)):
    require_auth(authorization)
    return {"ok": backend_health()["ok"], "mode": "container", "message": "Qwen container is managed by Compose."}


@app.post("/admin/qwen/stop")
def qwen_stop(authorization: str | None = Header(default=None)):
    require_auth(authorization)
    return {"ok": True, "mode": "container", "message": "Qwen stop is controlled by Compose."}


@app.post("/caption/scene")
def caption_scene(
    image: UploadFile = File(...),
    prompt: str = Form(""),
    model: str = Form(""),
    mode: str = Form("smart"),
    sourceName: str = Form(""),
    captionContext: str = Form(""),
    authorization: str | None = Header(default=None),
):
    require_auth(authorization)
    if mode != "smart":
        raise HTTPException(status_code=400, detail="Staging caption gateway only handles smart Qwen3-VL GGUF captions.")
    try:
        raw = image.file.read()
    finally:
        image.file.close()
    if not raw:
        raise HTTPException(status_code=400, detail="image is empty")
    mime = image.content_type or "image/jpeg"
    encoded = base64.b64encode(raw).decode("ascii")
    payload = {
        "model": model or QWEN_MODEL,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt_text(prompt, captionContext, sourceName)},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}},
        ]}],
        "max_tokens": MAX_TOKENS,
        "temperature": TEMPERATURE,
    }
    with GpuLock():
        try:
            response = requests.post(QWEN_URL, json=payload, timeout=TIMEOUT)
            response.raise_for_status()
            data = response.json()
            text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            parsed = parse_caption(str(text))
            caption = str(parsed.get("caption") or parsed.get("text") or "").strip()
            if not caption:
                raise RuntimeError("Qwen returned no caption text")
            return {"ok": True, "source": "qwen3-vl-server", "model": model or QWEN_MODEL, "text": caption, "caption": caption, "meta": parsed}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Qwen3-VL GGUF captioning failed: {str(exc)[:500]}") from exc


@app.post("/story/treatments")
def story_treatments(
    body: dict[str, Any] = Body(...),
    authorization: str | None = Header(default=None),
):
    require_auth(authorization)
    instructions = str(body.get("instructions") or "").strip()
    user_input = str(body.get("input") or "").strip()
    if not instructions or not user_input:
        raise HTTPException(status_code=400, detail="instructions and input are required")
    model = str(body.get("model") or QWEN_MODEL).strip() or QWEN_MODEL
    max_tokens = int(body.get("max_tokens") or STORY_MAX_TOKENS)
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": instructions},
            {
                "role": "user",
                "content": f"{user_input}\n\nReturn only valid JSON with a top-level treatments array. No markdown fences.",
            },
        ],
        "max_tokens": max_tokens,
        "temperature": STORY_TEMPERATURE,
    }
    with GpuLock():
        try:
            response = requests.post(QWEN_URL, json=payload, timeout=STORY_TIMEOUT)
            response.raise_for_status()
            data = response.json()
            text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            if not str(text).strip():
                raise RuntimeError("Qwen returned no story treatment text")
            parsed = parse_json_object(str(text))
            usage = data.get("usage") if isinstance(data.get("usage"), dict) else None
            return {
                "ok": True,
                "source": "qwen3-vl-server",
                "model": model,
                "output": parsed,
                "usage": usage,
            }
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Qwen story treatment failed: {str(exc)[:500]}") from exc
