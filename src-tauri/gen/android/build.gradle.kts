buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.10")
    }
}

val genzoLocalSettings = java.util.Properties().apply {
    val settings = file(".gradle/config.properties")
    if (settings.exists()) settings.inputStream().use { load(it) }
}
val genzoBuildDirectory = System.getenv("GENZO_ANDROID_BUILD_DIR") ?: genzoLocalSettings.getProperty("genzo.build.dir")
allprojects {
    genzoBuildDirectory?.let {
        layout.buildDirectory.set(file("$it/${project.name}"))
    }
    repositories {
        google()
        mavenCentral()
    }
}

tasks.register("clean").configure {
    delete("build")
}
