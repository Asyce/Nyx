# ─────────────────────────────────────────────────────────────────
# Pengo Nyx - gacha-history URL grabber  (rev 7)
#
# Architecture follows the paimon.moe community script:
#   1. Find the install dir from the Unity output log (LocalLow path
#      is fixed, embeds the install path on every session bootstrap).
#   2. COPY the webview cache (data_2) to a temp file first — the
#      game keeps it under an exclusive lock so we can't read it in
#      place. robocopy /B (backup-read API, admin-only) then plain
#      Copy-Item.
#   3. Sweep the copy for any URL containing auth_appid=webview_gacha.
#      That tag is what the in-game gacha webview always carries, so
#      it's a tighter filter than "any URL with an authkey".
#   4. Validate each candidate against the live Hoyo API. The first
#      one that returns retcode 0 is the working URL.
#
# Output: working URL -> clipboard. Paste it into
# https://pengo.gg. The script doesn't send your data
# anywhere; the only network call is the validation hit against
# Hoyo's own endpoint.
# ─────────────────────────────────────────────────────────────────

param(
  [ValidateSet('gi','hsr','zzz','wuwa')]
  [string]$Game = 'gi',
  [string]$InstallDir = ''
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
# PS5 defaults to TLS 1.0; force 1.2 for the Hoyo validation call.
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072

function Say  { param([string]$m, [string]$c = 'DarkGray') Write-Host "   $m" -ForegroundColor $c }
function Step { param([string]$m) Write-Host ">> $m" -ForegroundColor Cyan }

$GameConfig = @{
  gi = @{
    Family            = 'hoyo'
    Name              = 'Genshin Impact'
    Label             = 'Wish History'
    LogPath           = "$env:USERPROFILE\AppData\LocalLow\miHoYo\Genshin Impact\output_log.txt"
    LocalLowName      = 'Genshin Impact'
    DataMarker        = 'GenshinImpact_Data'
    ValidateUrl       = 'https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog'
    # 200 = Wanderlust Invocation (standard) — every account has at
    # least one pull here (welkin / login rewards), so we can probe
    # without depending on the user having pulled on a featured banner.
    TestGachaType     = 200
    TestRealGachaType = $null
  }
  hsr = @{
    Family            = 'hoyo'
    Name              = 'Honkai: Star Rail'
    Label             = 'Warp History'
    LogPath           = "$env:USERPROFILE\AppData\LocalLow\Cognosphere\Star Rail\Player.log"
    LocalLowName      = 'Star Rail'
    DataMarker        = 'StarRail_Data'
    ValidateUrl       = 'https://public-operation-hkrpg-sg.hoyoverse.com/common/gacha_record/api/getGachaLog'
    # 1 = Stellar Warp (standard).
    TestGachaType     = 1
    TestRealGachaType = $null
  }
  zzz = @{
    Family            = 'hoyo'
    Name              = 'Zenless Zone Zero'
    Label             = 'Signal Search History'
    LogPath           = "$env:USERPROFILE\AppData\LocalLow\miHoYo\ZenlessZoneZero\Player.log"
    LocalLowName      = 'ZenlessZoneZero'
    DataMarker        = 'ZenlessZoneZero_Data'
    ValidateUrl       = 'https://public-operation-nap-sg.hoyoverse.com/common/gacha_record/api/getGachaLog'
    # 1 = Stable Channel (standard). ZZZ requires both gacha_type and
    # real_gacha_type on getGachaLog or the API responds -110 / -100.
    TestGachaType     = 1
    TestRealGachaType = 1
  }
  wuwa = @{
    Family    = 'kuro'
    Name      = 'Wuthering Waves'
    Label     = 'Convene History'
    # Wuwa is a UE4 game (Kuro Games); the convene-history URL is
    # written to the engine's own Client.log when the user opens the
    # in-game records popup. No webview cache to scrape.
    Processes = @('Client-Win64-Shipping.exe', 'Wuthering Waves.exe', 'launcher.exe')
    # Relative path under the install root.
    LogRel    = 'Wuthering Waves Game\Client\Saved\Logs\Client.log'
    # Common install locations to fall back on if the process scan misses.
    CommonRoots = @(
      'C:\Wuthering Waves',
      'D:\Wuthering Waves',
      'E:\Wuthering Waves',
      'D:\Gaming\Wuthering Waves',
      'D:\Program Files\Wuthering Waves',
      'D:\Games\Wuthering Waves'
    )
    # The convene-history index lives on Kuro's CDN; the URL hash
    # carries (svr_id, player_id, record_id, lang, resources_id) which
    # is all the importer needs.
    UrlPattern = 'https?://[^\x00\s"]+?aki-game[^\x00\s"]*?(?:#|%23)[^\x00\s"]*?record(?:%3F|\?)[^\x00\s"]*?(?:player_id|playerId)=[^\x00\s"]+'
  }
}

$cfg = $GameConfig[$Game]
Step "Looking for $($cfg.Name)..."

# Read a file that may be held open with an exclusive write handle.
function Read-Shared {
  param([string]$Path)
  try {
    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try { return (New-Object System.IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Dispose() }
  } catch { return $null }
}

# Map a candidate install root to a webCaches parent. Tries direct
# children, recurses if missed, then LocalLow as a last resort.
function Resolve-Webcache {
  param([string]$Root, [string]$LocalLowName)
  if ($Root -and (Test-Path $Root)) {
    if (Test-Path (Join-Path $Root 'webCaches')) { return $Root }
    foreach ($sub in @('Genshin Impact Game','Star Rail','ZenlessZoneZero','Games')) {
      $p = Join-Path $Root $sub
      if (Test-Path (Join-Path $p 'webCaches')) { return $p }
    }
    $hit = Get-ChildItem -LiteralPath $Root -Directory -Recurse -Depth 4 -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq 'webCaches' } | Select-Object -First 1
    if ($hit) { return $hit.Parent.FullName }
  }
  if ($LocalLowName) {
    foreach ($base in @(
      "$env:USERPROFILE\AppData\LocalLow\miHoYo\$LocalLowName",
      "$env:USERPROFILE\AppData\LocalLow\Cognosphere\$LocalLowName"
    )) {
      if (Test-Path (Join-Path $base 'webCaches')) { return $base }
    }
  }
  return $null
}

# Pick the newest <version>\Cache\Cache_Data\data_(2|1) under webCaches.
function Find-CacheDataFile {
  param([string]$WebcachesRoot)
  if (-not (Test-Path $WebcachesRoot)) { return $null }
  $versions = Get-ChildItem $WebcachesRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object { try { [version]$_.Name } catch { [version]'0.0.0.0' } } -Descending
  foreach ($v in $versions) {
    foreach ($n in @('data_2','data_1')) {
      $p = Join-Path $v.FullName "Cache\Cache_Data\$n"
      if (Test-Path $p) { return $p }
    }
  }
  return $null
}

# Source: locate the file we'll scrape URLs out of. Hoyo games use
# the webview cache (webCaches\<v>\Cache\Cache_Data\data_2); Wuwa
# uses the UE4 engine log (Client.log).
$sourceFile = $null

if ($cfg.Family -eq 'hoyo') {
  # ── Step 1 (Hoyo): install dir → webCaches → data_2 ──────────
  $installDir = $null
  if ($InstallDir) {
    Say "Tier A: -InstallDir override = $InstallDir"
    $installDir = Resolve-Webcache -Root $InstallDir -LocalLowName $cfg.LocalLowName
  }
  if (-not $installDir -and (Test-Path $cfg.LogPath)) {
    Step "Reading Unity log..."
    Say "Path: $($cfg.LogPath)"
    $log = Read-Shared $cfg.LogPath
    if ($log) {
      Say "Read $($log.Length) chars"
      $m = [regex]::Match($log, "([A-Za-z]:[\\/][^`"<>|\r\n]*?)[\\/]$($cfg.DataMarker)", 'IgnoreCase')
      if ($m.Success) {
        $candidate = $m.Groups[1].Value
        Say "Log mentions install dir: $candidate"
        $installDir = Resolve-Webcache -Root $candidate -LocalLowName $cfg.LocalLowName
      }
    }
  }
  if (-not $installDir) {
    Step "Scanning fixed drives..."
    $drives = Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | Where-Object { $_.Free -ne $null }
    foreach ($d in $drives) {
      try {
        $hit = Get-ChildItem -Path $d.Root -Directory -Recurse -Depth 5 -Force -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -eq $cfg.DataMarker } | Select-Object -First 1
      } catch { $hit = $null }
      if ($hit) {
        Say "Drive $($d.Root) hit: $($hit.FullName)"
        $installDir = Resolve-Webcache -Root (Split-Path $hit.FullName -Parent) -LocalLowName $cfg.LocalLowName
        if ($installDir) { break }
      }
    }
  }
  if (-not $installDir) {
    Write-Host ""
    Write-Host "Couldn't locate the $($cfg.Name) install." -ForegroundColor Red
    Write-Host "Open $($cfg.Label) in-game and try again, or pass the path:" -ForegroundColor Yellow
    Write-Host "  & ([scriptblock]::Create((irm 'https://pengo.gg/scripts/pengo-pulls.ps1'))) -Game $Game -InstallDir 'D:\Your\Game\Path'"
    exit 1
  }
  $sourceFile = Find-CacheDataFile (Join-Path $installDir 'webCaches')
  if (-not $sourceFile) {
    Write-Host "Found install at $installDir but no cache data file under webCaches." -ForegroundColor Red
    Write-Host "Open $($cfg.Label) in-game (wait for it to load), then re-run." -ForegroundColor Yellow
    exit 1
  }
  Say "Cache file: $sourceFile"
}
elseif ($cfg.Family -eq 'kuro') {
  # ── Step 1 (Wuwa): install dir → Client.log ──────────────────
  # The convene-history popup is a system browser tab, so there's no
  # webview cache to scrape. The UE4 engine log records every URL the
  # game opens (including the convene URL); that's what we mine.
  $installRoot = $null
  if ($InstallDir) {
    Say "Tier A: -InstallDir override = $InstallDir"
    if (Test-Path (Join-Path $InstallDir $cfg.LogRel)) { $installRoot = $InstallDir }
  }
  if (-not $installRoot) {
    Step "Asking WMI for the running process..."
    foreach ($p in $cfg.Processes) {
      try {
        $cim = Get-CimInstance -ClassName Win32_Process -Filter "Name='$p'" -ErrorAction Stop |
          Where-Object { $_.ExecutablePath -match 'Wuthering Waves' } | Select-Object -First 1
      } catch { $cim = $null }
      if ($cim -and $cim.ExecutablePath) {
        # Walk up from <install>\Wuthering Waves Game\Client\Binaries\Win64\Client-Win64-Shipping.exe
        $up = Split-Path $cim.ExecutablePath -Parent
        for ($i = 0; $i -lt 5; $i++) {
          $up = Split-Path $up -Parent
          if (-not $up) { break }
          if (Test-Path (Join-Path $up $cfg.LogRel)) { $installRoot = $up; break }
        }
        if ($installRoot) { Say "Install via WMI: $installRoot"; break }
      }
    }
  }
  if (-not $installRoot) {
    Step "Checking common install roots..."
    foreach ($candidate in $cfg.CommonRoots) {
      if (Test-Path (Join-Path $candidate $cfg.LogRel)) {
        $installRoot = $candidate
        Say "Install: $installRoot"
        break
      }
    }
  }
  if (-not $installRoot) {
    Step "Scanning fixed drives for Wuthering Waves..."
    $drives = Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | Where-Object { $_.Free -ne $null }
    foreach ($d in $drives) {
      try {
        $hit = Get-ChildItem -Path $d.Root -Directory -Recurse -Depth 5 -Force -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -eq 'Wuthering Waves Game' } | Select-Object -First 1
      } catch { $hit = $null }
      if ($hit) {
        $up = Split-Path $hit.FullName -Parent
        if (Test-Path (Join-Path $up $cfg.LogRel)) { $installRoot = $up; Say "Install via scan: $up"; break }
      }
    }
  }
  if (-not $installRoot) {
    Write-Host ""
    Write-Host "Couldn't locate the Wuthering Waves install." -ForegroundColor Red
    Write-Host "Open the in-game convene history at least once, then re-run." -ForegroundColor Yellow
    Write-Host "Or pass the path: -InstallDir 'D:\Wuthering Waves'"
    exit 1
  }
  $sourceFile = Join-Path $installRoot $cfg.LogRel
  Say "Log file: $sourceFile"
}
else {
  Write-Host "Unknown game family: $($cfg.Family)" -ForegroundColor Red
  exit 1
}

