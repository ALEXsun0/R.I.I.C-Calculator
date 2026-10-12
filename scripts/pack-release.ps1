param(
    [string]$OutputDir = '',
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'tools-sync-core.psm1') -Force -DisableNameChecking
$repositoryRoot = Get-ToolsSyncAbsolutePath ([IO.Directory]::GetParent($PSScriptRoot).FullName)
$artifactsRoot = Join-Path $repositoryRoot 'artifacts'
$releaseRoot = Assert-ToolsSyncWithinRoot (Join-Path $repositoryRoot 'release') $repositoryRoot
$releaseDirectory = Assert-ToolsSyncWithinRoot (Join-Path $releaseRoot 'R.I.I.C-Calculator') $releaseRoot
Assert-ToolsSyncNoReparse $repositoryRoot
Assert-ToolsSyncNoReparse $releaseDirectory
if (-not $OutputDir) { $OutputDir = $artifactsRoot }
if (-not [IO.Path]::IsPathRooted($OutputDir)) { $OutputDir = Join-Path $repositoryRoot $OutputDir }
$resolvedOutputDir = Get-ToolsSyncAbsolutePath $OutputDir
Assert-ToolsSyncNoReparse $resolvedOutputDir
if ($resolvedOutputDir.Equals($releaseDirectory, [StringComparison]::OrdinalIgnoreCase) -or $resolvedOutputDir.StartsWith($releaseDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'ZIP output must be outside the package source directory.' }
$runName = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$reportDirectory = Assert-ToolsSyncWithinRoot (Join-Path $artifactsRoot ('pack-release/' + $runName)) $artifactsRoot
$frontendDirectory = Assert-ToolsSyncWithinRoot (Join-Path $reportDirectory 'frontend') $reportDirectory
$previousReleaseDirectory = Assert-ToolsSyncWithinRoot (Join-Path $reportDirectory 'previous-release') $reportDirectory
Assert-ToolsSyncNoReparse $reportDirectory
$previousFiles = @(if (Test-Path -LiteralPath $releaseDirectory) { Get-ToolsSyncInventory $releaseDirectory })
$isCI = $env:GITHUB_ACTIONS -eq 'true' -or $env:CI -match '^(1|true|yes)$'
$zipName = 'R.I.I.C-Calculator-Windows-x64-Portable.zip'
$zipPath = Assert-ToolsSyncWithinRoot (Join-Path $resolvedOutputDir $zipName) $resolvedOutputDir
$sumsPath = Assert-ToolsSyncWithinRoot (Join-Path $resolvedOutputDir 'SHA256SUMS.txt') $resolvedOutputDir
foreach ($path in @($zipPath, $sumsPath)) {
    Assert-ToolsSyncNoReparse $path
    if (Test-Path -LiteralPath $path -PathType Container) { throw "Package output file is an existing directory: $path" }
}
$syncScript = Join-Path $PSScriptRoot 'sync-tools.ps1'
$packageDist = Assert-ToolsSyncWithinRoot (Join-Path $releaseDirectory 'dist') $releaseDirectory
$plan = [ordered]@{
    RepositoryRoot = $repositoryRoot; PackageDirectory = $releaseDirectory; OutputDirectory = $resolvedOutputDir;
    ReportDirectory = $reportDirectory; PreviousPackageBackup = $previousReleaseDirectory; PreviousPackageFiles = $previousFiles.Count;
    IsCI = [bool]$isCI; LocalInstallSync = -not $isCI; SyncScript = $syncScript;
    SyncSourceDist = $packageDist; SyncDesktopPublish = $releaseDirectory;
    ForcedProcessClosure = $false; InstallTarget = 'D:\Tools\R.I.I.C-Calculator'
}
if ($ValidateOnly) {
    $plan | ConvertTo-Json -Depth 5
    return
}

function Invoke-CheckedCommand {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE`: $Executable $($Arguments -join ' ')" }
}

function Copy-ReleaseFile {
    param([string]$Source, [string]$Destination, [string]$DestinationRoot, [long]$Size, [string]$Sha256)
    $destinationPath = Assert-ToolsSyncWithinRoot $Destination $DestinationRoot
    Assert-ToolsSyncNoReparse $Source
    Assert-ToolsSyncNoReparse $destinationPath
    [IO.Directory]::CreateDirectory([IO.Directory]::GetParent($destinationPath).FullName) | Out-Null
    Copy-Item -LiteralPath $Source -Destination $destinationPath -Force
    if ((Get-Item -LiteralPath $destinationPath).Length -ne $Size -or (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha256) { throw "Package file hash mismatch: $destinationPath" }
}

Push-Location -LiteralPath $repositoryRoot
try {
    [IO.Directory]::CreateDirectory($reportDirectory) | Out-Null
    Write-ToolsSyncJson (Join-Path $reportDirectory 'pack-plan.json') $plan
    Write-Host '>>> [1/5] Building frontend with project-local tools...'
    $node = (Get-Command node -ErrorAction Stop).Source
    $dotnet = (Get-Command dotnet -ErrorAction Stop).Source
    Invoke-CheckedCommand $node @((Join-Path $repositoryRoot 'node_modules/vue-tsc/bin/vue-tsc.js'), '-b')
    $oldBase = $env:BASE_URL
    try {
        $env:BASE_URL = '/'
        Invoke-CheckedCommand $node @((Join-Path $repositoryRoot 'node_modules/vite/bin/vite.js'), 'build', '--outDir', $frontendDirectory)
    } finally { $env:BASE_URL = $oldBase }

    Write-Host '>>> [2/5] Publishing Windows desktop wrapper...'
    if (Test-Path -LiteralPath $releaseDirectory) {
        foreach ($process in @(Get-Process 'R.I.I.C-Calculator', 'ArcIncCalc' -ErrorAction SilentlyContinue)) {
            $processPath = $null
            try { $processPath = $process.Path } catch { }
            if (-not $processPath -or $processPath.StartsWith($releaseDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'The previous package application is running. Close it normally before replacing its staging directory.' }
        }
        # Preserve the previous package instead of recursively deleting it.
        $verifiedRelease = Assert-ToolsSyncWithinRoot $releaseDirectory $releaseRoot
        [void](Assert-ToolsSyncWithinRoot $verifiedRelease $repositoryRoot)
        Assert-ToolsSyncNoReparse $verifiedRelease
        $current = @(Get-ToolsSyncInventory $verifiedRelease)
        if (($current | ConvertTo-Json -Depth 5 -Compress) -ne ($previousFiles | ConvertTo-Json -Depth 5 -Compress)) { throw 'Previous package changed during the frontend build; inspect it before packing again.' }
        $verifiedBackup = Assert-ToolsSyncWithinRoot $previousReleaseDirectory $reportDirectory
        Assert-ToolsSyncNoReparse $verifiedBackup
        Move-Item -LiteralPath $verifiedRelease -Destination $verifiedBackup
        $backupFiles = @(Get-ToolsSyncInventory $verifiedBackup)
        if (($backupFiles | ConvertTo-Json -Depth 5 -Compress) -ne ($previousFiles | ConvertTo-Json -Depth 5 -Compress)) { throw 'Previous package backup hash verification failed.' }
        Write-ToolsSyncJson (Join-Path $reportDirectory 'previous-package-manifest.json') @{ Files = $backupFiles }
    }
    Invoke-CheckedCommand $dotnet @(
        'publish', (Join-Path $repositoryRoot 'desktop/R.I.I.C-Calculator.Desktop.csproj'),
        '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
        '-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true',
        '-p:EnableCompressionInSingleFile=true', '-o', $releaseDirectory
    )

    Write-Host '>>> [3/5] Copying verified frontend and instructions...'
    foreach ($entry in @(Get-ToolsSyncInventory $frontendDirectory)) { Copy-ReleaseFile (Join-Path $frontendDirectory $entry.Path) (Join-Path $packageDist $entry.Path) $releaseDirectory $entry.Size $entry.Sha256 }
    $readme = Join-Path $repositoryRoot 'desktop/README.txt'
    Copy-ReleaseFile $readme (Join-Path $releaseDirectory 'README.txt') $releaseDirectory (Get-Item -LiteralPath $readme).Length (Get-FileHash -LiteralPath $readme -Algorithm SHA256).Hash.ToLowerInvariant()
    foreach ($file in @(Get-ChildItem -LiteralPath $releaseDirectory -File | Where-Object { $_.Extension -in @('.pdb', '.xml') })) {
        $managedDebugFile = Assert-ToolsSyncWithinRoot $file.FullName $releaseDirectory
        Assert-ToolsSyncNoReparse $managedDebugFile
        Remove-Item -LiteralPath $managedDebugFile -Force
    }
    # This also validates all local index.html references and the native whitelist.
    $payload = @(New-ToolsSyncPayload $packageDist $releaseDirectory)
    $packageFiles = @(Get-ToolsSyncInventory $releaseDirectory)
    Write-ToolsSyncJson (Join-Path $reportDirectory 'package-manifest.json') @{ Files = $packageFiles; InstallFiles = $payload }

    Write-Host '>>> [4/5] Creating and validating portable ZIP...'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $draftZip = Assert-ToolsSyncWithinRoot (Join-Path $reportDirectory $zipName) $reportDirectory
    [IO.Compression.ZipFile]::CreateFromDirectory($releaseDirectory, $draftZip, [IO.Compression.CompressionLevel]::Optimal, $true, [Text.UTF8Encoding]::new($false))
    $archive = [IO.Compression.ZipFile]::OpenRead($draftZip)
    try {
        $duplicates = @($archive.Entries | Group-Object FullName | Where-Object Count -gt 1)
        $archiveFiles = @($archive.Entries | Where-Object { -not $_.FullName.EndsWith('/') })
        if ($duplicates.Count -gt 0 -or $archiveFiles.Count -ne $packageFiles.Count) { throw 'ZIP entry count or unique paths do not match the package.' }
        foreach ($entry in $packageFiles) {
            $archived = $archive.GetEntry('R.I.I.C-Calculator/' + $entry.Path)
            if ($null -eq $archived -or $archived.Length -ne $entry.Size) { throw "ZIP lost or resized a package file: $($entry.Path)" }
            $stream = $archived.Open()
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $entryHash = -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) } finally { $stream.Dispose(); $sha.Dispose() }
            if ($entryHash -ne $entry.Sha256) { throw "ZIP entry hash mismatch: $($entry.Path)" }
        }
    } finally { $archive.Dispose() }
    $zipHash = (Get-FileHash -LiteralPath $draftZip -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.Directory]::CreateDirectory($resolvedOutputDir) | Out-Null
    foreach ($path in @($zipPath, $sumsPath)) {
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            $prior = Get-Item -LiteralPath $path
            Copy-ReleaseFile $path (Join-Path $reportDirectory ('previous-output/' + $prior.Name)) $reportDirectory $prior.Length (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    Copy-ReleaseFile $draftZip $zipPath $resolvedOutputDir (Get-Item -LiteralPath $draftZip).Length $zipHash
    Assert-ToolsSyncNoReparse $sumsPath
    [IO.File]::WriteAllText($sumsPath, "$zipHash  $zipName" + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    Write-ToolsSyncJson (Join-Path $reportDirectory 'package-result.json') @{ Status = 'verified'; ZipPath = $zipPath; Sha256 = $zipHash; FileCount = $packageFiles.Count; PreviousPackageBackup = $previousReleaseDirectory; IsCI = [bool]$isCI; ApplicationStartupTested = $false }

    Write-Host '>>> [5/5] Delivering package...'
    if (-not $isCI) {
        # The same installer backs up, preserves user files and verifies hashes.
        & $syncScript -SourceDist $packageDist -DesktopPublish $releaseDirectory
    }
    Write-Host "Verified ZIP: $zipPath"
    Write-Host "SHA-256: $zipHash"
    Write-Host "Package backup and verification: $reportDirectory"
} finally { Pop-Location }
