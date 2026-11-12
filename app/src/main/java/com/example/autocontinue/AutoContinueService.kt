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

    override fun onServiceConnected() { instance = this }
    override fun onDestroy() { instance = null; super.onDestroy() }
    override fun onInterrupt() {}

    override fun onAccessibilityEvent(e: AccessibilityEvent?) {
        if (!Prefs.enabled(this)) return
        if (e?.packageName?.toString() != CHATGPT) return
        handler.removeCallbacks(check)
        handler.postDelayed(check, 400)
    }

    private val check = Runnable { evaluate() }

    private fun evaluate() {
        val root = rootInActiveWindow ?: return
        if (root.packageName?.toString() != CHATGPT) return
        if (isGenerating(root)) { wasGenerating = true; return }
        if (wasGenerating && !pending) {
            wasGenerating = false
            pending = true
            handler.postDelayed({ sendContinue() }, 1500) // let the reply settle
        }
    }

    private fun label(n: AccessibilityNodeInfo) =
        (n.contentDescription ?: n.text)?.toString() ?: ""

    private fun walk(n: AccessibilityNodeInfo?, f: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
        if (n == null) return null
        if (f(n)) return n
        for (i in 0 until n.childCount) walk(n.getChild(i), f)?.let { return it }
        return null
    }

    private fun isGenerating(root: AccessibilityNodeInfo) = walk(root) {
        val l = label(it)
        it.isClickable && l.length < 30 && l.contains("stop", true)
    } != null

    private fun sendContinue() {
        pending = false
        val root = rootInActiveWindow ?: return
        if (root.packageName?.toString() != CHATGPT || isGenerating(root)) return

        if (Prefs.sent(this) >= Prefs.max(this)) {
            Prefs.setEnabled(this, false)   // loop guard
            Log.i(TAG, "Max continues reached, disabled")
            return
        }

        val input = walk(root) { it.className?.toString()?.contains("EditText") == true } ?: return
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, Prefs.text(this@AutoContinueService))
        }
        input.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)

        handler.postDelayed({
            val r = rootInActiveWindow ?: return@postDelayed
            val send = walk(r) { it.isClickable && label(it).contains("send", true) && label(it).length < 30 }
            if (send != null && send.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                Prefs.setSent(this, Prefs.sent(this) + 1)
            } else {
                Log.w(TAG, "Send button not found; run Dump screen")
            }
        }, 600)
    }

    /** Logs every node so you can see the real labels in logcat (tag AutoContinue). */
    fun dumpScreen() {
        val root = rootInActiveWindow ?: return
        fun rec(n: AccessibilityNodeInfo, d: Int) {
            Log.d(TAG, "  ".repeat(d) + "${n.className} desc='${n.contentDescription}' text='${n.text}' click=${n.isClickable} id=${n.viewIdResourceName}")
            for (i in 0 until n.childCount) n.getChild(i)?.let { rec(it, d + 1) }
        }
        rec(root, 0)
    }
}
