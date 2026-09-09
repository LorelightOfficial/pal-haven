# First GitHub build and phone checklist

The source-side checks are complete. Run these on your actual build/device before relying on it:

- [ ] Source extracted to repository root, including `.github` and `.gitignore`.
- [ ] `Build ARM64 APK` passes. Exactly one `arm64-v8a` APK is in the artifact; no AAB.
- [ ] Debug install works on an ARM64 Android 8+ device with recent System WebView.
- [ ] All four signing secrets produce a signed release; keep the same keystore for updates.
- [ ] A release update installs over the prior release without losing saved projects.
- [ ] Entering a world forces landscape; menus and the lab stay landscape.
- [ ] Leaving a world restores normal orientation; rotate both landscape directions.
- [ ] Notches / gesture bars do not obstruct controls; test your device's aspect ratio.
- [ ] Joystick and look work simultaneously; sprint, attack, pick/drop and inspect respond.
- [ ] Import through the native file picker, including a ZIP selected from your usual file provider.
- [ ] Export through the native save dialog, then restore and reopen the exported project.
- [ ] Background/reopen and process restart preserve the latest completed save.
- [ ] Try Economy first with a few detailed pals; increase counts gradually while checking heat/memory.
- [ ] Export backups before uninstalling, clearing storage or switching between debug/release IDs.

Do not distribute your private keystore or passwords. Do not assume browser QA is Android-device QA.
