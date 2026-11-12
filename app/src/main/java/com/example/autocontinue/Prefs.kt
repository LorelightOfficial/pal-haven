package com.example.autocontinue

import android.content.Context
import android.content.SharedPreferences

object Prefs {
    private fun sp(c: Context): SharedPreferences =
        c.getSharedPreferences("ac", Context.MODE_PRIVATE)

    fun enabled(c: Context): Boolean = sp(c).getBoolean("enabled", false)
    fun setEnabled(c: Context, v: Boolean) {
        sp(c).edit().putBoolean("enabled", v).apply()
    }

    fun text(c: Context): String = sp(c).getString("text", "C") ?: "C"
    fun setText(c: Context, v: String) {
        sp(c).edit().putString("text", v).apply()
    }

    fun max(c: Context): Int = sp(c).getInt("max", 20)
    fun setMax(c: Context, v: Int) {
        sp(c).edit().putInt("max", v).apply()
    }

    fun sent(c: Context): Int = sp(c).getInt("sent", 0)
    fun setSent(c: Context, v: Int) {
        sp(c).edit().putInt("sent", v).apply()
    }

    fun dump(c: Context): String = sp(c).getString("dump", "") ?: ""
    fun setDump(c: Context, v: String) {
        sp(c).edit().putString("dump", v).apply()
    }
}
