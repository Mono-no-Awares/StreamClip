import json
import os
import shutil
import zipfile


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_DIR = os.path.join(ROOT_DIR, "dist")
COPY_DIRS = ["_locales", "icons", "src", "vendor"]
COPY_FILES = ["LICENSE", "THIRD_PARTY_NOTICES.md"]


def read_version():
    with open(os.path.join(ROOT_DIR, "manifests", "manifest.chrome.json"), "r", encoding="utf-8") as f:
        return json.load(f)["version"]


def build_target(target, manifest_src, version):
    target_dir = os.path.join(DIST_DIR, target)
    if os.path.exists(target_dir):
        shutil.rmtree(target_dir)
    os.makedirs(target_dir, exist_ok=True)

    for rel_dir in COPY_DIRS:
        shutil.copytree(
            os.path.join(ROOT_DIR, rel_dir),
            os.path.join(target_dir, rel_dir),
        )

    for rel_file in COPY_FILES:
        src_path = os.path.join(ROOT_DIR, rel_file)
        if os.path.exists(src_path):
            shutil.copy2(src_path, os.path.join(target_dir, rel_file))

    shutil.copy2(manifest_src, os.path.join(target_dir, "manifest.json"))

    zip_name = f"streamclip-{target}-v{version}.zip"
    zip_path = os.path.join(DIST_DIR, zip_name)
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for base, _, files in os.walk(target_dir):
            for name in sorted(files):
                full_path = os.path.join(base, name)
                arcname = os.path.relpath(full_path, target_dir).replace("\\", "/")
                zf.write(full_path, arcname)

    return target_dir, zip_path


def main():
    os.makedirs(DIST_DIR, exist_ok=True)
    version = read_version()
    targets = {
        "chrome": os.path.join(ROOT_DIR, "manifests", "manifest.chrome.json"),
        "firefox": os.path.join(ROOT_DIR, "manifests", "manifest.firefox.json"),
    }
    for target, manifest_src in targets.items():
        target_dir, zip_path = build_target(target, manifest_src, version)
        print(f"Built {target}: {target_dir} -> {zip_path}")


if __name__ == "__main__":
    main()
