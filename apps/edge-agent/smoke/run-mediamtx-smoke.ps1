$ErrorActionPreference = "Stop"

$version = "1.21.1"
$expectedSha256 = "faa97974861eb75a68b5aa326c78e7e7a6f670b5ef191bace78e715130381f23"
$archive = Join-Path $env:RUNNER_TEMP "mediamtx-$version-windows-amd64.zip"
$extract = Join-Path $env:RUNNER_TEMP "mediamtx-$version-windows-amd64"
$url = "https://github.com/bluenviron/mediamtx/releases/download/v$version/mediamtx_v${version}_windows_amd64.zip"

Invoke-WebRequest -Uri $url -OutFile $archive
$actualSha256 = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) {
    throw "MediaMTX checksum mismatch: $actualSha256"
}

if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
Expand-Archive -Path $archive -DestinationPath $extract
$server = Get-ChildItem -Path $extract -Recurse -File -Filter "mediamtx.exe" | Select-Object -First 1
if (-not $server) { throw "MediaMTX executable was not found in the pinned archive." }
$config = (Resolve-Path "smoke/mediamtx-smoke.yml").Path
$stdout = Join-Path $env:RUNNER_TEMP "mediamtx-smoke-windows.log"
$stderr = Join-Path $env:RUNNER_TEMP "mediamtx-smoke-windows.err"
$process = Start-Process -FilePath $server.FullName -ArgumentList @($config) -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr

try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($process.HasExited) { throw "MediaMTX exited before the API became ready." }
        try {
            $null = Invoke-RestMethod -Uri "http://127.0.0.1:9997/v3/info" -TimeoutSec 1
            $ready = $true
            break
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $ready) { throw "MediaMTX API did not become ready." }

    $publish = "publish/srt-smoke/windows"
    dotnet publish smoke/iPresenterPlux.Edge.SrtSmoke/iPresenterPlux.Edge.SrtSmoke.csproj -c Release -o $publish
    New-Item -ItemType Directory -Force -Path "$publish/libSrt" | Out-Null
    Copy-Item "publish/libsrt-stage/*" "$publish/libSrt/" -Recurse
    dotnet "$publish/iPresenterPlux.Edge.SrtSmoke.dll"
    if ($LASTEXITCODE -ne 0) { throw "SRT MediaMTX smoke executable failed." }
} finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        $process.WaitForExit(3000) | Out-Null
    }
    if (Test-Path $stdout) { Get-Content $stdout }
    if (Test-Path $stderr) { Get-Content $stderr }
}
