package app.palhaven.sandbox;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Collections;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Offline, trusted-origin Android shell. No account, tracking or broad storage permissions. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/assets/index.html";
    private static final int PICK_FILE = 1201;
    private static final int SAVE_FILE = 1202;
    private static final long MAX_EXPORT = 128L * 1024L * 1024L;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExportBridge bridge = new ExportBridge();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
        getWindow().setStatusBarColor(Color.rgb(36,77,64));
        getWindow().setNavigationBarColor(Color.rgb(36,77,64));
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(params);
        }
        // Only abandoned app-owned temporary exports are removed; never user documents.
        File[] temporary = getCacheDir().listFiles((dir, name) -> name.startsWith("pal-export-") && name.endsWith(".tmp"));
        if (temporary != null) for (File f : temporary) f.delete();
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(247,247,241));
        setContentView(webView);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true); // Scoped file picker URIs, not arbitrary storage browsing.
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSupportMultipleWindows(false);
        s.setBuiltInZoomControls(false);
        s.setSafeBrowsingEnabled(true);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.addJavascriptInterface(bridge, "PalNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                return !("https".equals(u.getScheme()) && HOST.equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith("/assets/"));
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (!"https".equals(u.getScheme()) || !HOST.equals(u.getHost()) || u.getPath() == null || !u.getPath().startsWith("/assets/")) {
                    return response(403, "Forbidden", "text/plain", new ByteArrayInputStream(new byte[0]));
                }
                String path = u.getPath().substring("/assets/".length());
                if (path.isEmpty()) path = "index.html";
                if (path.contains("..") || path.contains("\\") || path.indexOf('\0') >= 0) {
                    return response(403, "Forbidden", "text/plain", new ByteArrayInputStream(new byte[0]));
                }
                try { return response(200, "OK", mime(path), getAssets().open(path)); }
                catch (Exception error) { return response(404, "Not Found", "text/plain", new ByteArrayInputStream(new byte[0])); }
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                // Providers often do not register GLB/STL MIME types. Validation happens in the app.
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivityForResult(intent, PICK_FILE); }
                catch (ActivityNotFoundException error) {
                    fileCallback.onReceiveValue(null); fileCallback = null;
                    Toast.makeText(MainActivity.this, "No document picker is available on this device.", Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });
        webView.loadUrl(HOME);
        immersive();
    }
    private static WebResourceResponse response(int code, String reason, String mime, InputStream data) {
        return new WebResourceResponse(mime, mime.startsWith("text/") || mime.equals("application/json") ? "UTF-8" : null,
                code, reason, Collections.singletonMap("Cache-Control", "no-cache"), data);
    }
    private static String mime(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".glb")) return "model/gltf-binary";
        return "application/octet-stream";
    }
    private void immersive() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }
    @Override public void onWindowFocusChanged(boolean focused) { super.onWindowFocusChanged(focused); if (focused) immersive(); }
    @Override public void onConfigurationChanged(Configuration config) { super.onConfigurationChanged(config); immersive(); }
    @Override public void onBackPressed() {
        if (webView == null) { super.onBackPressed(); return; }
        webView.evaluateJavascript("Boolean(window.PalHaven && window.PalHaven.handleBack())", result -> {
            if (!"true".equals(result)) MainActivity.super.onBackPressed();
        });
    }
    @Override protected void onPause() {
        if (webView != null) webView.evaluateJavascript("window.dispatchEvent(new Event('pal-native-pause'))", null);
        super.onPause();
        if (webView != null) webView.onPause();
    }
    @Override protected void onResume() { super.onResume(); if (webView != null) webView.onResume(); immersive(); }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(result == RESULT_OK && data != null && data.getData() != null ? new Uri[]{data.getData()} : null);
                fileCallback = null;
            }
        } else if (request == SAVE_FILE) {
            if (result != RESULT_OK || data == null || data.getData() == null) { bridge.abortAndNotify("Export cancelled. Your project is still saved in the app."); return; }
            Uri destination = data.getData();
            io.execute(() -> bridge.copyTo(destination));
        }
    }
    private void notifyExport(boolean ok, String message) {
        runOnUiThread(() -> { if (webView != null && !isFinishing()) webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('native-export-result',{detail:{ok:" + ok + ",message:" + JSONObject.quote(message) + "}}))", null); });
    }
    @Override protected void onDestroy() {
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        bridge.cleanup();
        if (webView != null) { webView.removeJavascriptInterface("PalNative"); webView.destroy(); webView = null; }
        io.shutdown();
        super.onDestroy();
    }
    /** The only native bridge; all entry points are size-bounded and origin-confined. */
    public final class ExportBridge {
        private String id;
        private File file;
        private FileOutputStream output;
        private long expected, written;
        private String name, type;
        private boolean readyToSave;
        @JavascriptInterface public void setWorldMode(boolean inWorld) {
            runOnUiThread(() -> setRequestedOrientation(inWorld
                    ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED));
        }
        @JavascriptInterface public synchronized String beginExport(String proposedName, String mime, long totalBytes) {
            if (id != null || totalBytes < 1 || totalBytes > MAX_EXPORT) return "";
            name = proposedName == null ? "Pal-Haven.zip" : proposedName.replaceAll("[^a-zA-Z0-9._-]", "_");
            if (name.length() > 100) name = name.substring(0,100);
            if (!name.toLowerCase(Locale.ROOT).endsWith(".zip")) name += ".zip";
            type = "application/zip";
            expected = totalBytes; written = 0; readyToSave = false;
            id = UUID.randomUUID().toString();
            file = new File(getCacheDir(), "pal-export-" + id + ".tmp");
            try { output = new FileOutputStream(file); return id; }
            catch (Exception error) { cleanup(); return ""; }
        }
        @JavascriptInterface public synchronized boolean appendExport(String ticket, String base64) {
            if (id == null || !id.equals(ticket) || readyToSave || output == null || base64 == null || base64.length() > 600000) return false;
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (written + bytes.length > expected || written + bytes.length > MAX_EXPORT) { cleanup(); return false; }
                output.write(bytes); written += bytes.length; return true;
            } catch (Exception error) { cleanup(); return false; }
        }
        @JavascriptInterface public synchronized void finishExport(String ticket) {
            if (id == null || !id.equals(ticket) || readyToSave) return;
            try {
                if (written != expected || output == null) throw new IllegalStateException("Incomplete export");
                output.flush(); output.close(); output = null; readyToSave = true;
                runOnUiThread(() -> {
                    try {
                        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                        intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType(type);
                        intent.putExtra(Intent.EXTRA_TITLE, name);
                        startActivityForResult(intent, SAVE_FILE);
                    } catch (Exception error) { abortAndNotify("Cannot open the save dialog. Your project remains in the app."); }
                });
            } catch (Exception error) { abortAndNotify("Export could not be prepared. Check free device storage."); }
        }
        @JavascriptInterface public synchronized void cancelExport(String ticket) { if (id != null && id.equals(ticket)) cleanup(); }
        synchronized void copyTo(Uri destination) {
            if (!readyToSave || file == null) { notifyExport(false, "No prepared export is available. Please export again."); return; }
            try (InputStream in = new FileInputStream(file); OutputStream out = getContentResolver().openOutputStream(destination, "w")) {
                if (out == null) throw new IllegalStateException("No writable document stream");
                byte[] buffer = new byte[64 * 1024]; int count;
                while ((count = in.read(buffer)) != -1) out.write(buffer,0,count);
                out.flush(); notifyExport(true, "Backup saved successfully.");
            } catch (Exception error) { notifyExport(false, "Export failed. Check storage space, then try another save location."); }
            finally { cleanup(); }
        }
        synchronized void abortAndNotify(String message) { cleanup(); notifyExport(false,message); }
        synchronized void cleanup() {
            try { if (output != null) output.close(); } catch (Exception ignored) { }
            output = null; if (file != null) file.delete(); file = null; id = null; readyToSave = false; expected = written = 0;
        }
    }
}
