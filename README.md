# AutoContinue

An Android app that watches the ChatGPT app and, when a reply finishes, automatically
types a message (default `C`) and sends it, so long audits and troubleshooting sessions
keep going without you tapping "continue".

## How it works

AutoContinue is an Android **AccessibilityService** limited to the ChatGPT app
(`com.openai.chatgpt`). Once a second it looks at the screen:

1. While a clickable "Stop" button is on screen, ChatGPT is generating.
2. When that button disappears, wait ~1.5 s for the reply to settle.
3. Set the message box to your text and tap the "Send" button.
4. Repeat until the max count is reached, then switch itself off.

## Install

1. Download the APK from the latest **Actions -> Build APK** run (artifact
   `AutoContinue-debug-apk`; it is a zip, unzip it first) and install it.
2. Open AutoContinue -> **1. Enable accessibility service** -> turn on "Auto Continue".
3. **Android 13+ only:** if the switch is greyed out ("restricted setting"), go to
   Settings -> Apps -> Auto Continue -> three-dot menu (top right) -> **Allow restricted
   settings**, then try step 2 again.
4. Back in the app, set your message and max continues, flip the switch on, then open ChatGPT.

## Troubleshooting

If nothing happens, the button labels may differ from what the app expects:

1. Tap **2. Capture ChatGPT screen (5 s)**, then switch to ChatGPT with a reply on screen.
2. Return to AutoContinue and tap **3. Show and copy last capture**.
3. Paste the result where it can be read and adjust the matching in
   `AutoContinueService.kt` (`isGenerating` looks for "stop", `clickSend` looks for "send").

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
