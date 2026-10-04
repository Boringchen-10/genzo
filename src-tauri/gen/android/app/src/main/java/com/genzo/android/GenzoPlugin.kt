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
class TreeArgs { var uri: String? = null }
@InvokeArg
class PlayerArgs {
    lateinit var uri: String
    var restart: Boolean = false
    var mediaFileId: String? = null
    var sessionId: String? = null
    var resumeMs: Long? = null
}
@InvokeArg
class CredentialArgs { lateinit var id: String; var username: String = ""; var password: String = "" }
@InvokeArg
class ControlArgs { lateinit var action: String; var value: Double = 0.0; var uri: String? = null }
@InvokeArg
class AppearanceArgs { var dark: Boolean = true }

@TauriPlugin
class GenzoPlugin(private val activity: Activity) : Plugin(activity) {
    private val preferences = activity.getSharedPreferences("genzo-prototype", 0)
    private val worker = Executors.newSingleThreadExecutor()
    private val timeouts = Executors.newSingleThreadScheduledExecutor()
    private val credentials = CredentialStore(activity)

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
            .putExtra("sessionId", args.sessionId).putExtra("resumeMs", args.resumeMs ?: -1L))
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
        try { invoke.resolve(PlayerActivity.current?.get()?.control(args) ?: JSObject().put("status", "closed")) }
        catch (_: Exception) { invoke.reject("invalid_player_control") }
    }
}
