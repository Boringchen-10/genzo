param([string]$Apk)
$ErrorActionPreference = 'Stop'
$androidTools = if ($env:GENZO_ANDROID_TOOLS) { $env:GENZO_ANDROID_TOOLS } else { 'D:\DevTools\Android' }
$env:ANDROID_HOME = Join-Path $androidTools 'Sdk'
$env:ANDROID_USER_HOME = Join-Path $androidTools 'AndroidUserHome'
$env:ANDROID_EMULATOR_HOME = $env:ANDROID_USER_HOME
$env:ANDROID_AVD_HOME = Join-Path $androidTools 'Avd'
$env:TEMP = Join-Path $androidTools 'Temp'
$env:TMP = $env:TEMP
$adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
$emulator = Join-Path $env:ANDROID_HOME 'emulator\emulator.exe'
$avd = 'Genzo_Pixel9_API36'
$serial = 'emulator-5554'
$avdConfiguration = Join-Path $env:ANDROID_AVD_HOME "$avd.avd\config.ini"
if (!(Test-Path -LiteralPath $avdConfiguration)) {
    throw "Create $avd first; see docs/android/ANDROID_STUDIO.md"
}
# Studio launches do not inherit our command-line -no-snapshot-load flag.
# Keep this AVD's next IDE launch on cold boot too, without wiping user data.
$existingConfiguration = [System.IO.File]::ReadAllText($avdConfiguration)
$coldBootConfiguration = $existingConfiguration -replace '(?m)^fastboot.forceColdBoot=[^\r\n]*', 'fastboot.forceColdBoot=yes' -replace '(?m)^fastboot.forceFastBoot=[^\r\n]*', 'fastboot.forceFastBoot=no'
if ($coldBootConfiguration -ne $existingConfiguration) {
    [System.IO.File]::WriteAllText($avdConfiguration, $coldBootConfiguration, [System.Text.UTF8Encoding]::new($false))
}
$devices = & $adb devices
if ($devices -match "^$serial\s") {
    $runningAvd = @(& $adb -s $serial emu avd name 2>$null)
    if ($LASTEXITCODE -ne 0 -or !$runningAvd.Count) { throw 'ADB still lists an unavailable emulator. Wait for disconnection and retry; user data stays intact.' }
    if ($runningAvd[0] -ne $avd) { throw 'Port 5554 belongs to another emulator; leave it running and choose another port.' }
} else {
    # Cold boot avoids restoring a stale GPU/VM snapshot; user data stays intact.
    $arguments = @('-avd',$avd,'-port','5554','-gpu','software','-feature','-Vulkan','-no-snapshot-load','-no-boot-anim','-scale','0.35','-cores','4')
    $logDirectory = Join-Path $androidTools 'Build\emulator-logs'
    New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    # The user explicitly wants a visible emulator window. Persist output so the
    # helper does not depend on the launching terminal's lifetime or pipe buffer.
    $null = Start-Process -FilePath $emulator -ArgumentList $arguments -WindowStyle Normal `
        -RedirectStandardOutput (Join-Path $logDirectory "$stamp.out.log") `
        -RedirectStandardError (Join-Path $logDirectory "$stamp.err.log") -PassThru
}
if ($Apk) {
    if (!(Test-Path -LiteralPath $Apk)) { throw "APK not found: $Apk" }
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        $booted = & $adb -s $serial shell getprop sys.boot_completed 2>$null
        if ($booted -eq '1') { break }
        Start-Sleep -Milliseconds 500
    }
    if ($booted -ne '1') { throw 'Emulator has not finished booting; retry installation when it is ready.' }
    & $adb -s $serial install -r $Apk
    if ($LASTEXITCODE -ne 0) { throw 'Emulator APK installation failed' }
    & $adb -s $serial shell am start -n com.genzo.android/.MainActivity
}
Write-Output "$avd ($serial) — AVD data: $env:ANDROID_AVD_HOME"
