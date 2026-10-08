package com.genzo.android

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.os.CancellationSignal
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import androidx.core.view.WindowInsetsControllerCompat

@InvokeArg
class TreeArgs { var uri: String? = null; var rootUri: String? = null }
@InvokeArg
class PlayerArgs {
    lateinit var uri: String
    var restart: Boolean = false
    var mediaFileId: String? = null
    var sessionId: String? = null
    var resumeMs: Long? = null
    var subtitleUri: String? = null
    var subtitleFile: String? = null
    var subtitleLabel: String? = null
    var subtitleId: String? = null
}
@InvokeArg
class CredentialArgs { lateinit var id: String; var username: String = ""; var password: String = "" }
@InvokeArg
class ControlArgs { lateinit var action: String; var value: Double = 0.0; var uri: String? = null; var sessionId: String? = null; var trackId: String? = null }
@InvokeArg
class SessionArgs { lateinit var sessionId: String }
@InvokeArg
class AppearanceArgs { var dark: Boolean = true }
@InvokeArg
class ReaderArgs { lateinit var sessionId: String; lateinit var baseUrl: String; lateinit var kind: String; lateinit var entryId: String }
@InvokeArg
class ReaderControlArgs { lateinit var sessionId: String; lateinit var action: String; var value: Double = 0.0; var settings: String? = null }
@InvokeArg
class DataPackageArgs { lateinit var data: String }