# ── Step 2: copy then read. The game keeps these files under an
# exclusive lock while it's running, so we copy to %TEMP% with
# robocopy /B (backup-read API, needs admin) and fall back to
# Copy-Item if that's not available.
Step "Copying source to temp..."
$srcDir   = Split-Path $sourceFile -Parent
$srcName  = Split-Path $sourceFile -Leaf
$tmpDir   = $env:TEMP
$copied   = Join-Path $tmpDir $srcName
if (Test-Path $copied) { Remove-Item -LiteralPath $copied -Force -ErrorAction SilentlyContinue }

& robocopy $srcDir $tmpDir $srcName /B /R:0 /W:0 /NJH /NJS /NC /NS /NDL /NFL /NP *> $null
if (Test-Path $copied) { Say "Copied via robocopy /B" }

if (-not (Test-Path $copied)) {
  try { Copy-Item -LiteralPath $sourceFile -Destination $copied -Force -ErrorAction Stop; Say "Copied via Copy-Item" } catch {}
}

if (-not (Test-Path $copied)) {
  Write-Host ""
  Write-Host "Couldn't copy $sourceFile. The game has it locked and we don't have backup-read privileges." -ForegroundColor Red
  Write-Host "Run this PowerShell session as Administrator and try again." -ForegroundColor Yellow
  exit 1
}

