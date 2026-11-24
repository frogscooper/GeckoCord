package dev.geckocord

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import org.json.JSONObject
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.WebExtension

/** Embeds Discord web in GeckoView instead of Chromium WebView. */
class MainActivity : Activity() {
    companion object {
        private const val TAG = "GeckoCord"
        private var runtime: GeckoRuntime? = null
        private const val DISCORD_URL = "https://discord.com/app"

        // Discord's mobile-UA site only nags you to install the app, so we ask for
        // the desktop client and make it phone-friendly with the built-in
        // "mobile" extension (assets/mobile/).
        private const val DESKTOP_UA =
            "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"

        private const val MOBILE_EXT_URI = "resource://android/assets/mobile/"
        private const val MOBILE_EXT_ID = "mobile@geckocord"
        private const val NATIVE_APP = "geckocord"
        private const val BACK_TIMEOUT_MS = 300L
        private val DISCORD_DARK = Color.rgb(0x1E, 0x1F, 0x22)
        private val CSS_RGB = Regex("""rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)""")
    }

    private lateinit var session: GeckoSession
    private val handler = Handler(Looper.getMainLooper())

    private var port: WebExtension.Port? = null
    private var canGoBack = false
    private var backId = 0
    private var pendingBack: Runnable? = null

    private lateinit var statusSpacer: View
    private lateinit var navSpacer: View

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val view = findViewById<GeckoView>(R.id.geckoview)
        statusSpacer = findViewById(R.id.status_spacer)
        navSpacer = findViewById(R.id.nav_spacer)
        view.coverUntilFirstPaint(DISCORD_DARK)
        setupEdgeToEdge(findViewById(R.id.root))
        applyBarColors(DISCORD_DARK, DISCORD_DARK)

        val rt = runtime ?: GeckoRuntime.create(
            this,
            GeckoRuntimeSettings.Builder()
                .javaScriptEnabled(true)
                .consoleOutput(true)
                .build()
        ).also { runtime = it }

        val sessionSettings = GeckoSessionSettings.Builder()
            .userAgentOverride(DESKTOP_UA)
            // Lay out at device width (honouring <meta viewport>) rather than a
            // 980px desktop canvas.
            .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_MOBILE)
            .allowJavascript(true)
            .build()

        session = GeckoSession(sessionSettings)
        session.navigationDelegate = object : GeckoSession.NavigationDelegate {
            override fun onCanGoBack(session: GeckoSession, canGoBack: Boolean) {
                this@MainActivity.canGoBack = canGoBack
            }
        }
        session.open(rt)
        view.setSession(session)

        // Install the mobile layout extension before loading Discord so its
        // content scripts apply to the first page load.
        rt.webExtensionController.ensureBuiltIn(MOBILE_EXT_URI, MOBILE_EXT_ID).accept(
            { ext ->
                if (ext != null) attachMessaging(ext)
                session.loadUri(DISCORD_URL)
            },
            { e ->
                Log.e(TAG, "Failed to install mobile layout extension", e)
                session.loadUri(DISCORD_URL)
            }
        )

        // Future: runtime!!.webExtensionController.ensureBuiltIn(
        //     "resource://android/assets/vencord/", "vencord@geckocord")
    }

    private fun attachMessaging(ext: WebExtension) {
        val portDelegate = object : WebExtension.PortDelegate {
            override fun onPortMessage(message: Any, port: WebExtension.Port) {
                val json = message as? JSONObject ?: return
                when (json.optString("type")) {
                    "backResult" -> if (json.optInt("id") == backId) resolveBack(json.optBoolean("handled"))
                    "bars" -> {
                        val top = parseCssColor(json.optString("top")) ?: return
                        val bottom = parseCssColor(json.optString("bottom")) ?: top
                        applyBarColors(top, bottom)
                    }
                }
            }

            override fun onDisconnect(port: WebExtension.Port) {
                if (this@MainActivity.port === port) this@MainActivity.port = null
            }
        }
        session.webExtensionController.setMessageDelegate(
            ext,
            object : WebExtension.MessageDelegate {
                override fun onConnect(port: WebExtension.Port) {
                    port.setDelegate(portDelegate)
                    this@MainActivity.port = port
                }
            },
            NATIVE_APP
        )
    }

    /**
     * Draw behind the system bars (mandatory from Android 15) and pad the page
     * with spacers instead, so the bars can take the colour of the page edge.
     * The bottom spacer also tracks the keyboard, keeping the composer visible.
     */
    private fun setupEdgeToEdge(root: View) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        window.setDecorFitsSystemWindows(false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) window.isNavigationBarContrastEnforced = false
        root.setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            val ime = insets.getInsets(WindowInsets.Type.ime())
            v.setPadding(bars.left, 0, bars.right, 0)
            setHeight(statusSpacer, bars.top)
            setHeight(navSpacer, maxOf(bars.bottom, ime.bottom))
            WindowInsets.CONSUMED
        }
    }

    private fun setHeight(view: View, height: Int) {
        val lp = view.layoutParams
        if (lp.height != height) {
            lp.height = height
            view.layoutParams = lp
        }
    }

    private fun parseCssColor(css: String): Int? {
        val m = CSS_RGB.find(css) ?: return null
        val (r, g, b) = m.destructured
        return Color.rgb(r.toInt(), g.toInt(), b.toInt())
    }

    private fun isLight(color: Int): Boolean =
        (0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)) / 255 > 0.6

    @Suppress("DEPRECATION")
    private fun applyBarColors(top: Int, bottom: Int) {
        statusSpacer.setBackgroundColor(top)
        navSpacer.setBackgroundColor(bottom)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            window.statusBarColor = top
            window.navigationBarColor = bottom
        }
        val lightTop = isLight(top)
        val lightBottom = isLight(bottom)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val flags = (if (lightTop) WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS else 0) or
                (if (lightBottom) WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS else 0)
            window.insetsController?.setSystemBarsAppearance(
                flags,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            )
        } else {
            var vis = window.decorView.systemUiVisibility and
                (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR).inv()
            if (lightTop) vis = vis or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
            if (lightBottom) vis = vis or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            window.decorView.systemUiVisibility = vis
        }
    }

    /**
     * Back: let the page handle it first (close a sheet, modal, settings page or
     * member list, or go from a chat back to the channel list). If it doesn't, leave the app.
     */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (pendingBack != null) return
        val p = port ?: return fallbackBack()
        backId++
        val timeout = Runnable { resolveBack(false) }
        pendingBack = timeout
        handler.postDelayed(timeout, BACK_TIMEOUT_MS)
        try {
            p.postMessage(JSONObject().put("type", "back").put("id", backId))
        } catch (e: Exception) {
            Log.w(TAG, "Back message failed", e)
            resolveBack(false)
        }
    }

    private fun resolveBack(handled: Boolean) {
        val pending = pendingBack ?: return
        handler.removeCallbacks(pending)
        pendingBack = null
        if (!handled) fallbackBack()
    }

    private fun fallbackBack() {
        if (port == null && canGoBack) {
            // Off Discord (e.g. a login/captcha page): normal browser back.
            session.goBack()
        } else {
            moveTaskToBack(true)
        }
    }

    override fun onDestroy() {
        pendingBack?.let { handler.removeCallbacks(it) }
        session.close()
        super.onDestroy()
    }
}
