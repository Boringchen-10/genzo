package com.genzo.android

import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Invoke
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.interfaces.IMedia
import org.videolan.libvlc.util.VLCVideoLayout
import java.io.File
import java.security.MessageDigest
import java.lang.ref.WeakReference
import java.util.UUID

// A native validation view. OpenDesign will define the final controls and React entry flow.
class PlayerActivity : ComponentActivity() {
    companion object {
        @Volatile var snapshot = JSObject().put("status", "idle")
        var current: WeakReference<PlayerActivity>? = null
    }
    private lateinit var vlc: LibVLC
    private lateinit var player: MediaPlayer
    private lateinit var label: TextView
    private lateinit var seek: SeekBar
    private lateinit var video: VLCVideoLayout
    private var descriptor: ParcelFileDescriptor? = null
    private var uri = ""
    private var mediaFileId: String? = null
    private var sessionId: String? = null
    private var revision = 0L
    private var resumeMs = 0L
    private var subtitleDelayMs = 0L
    private var pendingRate: Float? = null
    private var status = "opening"
    private val subtitleFiles = mutableListOf<File>()
    private val sidecars = linkedMapOf<String, Pair<String, File>>()
    private var selectedSidecar: String? = null
    private var subtitlePicker: Invoke? = null
    private var initialSubtitle: String? = null
    private var subtitleError: String? = null
    private val handler = Handler(Looper.getMainLooper())
    private val ticker = object : Runnable {
        override fun run() { report(); handler.postDelayed(this, 1000) }
    }
    private fun identity() = MessageDigest.getInstance("SHA-256").digest(uri.toByteArray())
        .joinToString("") { "%02x".format(it) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { finish() }
        })
        current = WeakReference(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        uri = intent.getStringExtra("uri") ?: run { finish(); return }
        mediaFileId = intent.getStringExtra("mediaFileId")
        sessionId = intent.getStringExtra("sessionId")
        initialSubtitle = intent.getStringExtra("subtitleUri")
        resumeMs = savedInstanceState?.getLong("positionMs") ?: if (intent.getBooleanExtra("restart", false)) 0 else
            intent.getLongExtra("resumeMs", -1L).takeIf { it >= 0 } ?: getSharedPreferences("genzo-prototype-progress", 0).getLong(identity(), 0)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(0xff101114.toInt()) }
        video = VLCVideoLayout(this)
        root.addView(video, LinearLayout.LayoutParams(-1, 0, 1f))
        label = TextView(this).apply { setTextColor(0xffffffff.toInt()); textSize = 12f }
        root.addView(label)
        seek = SeekBar(this).apply { max = 1000 }
        root.addView(seek)
        val controls = LinearLayout(this)
        val controlHeight = (48 * resources.displayMetrics.density).toInt()
        fun button(text: String, action: () -> Unit) {
            controls.addView(Button(this).apply { this.text = text; textSize = 13f; setOnClickListener { action() } }, LinearLayout.LayoutParams(0, controlHeight, 1f))
        }
        button("暂停/播放") { if (player.isPlaying) player.pause() else player.play() }
        button("倍速") { AlertDialog.Builder(this).setItems(arrayOf("0.5×", "1×", "1.5×", "2×")) { _, index -> setPlaybackRate(floatArrayOf(.5f, 1f, 1.5f, 2f)[index]) }.show() }
        button("音轨") { tracks(false) }
        button("字幕") { tracks(true) }
        root.addView(controls)
        val extra = LinearLayout(this)
        extra.addView(Button(this).apply { text = "选择外挂字幕"; setOnClickListener { launchSubtitlePicker() } }, LinearLayout.LayoutParams(0, controlHeight, 1f))
        extra.addView(Button(this).apply { text = "字幕偏移"; setOnClickListener {
            AlertDialog.Builder(this@PlayerActivity).setItems(arrayOf("提前 500 ms", "重置", "延后 500 ms")) { _, index ->
                subtitleDelayMs = if (index == 1) 0 else subtitleDelayMs + if (index == 0) -500 else 500
                if (!player.setSpuDelay(subtitleDelayMs * 1000)) label.text = "当前字幕不支持时间偏移"
            }.show()
        } }, LinearLayout.LayoutParams(0, controlHeight, 1f))
        extra.addView(Button(this).apply { text = "横/竖屏"; setOnClickListener {
            requestedOrientation = if (resources.configuration.orientation == 2) ActivityInfo.SCREEN_ORIENTATION_PORTRAIT else ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        } }, LinearLayout.LayoutParams(0, controlHeight, 1f))
        root.addView(extra)
        setContentView(root)
        vlc = LibVLC(this, arrayListOf("--no-video-title-show", "--network-caching=1500"))
        player = MediaPlayer(vlc)
        player.attachViews(video, null, true, false)
        player.setEventListener { event ->
            when (event.type) {
                MediaPlayer.Event.Playing -> {
                    status = "playing"
                    pendingRate?.let { pendingRate = null; player.rate = it }
                    if (resumeMs > 0) { player.setTime(resumeMs, false); resumeMs = 0 }
                    val initialFile = intent.getStringExtra("subtitleFile")
                    if (initialSubtitle != null || initialFile != null) {
                        val selected = initialSubtitle
                        initialSubtitle = null
                        intent.removeExtra("subtitleFile")
                        try {
                            val file = initialFile?.let { path -> File(path).also {
                                require(it.canonicalPath.startsWith(File(applicationInfo.dataDir, "player-subtitles").canonicalPath + "/"))
                                require(it.length() <= 16 * 1024 * 1024)
                                subtitleFiles.add(it)
                            } }
                            if (file != null) selectSidecar(file, intent.getStringExtra("subtitleLabel"), intent.getStringExtra("subtitleId"))
                            else loadSubtitle(Uri.parse(requireNotNull(selected)), intent.getStringExtra("subtitleId"))
                        } catch (_: Exception) { subtitleError = "外挂字幕无法加载，请手动选择" }
                    }
                }
                MediaPlayer.Event.Paused -> status = "paused"
                MediaPlayer.Event.Buffering -> status = if (event.buffering < 100) "buffering" else if (player.isPlaying) "playing" else "paused"
                MediaPlayer.Event.EndReached -> status = "ended"
                MediaPlayer.Event.EncounteredError -> status = "playback_error"
            }
            report()
        }
        seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar?, value: Int, fromUser: Boolean) {}
            override fun onStartTrackingTouch(bar: SeekBar?) {}
            override fun onStopTrackingTouch(bar: SeekBar?) { if (player.isSeekable) player.setTime(player.length * seek.progress / 1000, false) }
        })
        try {
            val locator = Uri.parse(uri)
            val media = if (locator.scheme == "content") {
                descriptor = contentResolver.openFileDescriptor(locator, "r") ?: throw IllegalStateException("Unreadable document")
                Media(vlc, descriptor!!.fileDescriptor)
            } else Media(vlc, locator)
            // The debug emulator's goldfish decoder can keep stale frames after a paused seek.
            val softwarePreview = BuildConfig.DEBUG && Build.HARDWARE in listOf("ranchu", "goldfish")
            media.setHWDecoderEnabled(!softwarePreview, false)
            player.media = media
            media.release()
            player.play()
        } catch (_: SecurityException) { status = "permission_denied" }
        catch (_: Exception) { status = "playback_error" }
        handler.post(ticker)
    }

    private fun tracks(subtitle: Boolean) {
        val items = (if (subtitle) player.spuTracks else player.audioTracks) ?: emptyArray()
        AlertDialog.Builder(this).setItems(items.map { "${it.id}: ${it.name}" }.toTypedArray()) { _, index ->
            val changed = if (subtitle) player.setSpuTrack(items[index].id) else player.setAudioTrack(items[index].id)
            if (changed && subtitle) selectedSidecar = null
        }.show()
    }

    @Deprecated("Prototype uses the platform result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 20) return
        val pending = subtitlePicker
        subtitlePicker = null
        val selected = data?.data
        if (resultCode != RESULT_OK || selected == null) { pending?.resolve(JSObject().put("status", "cancelled")); return }
        try {
            if (((data?.flags ?: 0) and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) != 0) {
                contentResolver.takePersistableUriPermission(selected, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val track = loadSubtitle(selected)
            report()
            pending?.resolve(JSObject().put("status", "selected").put("track", track))
        } catch (_: SecurityException) { pending?.resolve(JSObject().put("status", "permission_denied")); Toast.makeText(this, "无法读取所选字幕，请重新授权", Toast.LENGTH_LONG).show() }
        catch (_: Exception) { pending?.resolve(JSObject().put("status", "subtitle_error")); Toast.makeText(this, "请选择不超过 16 MiB 的 SRT、ASS 或 SSA 字幕", Toast.LENGTH_LONG).show() }
    }

    private fun launchSubtitlePicker() {
        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION), 20)
    }

    fun pickSubtitle(invoke: Invoke, expectedSession: String) {
        if (sessionId != expectedSession || isFinishing || isDestroyed) { invoke.reject("expired_player_session"); return }
        if (subtitlePicker != null) { invoke.reject("subtitle_picker_busy"); return }
        subtitlePicker = invoke
        try { launchSubtitlePicker() } catch (_: Exception) { subtitlePicker = null; invoke.resolve(JSObject().put("status", "subtitle_error")) }
    }

    private fun loadSubtitle(selected: Uri, trackId: String? = null): JSObject {
        require(selected.scheme == "content")
        val name = contentResolver.query(selected, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        }
        val extension = name?.substringAfterLast('.')?.lowercase()
        require(extension in listOf("srt", "ass", "ssa"))
        // Copy only the chosen small sidecar, never the video. Files are deleted with this player instance.
        val file = File(cacheDir, "prototype-subtitle-${System.nanoTime()}.$extension")
        subtitleFiles.add(file)
        contentResolver.openInputStream(selected)?.use { input -> file.outputStream().use { output ->
            val bytes = ByteArray(8192); var total = 0L
            while (true) { val count = input.read(bytes); if (count < 0) break
                total += count; require(total <= 16 * 1024 * 1024); output.write(bytes, 0, count) }
        } } ?: throw IllegalStateException("Unreadable subtitle")
        return selectSidecar(file, name, trackId)
    }

    private fun selectSidecar(file: File, name: String?, trackId: String?): JSObject {
        require(file.extension.lowercase() in listOf("srt", "ass", "ssa"))
        check(player.addSlave(IMedia.Slave.Type.Subtitle, file.absolutePath, true))
        val id = trackId ?: "sidecar:${UUID.randomUUID()}"
        sidecars[id] = Pair(name ?: "外挂字幕", file)
        selectedSidecar = id
        subtitleError = null
        return JSObject().put("id", id).put("label", name ?: "外挂字幕").put("kind", "sidecar").put("available", true)
    }

    private fun setPlaybackRate(rate: Float) {
        // Changing rate while paused can discard the active subtitle cue in LibVLC 3.7.7.
        // Retain the chosen speed and apply it when playback resumes.
        if (status == "paused" || !player.isPlaying) pendingRate = rate else player.rate = rate
    }

    fun control(args: ControlArgs): JSObject {
        require(args.sessionId == null || (args.sessionId == sessionId && !isFinishing && !isDestroyed))
        when (args.action) {
            "play" -> player.play()
            "pause" -> player.pause()
            "seek" -> { require(player.isSeekable && args.value >= 0 && args.value <= player.length); player.setTime(args.value.toLong(), false) }
            "rate" -> { require(args.value in .5..2.0); setPlaybackRate(args.value.toFloat()) }
            "audio" -> {
                val id = args.trackId?.toInt() ?: args.value.toInt()
                require(player.audioTracks?.any { it.id == id } == true)
                check(player.setAudioTrack(id))
            }
            "subtitle" -> {
                val sidecar = args.trackId?.let { sidecars[it] }
                if (sidecar != null) { check(player.addSlave(IMedia.Slave.Type.Subtitle, sidecar.second.absolutePath, true)); selectedSidecar = args.trackId }
                else {
                    val id = args.trackId?.toInt() ?: args.value.toInt()
                    require(player.spuTracks?.any { it.id == id } == true)
                    check(player.setSpuTrack(id)); selectedSidecar = null
                }
            }
            "subtitleOffset" -> { require(args.value in -60000.0..60000.0); subtitleDelayMs = args.value.toLong(); check(player.setSpuDelay(subtitleDelayMs * 1000)) }
            "externalSubtitle" -> loadSubtitle(Uri.parse(requireNotNull(args.uri)))
            "landscape" -> requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            "portrait" -> requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            "system" -> requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            "close" -> { player.pause(); status = "closed"; finish() }
            else -> throw IllegalArgumentException("Unknown action")
        }
        report()
        return snapshot
    }

    private fun report() {
        if (!::player.isInitialized) return
        fun trackList(items: Array<MediaPlayer.TrackDescription>?) = JSArray().apply {
            items?.forEach { put(JSObject().put("id", it.id).put("name", it.name)) }
        }
        val subtitleTracks = trackList(player.spuTracks)
        sidecars.forEach { (id, entry) -> subtitleTracks.put(JSObject().put("id", id).put("name", entry.first).put("kind", "sidecar")) }
        snapshot = JSObject().put("status", status).put("engine", "LibVLC 3.7.7").put("positionMs", player.time)
            .put("mediaFileId", mediaFileId).put("sessionId", sessionId).put("revision", ++revision)
            .put("updatedAtMs", System.currentTimeMillis())
            .put("durationMs", player.length).put("seekable", player.isSeekable).put("rate", pendingRate ?: player.rate)
            .put("audioTracks", trackList(player.audioTracks)).put("subtitleTracks", subtitleTracks).put("selectedSidecar", selectedSidecar)
            .put("audioTrack", player.audioTrack).put("subtitleTrack", player.spuTrack).put("subtitleDelayUs", player.spuDelay)
            .put("subtitleOffsetMs", player.spuDelay / 1000)
        label.text = subtitleError ?: "${status} · ${player.time / 1000}/${player.length / 1000}s · ${player.rate}× · ${subtitleDelayMs}ms"
        if (player.length > 0 && !seek.isPressed) seek.progress = (player.time * 1000 / player.length).toInt().coerceIn(0, 1000)
        if (player.time >= 0 && player.length > 0) getSharedPreferences("genzo-prototype-progress", 0).edit().putLong(identity(), player.time).apply()
        if (mediaFileId != null && player.time >= 0 && player.length > 0) {
            getSharedPreferences("genzo-player", 0).edit().putString("lastProgress", snapshot.toString()).apply()
        }
    }

    override fun onStart() {
        super.onStart()
        // LibVLC detaches automatically when the system picker destroys our surfaces.
        if (::player.isInitialized && !player.vlcVout.areViewsAttached()) {
            player.detachViews()
            player.attachViews(video, null, true, false)
        }
    }
    override fun onPause() { if (::player.isInitialized) { player.pause(); status = if (isFinishing) "closed" else "paused"; report() }; super.onPause() }
    override fun onStop() { if (::player.isInitialized) player.detachViews(); super.onStop() }
    override fun onSaveInstanceState(outState: Bundle) { if (::player.isInitialized) outState.putLong("positionMs", player.time); super.onSaveInstanceState(outState) }
    override fun onDestroy() {
        subtitlePicker?.resolve(JSObject().put("status", "cancelled")); subtitlePicker = null
        handler.removeCallbacks(ticker)
        if (::player.isInitialized) { status = "closed"; report(); player.stop(); player.detachViews(); player.release() }
        if (::vlc.isInitialized) vlc.release()
        descriptor?.close()
        subtitleFiles.forEach { it.delete() }
        if (current?.get() === this) current = null
        super.onDestroy()
    }
}
