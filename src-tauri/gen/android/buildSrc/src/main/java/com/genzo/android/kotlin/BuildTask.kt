import java.io.File
import java.util.Properties
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction

open class BuildTask : DefaultTask() {
    @Input
    var rootDirRel: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val localSettings = Properties().apply {
            val settings = File(project.rootDir, ".gradle/config.properties")
            if (settings.exists()) settings.inputStream().use { load(it) }
        }
        val executable = localSettings.getProperty("genzo.env.GENZO_NODE") ?: System.getenv("GENZO_NODE") ?: "node"
        runTauriCli(executable, localSettings)
    }

    fun runTauriCli(executable: String, localSettings: Properties) {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val args = listOf("../node_modules/@tauri-apps/cli/tauri.js", "android", "android-studio-script")

        project.exec {
            workingDir(File(project.projectDir, rootDirRel))
            localSettings.forEach { key, value ->
                if (key.toString().startsWith("genzo.env.")) environment(key.toString().removePrefix("genzo.env."), value)
            }
            executable(executable)
            args(args)
            if (project.logger.isEnabled(LogLevel.DEBUG)) {
                args("-vv")
            } else if (project.logger.isEnabled(LogLevel.INFO)) {
                args("-v")
            }
            if (release) {
                args("--release")
            }
            args(listOf("--target", target))
        }.assertNormalExitValue()
    }
}
