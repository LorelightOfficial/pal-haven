# AutoContinue

An Android app that watches the ChatGPT app and, when a reply finishes, automatically
types a message (default `C`) and sends it, so long audits and troubleshooting sessions
keep going without you tapping "continue".

## How it works

AutoContinue is an Android **AccessibilityService** limited to the ChatGPT app
(`com.openai.chatgpt`).

1. While a clickable "Stop" button is on screen, ChatGPT is generating.
2. When that button disappears, wait ~1.5 s for the reply to settle.
3. Set the text box to your message and tap the "Send" button.
4. Repeat until the max count is reached, then switch itself off.

## Setup

1. Download the APK from the latest **Actions → Build APK** run (artifact
   `AutoContinue-debug-apk`), or build it yourself in Android Studio.
2. Install it (allow installs from unknown sources).
3. Open AutoContinue → **Enable accessibility service** → turn on "Auto Continue".
4. Set your message and max continues, flip the switch on, then open ChatGPT.

## Troubleshooting

If nothing happens, the button labels may differ from what the app expects.
Open ChatGPT, tap **Dump ChatGPT screen to logcat**, read the output
(`adb logcat -s AutoContinue`), and adjust the label matching in
`AutoContinueService.kt` (`isGenerating` and `sendContinue`).

## Roadmap

- Floating pause button
- Stop when the reply is empty or identical to the previous one
- Image-matching fallback (MediaProjection + OpenCV) if labels are unreadable

## Notes

- Android only. Not intended for the Play Store.
- Automating another app's UI may conflict with that app's terms of service.
  Use at your own risk, for personal use.

## License

MIT
