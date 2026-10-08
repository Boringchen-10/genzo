package com.genzo.android

import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2
import com.davemorrissey.labs.subscaleview.ImageSource
import com.davemorrissey.labs.subscaleview.SubsamplingScaleImageView
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.json.JSONObject
import org.json.JSONArray
import java.io.File

/** Bounded page loading; large static images are decoded in tiles by SSIV. */
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
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val downloads = Semaphore(4)
    private val files = File(host.cacheDir, "reader-images/${host.intent.getStringExtra("sessionId")}/${host.entry}")
    private val requests = mutableMapOf<Int, Deferred<File>>()
    private val fetching = mutableSetOf<Int>()
    private val naturalSizes=mutableMapOf<Int,Pair<Int,Int>>()
    private val networkFiles=File(host.cacheDir,"reader-network-images")
    private var globalHold:FloatArray?=null
    private var preload:Job?=null
    private var pager: ViewPager2? = null
    private var list: RecyclerView? = null
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
    override fun zoomRatio(): Float {
        if(mode.startsWith("scroll"))return view.ratio
        val recycler = list ?: pager?.getChildAt(0) as? RecyclerView
        return (recycler?.findViewHolderForAdapterPosition(page) as? PageHolder)?.zoomRatio() ?: 1f
    }
    override fun imageGeometry(): JSONObject? {
        val recycler = list ?: pager?.getChildAt(0) as? RecyclerView
        return (recycler?.findViewHolderForAdapterPosition(page) as? PageHolder)?.geometry()
    }
    fun visiblePages():JSONArray {
        val result=JSONArray();val recycler=list?:pager?.getChildAt(0) as? RecyclerView?:return result
        for(index in 0 until recycler.childCount){val child=recycler.getChildAt(index);val holder=recycler.getChildViewHolder(child) as? PageHolder?:continue
            if(child.right<=0||child.left>=recycler.width||child.bottom<=0||child.top>=recycler.height)continue
            result.put(JSONObject().put("index",holder.bindingAdapterPosition).put("rendered",holder.geometry()!=null).put("loading",holder.loading()).put("width",child.width).put("visualWidth",child.width*if(list!=null)view.ratio else holder.zoomRatio()).put("localZoom",holder.zoomRatio()))
        };return result
    }
    fun zoomDiagnostics()=view.diagnostics()
    private fun holderAt(x:Float,y:Float):PageHolder? {
        val recycler=list?:pager?.getChildAt(0) as? RecyclerView?:return null
        val child=if(list!=null)recycler.findChildViewUnder((x-view.offsetX)/view.ratio,(y-view.offsetY)/view.ratio)else manager?.findViewByPosition(page)
        return (child?.let {recycler.getChildViewHolder(it)}?:recycler.findViewHolderForAdapterPosition(page)) as? PageHolder
    }
    private fun tap(x:Float,y:Float){
        val axis=if(mode=="page-vertical")y else x;val size=if(mode=="page-vertical")view.height else view.width
        val rtl=mode=="page-horizontal"&&host.settings.optBoolean("rtl",false)
        if(mode.startsWith("page")&&axis<size*.3f)move(rtl)else if(mode.startsWith("page")&&axis>size*.7f)move(!rtl)else host.toggleMenu()
    }
    private fun doubleTap(x:Float,y:Float){holderAt(x,y)?.sourceFile?.let {source->overlayVisible=true;showReaderImage(host,source){overlayVisible=false;autoPausedUntil=SystemClock.uptimeMillis()+2000}}}
    private fun hold(x:Float,y:Float){
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
        scope.async { downloads.withPermit {
            fetching.add(index)
            try {
            if (archive != null) host.client.cachedImage(archive,requireNotNull(archiveEntries).getString(index),files)
            else {
                val result=host.client.image(urls[index],networkFiles,cacheKeys?.optString(index)?.takeIf {it.isNotEmpty()},host.settings.optDouble("imageTimeout",15.0).toInt())
                val protected=(maxOf(0,page-2)..minOf(urls.lastIndex,page+2)).mapNotNull {cacheKeys?.optString(it)}.toSet()
                scope.launch {host.client.trimImages(networkFiles,protected)}
                result
            }
            } finally { fetching.remove(index) }
        } }
    }
    private fun attachedPages():Set<Int> {
        val recycler=list?:pager?.getChildAt(0) as? RecyclerView?:return emptySet()
        return (0 until recycler.childCount).map { recycler.getChildAdapterPosition(recycler.getChildAt(it)) }.toSet()
    }
    private fun active(index: Int) {
        if (index !in urls.indices || restoring) return
        page = index; offset = if (pager != null) 0.0 else offset
        host.locationChanged(page, urls.size, if (urls.size == 1) offset else (page + offset) / (urls.size - 1))
        // Kira: visible image first, then two neighbors in both directions.
        file(index)
        preload?.cancel();preload=scope.launch {
            delay(100)
            if(page!=index)return@launch
            for (distance in 1..2) {if(index+distance in urls.indices)file(index+distance);if(index-distance in urls.indices)file(index-distance)}
        }
        val attached=attachedPages()
        for (old in requests.keys.filter { it !in index-2..index+2 && it !in attached && it !in fetching }) {
            val request = requests.remove(old) ?: continue
            // Keep downloads already in flight and their disk files, as Kira's cache manager does.
            // Only obsolete queued work is cancelled so it cannot block newly visible pages.
            if(!request.isCompleted)request.cancel()
        }
    }
    @OptIn(ExperimentalCoroutinesApi::class)
    private fun build() {
        restoring = true;pager?.adapter = null;list?.adapter = null;view.reset();view.scroll=null;pager=null;list=null;manager=null;view.removeAllViews()
        mode = host.settings.optString("mode","scroll-vertical")
        layoutKey = currentLayoutKey()
        view.setBackgroundColor(host.readerBackground)
        val vertical = mode.endsWith("vertical")
        val adapter = object : RecyclerView.Adapter<PageHolder>() {
            override fun getItemCount() = urls.size + if (mode.startsWith("page")) 1 else 0
            override fun onCreateViewHolder(parent: ViewGroup, type: Int): PageHolder = PageHolder(FrameLayout(host).apply {
                layoutParams = ViewGroup.LayoutParams(if (vertical || mode.startsWith("page")) -1 else host.resources.displayMetrics.widthPixels,
                    if (mode.startsWith("page") || !vertical) -1 else host.dp(480))
            })
            override fun onBindViewHolder(holder: PageHolder, index: Int) { holder.bind(index) }
            override fun onViewAttachedToWindow(holder: PageHolder) { holder.resumeLoading() }
            override fun onViewRecycled(holder: PageHolder) { holder.release() }
        }
        if (mode.startsWith("page")) {
            pager = ViewPager2(host).apply {
                orientation = if (vertical) ViewPager2.ORIENTATION_VERTICAL else ViewPager2.ORIENTATION_HORIZONTAL
                layoutDirection = if (!vertical && host.settings.optBoolean("rtl",false)) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
                offscreenPageLimit = 1; this.adapter = adapter
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
            manager = LinearLayoutManager(host, if (vertical) RecyclerView.VERTICAL else RecyclerView.HORIZONTAL, false)
            list = RecyclerView(host).apply {
                layoutManager = manager; itemAnimator = null; this.adapter = adapter
                layoutDirection = if (!vertical && host.settings.optBoolean("rtl",false)) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
                setItemViewCacheSize(2)
                addOnScrollListener(object : RecyclerView.OnScrollListener() {
                    override fun onScrolled(recycler: RecyclerView, dx: Int, dy: Int) {
                        if (restoring) return
                        val index = manager!!.findFirstVisibleItemPosition(); if (index < 0) return
                        val child = manager!!.findViewByPosition(index) ?: return
                        val size = if (vertical) child.height else child.width
                        val start = if (vertical) child.top else if (host.settings.optBoolean("rtl",false)) recycler.width - child.right else child.left
                        offset = if (size > 0) (-start.toDouble() / size).coerceIn(0.0,1.0) else 0.0
                        moving = if (vertical) dy > 0 else if (host.settings.optBoolean("rtl",false)) dx < 0 else dx > 0
                        active(index)
                    }
                    override fun onScrollStateChanged(recycler: RecyclerView, state: Int) {
                        val direction = if (!vertical && host.settings.optBoolean("rtl",false)) -1 else 1
                        if (state == RecyclerView.SCROLL_STATE_IDLE && moving && !(if (vertical) recycler.canScrollVertically(1) else recycler.canScrollHorizontally(direction))) {
                            moving = false; host.adjacent(true, automatic = true)
                        }
                    }
                })
            }
            view.scroll=list;view.vertical=vertical
            view.addView(list, FrameLayout.LayoutParams(-1,-1)); manager!!.scrollToPositionWithOffset(page,0)
        }
        view.post { restoring = false; active(page) }
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
        fun loading():Boolean=task?.isActive==true
        fun resumeLoading() { if(bound in urls.indices&&image==null&&task?.isCancelled==true)bind(bound) }
        fun zoomRatio(): Float = image?.let { if (it.isReady && it.minScale > 0) it.scale / it.minScale else 1f } ?: 1f
        fun geometry(): JSONObject? {
            val picture = image?.takeIf { it.isReady } ?: return null
            val first = picture.sourceToViewCoord(0f,0f) ?: return null
            val last = picture.sourceToViewCoord(picture.sWidth.toFloat(),picture.sHeight.toFloat()) ?: return null
            return JSONObject().put("left",first.x).put("top",first.y).put("right",last.x).put("bottom",last.y).put("width",picture.width).put("height",picture.height).put("source",if (archive != null) "local-cbz" else "online")
        }
        fun holdAt(x:Float,y:Float){val picture=image?.takeIf {it.isReady&&it.scale<=it.minScale*1.01f}?:return;val rootLocation=IntArray(2);val location=IntArray(2);view.getLocationOnScreen(rootLocation);picture.getLocationOnScreen(location)
            val point=picture.viewToSourceCoord(x+rootLocation[0]-location[0],y+rootLocation[1]-location[1])?:return
            holdScale=picture.scale;holdCenter=picture.center?.let {android.graphics.PointF(it.x,it.y)};picture.setScaleAndCenter(picture.minScale*2.5f,point);frame.parent?.requestDisallowInterceptTouchEvent(true)
        }
        fun releaseHold(){holdScale?.let {scale->holdCenter?.let {image?.setScaleAndCenter(scale,it)}};holdScale=null;holdCenter=null}
        fun release() {version++;task?.cancel();ready.remove(bound);image?.recycle();image=null;sourceFile=null;frame.removeAllViews();holdScale=null;holdCenter=null;bound=-1}
        fun bind(index: Int) {
            if(bound!=index)retries=0
            release(); bound = index
            val gap = host.dp(host.settings.optDouble("gap",0.0).toInt())
            frame.setPadding(0,0,if (mode == "scroll-horizontal") gap else 0,if (mode == "scroll-vertical") gap else 0)
            if(mode.startsWith("scroll"))frame.layoutParams=frame.layoutParams.apply {
                val dimensions=naturalSizes[index];val ratio=dimensions?.let {it.second.toDouble()/it.first}?:naturalSizes.values.map {it.second.toDouble()/it.first}.sorted().let {if(it.isEmpty())1.35 else it[it.size/2]}
                if(mode=="scroll-vertical")height=(maxOf(view.width,host.resources.displayMetrics.widthPixels)*ratio).toInt()+gap
                else width=(maxOf(view.height,host.resources.displayMetrics.heightPixels)/ratio).toInt()+gap
            }
            if (index == urls.size) {
                val actions = LinearLayout(host).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
                actions.addView(TextView(host).apply { text = "本话读完"; setTextColor(host.readerForeground) })
                actions.addView(host.button("下一话") { host.adjacent(true) }); actions.addView(host.button("章节目录") { host.catalogue() })
                frame.addView(actions,FrameLayout.LayoutParams(-1,-1)); return
            }
            frame.addView(ProgressBar(host),FrameLayout.LayoutParams(host.dp(36),host.dp(36),Gravity.CENTER))
            task = scope.launch {
                try {
                    val source = file(index).await()
                    if (bound != index) return@launch
                    sourceFile=source
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
                            if (mode == "scroll-vertical") frame.layoutParams = frame.layoutParams.apply {
                                height = (maxOf(frame.width,view.width).toDouble() * picture.sHeight / picture.sWidth).toInt().coerceAtLeast(host.dp(80)) + gap
                            }
                            if (mode == "scroll-horizontal") frame.layoutParams = frame.layoutParams.apply {
                                width = (view.height.toDouble() * picture.sWidth / picture.sHeight).toInt().coerceAtLeast(host.dp(80)) + gap
                            }
                            if (index == page && offset > 0 && list != null) frame.post {
                                val size = if (mode == "scroll-vertical") frame.height else frame.width
                                restoring = true; manager?.scrollToPositionWithOffset(page,-(offset * size).toInt()); list?.post { restoring = false }
                            }
                        }
                        override fun onImageLoadError(error: Exception) { if(bound!=index||image!==picture)return;if(archive==null)sourceFile?.delete();sourceFile=null;showFailure(index) }
                    })
                    picture.setOnTouchListener { _,event ->
                        if(mode.startsWith("page")&&(event.pointerCount>1||picture.isReady&&picture.scale>picture.minScale*1.05f))frame.parent?.requestDisallowInterceptTouchEvent(true)
                        if(event.actionMasked==MotionEvent.ACTION_UP||event.actionMasked==MotionEvent.ACTION_CANCEL)frame.parent?.requestDisallowInterceptTouchEvent(false)
                        false
                    }
                    frame.addView(picture,FrameLayout.LayoutParams(-1,-1)); picture.setImage(ImageSource.uri(source.absolutePath))
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
            image?.recycle(); image = null; frame.removeAllViews()
            val panel = LinearLayout(host).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
            panel.addView(TextView(host).apply { text = "第 ${index + 1} 页读取失败"; setTextColor(host.readerForeground) })
            panel.addView(host.button("重试") { retries=0;requests.remove(index)?.cancel();bind(index) })
            frame.addView(panel,FrameLayout.LayoutParams(-1,-1))
            if(archive==null&&retries<host.settings.optDouble("imageRetries",1.0).toInt().coerceIn(0,5)) {
                retries++;val expected=version;frame.postDelayed({if(bound==index&&version==expected&&scope.isActive){requests.remove(index)?.cancel();bind(index)}},200)
            }
        }
    }
    override fun location(): JSONObject = JSONObject().put("pageIndex",page).put("offset",offset)
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
        page = (fraction * urls.lastIndex).toInt().coerceIn(0,urls.lastIndex); offset = 0.0
        pager?.setCurrentItem(page,false); manager?.scrollToPositionWithOffset(page,0); active(page)
    }
    override fun settingsChanged() {
        if (layoutKey != currentLayoutKey()) build()
        view.setBackgroundColor(host.readerBackground)
    }
    fun autoScroll(speed: Double) {
        val now = SystemClock.uptimeMillis(); if (touching || overlayVisible || now < autoPausedUntil) return
        if (pager != null) { if (now - lastAutoPage > 3000) { lastAutoPage = now; move(true) } }
        else {
            val direction = if (mode == "scroll-horizontal" && host.settings.optBoolean("rtl",false)) -1 else 1
            val canMove = if (mode == "scroll-vertical") list?.canScrollVertically(1) else list?.canScrollHorizontally(direction)
            if (canMove == false) { if (now - lastAutoPage > 1500) { lastAutoPage = now; host.adjacent(true,automatic = true) }; return }
            val amount = maxOf(1,(host.dp(speed.toInt()) * .05).toInt())
            if (mode == "scroll-vertical") list?.scrollBy(0,amount) else list?.scrollBy(amount * direction,0)
        }
    }
    override fun close() {
        scope.cancel(); pager?.adapter = null; list?.adapter = null
        files.listFiles()?.forEach { if (it.isFile) it.delete() }
    }
}
