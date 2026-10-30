"""Downloads the on-server nudity check model and checks its fingerprint.

Used by the Dockerfile (and CI) so every build gets exactly the same file:

    python models/fetch_nsfw_model.py models/marqo-nsfw-384.onnx

Model: Marqo/nsfw-image-detection-384 (Apache-2.0), as the ONNX export published by ICIJ at a
fixed revision. Input [1, 3, 384, 384] scaled to [-1, 1]; output logits for ["NSFW", "SFW"].
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

URL = (
    "https://huggingface.co/ICIJ/nsfw-image-detection-384-onnx/resolve/"
    "4f63fac119fb24a9d98393e57549b1427530ca52/marqo-nsfw-384.onnx"
)
SHA256 = "50256dde930a4ceeb8953246ba7345158e02cc0a201a173402ab3e6e3a76f40a"


def main(dest: str) -> int:
    target = Path(dest)
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == SHA256:
        print(f"{target} is already the right model.")
        return 0
    with urllib.request.urlopen(URL, timeout=120) as response:
        data = response.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256:
        print(f"Model fingerprint mismatch: got {digest}", file=sys.stderr)
        return 1
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    print(f"Saved {target} ({len(data) // 1024} KB).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "models/marqo-nsfw-384.onnx"))
