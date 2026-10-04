param([switch]$Release, [switch]$Studio, [ValidateSet('aarch64','x86_64')][string]$Target = 'aarch64')
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$androidTools = if ($env:GENZO_ANDROID_TOOLS) { $env:GENZO_ANDROID_TOOLS } else { 'D:\DevTools\Android' }
$env:JAVA_HOME = Join-Path $androidTools 'Java\jdk-17.0.20.1+1'
$env:ANDROID_HOME = Join-Path $androidTools 'Sdk'
$env:NDK_HOME = Join-Path $androidTools 'Sdk\ndk\27.0.12077973'
$env:CARGO_HOME = Join-Path $androidTools 'Cargo'
$env:RUSTUP_HOME = Join-Path $androidTools 'Rustup'
$env:GRADLE_USER_HOME = Join-Path $androidTools 'Gradle'
$env:ANDROID_USER_HOME = Join-Path $androidTools 'AndroidUserHome'
$env:ANDROID_EMULATOR_HOME = $env:ANDROID_USER_HOME
$env:ANDROID_AVD_HOME = Join-Path $androidTools 'Avd'
$env:CARGO_TARGET_DIR = Join-Path $androidTools 'Build\genzo'
$env:CARGO_PROFILE_DEV_DEBUG = '0'
$env:CARGO_PROFILE_DEV_STRIP = 'symbols'
$env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = Join-Path $env:NDK_HOME 'toolchains\llvm\prebuilt\windows-x86_64\bin\aarch64-linux-android26-clang.cmd'
$env:CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER = Join-Path $env:NDK_HOME 'toolchains\llvm\prebuilt\windows-x86_64\bin\x86_64-linux-android26-clang.cmd'
$env:RUSTFLAGS = '-C link-arg=-Wl,-z,max-page-size=16384 -C link-arg=-landroid -C link-arg=-llog -C link-arg=-lOpenSLES'
$env:GENZO_ANDROID_BUILD_DIR = Join-Path $androidTools 'Build\gradle-genzo'
$env:TEMP = Join-Path $androidTools 'Temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
$env:PATH = "$env:JAVA_HOME\bin;$env:CARGO_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
$env:GENZO_NODE = (Get-Command node).Source
if ($Studio) {
    $studioExecutable = Join-Path $androidTools 'Studio\bin\studio64.exe'
    if (!(Test-Path -LiteralPath $studioExecutable)) { throw "Android Studio not found: $studioExecutable" }
    # Preserve existing IDE preferences; put new indexing caches and logs on D:.
    $env:STUDIO_PROPERTIES = Join-Path $androidTools 'AndroidUserHome\genzo-studio.properties'
    $studioSystemDirectory = (Join-Path $androidTools 'AndroidUserHome\studio-system').Replace('\', '/')
    @("idea.system.path=$studioSystemDirectory", "idea.log.path=$studioSystemDirectory/log") |
        Set-Content -LiteralPath $env:STUDIO_PROPERTIES -Encoding utf8
    $studioMetadata = Get-Content -LiteralPath (Join-Path $androidTools 'Studio\product-info.json') -Raw | ConvertFrom-Json
    $studioConfiguration = Join-Path $env:APPDATA "Google\$($studioMetadata.dataDirectoryName)"
    if (Test-Path -LiteralPath $studioConfiguration) {
        $customPropertiesPath = Join-Path $studioConfiguration 'idea.properties'
        $previousProperties = if (Test-Path -LiteralPath $customPropertiesPath) { Get-Content -LiteralPath $customPropertiesPath -Raw } else { '' }
        $preservedProperties = ($previousProperties -split "`r?`n" | Where-Object { $_ -notmatch '^idea\.(system|log)\.path=' }) -join "`n"
        @($preservedProperties, "idea.system.path=$studioSystemDirectory", "idea.log.path=$studioSystemDirectory/log") |
            Set-Content -LiteralPath $customPropertiesPath -Encoding utf8
    }
    $studioProject = Join-Path $projectDirectory 'src-tauri\gen\android'
    $gradleConfiguration = Join-Path $studioProject '.gradle'
    New-Item -ItemType Directory -Force -Path $gradleConfiguration | Out-Null
    # Android Studio's GRADLE_LOCAL_JAVA_HOME macro reads this ignored local file.
    $studioBuildSettings = @(('java.home=' + $env:JAVA_HOME.Replace('\', '/')), ('genzo.build.dir=' + $env:GENZO_ANDROID_BUILD_DIR.Replace('\', '/')))
    foreach ($variable in @('GENZO_NODE','CARGO_HOME','RUSTUP_HOME','CARGO_TARGET_DIR','CARGO_PROFILE_DEV_DEBUG','CARGO_PROFILE_DEV_STRIP','CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER','CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER','RUSTFLAGS','JAVA_HOME','ANDROID_HOME','NDK_HOME','TEMP','TMP')) {
        $studioBuildSettings += 'genzo.env.' + $variable + '=' + [Environment]::GetEnvironmentVariable($variable).Replace('\', '/')
    }
    $studioBuildSettings | Set-Content -LiteralPath (Join-Path $gradleConfiguration 'config.properties') -Encoding ascii
    $env:PATH = "$(Split-Path -Parent $studioExecutable);$env:PATH"
    # Tauri's shell-open request may use Explorer's old environment. Start the IDE
    # directly first so the D: cache/TEMP and tool variables are actually inherited.
    $studioStart = [System.Diagnostics.ProcessStartInfo]::new()
    $studioStart.FileName = $studioExecutable
    $studioStart.UseShellExecute = $false
    $studioStart.ArgumentList.Add($studioProject)
    $null = [System.Diagnostics.Process]::Start($studioStart)
}
Push-Location $projectDirectory
try {
    $buildArguments = @('node_modules/@tauri-apps/cli/tauri.js', 'android', 'build', '--apk', '--target', $Target)
    if (!$Release) { $buildArguments += '--debug' }
    if ($Studio) { $buildArguments += '--open' }
    & node @buildArguments
    if ($LASTEXITCODE -ne 0) { throw "Android build failed ($LASTEXITCODE)" }
} finally { Pop-Location }
