# Android APK build — ARM64-v8a only

## 1. Put the source at the repository root

Your repository must look like this:

```text
.github/workflows/android-build.yml
.gitignore
android/
web/
package.json
README.md
```

Do not upload only the source ZIP. GitHub does not unpack a ZIP and discover workflows inside it. Extract it first. Do not keep all the files under an extra `pal-haven-app/` directory inside the repository. On mobile, ensure your upload method includes dotfiles such as `.github` and `.gitignore`; a Git client or Codespace can be easier than a file picker that hides them.

## 2. Choose debug or signed release

The workflow chooses automatically:

- **No signing secrets:** `assembleDebug`, one ARM64-v8a debug APK, signed with a build-time debug key. Fine for testing, not your long-term release identity.
- **All four secrets:** `assembleRelease`, one ARM64-v8a release APK signed with your key.
- **Only some secrets:** the build stops with an explicit configuration error; it does not silently publish an unsigned release.

No AAB is built. The app is Java/WebGL and uses the phone's native WebView, so it does not ship a large native game engine. Gradle is configured for one `arm64-v8a` APK output and no universal, x86 or ARMv7 variant.

## 3. Add repository secrets

Go to **Repository → Settings → Secrets and variables → Actions → New repository secret**.

| Exact secret name           | Value                                                         |
| --------------------------- | ------------------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | Base64 of the entire `.jks` / keystore file, not its filename |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore store password                                       |
| `ANDROID_KEY_ALIAS`         | Alias of the private signing key inside the keystore          |
| `ANDROID_KEY_PASSWORD`      | Password for that private key; may match the store password   |

Do not paste passwords into chat, commit them to the repository, hardcode them in Gradle, or upload the raw JKS to a public repository. Base64 is encoding, **not encryption**. `.gitignore` excludes common key and secret files as an extra safeguard.

### If you already have a JKS

Use it, with its existing alias and passwords. List aliases locally if needed:

```sh
keytool -list -keystore /private/path/your-upload-key.jks
```

The command prompts for the store password. Do not change keys for an existing installed release unless you understand Android signing migration.

### If you need a new key

Run locally with Java installed, **outside the app repository**:

```sh
keytool -genkeypair -v -storetype JKS   -keystore pal-haven-upload.jks   -alias palhaven   -keyalg RSA -keysize 2048 -validity 10000
```

Answer the local prompts. Store the key and passwords in a safe password manager / backed-up private location. Set `ANDROID_KEY_ALIAS` to `palhaven` if you used that command.

### Convert the keystore to base64

Windows PowerShell (copies to clipboard):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\private\pal-haven-upload.jks')) | Set-Clipboard
```

macOS (copies to clipboard):

```sh
base64 -i "$HOME/private/pal-haven-upload.jks" | tr -d '\n' | pbcopy
```

Linux (writes to a private file **outside the repository**):

```sh
umask 077
base64 -w 0 "$HOME/private/pal-haven-upload.jks" > "$HOME/private/pal-haven-keystore.base64"
```

Paste that full base64 string into `ANDROID_KEYSTORE_BASE64`, then remove temporary encoded copies you no longer need. Never print secret values in Actions logs.

## 4. Build and download

1. Push a commit to any branch; or go to **Actions → Build ARM64 APK → Run workflow**.
2. Wait for source checks, tests, Android compilation and signing to finish.
3. Open the successful run and find **Artifacts → Pal-Haven-arm64-v8a-APK**.
4. Download the artifact ZIP and extract the APK:
   - Debug: `app-arm64-v8a-debug.apk`.
   - Release: `app-arm64-v8a-release.apk`.
5. On your phone, approve installation from the app/browser you use to open the APK, then install.

The workflow uploads artifacts only; it does not publish to a store, create a GitHub Release, or expose your private key. Temporary keystore material is written with restricted permissions under the runner's temporary directory and removed in an `always()` cleanup step. Artifacts are retained for 14 days.

`VERSION_CODE` uses the Actions run number. Keep it monotonically increasing for installed release updates. The human-readable version is `0.1.0` in `android/app/build.gradle`.

## 5. Check the app on a phone

- Start the app in portrait. Enter a world: Android switches to sensor-landscape and stays landscape through menus and the lab. Leave the world: normal orientation resumes.
- Move and look using two thumbs at the same time. Enable/disable sprint lock.
- Import a model through the Android document picker.
- Export a world and save it using the native document dialog; restore it from the hub.
- Background and reopen the app; check your save.
- Repeat with your target device's low-memory and low-battery conditions.

## Debug / release storage and upgrades

Debug ID: `app.palhaven.sandbox.debug`. Release ID: `app.palhaven.sandbox`. They can coexist but do not share local IndexedDB data. Export from debug and restore into release when switching.

A debug key generated on a new runner may differ from a previous run; an installed debug APK may reject an update. Export backups before uninstalling the old debug build. Your persistent release key avoids this problem.

## Local Android build

The CI workflow deliberately uses a **pinned Gradle 8.9 installation**, so it does not depend on an untracked wrapper JAR or executable bit. Install Java 17, Android SDK platform/build-tools 35 and Gradle 8.9 locally, set `ANDROID_HOME`, then run:

```sh
cd android
gradle --no-daemon :app:assembleDebug
```

For a local release, set `ANDROID_KEYSTORE_PATH` and the other three password/alias variables in your private environment before `gradle :app:assembleRelease`. Never put their values in tracked files. If you prefer a Gradle wrapper, run `gradle wrapper --gradle-version 8.9` locally and commit the generated non-secret wrapper files.

## Troubleshooting

- **Workflow not visible:** `.github/workflows/android-build.yml` must be at the repository root, not inside a ZIP or nested project folder. Ensure Actions is enabled for the repository.
- **Bad base64:** encode the binary keystore, not the text path; remove accidental quotes around the secret.
- **Alias missing / password error:** verify the alias and store password locally with `keytool -list`.
- **No WebGL:** update Android System WebView / Chrome. The app needs WebGL 2, not just an ARM64 CPU.
- **APK will not update:** check signing identity, version code, and whether you are switching debug/release IDs.
- **Downloaded file is a ZIP:** extract the Actions artifact; the APK is inside it.
- **Gradle cannot reach repositories:** the GitHub runner must be allowed to download Android/Gradle dependencies. Runtime gameplay remains offline.
