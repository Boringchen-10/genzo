package com.genzo.android

import android.content.Context
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.VelocityTracker
import android.widget.FrameLayout
import android.widget.OverScroller
import androidx.recyclerview.widget.RecyclerView

/** Kira pinch_zoomable.dart / reader_scroll_mode.dart, adapted to native views.
 * MIT Copyright (c) 2026 孤独的Lonely; see licenses/kira-MIT.txt.
 * Scroll mode transforms the entire list, including loading placeholders.
 */
class ComicViewport(context:Context,
    private val tap:(Float,Float)->Unit,
    private val doubleTap:(Float,Float)->Unit,
    private val hold:(Float,Float)->Unit,
    private val release:()->Unit,
    private val touching:(Boolean)->Unit,
    private val changed:()->Unit
) : FrameLayout(context) {
    var scroll:RecyclerView?=null
    var vertical=true
    var ratio=1f;private set
    var offsetX=0f;private set
    var offsetY=0f;private set
    private var x=0f;private var y=0f
    private var focusX=0f;private var focusY=0f
    private var span=0f
    private var multiple=false
    private var doubleHandled=false
    private var brake=false
    private var velocity:VelocityTracker?=null
    private val fling=OverScroller(context)
    private var scaleUpdates=0
    private var sizeResets=0
    private var maximumRatio=1f
    fun diagnostics()=org.json.JSONObject().put("scaleUpdates",scaleUpdates).put("sizeResets",sizeResets).put("maximumRatio",maximumRatio).put("offsetX",offsetX).put("offsetY",offsetY)
    private val detector=GestureDetector(context,object:GestureDetector.SimpleOnGestureListener(){
        override fun onDown(event:MotionEvent)=true
        override fun onSingleTapConfirmed(event:MotionEvent):Boolean {if(!brake)tap(event.x,event.y);return true}
        override fun onDoubleTap(event:MotionEvent):Boolean {doubleHandled=true;doubleTap(event.x,event.y);return true}
        override fun onLongPress(event:MotionEvent) {if(!multiple)hold(event.x,event.y)}
    })
    init {isClickable=true;clipChildren=true;clipToPadding=true}
    fun zoomAt(value:Float,px:Float,py:Float) {
        val worldX=(px-offsetX)/ratio;val worldY=(py-offsetY)/ratio
        ratio=value.coerceIn(1f,5f);offsetX=px-worldX*ratio;offsetY=py-worldY*ratio;transform()
    }
    fun restore(value:Float,px:Float,py:Float){ratio=value;offsetX=px;offsetY=py;transform()}
    fun reset(){fling.forceFinished(true);ratio=1f;offsetX=0f;offsetY=0f;transform()}
    private fun transform(){
        offsetX=offsetX.coerceIn(-width*(ratio-1),0f);offsetY=offsetY.coerceIn(-height*(ratio-1),0f)
        scroll?.apply {pivotX=0f;pivotY=0f;scaleX=ratio;scaleY=ratio;translationX=offsetX;translationY=offsetY}
        changed()
    }
    override fun onSizeChanged(w:Int,h:Int,oldw:Int,oldh:Int){super.onSizeChanged(w,h,oldw,oldh);if(w!=oldw||h!=oldh){sizeResets++;reset()}}
    override fun dispatchTouchEvent(event:MotionEvent):Boolean {
        val action=event.actionMasked
        if(action==MotionEvent.ACTION_DOWN){
            touching(true);x=event.x;y=event.y;multiple=false;doubleHandled=false
            brake=scroll?.scrollState==RecyclerView.SCROLL_STATE_SETTLING
            fling.forceFinished(true);velocity?.recycle();velocity=VelocityTracker.obtain()
        }
        velocity?.addMovement(event)
        detector.onTouchEvent(event)
        if(scroll!=null&&action==MotionEvent.ACTION_POINTER_DOWN){
            multiple=true;scroll?.stopScroll()
            span=kotlin.math.hypot(event.getX(1)-event.getX(0),event.getY(1)-event.getY(0))
            focusX=(event.getX(0)+event.getX(1))/2;focusY=(event.getY(0)+event.getY(1))/2
            val cancel=MotionEvent.obtain(event);cancel.action=MotionEvent.ACTION_CANCEL;super.dispatchTouchEvent(cancel);cancel.recycle()
        }
        var handled=false
        if(scroll!=null&&(multiple||ratio>1.01f)){
            handled=true
            if(multiple&&action==MotionEvent.ACTION_MOVE&&event.pointerCount>=2){
                val nextSpan=kotlin.math.hypot(event.getX(1)-event.getX(0),event.getY(1)-event.getY(0))
                val nextX=(event.getX(0)+event.getX(1))/2;val nextY=(event.getY(0)+event.getY(1))/2
                val worldX=(focusX-offsetX)/ratio;val worldY=(focusY-offsetY)/ratio
                if(span>0&&nextSpan>0)ratio=(ratio*nextSpan/span).coerceIn(1f,5f)
                offsetX=nextX-worldX*ratio;offsetY=nextY-worldY*ratio
                focusX=nextX;focusY=nextY;span=nextSpan;scaleUpdates++;maximumRatio=maxOf(maximumRatio,ratio);transform()
            }
            if(!multiple&&action==MotionEvent.ACTION_MOVE){
                val dx=event.x-x;val dy=event.y-y
                if(vertical){offsetX+=dx;scroll?.scrollBy(0,(-dy/ratio).toInt())}
                else{offsetY+=dy;scroll?.scrollBy((-dx/ratio).toInt(),0)}
                transform()
            }
            if(action==MotionEvent.ACTION_UP&&!multiple){
                velocity?.computeCurrentVelocity(1000)
                if(vertical){scroll?.fling(0,(-(velocity?.yVelocity?:0f)/ratio).toInt());fling.fling(offsetX.toInt(),offsetY.toInt(),(velocity?.xVelocity?:0f).toInt(),0,(-width*(ratio-1)).toInt(),0,offsetY.toInt(),offsetY.toInt())}
                else{scroll?.fling((-(velocity?.xVelocity?:0f)/ratio).toInt(),0);fling.fling(offsetX.toInt(),offsetY.toInt(),0,(velocity?.yVelocity?:0f).toInt(),offsetX.toInt(),offsetX.toInt(),(-height*(ratio-1)).toInt(),0)}
                postInvalidateOnAnimation()
            }
        }
        x=event.x;y=event.y
        if(action==MotionEvent.ACTION_UP||action==MotionEvent.ACTION_CANCEL){touching(false);release();velocity?.recycle();velocity=null}
        return if(handled||doubleHandled)true else super.dispatchTouchEvent(event)
    }
    override fun onTouchEvent(event:MotionEvent)=true
    override fun computeScroll(){if(fling.computeScrollOffset()){offsetX=fling.currX.toFloat();offsetY=fling.currY.toFloat();transform();postInvalidateOnAnimation()}}
}
