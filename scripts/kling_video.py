#!/usr/bin/env python3
"""
Kling Video Generation Script
支持两种模式：
  - image2video: 首尾帧模式，需要提供 first_frame + last_frame
  - text2video:  参考图模式，提供一张初始图作为角色参考

用法示例：
  # 首尾帧模式
  python kling_video.py image2video \
    --first-frame path/to/first.png \
    --last-frame  path/to/last.png \
    --prompt "角色慢慢抬头看向镜头" \
    --output output.mp4

  # 参考图模式
  python kling_video.py text2video \
    --initial-image path/to/char_ref.png \
    --prompt "女孩抱着狐狸，轻轻抚摸" \
    --output output.mp4
"""

import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.request
import urllib.error

# ── JWT Token ────────────────────────────────────────────────────────────────

def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def generate_kling_token(access_key: str, secret_key: str) -> str:
    now = int(time.time())
    header  = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64url(json.dumps({"iss": access_key, "exp": now + 1800, "nbf": now - 5}).encode())
    msg = f"{header}.{payload}"
    sig = _b64url(hmac.new(secret_key.encode(), msg.encode(), hashlib.sha256).digest())
    return f"{msg}.{sig}"

# ── Helpers ───────────────────────────────────────────────────────────────────

def to_base64(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()

def api_request(method: str, url: str, token: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {body_text}") from e

def download_file(url: str, dest: str) -> None:
    print(f"  Downloading {url} → {dest}")
    urllib.request.urlretrieve(url, dest)

# ── Core ──────────────────────────────────────────────────────────────────────

def submit_image2video(base_url: str, token: str, model: str,
                       first_frame: str, last_frame: str,
                       prompt: str, duration: int, ratio: str) -> str:
    print(f"[Kling] image2video: model={model}, duration={duration}s, ratio={ratio}")
    resp = api_request("POST", f"{base_url}/v1/videos/image2video", token, {
        "model": model,
        "prompt": prompt,
        "image": to_base64(first_frame),
        "tail_image": to_base64(last_frame),
        "duration": duration,
        "aspect_ratio": ratio,
        "sound": "on",
    })
    if resp.get("code") != 0:
        raise RuntimeError(f"image2video submit error: {resp.get('message')}")
    task_id = resp["data"]["task_id"]
    print(f"[Kling] Task submitted: {task_id}")
    return task_id

def submit_text2video(base_url: str, token: str, model: str,
                      initial_image: str | None,
                      prompt: str, duration: int, ratio: str) -> str:
    print(f"[Kling] text2video: model={model}, duration={duration}s, ratio={ratio}")
    body: dict = {
        "model": model,
        "prompt": prompt,
        "duration": duration,
        "aspect_ratio": ratio,
        "sound": "on",
    }
    if initial_image:
        body["reference_image"] = [to_base64(initial_image)]

    resp = api_request("POST", f"{base_url}/v1/videos/text2video", token, body)

    # Fallback: if reference_image unsupported, retry without it
    if resp.get("code") != 0 and initial_image:
        print(f"[Kling] reference_image rejected ({resp.get('message')}), retrying without it")
        body.pop("reference_image", None)
        resp = api_request("POST", f"{base_url}/v1/videos/text2video", token, body)

    if resp.get("code") != 0:
        raise RuntimeError(f"text2video submit error: {resp.get('message')}")
    task_id = resp["data"]["task_id"]
    print(f"[Kling] Task submitted: {task_id}")
    return task_id

def poll_for_result(base_url: str, token: str,
                    task_id: str, task_type: str,
                    max_attempts: int = 120, interval: int = 5) -> str:
    for i in range(max_attempts):
        time.sleep(interval)
        resp = api_request("GET", f"{base_url}/v1/videos/{task_type}/{task_id}", token)
        if resp.get("code") != 0:
            raise RuntimeError(f"Poll error: {resp.get('message')}")

        data = resp["data"]
        status = data.get("task_status")
        print(f"[Kling] Poll {i+1}: status={status}")

        if status == "succeed":
            url = data.get("task_result", {}).get("videos", [{}])[0].get("url")
            if not url:
                raise RuntimeError("No video URL in result")
            return url
        if status == "failed":
            raise RuntimeError(f"Generation failed: {data.get('task_status_msg')}")

    raise RuntimeError("Timed out after 10 minutes")

# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Kling Video Generation")
    sub = parser.add_subparsers(dest="mode", required=True)

    # image2video
    p1 = sub.add_parser("image2video", help="首尾帧模式")
    p1.add_argument("--first-frame", required=True, help="首帧图片路径")
    p1.add_argument("--last-frame",  required=True, help="尾帧图片路径")
    p1.add_argument("--prompt",      required=True, help="运动描述")
    p1.add_argument("--output",      default="output.mp4", help="输出文件路径")
    p1.add_argument("--model",       default=None)
    p1.add_argument("--duration",    type=int, default=5, choices=[5, 10, 15])
    p1.add_argument("--ratio",       default="16:9")

    # text2video
    p2 = sub.add_parser("text2video", help="参考图模式（可链式生成）")
    p2.add_argument("--initial-image", default=None, help="角色参考图或上一帧路径（可选）")
    p2.add_argument("--prompt",        required=True, help="场景描述")
    p2.add_argument("--output",        default="output.mp4")
    p2.add_argument("--model",         default=None)
    p2.add_argument("--duration",      type=int, default=5, choices=[5, 10, 15])
    p2.add_argument("--ratio",         default="16:9")

    args = parser.parse_args()

    access_key = os.environ.get("KLING_ACCESS_KEY", "")
    secret_key = os.environ.get("KLING_SECRET_KEY", "")
    base_url   = os.environ.get("KLING_BASE_URL", "https://api-beijing.klingai.com").rstrip("/")

    if not access_key:
        print("Error: KLING_ACCESS_KEY not set", file=sys.stderr)
        sys.exit(1)

    token = generate_kling_token(access_key, secret_key) if secret_key else access_key
    model = args.model or os.environ.get("KLING_MODEL", "kling-v3")

    if args.mode == "image2video":
        task_id = submit_image2video(
            base_url, token, model,
            args.first_frame, args.last_frame,
            args.prompt, args.duration, args.ratio,
        )
        task_type = "image2video"
    else:
        task_id = submit_text2video(
            base_url, token, model,
            args.initial_image,
            args.prompt, args.duration, args.ratio,
        )
        task_type = "text2video"

    video_url = poll_for_result(base_url, token, task_id, task_type)
    print(f"[Kling] Video ready: {video_url}")
    download_file(video_url, args.output)
    print(f"[Kling] Saved to: {args.output}")

if __name__ == "__main__":
    main()
