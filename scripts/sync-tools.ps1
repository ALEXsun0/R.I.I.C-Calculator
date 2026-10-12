param(
    [string]$SourceDist = '',
    [string]$DesktopPublish = '',
    [switch]$PublishDesktop,
    [switch]$ValidateOnly,
    [string]$ReportDirectory = '',
    [string]$SourceCommit = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'tools-sync-core.psm1') -Force -DisableNameChecking

$repositoryRoot = Get-ToolsSyncAbsolutePath ([IO.Directory]::GetParent($PSScriptRoot).FullName)
$targetDirectory = Get-ToolsSyncAbsolutePath 'D:\Tools\R.I.I.C-Calculator'
$artifactsRoot = Join-Path $repositoryRoot 'artifacts'
if (-not $ReportDirectory) {
    $reportName = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $ReportDirectory = Join-Path $artifactsRoot ('install-sync/' + $reportName)
}
$ReportDirectory = Assert-ToolsSyncWithinRoot (Get-ToolsSyncAbsolutePath $ReportDirectory) $artifactsRoot
Assert-ToolsSyncNoReparse $targetDirectory
Assert-ToolsSyncNoReparse $ReportDirectory
if ($PublishDesktop -and $DesktopPublish) { throw 'Use either -PublishDesktop or -DesktopPublish, not both.' }

function Assert-InstallationNotRunning {
    foreach ($process in @(Get-Process 'R.I.I.C-Calculator', 'ArcIncCalc' -ErrorAction SilentlyContinue)) {
        $processPath = $null
        try { $processPath = $process.Path } catch { }
        if (-not $processPath -or $processPath.StartsWith($targetDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw "The installed application is running (PID $($process.Id)). Close it normally, then run sync again; this tool does not force-close it."
        }
    }
}

function Invoke-CheckedCommand {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE`: $Executable $($Arguments -join ' ')" }
}

Assert-InstallationNotRunning
[IO.Directory]::CreateDirectory($ReportDirectory) | Out-Null
Push-Location -LiteralPath $repositoryRoot
try {
    if (-not $SourceCommit) {
        $SourceCommit = (& git rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Could not read the source Git commit.' }
    }
    if ($SourceCommit -notmatch '^[0-9a-fA-F]{40}$') { throw '-SourceCommit must be a full 40-character commit SHA.' }
    $package = [IO.File]::ReadAllText((Join-Path $repositoryRoot 'package.json')) | ConvertFrom-Json
    $sourceStatus = @(& git status --porcelain --untracked-files=no)
    if ($LASTEXITCODE -ne 0) { throw 'Could not read source Git status.' }
    if (-not $SourceDist) {
        $SourceDist = Join-Path $ReportDirectory 'build/dist'
        $nodeCommand = (Get-Command node -ErrorAction Stop).Source
        $typecheckTool = Join-Path $repositoryRoot 'node_modules/vue-tsc/bin/vue-tsc.js'
        $viteTool = Join-Path $repositoryRoot 'node_modules/vite/bin/vite.js'
        if (-not (Test-Path -LiteralPath $typecheckTool) -or -not (Test-Path -LiteralPath $viteTool)) { throw 'Install project dependencies before building, or pass -SourceDist for a verified build.' }
        Invoke-CheckedCommand $nodeCommand @($typecheckTool, '-b')
        $oldBase = $env:BASE_URL
        try {
            $env:BASE_URL = '/'
            Invoke-CheckedCommand $nodeCommand @($viteTool, 'build', '--outDir', $SourceDist)
        } finally { $env:BASE_URL = $oldBase }
    }
    $SourceDist = Get-ToolsSyncAbsolutePath $SourceDist
    if ($PublishDesktop) {
        $DesktopPublish = Join-Path $ReportDirectory 'build/desktop'
        Invoke-CheckedCommand (Get-Command dotnet -ErrorAction Stop).Source @(
            'publish', (Join-Path $repositoryRoot 'desktop/R.I.I.C-Calculator.Desktop.csproj'),
            '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
            '-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true',
            '-p:EnableCompressionInSingleFile=true', '-o', $DesktopPublish
        )
        Copy-Item -LiteralPath (Join-Path $repositoryRoot 'desktop/README.txt') -Destination (Join-Path $DesktopPublish 'README.txt')
    }
    if ($DesktopPublish) { $DesktopPublish = Get-ToolsSyncAbsolutePath $DesktopPublish }
    $payload = @(New-ToolsSyncPayload $SourceDist $DesktopPublish)
    $buildInfoPath = Join-Path $ReportDirectory 'BUILD-INFO.json'
    $buildInfo = [ordered]@{
        Version = $package.version; SourceCommit = $SourceCommit.ToLowerInvariant();
        SourceHadTrackedChanges = $sourceStatus.Count -gt 0; PreparedAt = [DateTime]::UtcNow.ToString('o');
        FrontendDirectory = $SourceDist; NativeWrapperUpdated = [bool]$DesktopPublish;
        FrontendFileCount = @($payload | Where-Object { $_.Path.StartsWith('dist/') }).Count;
        Evidence = 'Payload and installed SHA-256 validation; application startup is a separate check.'
    }
    Write-ToolsSyncJson $buildInfoPath $buildInfo
    $payload += [PSCustomObject]@{ Path = 'BUILD-INFO.json'; Source = $buildInfoPath; Size = (Get-Item -LiteralPath $buildInfoPath).Length; Sha256 = (Get-FileHash -LiteralPath $buildInfoPath -Algorithm SHA256).Hash.ToLowerInvariant() }
    $plan = New-ToolsSyncPlan $payload $targetDirectory $ReportDirectory
    Write-ToolsSyncJson (Join-Path $ReportDirectory 'sync-plan.json') $plan
    if ($ValidateOnly) {
        Write-Host "Validated $($payload.Count) managed files; no installation writes. Plan: $ReportDirectory\sync-plan.json"
    } else {
        Assert-InstallationNotRunning
        $result = Invoke-ToolsSyncUpdate $plan $SourceCommit $package.version
        Write-Host "Verified $($result.ManagedFileCount) installed files; preserved $($result.PreservedFileCount) pre-existing unmanaged files. Backup/report: $ReportDirectory"
    }
} finally { Pop-Location }