$bytes = [System.IO.File]::ReadAllBytes($copied)
Remove-Item -LiteralPath $copied -Force -ErrorAction SilentlyContinue
Say "Read $($bytes.Length) bytes"

# ── Step 3: extract candidate URLs ───────────────────────────────
Step "Extracting candidate URLs..."
$text = [System.Text.Encoding]::ASCII.GetString($bytes)

if ($cfg.Family -eq 'hoyo') {
  # paimon's filter — auth_appid=webview_gacha is the marker the
  # in-game gacha webview always carries.
  $pattern = 'https?://[^\x00\s"]+?auth_appid=webview_gacha[^\x00\s"]*?authkey=[^\x00\s"]+'
} else {
  $pattern = $cfg.UrlPattern
}
$rxMatches = [regex]::Matches($text, $pattern)
$candidates = @()
foreach ($m in $rxMatches) {
  $u = $m.Value -replace '[\x00-\x1f"<>]+.*$',''
  if ($u -notin $candidates) { $candidates += $u }
}
Say "Found $($candidates.Count) distinct candidate(s)"
if ($candidates.Count -eq 0) {
  Write-Host ""
  Write-Host "No $($cfg.Label) URL in the cache yet." -ForegroundColor Red
  Write-Host "Open $($cfg.Label) in-game and wait for the list to populate, then re-run." -ForegroundColor Yellow
  exit 1
}

