param([switch]$Install, [switch]$Optimize, [ValidateSet('x86_64','aarch64')][string]$Target = 'x86_64')
if ($Install -and $Target -ne 'x86_64') { throw 'Only the x86_64 QA package can be installed on emulator-5554' }
$ErrorActionPreference = 'Stop'
$taskSource = Split-Path -Parent $PSScriptRoot
$taskTools = 'D:\DevTools\Android'
$taskCopy = Join-Path $taskTools 'Build\reader-source'
New-Item -ItemType Directory -Force -Path $taskCopy | Out-Null
foreach ($taskFile in (& git -C $taskSource ls-files -co --exclude-standard)) {
    $taskOriginal = Join-Path $taskSource $taskFile
    if (Test-Path -LiteralPath $taskOriginal -PathType Leaf) {
        $taskDestination = Join-Path $taskCopy $taskFile
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $taskDestination) | Out-Null
        Copy-Item -LiteralPath $taskOriginal -Destination $taskDestination -Force
    }
}
foreach ($taskFile in @('src-tauri/gen/android/tauri.settings.gradle','src-tauri/gen/android/app/tauri.build.gradle.kts','src-tauri/gen/android/local.properties','src-tauri/gen/android/app/tauri.properties')) {
    Copy-Item -LiteralPath (Join-Path $taskSource $taskFile) -Destination (Join-Path $taskCopy $taskFile) -Force
}
$taskVersion = [Version](Get-Content -LiteralPath (Join-Path $taskSource 'package.json') -Raw | ConvertFrom-Json).version
$taskVersionCode = $taskVersion.Major * 1000000 + $taskVersion.Minor * 1000 + $taskVersion.Build
@("tauri.android.versionName=$taskVersion", "tauri.android.versionCode=$taskVersionCode") | Set-Content -LiteralPath (Join-Path $taskCopy 'src-tauri/gen/android/app/tauri.properties') -Encoding ascii
$taskGenerated = 'src-tauri/gen/android/app/src/main/java/com/genzo/android/generated'
New-Item -ItemType Directory -Force -Path (Join-Path $taskCopy $taskGenerated) | Out-Null
Get-ChildItem -LiteralPath (Join-Path $taskSource $taskGenerated) -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path (Join-Path $taskCopy $taskGenerated) $_.Name) -Force
}
if (!(Test-Path -LiteralPath (Join-Path $taskCopy 'node_modules'))) {
    New-Item -ItemType Junction -Path (Join-Path $taskCopy 'node_modules') -Target (Join-Path $taskSource 'node_modules') | Out-Null
}
$env:JAVA_HOME = Join-Path $taskTools 'Java\jdk-17.0.20.1+1'
$env:ANDROID_HOME = Join-Path $taskTools 'Sdk'
$env:NDK_HOME = Join-Path $taskTools 'Sdk\ndk\27.0.12077973'
$env:CARGO_HOME = Join-Path $taskTools 'Cargo'
$env:RUSTUP_HOME = Join-Path $taskTools 'Rustup'
$env:GRADLE_USER_HOME = Join-Path $taskTools 'Gradle'
$env:CARGO_TARGET_DIR = Join-Path $taskTools 'Build\genzo'
$env:CARGO_PROFILE_DEV_DEBUG = '0'
$env:CARGO_PROFILE_DEV_STRIP = 'symbols'
$taskCargoProfile = if ($Optimize) { 'release' } else { 'debug' }
$env:CARGO_PROFILE_RELEASE_OPT_LEVEL = 's'
$env:CARGO_PROFILE_RELEASE_LTO = 'thin'
$env:CARGO_PROFILE_RELEASE_CODEGEN_UNITS = '1'
$env:CARGO_PROFILE_RELEASE_STRIP = 'symbols'
$env:CARGO_PROFILE_RELEASE_PANIC = 'abort'
$taskNdkBin = Join-Path $env:NDK_HOME 'toolchains\llvm\prebuilt\windows-x86_64\bin'
$env:CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER = Join-Path $taskNdkBin 'x86_64-linux-android26-clang.cmd'
$env:CC_x86_64_linux_android = $env:CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER
$env:CXX_x86_64_linux_android = Join-Path $taskNdkBin 'x86_64-linux-android26-clang++.cmd'
$env:AR_x86_64_linux_android = Join-Path $taskNdkBin 'llvm-ar.exe'
$env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = Join-Path $taskNdkBin 'aarch64-linux-android26-clang.cmd'
$env:CC_aarch64_linux_android = $env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER
$env:CXX_aarch64_linux_android = Join-Path $taskNdkBin 'aarch64-linux-android26-clang++.cmd'
$env:AR_aarch64_linux_android = Join-Path $taskNdkBin 'llvm-ar.exe'
$taskRustTarget = if ($Target -eq 'aarch64') { 'aarch64-linux-android' } else { 'x86_64-linux-android' }
$taskAbi = if ($Target -eq 'aarch64') { 'arm64-v8a' } else { 'x86_64' }
$taskFlavor = if ($Target -eq 'aarch64') { 'arm64' } else { 'x86_64' }
$taskTaskFlavor = if ($Target -eq 'aarch64') { 'Arm64' } else { 'X86_64' }
$env:RUSTFLAGS = '-C link-arg=-Wl,-z,max-page-size=16384 -C link-arg=-landroid -C link-arg=-llog -C link-arg=-lOpenSLES'
$env:WRY_ANDROID_PACKAGE = 'com.genzo.android'
$env:WRY_ANDROID_LIBRARY = 'genzo_lib'
$env:WRY_ANDROID_KOTLIN_FILES_OUT_DIR = Join-Path $taskCopy $taskGenerated
# Tauri's JNI symbols follow the Kotlin namespace; Gradle applicationId isolates data.
$env:TAURI_CONFIG = '{"identifier":"com.genzo.android","build":{"devUrl":null}}'
$env:GENZO_READER_QA = '1'
$env:GENZO_ANDROID_FRONTEND = '1'
$env:GENZO_ANDROID_OPTIMIZE = if ($Optimize) { '1' } else { '0' }
$env:GENZO_ANDROID_BUILD_DIR = Join-Path $taskTools $(if ($Optimize) { 'Build\reader-optimized-gradle' } else { 'Build\reader-gradle' })
$env:TEMP = Join-Path $taskTools 'Temp'
$env:TMP = $env:TEMP
$env:JAVA_TOOL_OPTIONS = '-Djava.net.preferIPv4Stack=true'
$env:PATH = "$taskNdkBin;$env:JAVA_HOME\bin;$env:CARGO_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
Push-Location $taskSource
try {
    $taskDist = [IO.Path]::GetFullPath((Join-Path $taskCopy 'dist'))
    if ($taskDist -ne 'D:\DevTools\Android\Build\reader-source\dist') { throw 'Unexpected generated frontend directory' }
    & node (Join-Path $taskSource 'node_modules/vite/bin/vite.js') build --outDir $taskDist --emptyOutDir
    if ($LASTEXITCODE -ne 0) { throw 'Reader frontend build failed' }
} finally { Pop-Location }
Push-Location $taskCopy
try {
    $taskCargoArgs = @('build', '--manifest-path', 'src-tauri/Cargo.toml', '--lib', '--target', $taskRustTarget, '--features', 'custom-protocol', '--locked')
    if ($Optimize) { $taskCargoArgs += '--release' }
    & cargo @taskCargoArgs
    if ($LASTEXITCODE -ne 0) { throw 'Reader Android Rust build failed' }
    $taskJni = Join-Path $taskCopy "src-tauri/gen/android/app/src/main/jniLibs/$taskAbi"
    New-Item -ItemType Directory -Force -Path $taskJni | Out-Null
    Copy-Item -LiteralPath (Join-Path $env:CARGO_TARGET_DIR "$taskRustTarget/$taskCargoProfile/libgenzo_lib.so") -Destination (Join-Path $taskJni 'libgenzo_lib.so') -Force
    Push-Location 'src-tauri/gen/android'
    try {
        $taskApkOutput = [IO.Path]::GetFullPath((Join-Path $env:GENZO_ANDROID_BUILD_DIR "app/outputs/apk/$taskFlavor/debug/app-$taskFlavor-debug.apk"))
        if (!$taskApkOutput.StartsWith([IO.Path]::GetFullPath($env:GENZO_ANDROID_BUILD_DIR) + [IO.Path]::DirectorySeparatorChar)) { throw 'QA APK path outside build directory' }
        if (Test-Path -LiteralPath $taskApkOutput) { Remove-Item -LiteralPath $taskApkOutput }
        & .\gradlew.bat ":app:assemble${taskTaskFlavor}Debug" -x ":app:rustBuild${taskTaskFlavor}Debug" --console=plain
        if ($LASTEXITCODE -ne 0) { throw 'Reader QA APK build failed' }
    } finally { Pop-Location }
} finally { Pop-Location }
$taskApk = Join-Path $env:GENZO_ANDROID_BUILD_DIR "app/outputs/apk/$taskFlavor/debug/app-$taskFlavor-debug.apk"
Get-FileHash -LiteralPath $taskApk -Algorithm SHA256
if ($Install) {
    & adb -s emulator-5554 install --no-streaming -r $taskApk
    if ($LASTEXITCODE -ne 0) { throw 'Reader QA install failed' }
    & adb -s emulator-5554 shell am start -n com.genzo.android.readerqa/com.genzo.android.MainActivity
    if ($LASTEXITCODE -ne 0) { throw 'Reader QA launch failed' }
}
