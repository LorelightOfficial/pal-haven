package com.example.autocontinue

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.widget.*

class MainActivity : Activity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad * 2, pad, pad) }

        val status = TextView(this)
        val text = EditText(this).apply { setText(Prefs.text(this@MainActivity)); hint = "Message to send" }
        val max = EditText(this).apply {
            setText(Prefs.max(this@MainActivity).toString()); hint = "Max continues"
            inputType = InputType.TYPE_CLASS_NUMBER
        }
        val sw = Switch(this).apply { text = "Auto-continue ON"; isChecked = Prefs.enabled(this@MainActivity) }

        fun refresh() { status.text = "Sent this run: ${Prefs.sent(this)} / ${Prefs.max(this)}" }

        sw.setOnCheckedChangeListener { _, on ->
            Prefs.setText(this, text.text.toString().ifBlank { "C" })
            Prefs.setMax(this, max.text.toString().toIntOrNull() ?: 20)
            if (on) Prefs.setSent(this, 0)
            Prefs.setEnabled(this, on)
            refresh()
        }

        val access = Button(this).apply {
            this.text = "1. Enable accessibility service"
            setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        }
        val dump = Button(this).apply {
            this.text = "Dump ChatGPT screen to logcat"
            setOnClickListener {
                // Switch to ChatGPT first, then tap this from a notification/split-screen, or just use adb logcat after opening ChatGPT
                AutoContinueService.instance?.dumpScreen()
                    ?: Toast.makeText(this@MainActivity, "Service not running", Toast.LENGTH_SHORT).show()
            }
        }
        listOf(access, text, max, sw, status, dump).forEach { col.addView(it) }
        setContentView(col)
        refresh()
    }
}
