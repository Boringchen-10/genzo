@file:OptIn(org.readium.r2.shared.ExperimentalReadiumApi::class, org.readium.r2.shared.InternalReadiumApi::class)

package com.genzo.android

import android.view.View
import android.widget.FrameLayout
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.readium.r2.navigator.epub.EpubNavigatorFactory
import org.readium.r2.navigator.epub.EpubNavigatorFragment
import org.readium.r2.navigator.epub.EpubPreferences
import org.readium.r2.navigator.input.InputListener
import org.readium.r2.navigator.input.TapEvent
import org.readium.r2.navigator.preferences.Color
import org.readium.r2.navigator.preferences.FontFamily
import org.readium.r2.navigator.preferences.Theme
import org.readium.r2.shared.publication.Link
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.publication.Manifest
import org.readium.r2.shared.publication.Publication
import org.readium.r2.shared.publication.services.PerResourcePositionsService
import org.readium.r2.shared.publication.services.locateProgression
import org.readium.r2.shared.publication.services.positionsServiceFactory
import org.readium.r2.shared.util.asset.AssetRetriever
import org.readium.r2.shared.util.getOrElse
import org.readium.r2.shared.util.http.DefaultHttpClient
import org.readium.r2.shared.util.http.HttpContainer
import org.readium.r2.shared.util.mediatype.MediaType
import org.readium.r2.shared.util.AbsoluteUrl
import org.readium.r2.streamer.PublicationOpener
import org.readium.r2.streamer.parser.DefaultPublicationParser
import java.io.File

class NovelReaderSurface(private val host: ReaderActivity, private val container: FrameLayout, private val data: JSONObject, private val initial: JSONObject?) : ReaderSurface {
    override val view: View get() = container
    override var rendered = false; private set
    private var publication: Publication? = null
    private var navigator: EpubNavigatorFragment? = null
    private var observer: Job? = null
    private var opening: Job? = null
    private var closed = false
    private var anchor: Locator? = null
    private var pageIndex = 0
    private var pageCount = 0

