# Keep methods called from the trusted local WebView JavaScript bridge.
-keepclassmembers class app.palhaven.sandbox.MainActivity$ExportBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes RuntimeVisibleAnnotations
