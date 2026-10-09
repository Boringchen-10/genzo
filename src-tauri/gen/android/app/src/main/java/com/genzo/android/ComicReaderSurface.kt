package com.genzo.android

import android.os.SystemClock
import android.graphics.BitmapFactory
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2
import com.davemorrissey.labs.subscaleview.ImageSource
import com.davemorrissey.labs.subscaleview.SubsamplingScaleImageView
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.withPermit
import org.json.JSONObject
import org.json.JSONArray
import java.io.File

/**
 * Bounded page loading; large static images are decoded in tiles by SSIV.
 *
 * Scroll modes are continuous across chapters: the adapter flattens every loaded chapter into one
 * page list with an inline "between chapter" bar (目录 / 本话评论) inserted after each chapter, and
 * the next chapter is appended as the reader approaches the end. Paging modes keep the single-chapter
 * pager plus the floating end-of-chapter bar.
 */
class ComicReaderSurface(private val host: ReaderActivity, data: JSONObject, initial: JSONObject?) : ReaderSurface {
    override val view = ComicViewport(host,::tap,::doubleTap,::hold,::releaseHold,{ value -> touching=value;autoPausedUntil=SystemClock.uptimeMillis()+2000 },{host.report("ready")})
    private val ready = mutableSetOf<Int>()
    override val rendered: Boolean get() = page in ready
    private val urls = data.getJSONArray("pages").let { array -> (0 until array.length()).map { array.getString(it) } }
    private val cacheKeys=data.optJSONArray("cacheKeys")
    private val archive = data.optString("archivePath").takeIf { it.isNotEmpty() && it != "null" }?.let { File(it).canonicalFile }.also { path ->
        if (path != null) require(path.path.startsWith(File(host.applicationInfo.dataDir,"reading-cache").canonicalPath + "/"))
    }
    private val archiveEntries = data.optJSONArray("archiveEntries")
    private val initialTitle = data.optString("title", host.entry)
    private val initialOffline = data.optBoolean("offline")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val downloads = host.imageDownloads
    private val files = File(host.cacheDir, "reader-images/${host.intent.getStringExtra("sessionId")}/${host.entry}")
    private val requests = mutableMapOf<Int, Deferred<File>>()
    private val fetching = mutableSetOf<Int>()
    private val prefetching = mutableSetOf<Int>()
    private var preloadTargets = emptyList<Int>()
    private var preloadKey = ""
    private var readingDirection = if(initial?.optBoolean("end")==true)-1 else 1
    private val naturalSizes=mutableMapOf<Int,Pair<Int,Int>>()
    private val networkFiles=File(host.cacheDir,"reader-network-images")
    private var globalHold:FloatArray?=null
    private var pager: ViewPager2? = null
    private var list: RecyclerView? = null
    private var scrollAdapter: RecyclerView.Adapter<RecyclerView.ViewHolder>? = null
    private var manager: LinearLayoutManager? = null
    private var mode = ""
    private var layoutKey = ""
    private var page = if (initial?.optBoolean("end") == true) urls.lastIndex else initial?.optInt("pageIndex", 0)?.coerceIn(0, urls.lastIndex) ?: 0
    private var offset = if (initial?.optBoolean("end") == true) 1.0 else initial?.optDouble("offset",0.0)?.coerceIn(0.0,1.0) ?: 0.0
    private var autoPausedUntil = 0L
    private var lastAutoPage = 0L
    private var restoring = false
    private var moving = false
    private var touching = false
    private var overlayVisible = false
    private var endBar: LinearLayout? = null
    private var endCount: TextView? = null
    private var endBarShown = false

    /** One chapter inside the continuous scroll surface. */
    private class Chapter(val id:String,val title:String,val offline:Boolean,val urls:List<String>,val cacheKeys:JSONArray?,val archive:File?,val archiveEntries:JSONArray?)
    private val chapters=mutableListOf<Chapter>()
    private var rowKind=IntArray(0)          // 1 = page, 2 = between-chapter bar
    private var rowValue=IntArray(0)         // pages: ordinal, bars: chapter index
    private var itemOrdinal=IntArray(0)      // item position -> page ordinal (-1 for bars)
    private var ordinalItem=IntArray(0)      // page ordinal -> item position
    private var ordinalChapter=IntArray(0)   // page ordinal -> chapter index
    private var ordinalLocal=IntArray(0)     // page ordinal -> page index inside its chapter
    private var ordinalStart=IntArray(1)     // chapter index -> first page ordinal
    private var loadingNext=false
    private var nextError:String?=null
    private var endOfSeries=false

