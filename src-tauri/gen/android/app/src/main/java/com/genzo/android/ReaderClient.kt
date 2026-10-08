package com.genzo.android

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** Addresses come exclusively from the Rust session, never from book text. */
class ReaderClient(val base: String) {
    suspend fun cachedImage(archive: File, name: String, directory: File): File = withContext(Dispatchers.IO) {
        require(!name.contains('/') && !name.contains('\\'))
        directory.mkdirs()
        val file = File(directory,name)
        if (file.isFile && file.length() > 0) return@withContext file
        val pending = File(directory,"$name-${java.util.UUID.randomUUID()}.part")
        try {
            java.util.zip.ZipFile(archive).use { zip ->
                val entry = requireNotNull(zip.getEntry(name))
                require(entry.size in 1..20L*1024*1024) { "缓存图片超过大小限制" }
                zip.getInputStream(entry).use { input -> pending.outputStream().use { output ->
                    val buffer = ByteArray(32768); var total = 0
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val count = input.read(buffer); if (count < 0) break
                        total += count; check(total <= 20*1024*1024); output.write(buffer,0,count)
                    }
                } }
            }
            currentCoroutineContext().ensureActive(); check(pending.renameTo(file)); file
        } finally { pending.delete() }
    }
    private fun connection(path: String, body: JSONObject? = null): HttpURLConnection {
        val url = URL(if (path.startsWith(base)) path else base + path)
        require(url.protocol == "http" && url.host == "127.0.0.1" && url.toString().startsWith(base))
        return (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 10000; readTimeout = 90000; instanceFollowRedirects = false
            if (body != null) {
                requestMethod = "POST"; doOutput = true
                setRequestProperty("Content-Type", "application/json")
                outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
        }
    }
    suspend fun json(path: String, body: JSONObject? = null): JSONObject = withContext(Dispatchers.IO) {
        val connection = connection(path, body)
        try {
            val status = connection.responseCode
            val text = (if (status == 200) connection.inputStream else connection.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            val json = JSONObject(text)
            check(status == 200) { json.optString("error", "阅读会话已失效，请返回章节列表重新打开。") }
            json
        } finally { connection.disconnect() }
    }
    suspend fun array(path: String): JSONArray = withContext(Dispatchers.IO) {
        val connection = connection(path)
        try {
            check(connection.responseCode == 200) { "书签读取失败" }
            JSONArray(connection.inputStream.bufferedReader().use { it.readText() })
        } finally { connection.disconnect() }
    }
    suspend fun image(url: String, directory: File): File = withContext(Dispatchers.IO) {
        val name = MessageDigest.getInstance("SHA-256").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
        val file = File(directory, name)
        if (file.isFile && file.length() > 0) return@withContext file
        directory.mkdirs()
        val pending = File(directory, "$name-${java.util.UUID.randomUUID()}.part")
        val connection = connection(url)
        try {
            check(connection.responseCode == 200) { "图片暂时无法读取，请重试。" }
            connection.inputStream.use { input -> pending.outputStream().use { output ->
                val buffer = ByteArray(32768); var total = 0L
                while (true) {
                    currentCoroutineContext().ensureActive()
                    val count = input.read(buffer); if (count < 0) break
                    total += count; check(total <= 20 * 1024 * 1024) { "图片超过大小限制" }
                    output.write(buffer, 0, count)
                }
                check(total > 0) { "图片内容为空" }
            } }
            currentCoroutineContext().ensureActive(); check(pending.renameTo(file)) { "图片缓存保存失败" }
            file
        } finally { connection.disconnect(); pending.delete() }
    }
}
