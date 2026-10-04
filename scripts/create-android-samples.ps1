param(
    [string]$Ffmpeg = 'D:\DevTools\Android\TestTools\python\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe',
    [string]$OutputDirectory = 'D:\DevTools\Android\Samples\GenzoPrototype'
)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $Ffmpeg)) { throw 'Provide an existing test-only FFmpeg with libx264 and libx265.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
function Encode-Sample([string[]]$Arguments) {
    & $Ffmpeg -hide_banner -loglevel error -y @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic sample generation failed.' }
}
# Generates only our test fixtures; no user video is an input.
Encode-Sample @('-f','lavfi','-i','testsrc2=size=640x360:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
    '-t','40','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',(Join-Path $OutputDirectory 'h264.mp4'))
Encode-Sample @('-f','lavfi','-i','testsrc2=size=640x360:rate=24','-f','lavfi','-i','sine=frequency=660:sample_rate=48000',
    '-t','40','-c:v','libx265','-pix_fmt','yuv420p','-c:a','aac',(Join-Path $OutputDirectory 'h265.mkv'))
@'
1
00:00:01,000 --> 00:00:35,000
GENZO SRT subtitle test
'@ | Set-Content -LiteralPath (Join-Path $OutputDirectory 'h264.srt') -Encoding utf8
@'
[Script Info]
ScriptType: v4.00+
PlayResX: 640
PlayResY: 360
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,26,&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,10,10,20,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:35.00,Default,,0,0,0,,GENZO ASS style test
Dialogue: 1,0:00:05.00,0:00:15.00,Default,,0,0,0,,{\move(40,80,500,80)\c&HFF00FF&}moving subtitle
'@ | Set-Content -LiteralPath (Join-Path $OutputDirectory 'h264.ass') -Encoding utf8
@'
[Script Info]
ScriptType: v4.00
PlayResX: 640
PlayResY: 360
[V4 Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding
Style: Default,DejaVu Sans,26,65535,255,0,0,-1,0,1,2,1,2,10,10,20,0,1
[Events]
Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: Marked=0,0:00:01.00,0:00:35.00,Default,,0,0,0,,GENZO SSA v4 subtitle test
'@ | Set-Content -LiteralPath (Join-Path $OutputDirectory 'h264.ssa') -Encoding utf8
Encode-Sample @('-i',(Join-Path $OutputDirectory 'h264.mp4'),'-f','lavfi','-i','sine=frequency=880:sample_rate=48000',
    '-i',(Join-Path $OutputDirectory 'h264.ass'),'-t','40','-map','0:v','-map','0:a','-map','1:a','-map','2:0',
    '-c:v','copy','-c:a','aac','-c:s','ass','-metadata:s:a:0','language=eng','-metadata:s:a:1','language=jpn',
    (Join-Path $OutputDirectory 'h264-tracks.mkv'))
Get-ChildItem -LiteralPath $OutputDirectory -File | Get-FileHash -Algorithm SHA256 |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'fixture-hashes.json') -Encoding utf8
Write-Output "Synthetic samples generated in $OutputDirectory. Push only this test directory when needed."