    override fun zoomRatio(): Float {
        if(mode.startsWith("scroll"))return view.ratio
        val recycler = list ?: pager?.getChildAt(0) as? RecyclerView
        return (recycler?.findViewHolderForAdapterPosition(itemOf(page)) as? PageHolder)?.zoomRatio() ?: 1f
    }
    override fun imageGeometry(): JSONObject? {
        val recycler = list ?: pager?.getChildAt(0) as? RecyclerView
        return (recycler?.findViewHolderForAdapterPosition(itemOf(page)) as? PageHolder)?.geometry()
    }
    fun visiblePages():JSONArray {
        val result=JSONArray();val recycler=list?:pager?.getChildAt(0) as? RecyclerView?:return result
        for(index in 0 until recycler.childCount){val child=recycler.getChildAt(index);val holder=recycler.getChildViewHolder(child) as? PageHolder?:continue
            val position=holder.bindingAdapterPosition
            val ordinal=if(list!=null)itemOrdinal.getOrElse(position){-1} else position
            if(ordinal<0)continue
            if(child.right<=0||child.left>=recycler.width||child.bottom<=0||child.top>=recycler.height)continue
            result.put(JSONObject().put("index",ordinal).put("rendered",holder.fullyDrawn()).put("loading",holder.loading()).put("width",child.width).put("visualWidth",child.width*if(list!=null)view.ratio else holder.zoomRatio()).put("localZoom",holder.zoomRatio()))
        };return result
    }
    fun zoomDiagnostics()=view.diagnostics()
    private fun itemOf(ordinal:Int)=if(rowKind.isEmpty())ordinal else ordinalItem.getOrElse(ordinal){ordinal}
    private fun totalPages()=if(rowKind.isEmpty())urls.size else ordinalItem.size
    private fun chapterPageCount(chapter:Int)=chapters[chapter].urls.size
    private fun pageChapter(ordinal:Int)=if(rowKind.isEmpty())0 else ordinalChapter.getOrElse(ordinal){0}
    private fun pageLocal(ordinal:Int)=if(rowKind.isEmpty())ordinal else ordinalLocal.getOrElse(ordinal){ordinal}
    private fun pageUrl(ordinal:Int)=chapters[pageChapter(ordinal)].urls[pageLocal(ordinal)]
    private fun pageCacheKey(ordinal:Int)=chapters[pageChapter(ordinal)].cacheKeys?.optString(pageLocal(ordinal))?.takeIf {it.isNotEmpty()}
    private fun pageArchive(ordinal:Int)=chapters[pageChapter(ordinal)].archive
    private fun pageArchiveEntry(ordinal:Int)=chapters[pageChapter(ordinal)].archiveEntries?.getString(pageLocal(ordinal))
    private fun holderAt(x:Float,y:Float):PageHolder? {
        val recycler=list?:pager?.getChildAt(0) as? RecyclerView?:return null
        val child=if(list!=null)recycler.findChildViewUnder((x-view.offsetX)/view.ratio,(y-view.offsetY)/view.ratio)else manager?.findViewByPosition(itemOf(page))
        return (child?.let {recycler.getChildViewHolder(it)}?:recycler.findViewHolderForAdapterPosition(itemOf(page))) as? PageHolder
    }
    /** True when the touch lands on an inline between-chapter bar, so the tap is not also a menu toggle. */
    private fun overSeparator(x:Float,y:Float):Boolean {
        val recycler=list?:return false
        val child=recycler.findChildViewUnder((x-view.offsetX)/view.ratio,(y-view.offsetY)/view.ratio)?:return false
        return itemOrdinal.getOrElse(recycler.getChildAdapterPosition(child)){-1}<0
    }
    private fun tap(x:Float,y:Float){
        if(insideEndBar(x,y)||overSeparator(x,y))return
        val axis=if(mode=="page-vertical")y else x;val size=if(mode=="page-vertical")view.height else view.width
        val rtl=mode=="page-horizontal"&&host.settings.optBoolean("rtl",false)
        if(mode.startsWith("page")&&axis<size*.3f)move(rtl)else if(mode.startsWith("page")&&axis>size*.7f)move(!rtl)else host.toggleMenu()
    }
    private fun doubleTap(x:Float,y:Float){if(insideEndBar(x,y)||overSeparator(x,y))return;holderAt(x,y)?.sourceFile?.let {source->overlayVisible=true;showReaderImage(host,source){overlayVisible=false;autoPausedUntil=SystemClock.uptimeMillis()+2000}}}
    private fun hold(x:Float,y:Float){
        if(insideEndBar(x,y)||overSeparator(x,y))return
        if(!host.settings.optBoolean("longPressZoom",true))return
        if(list!=null){if(view.ratio>1.01f)return;globalHold=floatArrayOf(view.ratio,view.offsetX,view.offsetY);view.zoomAt(2.5f,x,y)}else holderAt(x,y)?.holdAt(x,y)
    }
    private fun releaseHold(){globalHold?.let {view.restore(it[0],it[1],it[2])};globalHold=null
        val recycler=list?:pager?.getChildAt(0) as? RecyclerView?:return
        for(index in 0 until recycler.childCount)(recycler.getChildViewHolder(recycler.getChildAt(index)) as? PageHolder)?.releaseHold()
    }
    private fun currentLayoutKey() = "${host.settings.optString("mode","scroll-vertical")}:${host.settings.optBoolean("rtl",false)}:${host.settings.optDouble("gap",0.0)}:${host.resources.configuration.orientation}"

