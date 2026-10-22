param(
    [Parameter(Mandatory = $true)][string]$Version,
    [ValidateSet('stable','beta')][string]$Channel = 'beta',
    [string]$AppDirectory = 'publish/windows-app',
    [string]$HelperDirectory = 'publish/windows-helper',
    [string]$ReleaseDirectory = 'publish/windows-release',
    [string]$PackageBaseUrl = 'https://updates.lightworldtech.com/releases/ipresenterplux/windows/x64'
)

$ErrorActionPreference = 'Stop'
$AppDirectory = [IO.Path]::GetFullPath($AppDirectory)
$HelperDirectory = [IO.Path]::GetFullPath($HelperDirectory)
$ReleaseDirectory = [IO.Path]::GetFullPath($ReleaseDirectory)
$desktop = Join-Path $AppDirectory 'iPresenterPlux.Edge.Desktop.exe'
$runtime = Join-Path $AppDirectory 'runtime/iPresenterPlux.Edge.Windows.exe'
$helper = Join-Path $HelperDirectory 'Lightworld.Update.Helper.exe'
foreach ($required in @($desktop, $runtime, $helper)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required release input is missing: $required" }
}

if (Test-Path -LiteralPath $ReleaseDirectory) { Remove-Item -LiteralPath $ReleaseDirectory -Recurse -Force }
New-Item -ItemType Directory -Force -Path $ReleaseDirectory | Out-Null
$current = Join-Path $ReleaseDirectory 'current'
New-Item -ItemType Directory -Force -Path $current | Out-Null
Copy-Item -Path (Join-Path $AppDirectory '*') -Destination $current -Recurse -Force
Copy-Item -LiteralPath $helper -Destination (Join-Path $ReleaseDirectory 'Lightworld.Update.Helper.exe') -Force

$packageName = "iPresenterPlux-$Version-windows-x64.zip"
$packagePath = Join-Path $ReleaseDirectory $packageName
Compress-Archive -Path (Join-Path $AppDirectory '*') -DestinationPath $packagePath -CompressionLevel Optimal -Force
$hash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $packagePath).Length
"$hash  $packageName" | Set-Content -LiteralPath "$packagePath.sha256" -Encoding ascii

$manifest = [ordered]@{
    schemaVersion = 1
    product = 'ipresenterplux'
    version = $Version
    channel = $Channel
    platform = 'windows'
    architecture = 'x64'
    minimumVersion = $null
    publishedAt = [DateTimeOffset]::UtcNow.ToString('o')
    releaseNotes = ''
    fullPackage = [ordered]@{
        url = "$($PackageBaseUrl.TrimEnd('/'))/$Version/$packageName"
        size = $size
        sha256 = $hash
    }
    deltaPackages = @()
    rollout = 100
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $ReleaseDirectory 'manifest-template.json') -Encoding utf8
@(
    "product=ipresenterplux",
    "version=$Version",
    "channel=$Channel",
    "platform=windows",
    "architecture=x64"
) | Set-Content -LiteralPath (Join-Path $ReleaseDirectory 'VERSION.txt') -Encoding utf8
Write-Host "Windows release staged at $ReleaseDirectory"
Write-Host "Full update package SHA-256: $hash"
