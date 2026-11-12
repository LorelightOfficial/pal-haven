package com.example.autocontinue

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {

    private lateinit var status: TextView
    private lateinit var output: TextView
    private lateinit var toggle: Switch
    private lateinit var msgInput: EditText
    private lateinit var maxInput: EditText
    private var syncing = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val pad = (16 * resources.displayMetrics.density).toInt()
        val col = LinearLayout(this)
        col.orientation = LinearLayout.VERTICAL
        col.setPadding(pad, pad * 2, pad, pad)

        status = TextView(this)
        output = TextView(this)
        output.setTextIsSelectable(true)

        msgInput = EditText(this)
        msgInput.setText(Prefs.text(this))
        msgInput.hint = "Message to send"

        maxInput = EditText(this)
        maxInput.setText(Prefs.max(this).toString())
        maxInput.hint = "Max continues"
        maxInput.inputType = InputType.TYPE_CLASS_NUMBER

        toggle = Switch(this)
        toggle.text = "Auto-continue ON"
        toggle.isChecked = Prefs.enabled(this)
        toggle.setOnCheckedChangeListener { _, isOn ->
            if (!syncing) {
                Prefs.setText(this@MainActivity, msgInput.text.toString().ifBlank { "C" })
                Prefs.setMax(this@MainActivity, maxInput.text.toString().toIntOrNull() ?: 20)
                if (isOn) {
                    Prefs.setSent(this@MainActivity, 0)
                }
                Prefs.setEnabled(this@MainActivity, isOn)
                refresh()
            }
        }

        val accessBtn = Button(this)
        accessBtn.text = "1. Enable accessibility service"
        accessBtn.setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }

        val captureBtn = Button(this)
        captureBtn.text = "2. Capture ChatGPT screen (5 s)"
        captureBtn.setOnClickListener {
            val svc = AutoContinueService.instance
            if (svc == null) {
                Toast.makeText(this@MainActivity, "Turn on the accessibility service first", Toast.LENGTH_LONG).show()
            } else {
                svc.captureScreen(5000L)
                Toast.makeText(this@MainActivity, "Switch to ChatGPT now. Capturing in 5 seconds", Toast.LENGTH_LONG).show()
            }
        }

        val showBtn = Button(this)
        showBtn.text = "3. Show and copy last capture"
        showBtn.setOnClickListener {
            val dump = Prefs.dump(this@MainActivity)
            if (dump.isEmpty()) {
                output.text = "Nothing captured yet"
            } else {
                output.text = dump
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("capture", dump))
                Toast.makeText(this@MainActivity, "Copied to clipboard", Toast.LENGTH_SHORT).show()
            }
        }

        col.addView(accessBtn)
        col.addView(msgInput)
        col.addView(maxInput)
        col.addView(toggle)
        col.addView(status)
        col.addView(captureBtn)
        col.addView(showBtn)
        col.addView(output)

        val scroll = ScrollView(this)
        scroll.addView(col)
        setContentView(scroll)
        refresh()
    }

    override fun onResume() {
        super.onResume()
        // The service switches itself off when the max is reached, so re-sync the switch.
        syncing = true
        toggle.isChecked = Prefs.enabled(this)
        syncing = false
        refresh()
    }

    private fun refresh() {
        val state = if (AutoContinueService.instance != null) "running" else "not enabled"
        status.text = "Service: $state\nSent this run: ${Prefs.sent(this)} / ${Prefs.max(this)}"
    }
}