    init { require(urls.isNotEmpty()); build() }
    private fun file(index: Int): Deferred<File> = requests.getOrPut(index) {
        scope.async(start=CoroutineStart.LAZY) { try {
            val prepared=host.preparedComicImage(pageCacheKey(index))
            val source=prepared?.await()?:downloads.withPermit {
            fetching.add(index)
            try {
            val archive=pageArchive(index)
            if (archive != null) host.client.cachedImage(archive,requireNotNull(pageArchiveEntry(index)),files)
            else {
                val result=host.client.image(pageUrl(index),networkFiles,pageCacheKey(index),host.settings.optDouble("imageTimeout",15.0).toInt())
                val window=if(readingDirection>0)maxOf(0,page-2)..minOf(totalPages()-1,page+6) else maxOf(0,page-6)..minOf(totalPages()-1,page+2)
                val protected=(window.toSet()+attachedPages()+fetching).mapNotNull {pageCacheKey(it)}.toSet()
                scope.launch {host.client.trimImages(networkFiles,protected)}
                result
            }
            } finally { fetching.remove(index) }
            }
            if(index !in naturalSizes) {
                val dimensions=withContext(Dispatchers.IO) {
                    val bounds=BitmapFactory.Options().apply {inJustDecodeBounds=true}
                    BitmapFactory.decodeFile(source.path,bounds)
                    if(bounds.outWidth>0&&bounds.outHeight>0)bounds.outWidth to bounds.outHeight else null
                }
                dimensions?.let {naturalSizes[index]=it;while(naturalSizes.size>120)naturalSizes.remove(naturalSizes.keys.first())}
            }
            source
        } finally { if(prefetching.remove(index))host.imagePrefetchSlots.release();pumpPreload() } }
    }.also {it.start()}
    private fun attachedPages():Set<Int> {
        val recycler=list?:pager?.getChildAt(0) as? RecyclerView?:return emptySet()
        return (0 until recycler.childCount).mapNotNull { index ->
            val position=recycler.getChildAdapterPosition(recycler.getChildAt(index))
            if(list!=null)itemOrdinal.getOrElse(position){-1}.takeIf {it>=0} else position
        }.toSet()
    }
    private fun pumpPreload() {
        if(!scope.isActive||restoring)return
        for(index in preloadTargets) {
            if(prefetching.size>=2||downloads.availablePermits==0)return
            if(index in requests)continue
            if(!host.imagePrefetchSlots.tryAcquire())return
            prefetching.add(index);file(index)
        }
    }
    private fun active(index: Int) {
        if (!scope.isActive || index !in 0 until totalPages() || restoring) return
        if(index!=page)readingDirection=if(index>page)1 else -1
        page = index; offset = if (pager != null) 0.0 else offset
        val chapter=pageChapter(index);val local=pageLocal(index);val count=chapterPageCount(chapter)
        host.locationChanged(local, count, if (count == 1) offset else (local + offset) / (count - 1))
        host.activeChapter(chapters[chapter].id, chapters[chapter].title, chapters[chapter].offline)
        if(readingDirection>0&&local>=count-maxOf(6,(count*.2).toInt()))host.prepareNextComicChapter()
        file(index)
        refreshEndBar()
        if(rowKind.isNotEmpty()&&readingDirection>0&&index>=totalPages()-3)loadNextChapter()
        val firstItem=manager?.findFirstVisibleItemPosition()?.takeIf {it>=0}
        val lastItem=manager?.findLastVisibleItemPosition()?.takeIf {it>=0}
        val first=if(rowKind.isEmpty())index else firstItem?.let {itemOrdinal.getOrElse(it){-1}}?.takeIf {it>=0}?:index
        val last=if(rowKind.isEmpty())index else lastItem?.let {itemOrdinal.getOrElse(it){-1}}?.takeIf {it>=0}?:index
        val edge=if(readingDirection>0)maxOf(index,last)else minOf(index,first)
        val key="$index:$edge:$readingDirection"
        if(preloadKey==key)return
        preloadKey=key
        val nearby=(1..6).map {edge+it*readingDirection}+(1..2).map {index-it*readingDirection}
        // Full current chapter on disk; near pages first, without decoding every image.
        val rest=if(pageArchive(index)!=null)emptyList()else if(readingDirection>0)(edge+1..totalPages()-1).toList()+(0 until index).reversed() else (0 until edge).reversed()+(index+1..totalPages()-1).toList()
        preloadTargets=(nearby+rest).filter {it in 0 until totalPages()}.distinct()
        val attached=attachedPages()
        val keep=preloadTargets.toSet()+attached+index
        for (old in requests.keys.filter { it !in keep && it !in fetching }) {
            val request = requests.remove(old) ?: continue
            // Keep downloads already in flight and their disk files, as Kira's cache manager does.
            // Only obsolete queued work is cancelled so it cannot block newly visible pages.
            if(!request.isCompleted)request.cancel()
        }
        pumpPreload()
    }
    /** Appends the next catalogue chapter into the same scroll list (continuous reading). */
    private fun loadNextChapter() {
        if(mode.startsWith("page")||loadingNext||endOfSeries)return
        val last=chapters.lastOrNull()?:return
        loadingNext=true;nextError=null
        val wasCount=rowKind.size
        notifyTrailer()
        scope.launch {
            try {
                val id=host.nextChapterId(last.id)
                if(id==null){ endOfSeries=true; return@launch }
                val chapter=chapterFrom(host.comicChapter(id), id)
                if(chapter.urls.isEmpty()){ endOfSeries=true; return@launch }
                chapters.add(chapter)
                rebuildRows()
                scrollAdapter?.notifyItemRangeInserted(wasCount,rowKind.size-wasCount)
                // The bar that used to be the trailer is now an interior divider; drop its status line.
                if(wasCount-1>=0&&rowKind.getOrElse(wasCount-1){0}==2)scrollAdapter?.notifyItemChanged(wasCount-1)
            } catch(error:CancellationException){ throw error }
            catch(error:Exception){ nextError=error.message?:"加载失败" }
            finally { loadingNext=false; notifyTrailer() }
        }
    }
    private fun notifyTrailer() {
        val last=rowKind.size-1
        if(last>=0&&rowKind[last]==2)scrollAdapter?.notifyItemChanged(last)
    }
    private fun chapterFrom(data:JSONObject, fallbackId:String):Chapter {
        val pages=data.getJSONArray("pages")
        val list=(0 until pages.length()).map { pages.getString(it) }
        val path=data.optString("archivePath").takeIf { it.isNotEmpty() && it != "null" }?.let { File(it).canonicalFile }
        if(path!=null)require(path.path.startsWith(File(host.applicationInfo.dataDir,"reading-cache").canonicalPath + "/"))
        return Chapter(data.optString("id", fallbackId), data.optString("title", fallbackId), data.optBoolean("offline"), list, data.optJSONArray("cacheKeys"), path, data.optJSONArray("archiveEntries"))
    }
    private fun rebuildRows() {
        val kinds=ArrayList<Int>();val values=ArrayList<Int>()
        val ordinalItemList=ArrayList<Int>();val ordinalChapterList=ArrayList<Int>();val ordinalLocalList=ArrayList<Int>()
        val starts=IntArray(chapters.size+1);var ordinal=0
        chapters.forEachIndexed { chapter, value ->
            starts[chapter]=ordinal
            value.urls.indices.forEach { local ->
                kinds.add(1);values.add(ordinal);ordinalItemList.add(kinds.size-1);ordinalChapterList.add(chapter);ordinalLocalList.add(local);ordinal++
            }
            kinds.add(2);values.add(chapter)
        }
        starts[chapters.size]=ordinal
        rowKind=kinds.toIntArray();rowValue=values.toIntArray()
        itemOrdinal=IntArray(kinds.size){if(kinds[it]==1)values[it] else -1}
        ordinalItem=ordinalItemList.toIntArray();ordinalChapter=ordinalChapterList.toIntArray();ordinalLocal=ordinalLocalList.toIntArray()
        ordinalStart=starts
    }
    @OptIn(ExperimentalCoroutinesApi::class)
    private fun build() {
        restoring = true;preloadKey="";preloadTargets=emptyList();pager?.adapter = null;list?.adapter = null;view.reset();view.scroll=null;pager=null;list=null;manager=null;scrollAdapter=null;view.removeAllViews()
        mode = host.settings.optString("mode","scroll-vertical")
        layoutKey = currentLayoutKey()
        view.setBackgroundColor(host.readerBackground)
        val vertical = mode.endsWith("vertical")
        chapters.clear()
        chapters.add(Chapter(host.entry,initialTitle,initialOffline,urls,cacheKeys,archive,archiveEntries))
        loadingNext=false;nextError=null;endOfSeries=false
        if (mode.startsWith("page")) {
            pager = ViewPager2(host).apply {
                orientation = if (vertical) ViewPager2.ORIENTATION_VERTICAL else ViewPager2.ORIENTATION_HORIZONTAL
                layoutDirection = if (!vertical && host.settings.optBoolean("rtl",false)) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
                offscreenPageLimit = 1
                adapter = object : RecyclerView.Adapter<PageHolder>() {
                    override fun getItemCount() = urls.size + 1
                    override fun onCreateViewHolder(parent: ViewGroup, type: Int): PageHolder = PageHolder(FrameLayout(host).apply {
                        layoutParams = ViewGroup.LayoutParams(-1,-1)
                    })
                    override fun onBindViewHolder(holder: PageHolder, index: Int) { holder.bind(index) }
                    override fun onViewAttachedToWindow(holder: PageHolder) { holder.resumeLoading() }
                    override fun onViewRecycled(holder: PageHolder) { holder.release() }
                }
                registerOnPageChangeCallback(object : ViewPager2.OnPageChangeCallback() {
                    override fun onPageSelected(index: Int) {
                        if (restoring) return
                        if (index == urls.size) { host.adjacent(true, automatic = true); return }
                        active(index)
                    }
                })
            }
            view.addView(pager, FrameLayout.LayoutParams(-1,-1)); pager!!.setCurrentItem(page,false)
        } else {
            rebuildRows()
            val adapter = object : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
                override fun getItemCount() = rowKind.size
                override fun getItemViewType(position: Int) = rowKind[position]
                override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder =
                    if (viewType == 1) PageHolder(FrameLayout(host).apply {
                        layoutParams = ViewGroup.LayoutParams(if (vertical) -1 else host.resources.displayMetrics.widthPixels, if (vertical) host.dp(480) else -1)
                    }) else EndHolder(FrameLayout(host).apply {
                        layoutParams = ViewGroup.LayoutParams(if (vertical) -1 else host.dp(240), if (vertical) -2 else -1)
                    })
                override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
                    if (rowKind[position] == 1) (holder as PageHolder).bind(rowValue[position])
                    else (holder as EndHolder).bind(rowValue[position], position == rowKind.size - 1)
                }
                override fun onViewAttachedToWindow(holder: RecyclerView.ViewHolder) { if (holder is PageHolder) holder.resumeLoading() }
                override fun onViewRecycled(holder: RecyclerView.ViewHolder) { if (holder is PageHolder) holder.release() }
            }
            scrollAdapter = adapter
            manager = object:LinearLayoutManager(host, if (vertical) RecyclerView.VERTICAL else RecyclerView.HORIZONTAL, false) {
                override fun calculateExtraLayoutSpace(state:RecyclerView.State,extraLayoutSpace:IntArray) {
                    val extent=if(vertical)view.height else view.width
                    extraLayoutSpace[0]=if(readingDirection<0)extent else 0
                    extraLayoutSpace[1]=if(readingDirection>0)extent else 0
                }
            }
            list = RecyclerView(host).apply {
                layoutManager = manager; itemAnimator = null; this.adapter = adapter
                layoutDirection = if (!vertical && host.settings.optBoolean("rtl",false)) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
                setItemViewCacheSize(1)
                addOnScrollListener(object : RecyclerView.OnScrollListener() {
                    override fun onScrolled(recycler: RecyclerView, dx: Int, dy: Int) {
                        if (restoring) return
                        val position = manager!!.findFirstVisibleItemPosition(); if (position < 0) return
                        val child = manager!!.findViewByPosition(position) ?: return
                        val size = if (vertical) child.height else child.width
                        val start = if (vertical) child.top else if (host.settings.optBoolean("rtl",false)) recycler.width - child.right else child.left
                        offset = if (size > 0) (-start.toDouble() / size).coerceIn(0.0,1.0) else 0.0
                        moving = if (vertical) dy > 0 else if (host.settings.optBoolean("rtl",false)) dx < 0 else dx > 0
                        if(dx!=0||dy!=0)readingDirection=if(moving)1 else -1
                        val ordinal=itemOrdinal.getOrElse(position){-1}
                        if(ordinal>=0)active(ordinal)
                    }
                    override fun onScrollStateChanged(recycler: RecyclerView, state: Int) {
                        if (state == RecyclerView.SCROLL_STATE_IDLE) moving = false
                    }
                })
            }
            view.scroll=list;view.vertical=vertical
            view.addView(list, FrameLayout.LayoutParams(-1,-1)); manager!!.scrollToPositionWithOffset(itemOf(page),0)
        }
        buildEndBar()
        view.post { restoring = false; active(page) }
    }
    /** Inline divider + 目录 / 本话评论 pills drawn between two chapters in scroll mode. */
    private inner class EndHolder(val frame: FrameLayout) : RecyclerView.ViewHolder(frame) {
        fun bind(chapter: Int, trailer: Boolean) {
            frame.removeAllViews()
            frame.setPadding(host.dp(16), host.dp(22), host.dp(16), host.dp(22))
            frame.background = null
            val column = LinearLayout(host).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
            column.addView(View(host).apply { setBackgroundColor(host.dividerColor) }, LinearLayout.LayoutParams(-1, host.dp(1)).apply { bottomMargin = host.dp(18) })
            val row = LinearLayout(host).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
            row.addView(endPill(R.drawable.ic_genzo_list, "目录") { host.catalogue() })
            row.addView(endPill(R.drawable.ic_genzo_comment, "本话评论") { host.chapterComments() }, LinearLayout.LayoutParams(-2,-2).apply { marginStart = host.dp(12) })
            column.addView(row)
            if (trailer) {
                val status = TextView(host).apply { textSize = 12f; gravity = Gravity.CENTER; setTextColor(host.readerForeground); alpha = 0.72f; setPadding(0, host.dp(14), 0, 0) }
                when {
                    loadingNext -> status.text = "正在加载下一话…"
                    nextError != null -> { status.text = "下一话加载失败，点击重试"; status.isClickable = true; status.setOnClickListener { nextError = null; loadNextChapter() } }
                    endOfSeries -> status.text = "已经是最后一话"
                    else -> status.text = ""
                }
                column.addView(status, LinearLayout.LayoutParams(-1,-2))
            }
            frame.addView(column, FrameLayout.LayoutParams(-1,-2,Gravity.CENTER))
        }
    }
    private inner class PageHolder(val frame: FrameLayout) : RecyclerView.ViewHolder(frame) {
        private var task: Job? = null
        private var image: SubsamplingScaleImageView? = null
        private var bound = -1
        private var holdScale: Float? = null
        private var holdCenter: android.graphics.PointF? = null
        var sourceFile:File?=null;private set
        private var retries=0
        private var version=0
        private var previewReady=false
        fun fullyDrawn():Boolean=image?.let {it.isImageLoaded||previewReady&&it.isReady}==true
        private fun sizeFor(dimensions:Pair<Int,Int>,gap:Int) {
            val params=frame.layoutParams
            if(mode=="scroll-vertical") {
                val height=(maxOf(frame.width,view.width).toDouble()*dimensions.second/dimensions.first).toInt().coerceAtLeast(1)+gap
                if(params.height!=height){params.height=height;frame.layoutParams=params}
            }else if(mode=="scroll-horizontal") {
                val width=(view.height.toDouble()*dimensions.first/dimensions.second).toInt().coerceAtLeast(1)+gap
                if(params.width!=width){params.width=width;frame.layoutParams=params}
            }
        }
        fun loading():Boolean=task?.isActive==true
        fun resumeLoading() { if(bound in 0 until totalPages()&&image==null&&task?.isCancelled==true)bind(bound) }
        fun zoomRatio(): Float = image?.let { if (it.isReady && it.minScale > 0) it.scale / it.minScale else 1f } ?: 1f
        fun geometry(): JSONObject? {
            val picture = image?.takeIf { it.isReady } ?: return null
            val first = picture.sourceToViewCoord(0f,0f) ?: return null
            val last = picture.sourceToViewCoord(picture.sWidth.toFloat(),picture.sHeight.toFloat()) ?: return null
            return JSONObject().put("left",first.x).put("top",first.y).put("right",last.x).put("bottom",last.y).put("width",picture.width).put("height",picture.height).put("source",if (pageArchive(bound) != null) "local-cbz" else "online")
        }
        fun holdAt(x:Float,y:Float){val picture=image?.takeIf {it.isReady&&it.scale<=it.minScale*1.01f}?:return;val rootLocation=IntArray(2);val location=IntArray(2);view.getLocationOnScreen(rootLocation);picture.getLocationOnScreen(location)
            val point=picture.viewToSourceCoord(x+rootLocation[0]-location[0],y+rootLocation[1]-location[1])?:return
            holdScale=picture.scale;holdCenter=picture.center?.let {android.graphics.PointF(it.x,it.y)};picture.setScaleAndCenter(picture.minScale*2.5f,point);frame.parent?.requestDisallowInterceptTouchEvent(true)
        }
        fun releaseHold(){holdScale?.let {scale->holdCenter?.let {image?.setScaleAndCenter(scale,it)}};holdScale=null;holdCenter=null}
        fun release() {version++;task?.cancel();if(bound>=0)ready.remove(bound);image?.recycle();image=null;previewReady=false;sourceFile=null;frame.removeAllViews();holdScale=null;holdCenter=null;bound=-1}
        fun bind(index: Int) {
            if(bound!=index)retries=0
            release(); bound = index
            if(index>=totalPages())return
            val gap = host.dp(host.settings.optDouble("gap",0.0).toInt())
            frame.setPadding(0,0,if (mode == "scroll-horizontal") gap else 0,if (mode == "scroll-vertical") gap else 0)
            if(mode.startsWith("scroll"))frame.layoutParams=frame.layoutParams.apply {
                val dimensions=naturalSizes[index];val ratio=dimensions?.let {it.second.toDouble()/it.first}?:naturalSizes.values.map {it.second.toDouble()/it.first}.sorted().let {if(it.isEmpty())1.35 else it[it.size/2]}
                if(mode=="scroll-vertical")height=(maxOf(view.width,host.resources.displayMetrics.widthPixels)*ratio).toInt()+gap
                else width=(maxOf(view.height,host.resources.displayMetrics.heightPixels)/ratio).toInt()+gap
            }
            frame.addView(ProgressBar(host),FrameLayout.LayoutParams(host.dp(36),host.dp(36),Gravity.CENTER))
            task = scope.launch {
                try {
                    val source = file(index).await()
                    val dimensions=naturalSizes[index]
                    val preview=if(mode.startsWith("scroll")&&dimensions!=null)withContext(Dispatchers.IO) {
                        val options=BitmapFactory.Options().apply {inSampleSize=1}
                        while(dimensions.first/options.inSampleSize>768||dimensions.second/options.inSampleSize>1024)options.inSampleSize*=2
                        val bitmap=BitmapFactory.decodeFile(source.path,options)
                        try {currentCoroutineContext().ensureActive();bitmap} catch(error:CancellationException){bitmap?.recycle();throw error}
                    } else null
                    if (bound != index) {preview?.recycle();return@launch}
                    sourceFile=source
                    naturalSizes[index]?.let {sizeFor(it,gap)}
                    frame.removeAllViews()
                    val picture = SubsamplingScaleImageView(host)
                    image = picture
                    picture.setMinimumScaleType(SubsamplingScaleImageView.SCALE_TYPE_CENTER_INSIDE)
                    picture.setMaxScale(8f)
                    picture.setDoubleTapZoomScale(2.5f)
                    picture.setZoomEnabled(mode.startsWith("page"));picture.setPanEnabled(mode.startsWith("page"))
                    picture.addOnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
                        if (picture.isReady && (right-left != oldRight-oldLeft || bottom-top != oldBottom-oldTop) && holdScale == null) picture.resetScaleAndCenter()
                    }
                    picture.setOnStateChangedListener(object : SubsamplingScaleImageView.OnStateChangedListener {
                        override fun onScaleChanged(scale: Float, origin: Int) {
                            if (index == page) host.report("ready")
                        }
                        override fun onCenterChanged(center: android.graphics.PointF?, origin: Int) {}
                    })
                    picture.setOnImageEventListener(object : SubsamplingScaleImageView.DefaultOnImageEventListener() {
                        override fun onImageLoaded() { if(bound==index&&image===picture){retries=0;ready.add(index);host.report("ready")} }
                        override fun onReady() {
                            if (bound != index || image !== picture) return
                            naturalSizes[index]=picture.sWidth to picture.sHeight
                            while(naturalSizes.size>120)naturalSizes.remove(naturalSizes.keys.first())
                            sizeFor(picture.sWidth to picture.sHeight,gap)
                            if (index == page && offset > 0 && list != null) frame.post {
                                val size = if (mode == "scroll-vertical") frame.height else frame.width
                                restoring = true; manager?.scrollToPositionWithOffset(itemOf(page),-(offset * size).toInt()); list?.post { restoring = false }
                            }
                        }
                        override fun onImageLoadError(error: Exception) { if(bound!=index||image!==picture)return;if(pageArchive(index)==null)sourceFile?.delete();sourceFile=null;showFailure(index) }
                    })
                    picture.setOnTouchListener { _,event ->
                        if(mode.startsWith("page")&&(event.pointerCount>1||picture.isReady&&picture.scale>picture.minScale*1.05f))frame.parent?.requestDisallowInterceptTouchEvent(true)
                        if(event.actionMasked==MotionEvent.ACTION_UP||event.actionMasked==MotionEvent.ACTION_CANCEL)frame.parent?.requestDisallowInterceptTouchEvent(false)
                        false
                    }
                    frame.addView(picture,FrameLayout.LayoutParams(-1,-1))
                    if(preview!=null&&dimensions!=null) {
                        previewReady=true
                        picture.setImage(ImageSource.uri(source.absolutePath).dimensions(dimensions.first,dimensions.second),ImageSource.bitmap(preview))
                    }else picture.setImage(ImageSource.uri(source.absolutePath))
                } catch (error: CancellationException) {
                    // A cached holder may be attached again without onBindViewHolder.
                    if(isActive&&bound==index&&frame.isAttachedToWindow) {
                        val expected=version
                        frame.post { if(bound==index&&version==expected&&scope.isActive)bind(index) }
                    }
                    throw error
                }
                catch (_: Exception) { if (bound == index) showFailure(index) }
            }
        }
        private fun showFailure(index: Int) {
            if (bound != index) return
            image?.recycle(); image = null;previewReady=false; frame.removeAllViews()
            val panel = LinearLayout(host).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
            panel.addView(TextView(host).apply { text = "第 ${index + 1} 页读取失败"; setTextColor(host.readerForeground) })
            panel.addView(host.button("重试") { retries=0;requests.remove(index)?.cancel();bind(index) })
            frame.addView(panel,FrameLayout.LayoutParams(-1,-1))
            if(pageArchive(index)==null&&retries<host.settings.optDouble("imageRetries",1.0).toInt().coerceIn(0,5)) {
                retries++;val expected=version;frame.postDelayed({if(bound==index&&version==expected&&scope.isActive){requests.remove(index)?.cancel();bind(index)}},200)
            }
        }
    }
    override fun location(): JSONObject = JSONObject().put("pageIndex",pageLocal(page)).put("offset",offset)
    override fun move(forward: Boolean) {
        if (pager != null) {
            val target = pager!!.currentItem + if (forward) 1 else -1
            if (target < 0) host.adjacent(false,automatic = true)
            else if (target >= urls.size) host.adjacent(true,automatic = true)
            else pager!!.setCurrentItem(target,true)
        } else {
            val amount = ((if (mode == "scroll-vertical") view.height else view.width) * .8).toInt() * if (forward) 1 else -1
            if (mode == "scroll-vertical") list?.smoothScrollBy(0,amount)
            else list?.smoothScrollBy(amount * if (host.settings.optBoolean("rtl",false)) -1 else 1,0)
        }
    }
    override fun seek(fraction: Double) {
        if (pager != null) {
            val target=(fraction * urls.lastIndex).toInt().coerceIn(0,urls.lastIndex)
            if(target!=page)readingDirection=if(target>page)1 else -1
            page = target; offset = 0.0
            pager!!.setCurrentItem(page,false); active(page)
        } else {
            val chapter=pageChapter(page);val count=chapterPageCount(chapter)
            val target=(fraction * (count-1).coerceAtLeast(1)).toInt().coerceIn(0,count-1)
            val ordinal=ordinalStart.getOrElse(chapter){0}+target
            if(ordinal!=page)readingDirection=if(ordinal>page)1 else -1
            page = ordinal; offset = 0.0
            manager?.scrollToPositionWithOffset(itemOf(ordinal),0); active(ordinal)
        }
    }
    override fun settingsChanged() {
        if (layoutKey != currentLayoutKey()) build()
        view.setBackgroundColor(host.readerBackground)
    }
    /** Called when the reader chrome (toolbar) toggles, so the end bar stays mutually exclusive. */
    fun onMenuChanged() { refreshEndBar() }
    /** Called from the activity's inset listener; re-anchors the bar above the system nav bar. */
    fun insetsChanged() {
        endBar?.setPadding(host.dp(16), host.dp(12), host.dp(16), host.dp(16) + host.navBottom)
        refreshEndBar()
    }
    private fun insideEndBar(x: Float, y: Float): Boolean {
        val bar = endBar ?: return false
        return bar.visibility == View.VISIBLE && x >= bar.left && x <= bar.right && y >= bar.top && y <= bar.bottom
    }
    private fun withAlpha(color: Int, factor: Float): Int {
        val base = color ushr 24 and 0xFF
        val alpha = ((if (base == 0) 255 else base) * factor).toInt().coerceIn(0, 255)
        return (color and 0x00FFFFFF) or (alpha shl 24)
    }
    private fun pillBackground() = GradientDrawable().apply {
        val dark = host.settings.optString("theme", "dark") == "dark"
        cornerRadius = host.dp(22).toFloat()
        setColor(if (dark) Color.argb(236, 44, 50, 52) else Color.argb(242, 255, 255, 255))
        setStroke(host.dp(1), if (dark) Color.argb(90, 255, 255, 255) else Color.argb(38, 0, 0, 0))
    }
    private fun endPill(icon: Int, label: String, action: () -> Unit): LinearLayout {
        val pill = LinearLayout(host).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER; background = pillBackground()
            isClickable = true; setPadding(host.dp(16), host.dp(10), host.dp(16), host.dp(10))
        }
        pill.addView(ImageView(host).apply {
            setImageResource(icon); scaleType = ImageView.ScaleType.CENTER_INSIDE
            imageTintList = ColorStateList.valueOf(host.readerForeground)
        }, LinearLayout.LayoutParams(host.dp(18), host.dp(18)).apply { marginEnd = host.dp(6) })
        pill.addView(TextView(host).apply { text = label; textSize = 14f; setTextColor(host.readerForeground) })
        pill.setOnClickListener { action() }
        return pill
    }
    private fun rowParams(start: Int) = LinearLayout.LayoutParams(-2, -2).apply { marginStart = host.dp(start) }
    /** Bottom overlay shown at the last page of a chapter in paging mode while the toolbar is hidden. */
    private fun buildEndBar() {
        endBarShown = false; endCount = null
        if(!mode.startsWith("page")){ endBar = null; return }
        val bar = LinearLayout(host).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; isClickable = false
            setPadding(host.dp(16), host.dp(12), host.dp(16), host.dp(16) + host.navBottom)
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(Color.TRANSPARENT, withAlpha(host.readerBackground, 0.94f)))
            visibility = View.GONE; alpha = 0f
        }
        val row = LinearLayout(host).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        row.addView(endPill(R.drawable.ic_genzo_list, "目录") { host.catalogue() }, rowParams(0))
        val count = LinearLayout(host).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER; background = pillBackground()
            setPadding(host.dp(16), host.dp(10), host.dp(16), host.dp(10))
        }
        count.addView(ImageView(host).apply {
            setImageResource(R.drawable.ic_genzo_book); scaleType = ImageView.ScaleType.CENTER_INSIDE
            imageTintList = ColorStateList.valueOf(host.readerForeground)
        }, LinearLayout.LayoutParams(host.dp(18), host.dp(18)).apply { marginEnd = host.dp(6) })
        endCount = TextView(host).apply { textSize = 14f; setTextColor(host.readerForeground) }
        count.addView(endCount as TextView)
        row.addView(count, rowParams(1))
        row.addView(endPill(R.drawable.ic_genzo_skip_next, "下一话") { host.chapter(true) }, rowParams(1))
        bar.addView(row)
        bar.addView(TextView(host).apply {
            text = "继续翻页进入下一话"; textSize = 12f; gravity = Gravity.CENTER
            setTextColor(host.readerForeground); alpha = 0.72f; setPadding(0, host.dp(12), 0, 0)
        })
        endBar = bar
        view.addView(bar, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
        refreshEndBar()
    }
    private fun surfaceAtEnd(): Boolean {
        if (urls.isEmpty()) return false
        return if (mode.startsWith("page")) page >= urls.size - 1
        else (manager?.findLastVisibleItemPosition() ?: page) >= rowKind.size - 1
    }
    private fun refreshEndBar() {
        val bar = endBar ?: return
        val shouldShow = !restoring && !host.menuVisible && surfaceAtEnd()
        if (shouldShow) endCount?.text = (page + 1).coerceIn(1, urls.size).toString()
        if (shouldShow == endBarShown) return
        endBarShown = shouldShow
        bar.animate().cancel()
        if (shouldShow) {
            bar.visibility = View.VISIBLE; bar.alpha = 0f
            bar.animate().alpha(1f).setDuration(180).start()
        } else bar.animate().alpha(0f).setDuration(140).withEndAction { if (!endBarShown) bar.visibility = View.GONE }.start()
    }
    fun autoScroll(speed: Double) {
        val now = SystemClock.uptimeMillis(); if (touching || overlayVisible || now < autoPausedUntil) return
        if (pager != null) { if (now - lastAutoPage > 3000) { lastAutoPage = now; move(true) } }
        else {
            val direction = if (mode == "scroll-horizontal" && host.settings.optBoolean("rtl",false)) -1 else 1
            val canMove = if (mode == "scroll-vertical") list?.canScrollVertically(1) else list?.canScrollHorizontally(direction)
            if (canMove == false) { loadNextChapter(); return }
            val amount = maxOf(1,(host.dp(speed.toInt()) * .05).toInt())
            if (mode == "scroll-vertical") list?.scrollBy(0,amount) else list?.scrollBy(amount * direction,0)
        }
    }
    override fun close() {
        scope.cancel(); pager?.adapter = null; list?.adapter = null
        files.listFiles()?.forEach { if (it.isFile) it.delete() }
    }
}
