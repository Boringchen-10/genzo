param([string]$SigningDirectory = 'D:\DevTools\Android\Signing')
$ErrorActionPreference = 'Stop'
$taskSource = Split-Path -Parent $PSScriptRoot
$taskStore = Join-Path $SigningDirectory 'genzo-release.p12'
$taskPassword = Join-Path $SigningDirectory 'store-password.txt'
if (!(Test-Path -LiteralPath $taskStore) -or !(Test-Path -LiteralPath $taskPassword)) {
    throw 'Provide the persistent Genzo signing store and password file outside the repository.'
}
# This builds the shared optimized native library and Android-only frontend.
# The intermediate QA APK is never installed or included in the release folder.
& (Join-Path $PSScriptRoot 'build-reader-qa.ps1') -Target aarch64 -Optimize
$env:GENZO_READER_QA = '0'
$env:GENZO_ANDROID_BUILD_DIR = 'D:\DevTools\Android\Build\release-gradle'
$taskUnsigned = Join-Path $env:GENZO_ANDROID_BUILD_DIR 'app/outputs/apk/arm64/release/app-arm64-release-unsigned.apk'
if (Test-Path -LiteralPath $taskUnsigned) { Remove-Item -LiteralPath $taskUnsigned }
Push-Location 'D:\DevTools\Android\Build\reader-source\src-tauri\gen\android'
try {
    & .\gradlew.bat :app:assembleArm64Release -x :app:rustBuildArm64Release --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Android release build failed' }
} finally { Pop-Location }
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskSource 'package.json') -Raw | ConvertFrom-Json).version
$taskOutput = "D:\DevTools\Android\Build\releases\v$taskVersion"
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
$taskAligned = Join-Path $taskOutput 'aligned-unsigned.apk'
$taskApk = Join-Path $taskOutput "Genzo_${taskVersion}_android_arm64-v8a.apk"
$taskBuildTools = 'D:\DevTools\Android\Sdk\build-tools\35.0.0'
& (Join-Path $taskBuildTools 'zipalign.exe') -f -P 16 4 $taskUnsigned $taskAligned
if ($LASTEXITCODE -ne 0) { throw 'Android ZIP alignment failed' }
& (Join-Path $taskBuildTools 'apksigner.bat') sign --ks $taskStore --ks-key-alias genzo --ks-pass "file:$taskPassword" --out $taskApk $taskAligned
if ($LASTEXITCODE -ne 0) { throw 'Android APK signing failed' }
& (Join-Path $taskBuildTools 'apksigner.bat') verify $taskApk
if ($LASTEXITCODE -ne 0) { throw 'Android signature verification failed' }
& (Join-Path $taskBuildTools 'zipalign.exe') -c -P 16 4 $taskApk
if ($LASTEXITCODE -ne 0) { throw 'Signed APK alignment verification failed' }
Remove-Item -LiteralPath $taskAligned
$taskHash = (Get-FileHash -LiteralPath $taskApk -Algorithm SHA256).Hash.ToLowerInvariant()
"$taskHash  $(Split-Path -Leaf $taskApk)" | Set-Content -LiteralPath (Join-Path $taskOutput 'SHA256SUMS.txt') -Encoding ascii
Write-Output $taskApk
Write-Output $taskHash