# Step 4: validate each candidate. Newest entries are appended last,
# so walk backwards. Hoyo games probe getGachaLog over GET; Wuwa's
# endpoint is POST-with-JSON so we skip the validation hit and just
# take the most recent URL.
[Array]::Reverse($candidates)
$validUrl = $null
$lastError = ''

if ($cfg.Family -eq 'hoyo') {
  Step "Validating against the live Hoyo endpoint..."
  foreach ($candidate in $candidates) {
    $qIdx = $candidate.IndexOf('?')
    if ($qIdx -lt 0) { continue }
    $rawQuery = $candidate.Substring($qIdx + 1)
    # Drop any gacha-call-specific params; we set our own for the probe.
    $kept = @()
    foreach ($pair in $rawQuery.Split('&')) {
      $eq = $pair.IndexOf('=')
      if ($eq -le 0) { continue }
      $key = $pair.Substring(0, $eq)
      if ($key -in @('gacha_type','real_gacha_type','size','end_id','page')) { continue }
      $kept += $pair
    }
    $kept += "gacha_type=$($cfg.TestGachaType)"
    if ($cfg.TestRealGachaType) {
      # ZZZ-only quirk: getGachaLog requires real_gacha_type as well as
      # gacha_type, otherwise the API answers retcode -110 / -100.
      $kept += "real_gacha_type=$($cfg.TestRealGachaType)"
    }
    $kept += 'size=5'
    $kept += 'end_id=0'
    $testUrl = "$($cfg.ValidateUrl)?$(($kept -join '&'))"
    try {
      $resp = Invoke-RestMethod -Uri $testUrl -Method Get -TimeoutSec 12 -UseBasicParsing
      if ($resp.retcode -eq 0) {
        Say "Validated (retcode 0)" 'Green'
        $validUrl = $candidate
        break
      }
      $lastError = "retcode $($resp.retcode): $($resp.message)"
      Say "Rejected: $lastError"
    } catch {
      $lastError = $_.Exception.Message
      Say "Probe failed: $lastError"
    }
  }
}
else {
  # Wuwa: the convene endpoint is POST with a JSON body; building one
  # from PowerShell just to probe is overkill. Take the newest URL the
  # log mentions and let the website's importer surface any error.
  Say "Wuwa: skipping endpoint probe (POST endpoint); using newest URL." 'DarkGray'
  $validUrl = $candidates[0]
}

if (-not $validUrl) {
  Write-Host ""
  Write-Host "All extracted URLs failed validation. Last error: $lastError" -ForegroundColor Red
  Write-Host "Close $($cfg.Label) in-game, reopen it (let the list fully load), then re-run." -ForegroundColor Yellow
  exit 1
}

Set-Clipboard -Value $validUrl
Write-Host ""
Write-Host "OK - copied your $($cfg.Name) $($cfg.Label) URL to the clipboard." -ForegroundColor Green
Write-Host "Paste it into https://pengo.gg (the $($cfg.Name) tracker)."
Write-Host ""
Write-Host "Sanity check (first 80 chars):"
Write-Host $validUrl.Substring(0, [Math]::Min(80, $validUrl.Length)) -ForegroundColor DarkGray
