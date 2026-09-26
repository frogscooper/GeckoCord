package dev.geckocord

import android.app.Activity
import android.os.Bundle
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.GeckoView

/** Embeds Discord web in GeckoView instead of Chromium WebView. */
class MainActivity : Activity() {
    companion object {
        private var runtime: GeckoRuntime? = null
        private const val DISCORD_URL = "https://discord.com/app"
        private const val DESKTOP_UA =
            "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val view = findViewById<GeckoView>(R.id.geckoview)

        if (runtime == null) {
            val settings = GeckoRuntimeSettings.Builder()
                .javaScriptEnabled(true)
                .consoleOutput(true)
                .build()
            runtime = GeckoRuntime.create(this, settings)
        }

        val sessionSettings = GeckoSessionSettings.Builder()
            .userAgentOverride(DESKTOP_UA)
            .allowJavascript(true)
            .build()

        val session = GeckoSession(sessionSettings)
        session.open(runtime!!)
        view.setSession(session)

        // Future: runtime!!.webExtensionController.ensureBuiltIn(
        //     "resource://android/assets/vencord/", "vencord@geckocord")

        session.loadUri(DISCORD_URL)
    }
}
