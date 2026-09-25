# Lens Translate



Tired of switching windows mid-game to translate? This is a Windows desktop screen translator built with Electron, Tesseract.js, and the OpenAI Responses API,
 which lets you capture text on your screen and see the translation right beside it—so you can follow the dialogue, understand the quest, and stay in the game. 
## Run

Requires Node.js 22 or later and Windows 10/11.

```powershell
npm install
npm start
```

1. Open **Settings**, enter your OpenAI API key, and save. You can alternatively supply `OPENAI_API_KEY` in the launching environment.
2. Select the OCR source language and translation target. The default model is `gpt-4.1-mini`; choose another model from the Settings dropdown if needed. Model access depends on your OpenAI API account.
3. Hold **Ctrl**, left-drag over text in any app, then release the mouse. Lens highlights the region and reads it while the app remains visible.
4. If a game does not expose mouse input, point at the display and press **Alt+Shift+T**, then click a paragraph or drag around text.
5. Use the card to copy, edit OCR and retry, or enable click-through. **Alt+Shift+X** restores controls from click-through. Escape dismisses a focused selection/card.

Closing the main window keeps Lens in the system tray. Use the tray menu to quit.

## Privacy and operation

- Selected screen regions are processed locally. When translation history is enabled, each region is saved as a local PNG in the app-data `captures` folder and shown beside its source text; clearing history removes these files.
- Extracted text, target language, glossary, and optional context are sent to OpenAI. Context includes application name, window title, and up to four translations from the same app/window and target language.
- The API key is encrypted using Electron `safeStorage` (Windows DPAPI). It is never exposed through renderer IPC. A key supplied via an environment variable remains available until removed from that environment.
- Settings and the latest 200 translations are stored under Electron's user data directory (`%APPDATA%/lens-translate` in development; packaged app naming may differ). History is plain local JSON. Disable recording or clear it from History for sensitive content. Changing the history toggle does not erase existing records.
- `store: false` is used for API calls; this does not promise zero retention under all OpenAI account/data policies.
- Language data downloads on first use and caches locally. OCR works offline after that, but translation requires internet and a funded OpenAI API account.
- Source language selection is explicit: Tesseract needs an appropriate recognition model; translation target language is independent.

## Compatibility

Designed for Windows desktop apps and borderless fullscreen. Exclusive fullscreen games, protected video, secure desktops, elevated apps and anti-cheat environments may prevent capture or overlays. No injection or protection bypass is used. Foreground metadata uses a hidden PowerShell helper and falls back to unknown app on failure. Monitor capture uses the display under the pointer, with pixel/DIP conversion for scaling. Drag selection is the fallback for complex layouts or inaccurate click OCR.

## Development and packaging

```powershell
npm test
npm run check
npm run pack
npm run dist
```

`pack` produces an unpacked Windows app; `dist` produces an NSIS installer. Distribution signing credentials are not included. Electron smoke test: `npx electron . --smoke-test`; writes `smoke-result.json` with renderer/IPC and screen-capture checks, then quits.

## Architecture

- `src/main.cjs`: secure IPC, capture lifecycle, global shortcut, tray, selection/result windows, cancellation.
- `src/services.cjs`: local state, secure key storage, foreground context, worker-backed OCR, translation and cache.
- `src/core.cjs`: validated settings, coordinate conversion, context filtering, paragraph selection.
- `src/preload.cjs`: narrow renderer bridge; renderer has no Node or network access.
- `src/ui/`: local HTML/CSS/JS interface with strict content security policy.
- `tests/`: coordinate, context-isolation, cache and input-validation tests.

This first version uses bounded JSON persistence instead of SQLite to keep packaging simple. It does not include continuous screen monitoring, automatic image uploads, a hosted API-key proxy, or auto-updates.
