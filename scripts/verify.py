import ast
import json
import os
import tokenize
import io


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_DIRS = ["src", "scripts", "manifests", "_locales"]


def scan_js_comments(text):
    i = 0
    n = len(text)
    in_str = None
    in_regex = False
    prev_sig = ""
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if in_str:
            if ch == "\\":
                i += 2
                continue
            if ch == in_str:
                in_str = None
                prev_sig = ch
            i += 1
            continue
        if in_regex:
            if ch == "\\":
                i += 2
                continue
            if ch == "/":
                in_regex = False
                prev_sig = "/"
            i += 1
            continue
        if ch in ("'", '"', "`"):
            in_str = ch
            i += 1
            continue
        if ch == "/" and nxt == "/":
            return f"line comment at offset {i}"
        if ch == "/" and nxt == "*":
            return f"block comment at offset {i}"
        if ch == "/" and prev_sig in ("", "(", ",", "=", ":", "[", "!", "&", "|", "?", ";", "{", "}", "return"):
            in_regex = True
            i += 1
            continue
        if not ch.isspace():
            prev_sig = ch
        i += 1
    return None


def scan_css_comments(text):
    i = 0
    n = len(text)
    in_str = None
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if in_str:
            if ch == "\\":
                i += 2
                continue
            if ch == in_str:
                in_str = None
            i += 1
            continue
        if ch in ("'", '"'):
            in_str = ch
            i += 1
            continue
        if ch == "/" and nxt == "*":
            return f"css comment at offset {i}"
        i += 1
    return None


def scan_html_comments(text):
    idx = text.find("<!--")
    if idx != -1:
        return f"html comment at offset {idx}"
    return None


def scan_python_comments(text):
    tokens = tokenize.generate_tokens(io.StringIO(text).readline)
    for tok in tokens:
        if tok.type == tokenize.COMMENT:
            return f"python comment on line {tok.start[0]}"
    return None


def verify_no_comments():
    errors = []
    for base_dir in SOURCE_DIRS:
        abs_dir = os.path.join(ROOT_DIR, base_dir)
        for root, _, files in os.walk(abs_dir):
            for name in sorted(files):
                path = os.path.join(root, name)
                rel = os.path.relpath(path, ROOT_DIR)
                if name.endswith(".pyc") or "__pycache__" in rel:
                    continue
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()
                issue = None
                if name.endswith(".js"):
                    issue = scan_js_comments(content)
                elif name.endswith(".css"):
                    issue = scan_css_comments(content)
                elif name.endswith(".html"):
                    issue = scan_html_comments(content)
                elif name.endswith(".py"):
                    issue = scan_python_comments(content)
                    ast.parse(content, filename=rel)
                if issue:
                    errors.append(f"{rel}: {issue}")
    if errors:
        raise AssertionError("Comment check failed:\n" + "\n".join(errors))


def verify_manifests():
    manifest_paths = [
        os.path.join(ROOT_DIR, "manifest.json"),
        os.path.join(ROOT_DIR, "manifests", "manifest.chrome.json"),
        os.path.join(ROOT_DIR, "manifests", "manifest.firefox.json"),
    ]
    for mpath in manifest_paths:
        with open(mpath, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert data["manifest_version"] == 3, mpath
        for icon_path in data.get("icons", {}).values():
            assert os.path.isfile(os.path.join(ROOT_DIR, icon_path)), icon_path
        popup = data.get("action", {}).get("default_popup")
        if popup:
            assert os.path.isfile(os.path.join(ROOT_DIR, popup)), popup
        bg = data.get("background", {})
        if "service_worker" in bg:
            assert os.path.isfile(os.path.join(ROOT_DIR, bg["service_worker"])), bg["service_worker"]
        for s in bg.get("scripts", []):
            assert os.path.isfile(os.path.join(ROOT_DIR, s)), s
        for cs in data.get("content_scripts", []):
            for s in cs.get("js", []):
                assert os.path.isfile(os.path.join(ROOT_DIR, s)), s

    for loc in ("en", "ru"):
        msg_path = os.path.join(ROOT_DIR, "_locales", loc, "messages.json")
        with open(msg_path, "r", encoding="utf-8") as f:
            msgs = json.load(f)
        assert "extName" in msgs and "extDescription" in msgs, msg_path


def verify_dist():
    for target in ("chrome", "firefox"):
        dist_manifest = os.path.join(ROOT_DIR, "dist", target, "manifest.json")
        assert os.path.isfile(dist_manifest), f"Missing {dist_manifest}"
        with open(dist_manifest, "r", encoding="utf-8") as f:
            data = json.load(f)
        if target == "chrome":
            assert "service_worker" in data["background"]
            assert "offscreen" in data["permissions"]
        else:
            assert "scripts" in data["background"]
            assert "offscreen" not in data["permissions"]
            assert "gecko" in data["browser_specific_settings"]


def main():
    verify_no_comments()
    verify_manifests()
    verify_dist()
    print("All verification checks passed.")


if __name__ == "__main__":
    main()
