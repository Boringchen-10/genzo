package com.genzo.qa;

import android.os.SystemClock;
import android.view.InputDevice;
import android.view.InputEvent;
import android.view.MotionEvent;
import java.lang.reflect.Method;

/** Shell-owned QA injector: real multi-pointer events, no reader implementation calls. */
public class ReaderGesture {
    private static Object manager;
    private static Method inject;
    private static void event(long down, int action, int count, float x, float y, float radius) throws Exception {
        MotionEvent.PointerProperties[] properties = new MotionEvent.PointerProperties[count];
        MotionEvent.PointerCoords[] coordinates = new MotionEvent.PointerCoords[count];
        for (int i = 0; i < count; i++) {
            properties[i] = new MotionEvent.PointerProperties(); properties[i].id = i; properties[i].toolType = MotionEvent.TOOL_TYPE_FINGER;
            coordinates[i] = new MotionEvent.PointerCoords(); coordinates[i].x = x + (i == 0 ? -radius : radius); coordinates[i].y = y;
            coordinates[i].pressure = 1; coordinates[i].size = 1;
        }
        MotionEvent event = MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,count,properties,coordinates,0,0,1,1,0,0,InputDevice.SOURCE_TOUCHSCREEN,0);
        if (!(Boolean) inject.invoke(manager,event,2)) throw new IllegalStateException("Input injection rejected");
        event.recycle();
    }
    public static void main(String[] args) throws Exception {
        Class<?> type = Class.forName("android.hardware.input.InputManagerGlobal");
        manager = type.getMethod("getInstance").invoke(null);
        inject = type.getMethod("injectInputEvent",InputEvent.class,int.class);
        float x = Float.parseFloat(args[0]), y = Float.parseFloat(args[1]);
        long down = SystemClock.uptimeMillis();
        event(down,MotionEvent.ACTION_DOWN,1,x,y,60);
        event(down,MotionEvent.ACTION_POINTER_DOWN | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT),2,x,y,60);
        for(int i=0;i<=20;i++){event(down,MotionEvent.ACTION_MOVE,2,x,y,60+i*10);SystemClock.sleep(20);}
        event(down,MotionEvent.ACTION_POINTER_UP | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT),2,x,y,260);
        event(down,MotionEvent.ACTION_UP,1,x,y,260);
    }
}
