"""Build-time only: download official immutable weights and verify size/SHA256."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download_models(directory):
    manifest = json.loads(Path(__file__).with_name("model-manifest.json").read_text())
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    for model in manifest["models"]:
        target = directory / model["file"]
        valid = lambda path: path.is_file() and path.stat().st_size == model["size"] and sha256_file(path) == model["sha256"]
        if not valid(target):
            temporary = target.with_suffix(".partial")
            try:
                with urllib.request.urlopen(model["url"], timeout=120) as source, temporary.open("wb") as output:
                    received = 0
                    while block := source.read(1024 * 1024):
                        received += len(block)
                        if received > model["size"]:
                            raise RuntimeError("Official model download exceeds pinned size")
                        output.write(block)
                if not valid(temporary):
                    raise RuntimeError("Official model size/SHA256 verification failed")
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
        print(json.dumps({"file": model["file"], "sha256": model["sha256"], "verified": True}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", required=True)
    download_models(parser.parse_args().model_dir)
