#Requires -Version 5.1

[CmdletBinding()]
param(
    [switch] $CheckOnly,
    [switch] $Restore
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ExitEnvironment = 10
$script:ExitSdk = 11
$script:ExitProject = 12
$script:ExitRunSupport = 13
$script:ExitRestore = 14
$script:ExitRegistration = 15
$script:ExitRun = 20

function Stop-NyxStart {
    param(
        [Parameter(Mandatory)] [int] $Code,
        [Parameter(Mandatory)] [string] $Message
    )

    Write-Host "Nyx is not ready to start: $Message" -ForegroundColor Red
    exit $Code
}

function Read-BoundedText {
    param(
        [Parameter(Mandatory)] [string] $LiteralPath,
        [Parameter(Mandatory)] [long] $MaximumBytes
    )

    $item = Get-Item -LiteralPath $LiteralPath -ErrorAction Stop
    if ($item.Length -gt $MaximumBytes) {
        throw 'The required project file is unexpectedly large.'
    }

    return [System.IO.File]::ReadAllText($item.FullName)
}

function Read-SafeXml {
    param([Parameter(Mandatory)] [string] $LiteralPath)

    $item = Get-Item -LiteralPath $LiteralPath -ErrorAction Stop
    if ($item.Length -gt 1048576) {
        throw 'The required project XML is unexpectedly large.'
    }

    $settings = [System.Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = $null
    try {
        $reader = [System.Xml.XmlReader]::Create($item.FullName, $settings)
        $document = [System.Xml.XmlDocument]::new()
        $document.XmlResolver = $null
        $document.Load($reader)
        return $document
    }
    finally {
        if ($null -ne $reader) {
            $reader.Dispose()
        }
    }
}

if ($CheckOnly -and $Restore) {
    Stop-NyxStart -Code $script:ExitRestore -Message 'Check-only never restores. Remove -Restore and try again.'
}

$desktopRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$globalJsonPath = Join-Path $desktopRoot 'global.json'
$projectPath = Join-Path $desktopRoot 'src\Nyx.Desktop.App\Nyx.Desktop.App.csproj'
$manifestPath = Join-Path $desktopRoot 'src\Nyx.Desktop.App\Package.appxmanifest'
$assetsPath = Join-Path $desktopRoot 'src\Nyx.Desktop.App\obj\project.assets.json'

if ($PSVersionTable.PSVersion.Major -ge 6 -and -not $IsWindows) {
    Stop-NyxStart -Code $script:ExitEnvironment -Message 'Nyx needs Windows 11.'
}

if ([Environment]::OSVersion.Version.Build -lt 22621) {
    Stop-NyxStart -Code $script:ExitEnvironment -Message 'Install Windows 11 version 22H2 or newer (build 22621+).'
}

if (-not [Environment]::Is64BitOperatingSystem -or
    [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) {
    Stop-NyxStart -Code $script:ExitEnvironment -Message 'Use 64-bit PowerShell on an x64 Windows PC.'
}

foreach ($requiredPath in @($globalJsonPath, $projectPath, $manifestPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        Stop-NyxStart -Code $script:ExitProject -Message 'The Desktop project is incomplete. Keep the scripts inside the Nyx repository.'
    }
}

try {
    $globalJson = Read-BoundedText -LiteralPath $globalJsonPath -MaximumBytes 65536 | ConvertFrom-Json
    $pinnedSdk = [string] $globalJson.sdk.version
}
catch {
    Stop-NyxStart -Code $script:ExitProject -Message 'Desktop\global.json is invalid.'
}

if ([string]::IsNullOrWhiteSpace($pinnedSdk) -or $pinnedSdk.Length -gt 32) {
    Stop-NyxStart -Code $script:ExitProject -Message 'Desktop\global.json does not contain a valid pinned SDK version.'
}

$dotnet = Get-Command 'dotnet.exe' -CommandType Application -ErrorAction SilentlyContinue
if ($null -eq $dotnet) {
    Stop-NyxStart -Code $script:ExitSdk -Message "Install the .NET SDK $pinnedSdk (x64), then run this check again."
}

$oldTelemetry = $env:DOTNET_CLI_TELEMETRY_OPTOUT
$oldFirstRun = $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE
$oldLogo = $env:DOTNET_NOLOGO
try {
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
    $env:DOTNET_NOLOGO = '1'
    $sdkLines = @(& $dotnet.Source --list-sdks 2>$null)
}
catch {
    Stop-NyxStart -Code $script:ExitSdk -Message "The .NET SDK could not be checked. Install SDK $pinnedSdk (x64)."
}
finally {
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = $oldTelemetry
    $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = $oldFirstRun
    $env:DOTNET_NOLOGO = $oldLogo
}

$hasPinnedSdk = $false
foreach ($sdkLine in $sdkLines) {
    if ($sdkLine -match ('^' + [Regex]::Escape($pinnedSdk) + '\s+\[')) {
        $hasPinnedSdk = $true
        break
    }
}

if (-not $hasPinnedSdk) {
    Stop-NyxStart -Code $script:ExitSdk -Message "Install the pinned .NET SDK $pinnedSdk (x64)."
}

try {
    $projectXml = Read-SafeXml -LiteralPath $projectPath
    $runPackage = @($projectXml.SelectNodes("/*[local-name()='Project']/*[local-name()='ItemGroup']/*[local-name()='PackageReference' and @Include='Microsoft.Windows.SDK.BuildTools.WinApp']"))
    $disabledRunSupport = @(
        @($projectXml.SelectNodes("/*[local-name()='Project']/*[local-name()='PropertyGroup']/*[local-name()='EnableWinAppRunSupport']")) |
            Where-Object { $_.InnerText.Trim().Equals('false', [StringComparison]::OrdinalIgnoreCase) }
    )
}
catch {
    Stop-NyxStart -Code $script:ExitProject -Message 'The Nyx app project XML is invalid.'
}

if ($runPackage.Count -ne 1 -or $disabledRunSupport.Count -gt 0) {
    Stop-NyxStart -Code $script:ExitRunSupport -Message 'Packaged-app run support is missing or disabled. Restore the reviewed project file.'
}

$developerMode = $false
try {
    $developerModeValue = Get-ItemPropertyValue -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -Name 'AllowDevelopmentWithoutDevLicense' -ErrorAction Stop
    $developerMode = $developerModeValue -eq 1
}
catch {
    $developerMode = $false
}

$isAdministrator = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

if ($isAdministrator) {
    Stop-NyxStart -Code $script:ExitRegistration -Message 'Close this administrator window, turn on Windows Developer Mode, and start Nyx normally.'
}

if (-not $developerMode) {
    Stop-NyxStart -Code $script:ExitRegistration -Message 'Turn on Windows Developer Mode. Nyx stays a normal-user app and will not ask to elevate itself.'
}

function Test-RunAssets {
    if (-not (Test-Path -LiteralPath $assetsPath -PathType Leaf)) {
        return $false
    }

    try {
        $assetsText = Read-BoundedText -LiteralPath $assetsPath -MaximumBytes 52428800
        $assets = $assetsText | ConvertFrom-Json
        return $null -ne $assets.libraries.'Microsoft.Windows.SDK.BuildTools.WinApp/0.4.0'
    }
    catch {
        return $false
    }
}

$assetsReady = Test-RunAssets
if (-not $assetsReady -and $Restore -and -not $CheckOnly) {
    Write-Host 'Run files are missing. Restoring the reviewed Nyx projects now...'
    Push-Location -LiteralPath $desktopRoot
    try {
        & $dotnet.Source restore 'Nyx.Desktop.slnx'
        if ($LASTEXITCODE -ne 0) {
            Stop-NyxStart -Code $script:ExitRestore -Message 'Restore failed. Check your connection and the .NET SDK, then retry.'
        }
    }
    finally {
        Pop-Location
    }
    $assetsReady = Test-RunAssets
}

if (-not $assetsReady) {
    Stop-NyxStart -Code $script:ExitRestore -Message 'Restore assets are missing. Run `dotnet restore Desktop\Nyx.Desktop.slnx`, or use -Restore for a real start.'
}

$runSupportArguments = @(
    'msbuild',
    $projectPath,
    '-t:WinAppRunSupportInfo',
    '-p:Configuration=Release',
    '-p:RuntimeIdentifier=win-x64',
    '-p:Platform=x64',
    '-nologo',
    '-v:minimal'
)
try {
    $runSupportOutput = @(& $dotnet.Source @runSupportArguments 2>&1)
    $runSupportExitCode = $LASTEXITCODE
}
catch {
    $runSupportOutput = @()
    $runSupportExitCode = 1
}

$activeRunSupport = @($runSupportOutput | Where-Object {
    ([string] $_).Trim().Equals('_WinAppRunSupportActive: true', [StringComparison]::OrdinalIgnoreCase)
})
if ($runSupportExitCode -ne 0 -or $activeRunSupport.Count -ne 1) {
    Stop-NyxStart -Code $script:ExitRunSupport -Message 'The packaged-app run check is inactive. Build the reviewed x64 project, then retry.'
}

if ($CheckOnly) {
    Write-Host "Nyx developer start is ready (Windows x64, SDK $pinnedSdk, packaged-app run support)." -ForegroundColor Green
    exit 0
}

Write-Host 'Starting Nyx as a normal-user packaged developer app...'
Push-Location -LiteralPath $desktopRoot
try {
    $runArguments = @(
        'run',
        '--project', 'src\Nyx.Desktop.App\Nyx.Desktop.App.csproj',
        '--configuration', 'Release',
        '--runtime', 'win-x64',
        '--property:Platform=x64',
        '--no-restore'
    )
    & $dotnet.Source @runArguments
    $runExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

if ($runExitCode -ne 0) {
    Stop-NyxStart -Code $script:ExitRun -Message 'Packaged developer start failed. Confirm Developer Mode is on, then run -CheckOnly.'
}

exit 0
