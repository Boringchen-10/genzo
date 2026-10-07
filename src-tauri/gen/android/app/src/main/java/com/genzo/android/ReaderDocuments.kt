@file:OptIn(org.readium.r2.shared.InternalReadiumApi::class)

package com.genzo.android

import android.net.Uri
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.readium.r2.shared.util.Try
import org.readium.r2.shared.util.resource.TransformingContainer
import org.readium.r2.shared.util.resource.TransformingResource

/** Adapt legacy Genzo <pre> chapters in memory; never rewrite an EPUB file. */
fun readerDocumentContainer(container: org.readium.r2.shared.util.data.Container<org.readium.r2.shared.util.resource.Resource>) =
    TransformingContainer(container) { url, resource ->
        if (!url.toString().substringBefore('#').endsWith(".xhtml")) resource else TransformingResource(resource) { bytes ->
            if (bytes.size > 32 * 1024 * 1024) Try.success(bytes) else {
                val document = Jsoup.parse(bytes.toString(Charsets.UTF_8))
                document.outputSettings().syntax(Document.OutputSettings.Syntax.xml).prettyPrint(false)
                for (pre in document.select("pre")) {
                    val replacement = org.jsoup.nodes.Element("div")
                    pre.wholeText().lineSequence().forEachIndexed { index, line ->
                        replacement.appendElement("p").attr("id","p$index").text(line).apply {
                            if (line.startsWith('　')) attr("style","text-indent:0")
                        }
                    }
                    pre.replaceWith(replacement)
                }
                for (image in document.select("img[src]")) {
                    if (image.parent()?.tagName() == "a") continue
                    val target = org.readium.r2.shared.util.Url(image.attr("src"))?.let { url.resolve(it) } ?: continue
                    val anchor = org.jsoup.nodes.Element("a").attr("href","genzo-image://reader/${Uri.encode(target.toString())}")
                    image.replaceWith(anchor); anchor.appendChild(image)
                }
                document.head().appendElement("style").text("h1{font-size:1.3em!important;margin:.8em 0 1em!important}p:empty{min-height:.6em}")
                Try.success(document.outerHtml().toByteArray(Charsets.UTF_8))
            }
        }
    }
