package com.genzo.android

import android.view.Gravity
import android.widget.LinearLayout
import android.app.Dialog
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.davemorrissey.labs.subscaleview.ImageSource
import com.davemorrissey.labs.subscaleview.SubsamplingScaleImageView
import java.io.File

fun showReaderImage(host: ReaderActivity, file: File, dismissed: () -> Unit = {}) {
    val root = LinearLayout(host).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(host.readerBackground); gravity = Gravity.CENTER }
    val image = SubsamplingScaleImageView(host).apply { setMaxScale(10f); setDoubleTapZoomScale(2.5f); setImage(ImageSource.uri(file.absolutePath)) }
    root.addView(image,LinearLayout.LayoutParams(-1,0,1f))
    val controls = LinearLayout(host)
    val dialog = Dialog(host, R.style.Theme_genzo)
    controls.addView(host.button("旋转") { image.setOrientation((image.orientation + 90) % 360) },LinearLayout.LayoutParams(0,host.dp(48),1f))
    controls.addView(host.button("重置") { image.setOrientation(0); image.resetScaleAndCenter() },LinearLayout.LayoutParams(0,host.dp(48),1f))
    controls.addView(host.button("返回") { dialog.dismiss() },LinearLayout.LayoutParams(0,host.dp(48),1f))
    root.addView(controls)
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        view.setPadding(bars.left,bars.top,bars.right,bars.bottom); insets
    }
    val observer = object : androidx.lifecycle.DefaultLifecycleObserver {
        override fun onDestroy(owner: androidx.lifecycle.LifecycleOwner) { dialog.dismiss(); host.lifecycle.removeObserver(this) }
    }
    host.lifecycle.addObserver(observer)
    dialog.setContentView(root); dialog.setOnDismissListener { host.lifecycle.removeObserver(observer); image.recycle(); dismissed() }; dialog.show()
    dialog.window?.setLayout(-1,-1)
}