    init {
        opening = host.lifecycleScope.launch {
            try {
                val client = DefaultHttpClient()
                val archive = data.optString("archivePath").takeIf { it.isNotEmpty() && it != "null" }
                val book = if (archive != null) {
                    val file = File(archive)
                    require(file.canonicalPath.startsWith(File(host.applicationInfo.dataDir).canonicalPath + "/"))
                    val retriever = AssetRetriever(host.contentResolver, client)
                    val asset = retriever.retrieve(file).getOrElse { error("EPUB 缓存无法读取：${it.message}") }
                    PublicationOpener(DefaultPublicationParser(host, client, retriever, null), onCreatePublication = { container = readerDocumentContainer(container) })
                        .open(asset, allowUserInteraction = false).getOrElse { error("EPUB 无法打开：${it.message}") }
                } else {
                    val manifest = Manifest.fromJSON(JSONObject(data.getJSONObject("publication").toString())) ?: error("小说目录无效")
                    require(manifest.readingOrder.isNotEmpty()) { "小说正文为空" }
                    val resources = (manifest.readingOrder + manifest.resources).map { it.url() }.toSet()
                    Publication(manifest, readerDocumentContainer(HttpContainer(requireNotNull(AbsoluteUrl(data.getString("contentBase"))), resources, client)),
                        Publication.ServicesBuilder().apply { positionsServiceFactory = PerResourcePositionsService.createFactory(MediaType.XHTML) })
                }
                if (closed) { book.close(); return@launch }
                publication = book
                val previous = host.supportFragmentManager.findFragmentById(container.id)
                if (previous != null) host.supportFragmentManager.beginTransaction().remove(previous).commitNow()
                val factory = EpubNavigatorFactory(book).createFragmentFactory(
                    initialLocator = if (initial?.optBoolean("end") == true) book.locatorFromLink(book.readingOrder.last())?.copyWithLocations(progression = 1.0)
                        else initial?.let { Locator.fromJSON(it) }, initialPreferences = preferences(),
                    paginationListener = object : EpubNavigatorFragment.PaginationListener {
                        override fun onPageLoaded() { rendered = true; host.report("ready") }
                        override fun onPageChanged(pageIndex: Int, totalPages: Int, locator: Locator) {
                            this@NovelReaderSurface.pageIndex = pageIndex; pageCount = totalPages
                        }
                    }, listener = object : EpubNavigatorFragment.Listener {
                        override fun onExternalLinkActivated(url: AbsoluteUrl) {
                            if (url.scheme.value == "genzo-image") illustration(android.net.Uri.parse(url.toString()).path.orEmpty().removePrefix("/"))
                            else if (url.isHttp) runCatching { host.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url.toString()))) }
                        }
                        override fun onResourceLoadFailed(href: org.readium.r2.shared.util.Url, error: org.readium.r2.shared.util.data.ReadError) { host.notify("正文或插图读取失败，可重新打开本章重试。") }
                    })
                host.supportFragmentManager.fragmentFactory = factory
                val fragment = factory.instantiate(host.classLoader, EpubNavigatorFragment::class.java.name) as EpubNavigatorFragment
                navigator = fragment
                host.supportFragmentManager.beginTransaction().replace(container.id, fragment).commitNow()
                fragment.addInputListener(object : InputListener {
                    override fun onTap(event: TapEvent): Boolean {
                        val width = fragment.view?.width ?: return false
                        if (event.point.x in width * .3f..width * .7f) { host.toggleMenu(); return true }
                        move(event.point.x > width * .7f); return true
                    }
                })
                observer = host.lifecycleScope.launch {
                    fragment.currentLocator.collect { current ->
                        val locator = (fragment.firstVisibleElementLocator() ?: current).copyWithLocations(
                            progression = current.locations.progression, totalProgression = current.locations.totalProgression,
                            position = current.locations.position)
                        anchor = locator
                        val index = book.readingOrder.indexOfFirst { it.url() == locator.href }.coerceAtLeast(0)
                        val progression = locator.locations.totalProgression ?: (index + (locator.locations.progression ?: 0.0)) / book.readingOrder.size
                        host.locationChanged(index, book.readingOrder.size, progression)
                    }
                }
            } catch (error: Exception) {
                if (!closed) host.surfaceFailed(error.message ?: "小说阅读器初始化失败，请重试。")
            }
        }
    }
    private fun preferences(): EpubPreferences {
        val settings = host.settings
        val theme = when (settings.optString("theme", "dark")) { "dark" -> Theme.DARK; "paper" -> Theme.SEPIA; else -> Theme.LIGHT }
        return EpubPreferences(fontFamily = FontFamily(settings.optString("font", "sans-serif")),
            // Readium expects a factor (1.0 = 100%), while the UI uses logical pixels.
            fontSize = settings.optDouble("fontSize", 20.0) / 16.0, lineHeight = settings.optDouble("lineHeight",1.8),
            pageMargins = settings.optDouble("margins",1.0), paragraphSpacing = settings.optDouble("paragraphSpacing",.6),
            paragraphIndent = 2.0, scroll = settings.optBoolean("scroll",false), publisherStyles = false,
            theme = theme, backgroundColor = Color(host.readerBackground), textColor = Color(host.readerForeground))
    }
    override fun location(): JSONObject? = (anchor ?: navigator?.currentLocator?.value)?.toJSON()
    override fun move(forward: Boolean) {
        val fragment = navigator ?: return
        if (host.settings.optBoolean("scroll",false)) {
            host.lifecycleScope.launch {
                val moved = fragment.evaluateJavascript("(function(){const before=window.scrollY;window.scrollBy(0,window.innerHeight*0.8*${if (forward) 1 else -1});return window.scrollY!==before;})()")
                if (moved != "true") chapter(forward)
            }
            return
        }
        val book = publication ?: return
        val resource = book.readingOrder.indexOfFirst { it.url() == fragment.currentLocator.value.href }
        if (pageCount > 0 && (forward && pageIndex >= pageCount - 1 && resource == book.readingOrder.lastIndex
                || !forward && pageIndex == 0 && resource == 0)) {
            host.adjacent(forward,automatic = true); return
        }
        if (!(if (forward) fragment.goForward(true) else fragment.goBackward(true))) host.adjacent(forward, automatic = true)
    }
    override fun seek(fraction: Double) {
        host.lifecycleScope.launch { publication?.locateProgression(fraction)?.let { navigator?.go(it, true) } }
    }
    override fun settingsChanged() { navigator?.submitPreferences(preferences()) }
    fun chapter(forward: Boolean) {
        val book = publication ?: return
        val current = navigator?.currentLocator?.value?.href ?: return
        val index = book.readingOrder.indexOfFirst { it.url() == current }
        val target = index + if (forward) 1 else -1
        if (target in book.readingOrder.indices) navigator?.go(book.readingOrder[target],true)
        else host.adjacent(forward)
    }
    fun contents() {
        val book = publication ?: return
        val links = mutableListOf<Link>()
        fun append(items: List<Link>) { for (link in items) { links.add(link); append(link.children) } }
        append(book.tableOfContents.ifEmpty { book.readingOrder })
        host.choice("小说目录", links.map { it.title ?: "正文" }) { index -> navigator?.go(links[index], true) }
    }
    private fun illustration(href: String) {
        val book = publication ?: return
        val url = org.readium.r2.shared.util.Url(href) ?: return
        if (book.resources.none { it.url() == url }) { host.notify("插图不属于当前卷册"); return }
        host.lifecycleScope.launch {
            try {
                val file = withContext(Dispatchers.IO) {
                    val bytes = book.container[url]?.read()?.getOrElse { error("插图读取失败") } ?: error("插图不存在")
                    require(bytes.size <= 20 * 1024 * 1024) { "插图超过大小限制" }
                    File(host.cacheDir,"reader-illustration-${System.nanoTime()}.image").apply { writeBytes(bytes) }
                }
                if (closed) { file.delete(); return@launch }
                showReaderImage(host,file) { file.delete() }
            } catch (error: Exception) { if (!closed) host.notify(error.message ?: "插图读取失败，请重试。") }
        }
    }
    override fun close() {
        closed = true; observer?.cancel(); opening?.cancel()
        navigator?.let { if (!host.supportFragmentManager.isStateSaved) host.supportFragmentManager.beginTransaction().remove(it).commitNow() }
        navigator = null; publication?.close(); publication = null
    }
}
