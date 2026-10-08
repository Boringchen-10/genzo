package com.genzo.android

import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.material.bottomsheet.BottomSheetDialog
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

interface ReaderSurface {
    val view: View
    val rendered: Boolean
    fun location(): JSONObject?
    fun move(forward: Boolean)
    fun seek(fraction: Double)
    fun settingsChanged()
    fun close()
    fun zoomRatio(): Float = 1f
    fun imageGeometry(): JSONObject? = null
}

/** React keeps the library; this activity owns reader gestures and lifecycle. */
class ReaderActivity : AppCompatActivity() {
    companion object {
        var current: java.lang.ref.WeakReference<ReaderActivity>? = null
        @Volatile var snapshot = JSONObject().put("status", "closed")
    }
    lateinit var client: ReaderClient; private set
    lateinit var settings: JSONObject; private set
    var kind = "comic"; private set
    var entry = ""; private set
    private lateinit var root: FrameLayout
    private lateinit var content: FrameLayout
    private lateinit var top: LinearLayout
    private lateinit var bottom: LinearLayout
    private lateinit var title: TextView
    private lateinit var position: TextView
    private lateinit var seek: SeekBar
    private lateinit var dimmer: View
    private var surface: ReaderSurface? = null
    private var manifest: JSONObject? = null
    private var entries = JSONArray()
    private var loading = false
    private var generation = 0
    private var menu = true
    private var firstContent = true
    private var menuTouched = false
    private var pendingSave: Job? = null
    private var autoScroll: Job? = null
    private val writes = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val writeLock = kotlinx.coroutines.sync.Mutex()
    val readerBackground: Int get() = when (settings.optString("theme", "dark")) {
        "white" -> Color.rgb(250,250,250); "green" -> Color.rgb(218,232,211)
        "paper" -> Color.rgb(247,244,235); else -> Color.rgb(15,19,21)
    }
    val readerForeground: Int get() = if (settings.optString("theme", "dark") == "dark") Color.rgb(226, 232, 231) else Color.rgb(35, 40, 39)
    val accent = Color.rgb(23, 180, 145)
    fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        supportFragmentManager.fragmentFactory = org.readium.r2.navigator.epub.EpubNavigatorFragment.createDummyFactory()
        super.onCreate(savedInstanceState)
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window,false)
        current = java.lang.ref.WeakReference(this)
        kind = intent.getStringExtra("kind") ?: "comic"
        entry = savedInstanceState?.getString("entry") ?: intent.getStringExtra("entryId") ?: ""
        client = ReaderClient(requireNotNull(intent.getStringExtra("baseUrl")))
        settings = runCatching { JSONObject(getSharedPreferences("genzo-reader-settings", 0).getString(kind, "{}")!!) }.getOrDefault(JSONObject())
        root = FrameLayout(this); content = FrameLayout(this).apply { id = R.id.genzo_reader_content }
        content.setOnClickListener { if(surface==null)toggleMenu() }
        root.addView(content, FrameLayout.LayoutParams(-1, -1))
        dimmer = View(this).apply { setBackgroundColor(Color.BLACK); isClickable = false }
        root.addView(dimmer, FrameLayout.LayoutParams(-1, -1))
        top = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(dp(8), 0, dp(8), 0) }
        top.addView(button("返回") { finish() })
        title = TextView(this).apply { textSize = 16f; maxLines = 1; gravity = Gravity.CENTER_VERTICAL; ellipsize = android.text.TextUtils.TruncateAt.END }
        top.addView(title, LinearLayout.LayoutParams(0, dp(56), 1f))
        root.addView(top, FrameLayout.LayoutParams(-1, dp(56), Gravity.TOP))
        bottom = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(8), 0, dp(8), dp(8)) }
        position = TextView(this).apply { textSize = 12f; gravity = Gravity.CENTER }
        bottom.addView(position)
        seek = SeekBar(this).apply { max = 1000; setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar?, progress: Int, user: Boolean) {}
            override fun onStartTrackingTouch(bar: SeekBar?) {}
            override fun onStopTrackingTouch(bar: SeekBar?) { surface?.seek(seek.progress / 1000.0) }
        }) }
        bottom.addView(seek, LinearLayout.LayoutParams(-1, dp(44)))
        val actions = LinearLayout(this)
        for ((label, action) in listOf<Pair<String, () -> Unit>>((if (kind == "comic") "上一话" else "上一章") to { chapter(false) }, "目录" to { catalogue() }, "书签" to { bookmarks() }, "设置" to { settingsSheet() }, (if (kind == "comic") "下一话" else "下一章") to { chapter(true) })) {
            actions.addView(button(label, action), LinearLayout.LayoutParams(0, dp(48), 1f))
        }
        bottom.addView(actions)
        root.addView(bottom, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
        setContentView(root)
        if (savedInstanceState != null) supportFragmentManager.fragments.forEach { supportFragmentManager.beginTransaction().remove(it).commitNow() }
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            // Chrome owns the status/cutout background; artwork starts below it.
            root.setPadding(bars.left,bars.top,bars.right,bars.bottom)
            WindowInsetsCompat.Builder(insets).setInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),androidx.core.graphics.Insets.NONE).build()
        }
        applyAppearance(); load(entry, savedInstanceState?.getString("location")?.let { runCatching { JSONObject(it) }.getOrNull() })
    }
    fun button(label: String, action: () -> Unit) = Button(this).apply {
        text = label; textSize = 12f; isAllCaps = false; minWidth = dp(44); minimumWidth = dp(44); minimumHeight = dp(44)
        setPadding(dp(4), 0, dp(4), 0); setOnClickListener { action() }
        contentDescription = label; setTextColor(readerForeground)
        backgroundTintList = android.content.res.ColorStateList.valueOf(if (settings.optString("theme","dark") == "dark") Color.rgb(33,43,42) else Color.rgb(230,231,222))
    }
    fun toggleMenu() { menuTouched = true;menu = !menu; applyMenu(); report(snapshot.optString("status","ready")) }
    private fun applyMenu() { top.visibility = if (menu) View.VISIBLE else View.GONE; bottom.visibility = top.visibility
        WindowInsetsControllerCompat(window, root).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            if (menu) show(WindowInsetsCompat.Type.systemBars()) else hide(WindowInsetsCompat.Type.systemBars())
        }
    }
    fun notify(message: String) { Toast.makeText(this, message, Toast.LENGTH_SHORT).show() }
    fun locationChanged(page: Int, count: Int, fraction: Double) {
        position.text = if (kind == "comic") "${page + 1} / $count 页" else "${"%.1f".format(fraction.coerceIn(0.0,1.0) * 100)}%"
        seek.progress = (fraction.coerceIn(0.0, 1.0) * 1000).toInt()
        report("ready")
        pendingSave?.cancel(); pendingSave = lifecycleScope.launch { delay(600); save() }
    }
    private fun save() {
        val location = surface?.location() ?: return
        val target = entry
        writes.launch { writeLock.lock(); try { client.json("chapter/$target/progress", location) }
            catch (_: Exception) { withContext(Dispatchers.Main) { if (!isFinishing) notify("阅读位置暂未保存，请返回前重试。") } }
            finally { writeLock.unlock() } }
    }
    private fun showError(message: String, retry: () -> Unit) {
        val panel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(dp(24), dp(72), dp(24), dp(120)) }
        panel.addView(TextView(this).apply { text = message; setTextColor(readerForeground); gravity = Gravity.CENTER })
        panel.addView(button("重试", retry)); content.removeAllViews(); content.addView(panel, FrameLayout.LayoutParams(-1, -1))
    }
    fun surfaceFailed(message: String) {
        surface?.close(); surface = null
        showError(message) { load(entry) }; report("error")
    }
    fun load(id: String, desired: JSONObject? = null) {
        if (loading) return
        save(); loading = true; val request = ++generation
        if (surface == null) { content.removeAllViews(); content.addView(ProgressBar(this), FrameLayout.LayoutParams(dp(48), dp(48), Gravity.CENTER)) }
        title.text = "正在读取正文…"
        report("loading")
        lifecycleScope.launch {
            try {
                val data = client.json("chapter/$id")
                if (request != generation) return@launch
                surface?.close(); surface = null; content.removeAllViews(); entry = id; manifest = data
                title.text = data.getString("title") + if (data.optBoolean("offline")) " · 离线" else ""
                val location = desired ?: data.optJSONObject("location")
                surface = if (kind == "comic") ComicReaderSurface(this@ReaderActivity, data, location) else NovelReaderSurface(this@ReaderActivity, content, data, location)
                if (kind == "comic") content.addView(surface!!.view, FrameLayout.LayoutParams(-1, -1))
                applyAppearance()
                report("ready")
            } catch (error: Exception) {
                if (request != generation) return@launch
                if (surface == null) showError(error.message ?: "正文读取失败") { load(id, desired) } else notify(error.message ?: "章节切换失败，原文保留。")
                title.text = manifest?.optString("title") ?: "正文读取失败"
                report(if (surface == null) "error" else "ready")
            } finally { if (request == generation) loading = false }
        }
    }
    private suspend fun catalogueEntries() {
        if (entries.length() > 0) return
        val result = JSONArray(); var offset = 0
        do {
            val page = client.json("entries/$offset"); val items = page.getJSONArray("entries")
            for (index in 0 until items.length()) result.put(items.getJSONObject(index))
            val previous = offset; offset += items.length()
            check(offset > previous || offset >= page.getInt("total")) { "章节目录不完整，请重试。" }
            check(result.length() <= 10000) { "章节目录过大" }
        } while (offset < page.getInt("total"))
        entries = result
    }
    fun adjacent(forward: Boolean, automatic: Boolean = false) {
        if (loading || automatic && !settings.optBoolean("continuous", true)) return
        lifecycleScope.launch {
            try {
                catalogueEntries(); val index = (0 until entries.length()).firstOrNull { entries.getJSONObject(it).getString("id") == entry } ?: return@launch
                val next = index + if (forward) 1 else -1
                if (next !in 0 until entries.length()) { if (!automatic) notify(if (forward) "已经是最后一章" else "已经是第一章"); return@launch }
                load(entries.getJSONObject(next).getString("id"), JSONObject().put("end", !forward))
            } catch (error: Exception) { notify(error.message ?: "章节目录读取失败") }
        }
    }
    fun chapter(forward: Boolean) {
        val novel = surface as? NovelReaderSurface
        if (novel != null) novel.chapter(forward) else adjacent(forward)
    }
    fun catalogue() {
        if (kind == "novel" && surface is NovelReaderSurface) {
            choice("阅读目录", listOf("本卷章节", "全部卷册")) { option -> if (option == 0) (surface as? NovelReaderSurface)?.contents() else seriesCatalogue() }
        } else seriesCatalogue()
    }
    private fun seriesCatalogue() {
        lifecycleScope.launch {
            try {
                catalogueEntries(); choice("章节目录", (0 until entries.length()).map { entries.getJSONObject(it).getString("title") }) { load(entries.getJSONObject(it).getString("id")) }
            } catch (error: Exception) { notify(error.message ?: "目录读取失败") }
        }
    }
    fun choice(title: String, items: List<String>, selected: (Int) -> Unit) {
        androidx.appcompat.app.AlertDialog.Builder(this).setTitle(title).setItems(items.toTypedArray()) { _, index -> selected(index) }.setNegativeButton("关闭", null).show()
    }
    private fun bookmarks() {
        choice("书签与阅读记录", listOf("添加当前位置", "查看 / 删除书签", "最近阅读")) { action -> lifecycleScope.launch {
            try {
                if (action == 0) {
                    val location = surface?.location() ?: return@launch
                    client.json("chapter/$entry/bookmark", JSONObject().put("location", location).put("label", "${manifest?.optString("title")} · ${position.text}".take(500))); notify("书签已保存")
                } else if (action == 1) {
                    val marks = client.array("bookmarks")
                    if (marks.length() == 0) { notify("暂无书签"); return@launch }
                    choice("阅读书签", (0 until marks.length()).map { marks.getJSONObject(it).getString("label") }) { index ->
                        val mark = marks.getJSONObject(index)
                        choice(mark.getString("label"), listOf("跳转", "删除")) { option ->
                            if (option == 0) load(mark.getString("entryId"), mark.getJSONObject("location")) else lifecycleScope.launch {
                                runCatching { client.json("chapter/${mark.getString("entryId")}/delete-bookmark", JSONObject().put("id", mark.getString("id"))) }.onSuccess { notify("书签已删除") }.onFailure { notify("书签删除失败") }
                            }
                        }
                    }
                } else {
                    val history = client.array("history")
                    if (history.length() == 0) { notify("暂无阅读记录"); return@launch }
                    catalogueEntries()
                    val labels = (0 until history.length()).map { index ->
                        val row = history.getJSONObject(index)
                        val name = (0 until entries.length()).map { entries.getJSONObject(it) }.firstOrNull { it.getString("id") == row.getString("entryId") }?.getString("title") ?: "已读章节"
                        "$name · ${row.getString("updatedAt").take(10)}"
                    }
                    choice("最近阅读", labels) { index -> val row = history.getJSONObject(index); load(row.getString("entryId"),row.getJSONObject("location")) }
                }
            } catch (error: Exception) { notify(error.message ?: "书签操作失败") }
        } }
    }
    private fun settingsSheet() {
        val dialog = BottomSheetDialog(this); val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(12), dp(20), dp(24)); setBackgroundColor(readerBackground) }
        fun toggle(label: String, key: String, default: Boolean) {
            column.addView(Switch(this).apply { text = label; setTextColor(readerForeground); minHeight = dp(48); isChecked = settings.optBoolean(key, default)
                setOnCheckedChangeListener { _, value -> settings.put(key, value); persistSettings() } })
        }
        fun slider(label: String, key: String, low: Double, high: Double, default: Double, integer:Boolean=false) {
            val text = TextView(this).apply { setTextColor(readerForeground) }; column.addView(text)
            val bar = SeekBar(this).apply { max = 100; progress = ((settings.optDouble(key, default) - low) / (high - low) * 100).toInt().coerceIn(0, 100) }
            fun update() { val value = low + bar.progress / 100.0 * (high - low); text.text = "$label：${if(integer)value.roundToInt().toString()else "%.1f".format(value)}" }
            bar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(bar: SeekBar?, value: Int, user: Boolean) { update() }
                override fun onStartTrackingTouch(bar: SeekBar?) {}
                override fun onStopTrackingTouch(bar: SeekBar?) { val value=low+(bar?.progress?:0)/100.0*(high-low);settings.put(key,if(integer)value.roundToInt().toDouble()else value);persistSettings() }
            }); update(); column.addView(bar, LinearLayout.LayoutParams(-1, dp(44)))
        }
        column.addView(button("阅读配色") { choice("配色", listOf("深色", "纸张", "白色", "护眼绿")) { settings.put("theme", listOf("dark", "paper", "white", "green")[it]); persistSettings() } })
        if (kind == "comic") {
            column.addView(button("阅读模式") { choice("阅读模式", listOf("纵向滚动", "横向滚动", "左右翻页", "上下翻页")) { settings.put("mode", listOf("scroll-vertical", "scroll-horizontal", "page-horizontal", "page-vertical")[it]); persistSettings() } })
            toggle("从右向左阅读", "rtl", false); toggle("自动进入下一章", "continuous", true)
            toggle("长按放大", "longPressZoom", true); slider("页面间距", "gap", 0.0, 24.0, 0.0)
            toggle("自动滚动", "autoScroll", false); slider("自动滚动速度", "autoSpeed", 10.0, 100.0, 35.0)
            slider("夜间遮罩", "dimming", 0.0, 0.8, 0.0)
            slider("图片超时（秒）", "imageTimeout", 5.0, 60.0, 15.0,true)
            slider("图片重试次数", "imageRetries", 0.0, 5.0, 1.0,true)
            val stats=ReaderClient.imageStats()
            column.addView(TextView(this).apply {setTextColor(readerForeground);text="最近10分钟内加载 ${stats.optInt("count")} 张，平均 ${"%.2f".format(stats.optLong("averageMs")/1000.0)} 秒"})
        } else {
            toggle("滚动阅读", "scroll", false)
            column.addView(button("字体") { choice("字体", listOf("系统无衬线", "系统衬线", "等宽")) { settings.put("font", listOf("sans-serif", "serif", "monospace")[it]); persistSettings() } })
            slider("字号", "fontSize", 14.0, 32.0, 20.0); slider("行距", "lineHeight", 1.2, 2.4, 1.8)
            slider("页边距", "margins", 0.4, 2.0, 1.0); slider("段落间距", "paragraphSpacing", 0.0, 2.0, 0.6)
        }
        toggle("保持屏幕常亮", "keepScreenOn", true); toggle("音量键翻页", "volumeKeys", true)
        toggle("跟随系统亮度", "systemBrightness", true); slider("阅读亮度", "brightness", 0.05, 1.0, 0.5)
        dialog.setContentView(ScrollView(this).apply { addView(column) }); dialog.show()
    }
    private fun persistSettings() {
        getSharedPreferences("genzo-reader-settings", 0).edit().putString(kind, settings.toString()).apply()
        applyAppearance(); surface?.settingsChanged()
        report("ready")
    }
    fun report(status: String) {
        if (firstContent && surface?.rendered == true) { firstContent = false;if(!menuTouched){menu = false;applyMenu()} }
        snapshot = JSONObject().put("status", status).put("kind", kind).put("entryId", entry)
            .put("sessionId", intent.getStringExtra("sessionId")).put("engine", if (kind == "comic") "Kotlin/SSIV" else "Readium 3.1.2")
            .put("title", manifest?.optString("title")).put("offline", manifest?.optBoolean("offline") ?: false)
            .put("location", surface?.location()).put("settings", JSONObject(settings.toString()))
            .put("rendered", surface?.rendered ?: false)
            .put("menuVisible", menu)
            .put("windowBrightness", window.attributes.screenBrightness)
            .put("keepScreenOn", window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON != 0)
            .put("viewportWidth", content.width).put("viewportHeight", content.height)
            .put("zoomRatio", surface?.zoomRatio() ?: 1f)
            .put("imageGeometry", surface?.imageGeometry())
            .put("visiblePages",(surface as? ComicReaderSurface)?.visiblePages())
            .put("zoomDiagnostics",(surface as? ComicReaderSurface)?.zoomDiagnostics())
            .put("imageStats",ReaderClient.imageStats())
            .put("contentTop",content.top).put("chromeColor",readerBackground)
            .put("progress", if (::seek.isInitialized) seek.progress else 0)
    }
    /** Debug QA package only: exercises the same surface/settings methods as UI controls. */
    fun qaControl(action: String, value: Double, options: String?) {
        when (action) {
            "next" -> surface?.move(true); "previous" -> surface?.move(false)
            "seek" -> surface?.seek(value.coerceIn(0.0,1.0)); "menu" -> toggleMenu(); "close" -> finish()
            "chapter-next" -> chapter(true); "chapter-previous" -> chapter(false)
            "catalogue" -> catalogue(); "bookmarks" -> bookmarks(); "settings-sheet" -> settingsSheet()
            "orientation" -> { requestedOrientation = if (value == 1.0) android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE else android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
            "settings" -> {
                val updated = JSONObject(options ?: "{}")
                updated.keys().forEach { key -> settings.put(key, updated.get(key)) }
                persistSettings()
            }
            else -> error("Unknown reader action")
        }
        report("ready")
    }
    private fun applyAppearance() {
        root.setBackgroundColor(readerBackground); top.setBackgroundColor(readerBackground); bottom.setBackgroundColor(readerBackground)
        title.setTextColor(readerForeground); position.setTextColor(readerForeground)
        fun paintControls(view: View) {
            if (view is Button) { view.setTextColor(readerForeground); view.backgroundTintList = android.content.res.ColorStateList.valueOf(if (settings.optString("theme","dark") == "dark") Color.rgb(33,43,42) else Color.rgb(230,231,222)) }
            if (view is android.view.ViewGroup) for (index in 0 until view.childCount) paintControls(view.getChildAt(index))
        }
        paintControls(top); paintControls(bottom)
        dimmer.alpha = if (kind == "comic") settings.optDouble("dimming", 0.0).toFloat() else 0f
        if (settings.optBoolean("keepScreenOn", true)) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.attributes = window.attributes.apply { screenBrightness = if (settings.optBoolean("systemBrightness", true)) -1f else settings.optDouble("brightness", .5).toFloat() }
        WindowInsetsControllerCompat(window, root).apply { isAppearanceLightStatusBars = readerBackground != Color.rgb(15,19,21); isAppearanceLightNavigationBars = isAppearanceLightStatusBars }
        autoScroll?.cancel()
        if (kind == "comic" && settings.optBoolean("autoScroll", false)) autoScroll = lifecycleScope.launch {
            while (isActive) { delay(50); if (!menu && !loading) (surface as? ComicReaderSurface)?.autoScroll(settings.optDouble("autoSpeed",35.0)) }
        }
    }
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (settings.optBoolean("volumeKeys", true) && keyCode in listOf(KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN)) { surface?.move(keyCode == KeyEvent.KEYCODE_VOLUME_DOWN); return true }
        return super.onKeyDown(keyCode, event)
    }
    override fun onConfigurationChanged(configuration: Configuration) { super.onConfigurationChanged(configuration); surface?.settingsChanged() }
    override fun onSaveInstanceState(out: Bundle) { out.putString("entry", entry); out.putString("location", surface?.location()?.toString()); super.onSaveInstanceState(out) }
    override fun onPause() { pendingSave?.cancel(); autoScroll?.cancel(); save(); super.onPause() }
    override fun onResume() { super.onResume(); if (::root.isInitialized) applyAppearance() }
    override fun onDestroy() {
        generation++; surface?.close(); super.onDestroy()
        if (current?.get() === this) { current = null; snapshot = JSONObject().put("status", "closed") }
        if (isFinishing) writes.launch { writeLock.lock(); try { client.json("close", JSONObject()) } catch (_: Exception) {} finally { writeLock.unlock(); writes.cancel() } }
        else writes.launch { writeLock.lock(); writeLock.unlock(); writes.cancel() }
    }
}
