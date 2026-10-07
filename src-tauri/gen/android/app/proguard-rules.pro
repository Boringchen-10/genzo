# Add project specific ProGuard rules here.
-keep class com.genzo.android.GenzoPlugin { *; }
-keep class com.genzo.android.TreeArgs { *; }
-keep class com.genzo.android.PlayerArgs { *; }
-keep class com.genzo.android.CredentialArgs { *; }
-keep class com.genzo.android.ControlArgs { *; }
-keep class com.genzo.android.ReaderArgs { *; }
-keep class com.genzo.android.ReaderControlArgs { *; }
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
