package com.example.autocontinue

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class AutoContinueService : AccessibilityService() {

    companion object {
        const val CHATGPT = "com.openai.chatgpt"
        const val TAG = "AutoContinue"
        var instance: AutoContinueService? = null
    }

    private val handler = Handler(Looper.getMainLooper())
    private var wasGenerating = false
    private var pending = false

    // Checks the screen once a second. (Screen events fire constantly while a reply
    // streams in, so polling is more reliable than reacting to events.)
    private val poller = object : Runnable {
        override fun run() {
            try {
                if (Prefs.enabled(this@AutoContinueService)) {
                    evaluate()
                }
            } catch (t: Throwable) {
                Log.e(TAG, "poll failed", t)
            }
            handler.postDelayed(this, 1000L)
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        handler.removeCallbacks(poller)
        handler.postDelayed(poller, 1000L)
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Not used: see poller above.
    }

    override fun onInterrupt() {
    }

    // ---------- core logic ----------

    private fun evaluate() {
        val root = rootInActiveWindow ?: return
        if (root.packageName?.toString() != CHATGPT) return

        if (isGenerating(root)) {
            wasGenerating = true
            return
        }
        if (wasGenerating && !pending) {
            wasGenerating = false
            pending = true
            handler.postDelayed({ sendContinue() }, 1500L) // let the reply settle
        }
    }

    private fun sendContinue() {
        pending = false
        val root = rootInActiveWindow ?: return
        if (root.packageName?.toString() != CHATGPT) return
        if (isGenerating(root)) return

        if (Prefs.sent(this) >= Prefs.max(this)) {
            Prefs.setEnabled(this, false) // loop guard
            Log.i(TAG, "Max continues reached, switched off")
            return
        }

        val input = findNode(root) { n -> isTextBox(n) }
        if (input == null) {
            Log.w(TAG, "Message box not found")
            return
        }
        val args = Bundle()
        args.putCharSequence(
            AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
            Prefs.text(this)
        )
        input.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)

        handler.postDelayed({ clickSend() }, 700L) // give the send arrow time to appear
    }

    private fun clickSend() {
        val root = rootInActiveWindow ?: return
        if (root.packageName?.toString() != CHATGPT) return

        val send = findNode(root) { n ->
            val l = labelOf(n)
            !isTextBox(n) && l.length < 30 && l.contains("send", ignoreCase = true) && clickableFor(n) != null
        }
        val target = if (send != null) clickableFor(send) else null
        if (target != null && target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
            Prefs.setSent(this, Prefs.sent(this) + 1)
        } else {
            Log.w(TAG, "Send button not found")
        }
    }

    // ---------- helpers ----------

    private fun isGenerating(root: AccessibilityNodeInfo): Boolean {
        val hit = findNode(root) { n ->
            val l = labelOf(n)
            l.length < 30 && l.contains("stop", ignoreCase = true) && clickableFor(n) != null
        }
        return hit != null
    }

    private fun isTextBox(n: AccessibilityNodeInfo): Boolean {
        val cls = n.className?.toString() ?: ""
        return cls.contains("EditText")
    }

    private fun labelOf(n: AccessibilityNodeInfo): String {
        val d = n.contentDescription?.toString()
        if (d != null && d.isNotEmpty()) return d
        return n.text?.toString() ?: ""
    }

    // The node itself, or the closest clickable parent (up to 4 levels up).
    private fun clickableFor(n: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var cur: AccessibilityNodeInfo? = n
        var depth = 0
        while (cur != null && depth < 4) {
            if (cur.isClickable) return cur
            cur = cur.parent
            depth++
        }
        return null
    }

    private fun findNode(
        root: AccessibilityNodeInfo,
        match: (AccessibilityNodeInfo) -> Boolean
    ): AccessibilityNodeInfo? {
        if (match(root)) return root
        for (i in 0 until root.childCount) {
            val child = root.getChild(i) ?: continue
            val hit = findNode(child, match)
            if (hit != null) return hit
        }
        return null
    }

    // ---------- screen capture for troubleshooting ----------

    /** Waits delayMs, then saves a readable list of what is on screen into Prefs. */
    fun captureScreen(delayMs: Long) {
        handler.postDelayed({
            val sb = StringBuilder()
            val root = rootInActiveWindow
            if (root == null) {
                sb.append("No active window found\n")
            } else {
                sb.append("Package: ${root.packageName}\n")
                dumpNode(root, 0, sb)
            }
            val out = sb.toString()
            Prefs.setDump(this, if (out.length > 30000) out.substring(0, 30000) else out)
        }, delayMs)
    }

    private fun dumpNode(n: AccessibilityNodeInfo, depth: Int, sb: StringBuilder) {
        val desc = n.contentDescription?.toString()
        val txt = n.text?.toString()
        val cls = n.className?.toString() ?: ""
        val interesting = n.isClickable || !desc.isNullOrEmpty() || !txt.isNullOrEmpty() || cls.contains("EditText")
        if (interesting) {
            val shortTxt = txt?.take(60)
            sb.append("  ".repeat(depth))
            sb.append("$cls desc='$desc' text='$shortTxt' click=${n.isClickable}\n")
        }
        for (i in 0 until n.childCount) {
            val child = n.getChild(i) ?: continue
            dumpNode(child, depth + 1, sb)
        }
    }
}
