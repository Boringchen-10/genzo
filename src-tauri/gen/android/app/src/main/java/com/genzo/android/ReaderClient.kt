package com.genzo.android

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** Addresses come exclusively from the Rust session, never from book text. */
class ReaderClient(val base: String) {
    private var lastTrim=0L
    companion object {
        private val networkLoads = ArrayDeque<Pair<Long,Long>>()
        @Synchronized fun imageStats(): JSONObject {
            val cutoff=System.currentTimeMillis()-600000
            while (networkLoads.firstOrNull()?.first?.let { it<cutoff }==true) networkLoads.removeFirst()
            return JSONObject().put("count",networkLoads.size).put("averageMs",if(networkLoads.isEmpty()) 0 else networkLoads.sumOf { it.second }/networkLoads.size)
        }
        @Synchronized private fun recordImage(milliseconds:Long) { networkLoads.addLast(System.currentTimeMillis() to milliseconds);while(networkLoads.size>2000)networkLoads.removeFirst() }
    }
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
    suspend fun image(url: String, directory: File, cacheKey: String? = null, timeoutSeconds: Int = 15): File = withContext(Dispatchers.IO) {
        val name = cacheKey ?: MessageDigest.getInstance("SHA-256").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
        require(name.matches(Regex("[a-f0-9]{64}")))
        val file = File(directory, name)
        if (file.isFile && file.length() in 1..20L*1024*1024 && System.currentTimeMillis()-file.lastModified()<7L*86400000) return@withContext file
        directory.mkdirs()
        val pending = File(directory, "$name-${java.util.UUID.randomUUID()}.part")
        val connection = connection(url+"?timeout=${timeoutSeconds.coerceIn(5,60)}").apply {
            connectTimeout=timeoutSeconds.coerceIn(5,60)*1000;readTimeout=connectTimeout+2000
        }
        suspendCancellableCoroutine<File> { continuation ->
        val started=android.os.SystemClock.elapsedRealtime()
        val worker=CoroutineScope(Dispatchers.IO).launch { try {
            check(connection.responseCode == 200) { "图片暂时无法读取，请重试。" }
            connection.inputStream.use { input -> pending.outputStream().use { output ->
                val buffer = ByteArray(32768); var total = 0L
                while (true) {
                    check(continuation.isActive) { "image_request_cancelled" }
                    val count = input.read(buffer); if (count < 0) break
                    total += count; check(total <= 20 * 1024 * 1024) { "图片超过大小限制" }
                    output.write(buffer, 0, count)
                }
                check(total > 0) { "图片内容为空" }
            } }
            if (continuation.isActive) {
                check(pending.renameTo(file)) { "图片缓存保存失败" }
                recordImage(android.os.SystemClock.elapsedRealtime()-started)
                continuation.resume(file)
            }
        } catch(error:Exception) { if(continuation.isActive)continuation.resumeWithException(error) }
          finally { connection.disconnect();pending.delete() } }
        continuation.invokeOnCancellation { connection.disconnect();worker.cancel() }
        }
    }
    suspend fun trimImages(directory:File,protected:Set<String>)=withContext(Dispatchers.IO) {
        synchronized(this@ReaderClient){val now=android.os.SystemClock.elapsedRealtime();if(now-lastTrim<60000)return@withContext;lastTrim=now}
        val files=directory.listFiles()?.filter { it.isFile&&it.name.matches(Regex("[a-f0-9]{64}")) }?.sortedBy { it.lastModified() } ?: return@withContext
        var total=files.sumOf { it.length() }
        for(file in files)if(file.name !in protected&&(total>256L*1024*1024||System.currentTimeMillis()-file.lastModified()>7L*86400000)) {
            val size=file.length();if(file.delete())total-=size
        }
    }
}
