# Implementation status

Implemented: Electron desktop shell, tray controls, configurable global hotkey, monitor capture, click/drag selection, pixel/DIP scaling, Tesseract OCR worker with language downloads, OpenAI text translation, context/history/glossary, secure API-key storage, editable source/retry, translation overlay, click-through/restore shortcut, blocked app list, local history search/clear, installer configuration.

Verified in the development environment: JavaScript syntax checks and five unit tests covering coordinate scaling/clipping, app/window context boundaries, context-sensitive cache keys, point-to-paragraph selection, and settings validation.

Not yet verified: Electron runtime launch, OCR execution, live OpenAI requests, and installer build. Dependency installation was attempted but the execution environment failed directory creation with ENOENT inside the existing workspace; npm had to be stopped. No API key was provided. No installer or lockfile has been generated.

## Manual acceptance checks once dependencies are installed

1. Run `npm install`, `npm test`, `npm run check`, then `npm start`.
2. Save a valid API key and source/target languages. Confirm a hotkey conflict produces an error without losing the previous binding.
3. In a browser or document viewer, press Alt+Shift+T. Drag a region and verify OCR/source text and translated output.
4. Click a paragraph between neighboring text blocks and verify only that paragraph is translated.
5. Repeat on monitors with different scaling and negative desktop coordinates; verify the correct display and result position.
6. Test a borderless fullscreen app. Confirm protected/exclusive content limitations are understood.
7. Edit recognized text in the card and retry. Copy the output. Enable click-through and restore with Alt+Shift+X.
8. Turn context/history off and verify no new history is saved; clear old history. Add a foreground process to the blocked list and verify capture refuses it, including when initiated from the main window.
9. Test invalid API key, no network, missing language download, Escape during selection/OCR, and a second capture while a request is pending.
10. Run `npm run pack`, then launch the packaged executable. Verify PowerShell metadata and the unpacked Tesseract worker before generating an NSIS installer with `npm run dist`.