@TauriPlugin
class GenzoPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun fingerprintDocument(invoke: Invoke) {
        val uri = Uri.parse(invoke.parseArgs(TreeArgs::class.java).uri)
        if (uri.scheme != "content") { invoke.reject("invalid_document"); return }
        worker.execute { try {
            fun attributes(): Pair<Long, Long> = requireNotNull(activity.contentResolver.query(uri,
                arrayOf(DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED),null,null,null)).use { cursor ->
                require(cursor.moveToFirst() && !cursor.isNull(0) && !cursor.isNull(1))
                Pair(cursor.getLong(0),cursor.getLong(1))
            }
            val before = attributes(); require(before.first > 0)
            val digest = java.security.MessageDigest.getInstance("SHA-256")
            var size = 0L
            requireNotNull(activity.contentResolver.openInputStream(uri)).use { input ->
                val buffer = ByteArray(1024*1024)
                while (true) { val count=input.read(buffer); if (count<0) break; digest.update(buffer,0,count); size+=count }
            }
            require(attributes()==before && size==before.first)
            val hash=digest.digest().joinToString("") { "%02x".format(it) }
            invoke.resolve(JSObject().put("size",size).put("version","sha256:$hash:$size"))
        } catch (_:Exception) { invoke.reject("document_verification_failed"); } }
    }
    private var pendingDataPackage: ByteArray? = null
    @Command
    fun exportDataPackage(invoke: Invoke) {
        val data = invoke.parseArgs(DataPackageArgs::class.java).data.toByteArray(Charsets.UTF_8)
        if (data.size > 16 * 1024 * 1024 || pendingDataPackage != null) { invoke.reject("package_limit_or_busy"); return }
        pendingDataPackage = data
        startActivityForResult(invoke,Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE)
            .putExtra(Intent.EXTRA_TITLE,"Genzo-personal-data.json"),"dataPackageSaved")
    }
    @ActivityCallback
    fun dataPackageSaved(invoke: Invoke,result: ActivityResult) {
        val bytes = pendingDataPackage; pendingDataPackage = null
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) { invoke.resolve(JSObject().put("status","cancelled")); return }
        if (bytes == null || uri.scheme != "content") { invoke.reject("invalid_package_target"); return }
        worker.execute { try {
            requireNotNull(activity.contentResolver.openOutputStream(uri,"wt")).use { it.write(bytes) }
            invoke.resolve(JSObject().put("status","saved"))
        } catch (_: Exception) { invoke.reject("package_write_failed") } }
    }
    @Command
    fun importDataPackage(invoke: Invoke) {
        startActivityForResult(invoke,Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE),"dataPackageSelected")
    }
    @ActivityCallback
    fun dataPackageSelected(invoke: Invoke,result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) { invoke.resolve(JSObject().put("status","cancelled")); return }
        if (uri.scheme != "content") { invoke.reject("invalid_package_source"); return }
        worker.execute { try {
            val bytes = requireNotNull(activity.contentResolver.openInputStream(uri)).use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(32768)
                while (true) {
                    val count = input.read(buffer); if (count < 0) break
                    require(output.size()+count <= 16*1024*1024)
                    output.write(buffer,0,count)
                }
                output.toByteArray()
            }
            invoke.resolve(JSObject().put("status","selected").put("data",bytes.toString(Charsets.UTF_8)))
        } catch (_: Exception) { invoke.reject("package_read_failed") } }
    }
    private val preferences = activity.getSharedPreferences("genzo-prototype", 0)
    private val worker = Executors.newSingleThreadExecutor()
    private val timeouts = Executors.newSingleThreadScheduledExecutor()
    private val credentials = CredentialStore(activity)

    @Command
    fun openReader(invoke: Invoke) {
        val args = invoke.parseArgs(ReaderArgs::class.java)
        val uri = Uri.parse(args.baseUrl)
        if (uri.scheme != "http" || uri.host != "127.0.0.1" || uri.port <= 0 || args.kind !in listOf("comic", "novel")) {
            invoke.reject("invalid_reader_session"); return
        }
        activity.startActivity(Intent(activity, ReaderActivity::class.java)
            .putExtra("baseUrl", args.baseUrl).putExtra("sessionId", args.sessionId)
            .putExtra("kind", args.kind).putExtra("entryId", args.entryId))
        invoke.resolve(JSObject().put("status", "opening"))
    }
    @Command
    fun readerState(invoke: Invoke) {
        if (!BuildConfig.DEBUG || activity.packageName != "com.genzo.android.readerqa") { invoke.reject("qa_only"); return }
        activity.runOnUiThread {
            ReaderActivity.current?.get()?.report(ReaderActivity.snapshot.optString("status", "ready"))
            invoke.resolve(JSObject(ReaderActivity.snapshot.toString()))
        }
    }
    @Command
    fun readerControl(invoke: Invoke) {
        if (!BuildConfig.DEBUG || activity.packageName != "com.genzo.android.readerqa") { invoke.reject("qa_only"); return }
        val args = invoke.parseArgs(ReaderControlArgs::class.java)
        val reader = ReaderActivity.current?.get()
        if (reader == null || reader.intent.getStringExtra("sessionId") != args.sessionId) { invoke.reject("reader_session_expired"); return }
        activity.runOnUiThread { try { reader.qaControl(args.action, args.value, args.settings); invoke.resolve(JSObject(ReaderActivity.snapshot.toString())) }
            catch (_: Exception) { invoke.reject("invalid_reader_action") } }
    }

    @Command
    fun appearance(invoke: Invoke) {
        val args = invoke.parseArgs(AppearanceArgs::class.java)
        activity.runOnUiThread {
            WindowInsetsControllerCompat(activity.window, activity.window.decorView).apply {
                isAppearanceLightStatusBars = !args.dark
                isAppearanceLightNavigationBars = !args.dark
            }
            activity.window.decorView.setBackgroundColor(if (args.dark) 0xff090d0f.toInt() else 0xfff3f6f5.toInt())
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun saveCredentials(invoke: Invoke) {
        val args = invoke.parseArgs(CredentialArgs::class.java)
        worker.execute { try { credentials.save(args.id, args.username, args.password); invoke.resolve(JSObject()) }
            catch (_: Exception) { invoke.reject("credential_storage_failed") } }
    }
    @Command
    fun readCredentials(invoke: Invoke) {
        val args = invoke.parseArgs(CredentialArgs::class.java)
        worker.execute { try { invoke.resolve(JSObject(credentials.read(args.id).toString())) }
            catch (_: Exception) { invoke.reject("credential_invalid") } }
    }
    @Command
    fun deleteCredentials(invoke: Invoke) {
        val args = invoke.parseArgs(CredentialArgs::class.java)
        worker.execute { try { credentials.delete(args.id); invoke.resolve(JSObject()) }
            catch (_: Exception) { invoke.reject("credential_storage_failed") } }
    }

    @Command
    fun pickTree(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        startActivityForResult(invoke, intent, "treePicked")
    }

    @ActivityCallback
    fun treePicked(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolve(JSObject().put("status", "cancelled")); return
        }
        try {
            activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            preferences.edit().putString("treeUri", uri.toString()).apply()
            invoke.resolve(JSObject().put("status", "authorized").put("uri", uri.toString()))
        } catch (_: SecurityException) {
            invoke.resolve(JSObject().put("status", "permission_denied"))
        }
    }

    @Command
    fun listTree(invoke: Invoke) {
        val args = invoke.parseArgs(TreeArgs::class.java)
        val storedUri = args.uri ?: preferences.getString("treeUri", null)
        if (storedUri == null) { invoke.resolve(JSObject().put("status", "not_authorized")); return }
        worker.execute {
            try {
                val tree = Uri.parse(storedUri)
                val treeId = DocumentsContract.getTreeDocumentId(tree)
                args.rootUri?.let { root ->
                    val allowed = Uri.parse(root)
                    if (tree.authority != allowed.authority || treeId != DocumentsContract.getTreeDocumentId(allowed)) {
                        throw SecurityException("Directory outside selected source")
                    }
                }
                if (activity.contentResolver.persistedUriPermissions.none { permission ->
                    permission.isReadPermission && permission.uri.authority == tree.authority &&
                        DocumentsContract.isTreeUri(permission.uri) && DocumentsContract.getTreeDocumentId(permission.uri) == treeId
                }) throw SecurityException("No persisted tree grant")
                val documentId = if (DocumentsContract.isDocumentUri(activity, tree)) DocumentsContract.getDocumentId(tree)
                    else treeId
                val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, documentId)
                val files = JSArray()
                val projection = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED)
                val cancellation = CancellationSignal()
                val timeout = timeouts.schedule({ cancellation.cancel() }, 15, TimeUnit.SECONDS)
                var label: String? = null
                try {
                    val selected = DocumentsContract.buildDocumentUriUsingTree(tree, documentId)
                    activity.contentResolver.query(selected, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
                        null, null, null, cancellation)?.use { cursor -> if (cursor.moveToFirst()) label = cursor.getString(0) }
                    activity.contentResolver.query(children, projection, null, null, null, cancellation)?.use { cursor ->
                        while (cursor.moveToNext()) {
                            if (files.length() >= 200000) throw IllegalStateException("Directory too large")
                            files.put(JSObject().put("documentId", cursor.getString(0)).put("name", cursor.getString(1))
                                .put("mimeType", cursor.getString(2)).put("size", if (cursor.isNull(3)) org.json.JSONObject.NULL else cursor.getLong(3))
                                .put("modifiedMs", if (cursor.isNull(4)) org.json.JSONObject.NULL else cursor.getLong(4)).put("uri",
                                    DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0)).toString()))
                        }
                    } ?: throw IllegalStateException("Source unavailable")
                } finally { timeout.cancel(false) }
                invoke.resolve(JSObject().put("status", "available").put("uri", storedUri).put("label", label).put("files", files))
            } catch (_: SecurityException) {
                invoke.resolve(JSObject().put("status", "permission_denied"))
            } catch (_: Exception) {
                invoke.resolve(JSObject().put("status", "source_offline"))
            }
        }
    }

    @Command
    fun pickVideo(invoke: Invoke) {
        startActivityForResult(invoke, Intent(Intent.ACTION_OPEN_DOCUMENT).setType("video/*")
            .addCategory(Intent.CATEGORY_OPENABLE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION), "videoPicked")
    }

    @ActivityCallback
    fun videoPicked(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolve(JSObject().put("status", "cancelled")); return
        }
        try {
            activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            invoke.resolve(JSObject().put("status", "authorized").put("uri", uri.toString()))
        } catch (_: SecurityException) { invoke.resolve(JSObject().put("status", "permission_denied")) }
    }

    @Command
    fun openPlayer(invoke: Invoke) {
        val args = invoke.parseArgs(PlayerArgs::class.java)
        val uri = Uri.parse(args.uri)
        if (uri.scheme !in listOf("content", "https", "http")) { invoke.reject("Unsupported locator"); return }
        activity.startActivity(Intent(activity, PlayerActivity::class.java).putExtra("uri", args.uri)
            .putExtra("restart", args.restart).putExtra("mediaFileId", args.mediaFileId)
            .putExtra("sessionId", args.sessionId).putExtra("resumeMs", args.resumeMs ?: -1L)
            .putExtra("subtitleUri", args.subtitleUri).putExtra("subtitleFile", args.subtitleFile)
            .putExtra("subtitleLabel", args.subtitleLabel).putExtra("subtitleId", args.subtitleId))
        invoke.resolve(JSObject().put("status", "opening"))
    }

    @Command
    fun playerState(invoke: Invoke) { invoke.resolve(PlayerActivity.snapshot) }
    @Command
    fun savedPlayerProgress(invoke: Invoke) {
        invoke.resolve(JSObject(activity.getSharedPreferences("genzo-player", 0).getString("lastProgress", "{}")!!))
    }
    @Command
    fun playerControl(invoke: Invoke) {
        val args = invoke.parseArgs(ControlArgs::class.java)
        activity.runOnUiThread {
            try {
                val current = PlayerActivity.current?.get()
                if (args.sessionId != null && current == null) { invoke.reject("expired_player_session"); return@runOnUiThread }
                invoke.resolve(current?.control(args) ?: JSObject().put("status", "closed"))
            } catch (_: Exception) { invoke.reject("invalid_player_control") }
        }
    }

    @Command
    fun pickSubtitle(invoke: Invoke) {
        val args = invoke.parseArgs(SessionArgs::class.java)
        activity.runOnUiThread {
            val current = PlayerActivity.current?.get()
            if (current == null) invoke.reject("expired_player_session")
            else current.pickSubtitle(invoke, args.sessionId)
        }
    }
}
