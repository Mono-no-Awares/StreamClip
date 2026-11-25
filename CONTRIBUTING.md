# Contributing to StreamClip / Участие в разработке

Thank you for your interest in contributing to StreamClip! / Спасибо за интерес к развитию StreamClip!

## Rules / Правила

1. **Zero dependencies & pure JS**: Keep the extension lightweight without heavy bundlers or external runtime dependencies.
2. **Cross-browser MV3**: Test changes for both Chrome (`manifests/manifest.chrome.json`) and Firefox (`manifests/manifest.firefox.json`).
3. **No comments in source code / Без комментариев в коде**: Keep `src/` and `scripts/` free of code comments and validate via `python scripts/verify.py`.
4. **Build & Verify / Сборка и проверка**:
   ```bash
   python scripts/generate_icons.py
   python scripts/build.py
   python scripts/verify.py
   ```

## Pull Requests

- Describe what changed and which platform (Twitch/Kick, Live/VOD, Chrome/Firefox) you tested.
- Keep PRs focused on a single feature or bug fix.
