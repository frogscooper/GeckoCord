# GeckoCord

Android Discord client that loads `https://discord.com/app` inside **Mozilla GeckoView** instead of Chromium `WebView`.

Inspired by Vendroid / VendroidEnhanced (web Discord + injected client mod), rewritten so the engine is Gecko rather than Android System WebView.

## Why GeckoView

- Engine version is bundled with the APK, not whatever WebView the OEM shipped.
- Full Firefox/Gecko web platform.
- Independent of Google WebView updates and flags.

## Status

Scaffold / MVP:

- GeckoRuntime + GeckoSession hosting Discord web
- Desktop user-agent (Discord mobile site is incomplete)
- Hook for a future Vencord/Equicord WebExtension

Not yet: voice, push, official token bridge, plugin UI.

## Build

- Android Studio / JDK 17
- minSdk 26, targetSdk 35
- GeckoView from `https://maven.mozilla.org/maven2/`

```bash
./gradlew :app:assembleDebug
```

First GeckoView download is large (~80-150 MB AAR).

## Disclaimer

Unofficial client. Discord ToS does not allow third-party clients. Use an alt.

## License

GPL-3.0
