#Requires -Version 5.1

[CmdletBinding()]
param(
    [ValidatePattern('^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})$')]
    [string] $Version = '1.0.0.0',
    [switch] $NoRestore,
    [switch] $Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$packagingRoot = Split-Path -Parent $PSCommandPath
$desktopRoot = Split-Path -Parent $packagingRoot
$repositoryRoot = Split-Path -Parent $desktopRoot
$artifactsRoot = Join-Path $packagingRoot 'artifacts'
$workParent = Join-Path $packagingRoot '.work'
$artifactBase = "Nyx-Desktop-$Version-development-win-x64"
$artifactPath = Join-Path $artifactsRoot "$artifactBase.zip"
$manifestArtifactPath = Join-Path $artifactsRoot "$artifactBase.release.json"
$hashPath = "$artifactPath.sha256"
$fixedTimestamp = [DateTimeOffset]::Parse('2026-07-17T00:00:00Z')

function Test-ReparsePoint {
    param([Parameter(Mandatory)] [IO.FileSystemInfo] $Item)
    return ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
}

function Assert-SafePackagingRoot {
    $resolved = (Get-Item -LiteralPath $packagingRoot -Force).FullName.TrimEnd('\')
    if ($resolved -notmatch '^[A-Za-z]:\\' -or (Test-ReparsePoint (Get-Item -LiteralPath $resolved -Force))) {
        throw 'The packaging root must be a normal local-drive directory.'
    }
}

function Remove-GeneratedDirectory {
    param([Parameter(Mandatory)] [string] $LiteralPath)

    $parent = [IO.Path]::GetFullPath($workParent).TrimEnd('\') + '\'
    $target = [IO.Path]::GetFullPath($LiteralPath).TrimEnd('\')
    if (-not $target.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $target -PathType Container)) {
        throw 'Refusing to remove a path outside the packaging work directory.'
    }

    $item = Get-Item -LiteralPath $target -Force
    if (Test-ReparsePoint $item) {
        throw 'Refusing to remove a reparse-backed work directory.'
    }

    Remove-Item -LiteralPath $target -Recurse -Force
}

function Install-GeneratedFile {
    param(
        [Parameter(Mandatory)] [string] $Source,
        [Parameter(Mandatory)] [string] $Destination
    )

    $artifactPrefix = [IO.Path]::GetFullPath($artifactsRoot).TrimEnd('\') + '\'
    $destinationPath = [IO.Path]::GetFullPath($Destination)
    $workPrefix = [IO.Path]::GetFullPath($workRoot).TrimEnd('\') + '\'
    $sourcePath = [IO.Path]::GetFullPath($Source)
    if (-not $destinationPath.StartsWith($artifactPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        -not $sourcePath.StartsWith($workPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to replace a file outside generated packaging paths.'
    }

    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
        $backup = Join-Path $workRoot ('.previous-' + [guid]::NewGuid().ToString('N'))
        [IO.File]::Replace($Source, $Destination, $backup, $true)
        Remove-Item -LiteralPath $backup -Force
    }
    else {
        [IO.File]::Move($Source, $Destination)
    }
}

function Get-RelativeArchivePath {
    param(
        [Parameter(Mandatory)] [string] $Root,
        [Parameter(Mandatory)] [string] $Path
    )

    $rootUri = [Uri]::new(([IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'))
    $pathUri = [Uri]::new([IO.Path]::GetFullPath($Path))
    return [Uri]::UnescapeDataString($rootUri.MakeRelativeUri($pathUri).ToString())
}

function Get-PayloadFiles {
    param([Parameter(Mandatory)] [string] $Root)

    $files = @(Get-ChildItem -LiteralPath $Root -File -Recurse -Force |
        Where-Object { $_.Extension -ne '.pdb' } |
        ForEach-Object {
            if (Test-ReparsePoint $_) {
                throw 'A package input is a reparse point.'
            }
            [pscustomobject]@{
                Item = $_
                Relative = Get-RelativeArchivePath -Root $Root -Path $_.FullName
            }
        })
    $comparison = [Comparison[object]] {
        param($left, $right)
        return [StringComparer]::Ordinal.Compare([string]$left.Relative, [string]$right.Relative)
    }
    [Array]::Sort($files, $comparison)
    return $files
}

function New-DeterministicZip {
    param(
        [Parameter(Mandatory)] [string] $SourceRoot,
        [Parameter(Mandatory)] [string] $Destination,
        [switch] $ExcludePdb
    )

    Add-Type -AssemblyName System.IO.Compression
    $files = if ($ExcludePdb) { Get-PayloadFiles -Root $SourceRoot } else {
        $archiveFiles = @(Get-ChildItem -LiteralPath $SourceRoot -File -Recurse -Force |
            ForEach-Object {
                if (Test-ReparsePoint $_) { throw 'A package input is a reparse point.' }
                [pscustomobject]@{
                    Item = $_
                    Relative = Get-RelativeArchivePath -Root $SourceRoot -Path $_.FullName
                }
            })
        $comparison = [Comparison[object]] {
            param($left, $right)
            return [StringComparer]::Ordinal.Compare([string]$left.Relative, [string]$right.Relative)
        }
        [Array]::Sort($archiveFiles, $comparison)
        $archiveFiles
    }

    $stream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
        try {
            foreach ($file in $files) {
                $entry = $archive.CreateEntry($file.Relative, [IO.Compression.CompressionLevel]::Optimal)
                $entry.LastWriteTime = $fixedTimestamp
                $input = [IO.File]::OpenRead($file.Item.FullName)
                $output = $entry.Open()
                try { $input.CopyTo($output) }
                finally { $output.Dispose(); $input.Dispose() }
            }
        }
        finally { $archive.Dispose() }
    }
    finally { $stream.Dispose() }
}

Assert-SafePackagingRoot
foreach ($part in $Version.Split('.')) {
    if ([int]$part -gt 65535) { throw 'Each version component must be between 0 and 65535.' }
}

[void] (New-Item -ItemType Directory -Path $artifactsRoot -Force)
[void] (New-Item -ItemType Directory -Path $workParent -Force)
if ((Test-Path -LiteralPath $artifactPath) -and -not $Force) {
    throw 'The output artifact already exists. Use -Force only to replace generated packaging output.'
}

$workRoot = Join-Path $workParent ([guid]::NewGuid().ToString('N'))
$publishRoot = Join-Path $workRoot 'app'
$toolRoot = Join-Path $workRoot 'tool'
$helperBuildRoot = Join-Path $workRoot 'achievement-helper-target'
$bundleRoot = Join-Path $workRoot 'bundle'
$payloadRoot = Join-Path $bundleRoot 'payload'
$temporaryArtifactPath = Join-Path $workRoot "$artifactBase.zip"
$temporaryManifestPath = Join-Path $workRoot "$artifactBase.release.json"
$temporaryHashPath = Join-Path $workRoot "$artifactBase.zip.sha256"
[void] (New-Item -ItemType Directory -Path $publishRoot, $toolRoot, $payloadRoot -Force)

try {
    $cargo = (Get-Command cargo -ErrorAction Stop).Source
    $python = (Get-Command python -ErrorAction Stop).Source
    $helperRoot = Join-Path $repositoryRoot 'Extractor\Achievements'
    $previousCargoTarget = $env:CARGO_TARGET_DIR
    $previousRustFlags = $env:RUSTFLAGS
    try {
        $env:CARGO_TARGET_DIR = $helperBuildRoot
        $env:RUSTFLAGS = "-C target-feature=+crt-static --remap-path-prefix=$helperBuildRoot=C:\_build\achievement-helper --remap-path-prefix=$repositoryRoot=C:\_src\Nyx"
        Push-Location -LiteralPath $helperRoot
        try {
            & $cargo build --locked --release --target x86_64-pc-windows-msvc --bin pengo-achievements-launcher
            if ($LASTEXITCODE -ne 0) { throw 'Achievement launcher helper build failed.' }
        }
        finally { Pop-Location }
    }
    finally {
        $env:CARGO_TARGET_DIR = $previousCargoTarget
        $env:RUSTFLAGS = $previousRustFlags
    }
    $builtHelper = Join-Path $helperBuildRoot 'x86_64-pc-windows-msvc\release\pengo-achievements-launcher.exe'
    if (-not (Test-Path -LiteralPath $builtHelper -PathType Leaf)) {
        throw 'The reviewed achievement launcher helper artifact is missing.'
    }
    & $python (Join-Path $repositoryRoot 'Extractor\Achievements\tools\verify_release.py') $builtHelper
    if ($LASTEXITCODE -ne 0) { throw 'Achievement launcher helper verification failed.' }
    $helperSha256 = (Get-FileHash -LiteralPath $builtHelper -Algorithm SHA256).Hash.ToLowerInvariant()

    $dotnet = (Get-Command dotnet -ErrorAction Stop).Source
    $restoreArgument = if ($NoRestore) { @('--no-restore') } else { @() }
    $appProject = Join-Path $desktopRoot 'src\Nyx.Desktop.App\Nyx.Desktop.App.csproj'
    $appArguments = @(
        'publish', $appProject,
        '-c', 'Release',
        '-r', 'win-x64',
        '-p:Platform=x64',
        '-p:WindowsPackageType=None',
        '-p:WindowsAppSDKSelfContained=true',
        '-p:SelfContained=true',
        '-p:PublishTrimmed=false',
        '-p:PublishReadyToRun=false',
        '-p:DebugType=None',
        '-p:DebugSymbols=false',
        '-p:Deterministic=true',
        '-p:ContinuousIntegrationBuild=true',
        "-p:PathMap=$repositoryRoot=C:\_src\Nyx",
        "-p:Version=$Version",
        "-p:AchievementHelperSource=$builtHelper",
        "-p:AchievementHelperSha256=$helperSha256",
        "-p:PublishDir=$publishRoot\"
    ) + $restoreArgument
    & $dotnet @appArguments
    if ($LASTEXITCODE -ne 0) { throw 'Nyx app publish failed.' }

    $toolProject = Join-Path $desktopRoot 'tools\Nyx.Desktop.Update\Nyx.Desktop.Update.csproj'
    $toolArguments = @(
        'publish', $toolProject,
        '-c', 'Release',
        '-r', 'win-x64',
        '--self-contained', 'true',
        '-p:PublishSingleFile=true',
        '-p:PublishTrimmed=false',
        '-p:DebugType=None',
        '-p:DebugSymbols=false',
        '-p:Deterministic=true',
        '-p:ContinuousIntegrationBuild=true',
        "-p:PathMap=$repositoryRoot=C:\_src\Nyx",
        "-p:Version=$Version",
        '-o', $toolRoot
    ) + $restoreArgument
    & $dotnet @toolArguments
    if ($LASTEXITCODE -ne 0) { throw 'Nyx updater publish failed.' }

    $entryPoint = Join-Path $publishRoot 'Nyx.Desktop.App.exe'
    $helper = Join-Path $publishRoot 'Assets\Tools\pengo-achievements-launcher.exe'
    $updater = Join-Path $toolRoot 'Nyx.Desktop.Update.exe'
    foreach ($required in @($entryPoint, $helper, $updater)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw 'A required distribution executable is missing.'
        }
    }

    $payloadFile = "Nyx-Desktop-$Version-win-x64.zip"
    $payloadPath = Join-Path $payloadRoot $payloadFile
    New-DeterministicZip -SourceRoot $publishRoot -Destination $payloadPath -ExcludePdb

    $fileEntries = @()
    foreach ($file in (Get-PayloadFiles -Root $publishRoot)) {
        $fileEntries += [ordered]@{
            path = $file.Relative
            size = [long]$file.Item.Length
            sha256 = (Get-FileHash -LiteralPath $file.Item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }

    $payloadInfo = Get-Item -LiteralPath $payloadPath
    $release = [ordered]@{
        schemaVersion = 1
        product = 'nyx-desktop'
        channel = 'development'
        version = $Version
        architecture = 'win-x64'
        packageFile = $payloadFile
        packageSize = [long]$payloadInfo.Length
        packageSha256 = (Get-FileHash -LiteralPath $payloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
        entryPoint = 'Nyx.Desktop.App.exe'
        packageUrl = $null
        files = $fileEntries
    }
    $releaseJson = $release | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText((Join-Path $bundleRoot 'release.json'), $releaseJson + "`n", [Text.UTF8Encoding]::new($false))
    & $updater verify --manifest (Join-Path $bundleRoot 'release.json') --package $payloadPath
    if ($LASTEXITCODE -ne 0) { throw 'Generated payload verification failed.' }
    Copy-Item -LiteralPath (Join-Path $packagingRoot 'scripts\Install-Nyx.ps1') -Destination $bundleRoot
    Copy-Item -LiteralPath (Join-Path $packagingRoot 'scripts\Uninstall-Nyx.ps1') -Destination $bundleRoot
    Copy-Item -LiteralPath (Join-Path $packagingRoot 'first-run-defaults.json') -Destination $bundleRoot
    Copy-Item -LiteralPath $updater -Destination $bundleRoot
    $notes = [IO.File]::ReadAllText((Join-Path $packagingRoot 'release-notes.md')).Replace('{{VERSION}}', $Version)
    [IO.File]::WriteAllText((Join-Path $bundleRoot 'release-notes.md'), $notes, [Text.UTF8Encoding]::new($false))

    New-DeterministicZip -SourceRoot $bundleRoot -Destination $temporaryArtifactPath
    [IO.File]::WriteAllText($temporaryManifestPath, $releaseJson + "`n", [Text.UTF8Encoding]::new($false))
    $artifactHash = (Get-FileHash -LiteralPath $temporaryArtifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($temporaryHashPath, "$artifactHash  $artifactBase.zip`n", [Text.UTF8Encoding]::new($false))
    $artifactBytes = (Get-Item -LiteralPath $temporaryArtifactPath).Length
    Install-GeneratedFile -Source $temporaryArtifactPath -Destination $artifactPath
    Install-GeneratedFile -Source $temporaryManifestPath -Destination $manifestArtifactPath
    Install-GeneratedFile -Source $temporaryHashPath -Destination $hashPath

    Write-Output "NYX_PACKAGE=CREATED"
    Write-Output "VERSION=$Version"
    Write-Output "ARTIFACT=$artifactPath"
    Write-Output "BYTES=$artifactBytes"
    Write-Output "SHA256=$artifactHash"
}
finally {
    if (Test-Path -LiteralPath $workRoot -PathType Container) {
        Remove-GeneratedDirectory -LiteralPath $workRoot
    }
}
