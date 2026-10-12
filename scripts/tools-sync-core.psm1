Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ToolsSyncAbsolutePath {
    param([Parameter(Mandatory)][string]$Path)
    if ($Path -notmatch '^[a-zA-Z]:[\\/]' -or $Path.StartsWith('\\')) { throw "Expected an absolute local path: $Path" }
    $fullPath = [IO.Path]::GetFullPath($Path)
    if ($fullPath.Equals([IO.Path]::GetPathRoot($fullPath), [StringComparison]::OrdinalIgnoreCase)) { return $fullPath }
    return $fullPath.TrimEnd([char[]]@('\', '/'))
}

function Assert-ToolsSyncWithinRoot {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Root, [switch]$AllowRoot)
    $fullPath = Get-ToolsSyncAbsolutePath $Path
    $fullRoot = Get-ToolsSyncAbsolutePath $Root
    $equal = $fullPath.Equals($fullRoot, [StringComparison]::OrdinalIgnoreCase)
    if (($equal -and -not $AllowRoot) -or (-not $equal -and -not $fullPath.StartsWith($fullRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase))) { throw "Path is outside the permitted root: $fullPath (root: $fullRoot)" }
    return $fullPath
}

function Assert-ToolsSyncNoReparse {
    param([Parameter(Mandatory)][string]$Path)
    $current = Get-ToolsSyncAbsolutePath $Path
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Links and reparse points are not allowed: $current" }
        }
        $parent = [IO.Directory]::GetParent($current)
        if ($null -eq $parent) { break }
        $current = $parent.FullName
    }
}

function Assert-ToolsSyncRelativePath {
    param([Parameter(Mandatory)][string]$Path)
    if ([IO.Path]::IsPathRooted($Path)) { throw "Expected a relative payload path: $Path" }
    $parts = $Path -split '[\\/]'
    foreach ($part in $parts) {
        if (-not $part -or $part -in @('.', '..') -or $part -match '[<>:"|?*\x00-\x1f]' -or $part -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)' -or $part.TrimEnd(' ', '.') -ne $part) { throw "Unsafe payload path: $Path" }
    }
    return $parts -join '/'
}

function Get-ToolsSyncInventory {
    param([Parameter(Mandatory)][string]$Root)
    $resolvedRoot = Get-ToolsSyncAbsolutePath $Root
    Assert-ToolsSyncNoReparse $resolvedRoot
    if (-not (Test-Path -LiteralPath $resolvedRoot -PathType Container)) { throw "Directory not found: $resolvedRoot" }
    $pending = [Collections.Generic.Queue[string]]::new()
    $pending.Enqueue($resolvedRoot)
    $files = [Collections.Generic.List[object]]::new()
    while ($pending.Count -gt 0) {
        foreach ($item in Get-ChildItem -LiteralPath $pending.Dequeue() -Force) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Links and reparse points are not allowed: $($item.FullName)" }
            if ($item.PSIsContainer) { $pending.Enqueue($item.FullName); continue }
            $relative = Assert-ToolsSyncRelativePath $item.FullName.Substring($resolvedRoot.Length + 1)
            $files.Add([PSCustomObject]@{ Path = $relative; Size = $item.Length; Sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant() })
        }
    }
    return @($files | Sort-Object Path)
}

function Write-ToolsSyncJson {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)]$Value)
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 20) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

function Test-ToolsSyncNativePath {
    param([Parameter(Mandatory)][string]$Path)
    $localizedReadme = -join ([char[]]@(0x4f7f, 0x7528, 0x8bf4, 0x660e))
    return $Path -in @('R.I.I.C-Calculator.exe', 'R.I.I.C-Calculator.dll', 'R.I.I.C-Calculator.deps.json', 'R.I.I.C-Calculator.runtimeconfig.json', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'Microsoft.Web.WebView2.Wpf.dll', 'WebView2Loader.dll', 'README.txt', ($localizedReadme + '.txt')) -or $Path -match '^runtimes/(win-x64|win-x86|win-arm64)/native/WebView2Loader\.dll$'
}

function New-ToolsSyncPayload {
    param([Parameter(Mandatory)][string]$SourceDist, [string]$DesktopPublish = '')
    $distRoot = Get-ToolsSyncAbsolutePath $SourceDist
    $distFiles = @(Get-ToolsSyncInventory $distRoot)
    if (-not ($distFiles | Where-Object Path -eq 'index.html')) { throw 'The frontend payload is missing index.html.' }
    $distPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $distFiles) { if (-not $distPaths.Add($entry.Path)) { throw "Duplicate frontend path: $($entry.Path)" } }
    $html = [IO.File]::ReadAllText((Join-Path $distRoot 'index.html'))
    foreach ($match in [regex]::Matches($html, '(?:src|href)\s*=\s*["'']([^"'']+)["'']')) {
        $url = [Uri]::new([Uri]'https://app.riic/index.html', $match.Groups[1].Value)
        if ($url.Scheme -notin @('http', 'https') -or $url.Host -ne 'app.riic') { continue }
        $path = Assert-ToolsSyncRelativePath ([Uri]::UnescapeDataString($url.AbsolutePath).TrimStart('/'))
        if (-not $distPaths.Contains($path)) { throw "The desktop entry references a missing frontend file: $path. Build with BASE_URL=/." }
    }
    $payload = [Collections.Generic.List[object]]::new()
    foreach ($entry in $distFiles) { $payload.Add([PSCustomObject]@{ Path = 'dist/' + $entry.Path; Source = Join-Path $distRoot $entry.Path; Size = $entry.Size; Sha256 = $entry.Sha256 }) }
    if ($DesktopPublish) {
        $nativeRoot = Get-ToolsSyncAbsolutePath $DesktopPublish
        $nativeFiles = @(Get-ToolsSyncInventory $nativeRoot)
        if (-not ($nativeFiles | Where-Object Path -eq 'R.I.I.C-Calculator.exe')) { throw 'The desktop payload is missing R.I.I.C-Calculator.exe.' }
        foreach ($entry in $nativeFiles) {
            if ($entry.Path -match '\.(pdb|xml)$' -or $entry.Path.StartsWith('dist/', [StringComparison]::OrdinalIgnoreCase)) { continue }
            if (-not (Test-ToolsSyncNativePath $entry.Path)) { throw "Unrecognized native payload file; keep user files out of the publish directory: $($entry.Path)" }
            $payload.Add([PSCustomObject]@{ Path = $entry.Path; Source = Join-Path $nativeRoot $entry.Path; Size = $entry.Size; Sha256 = $entry.Sha256 })
        }
    }
    return @($payload | Sort-Object Path)
}

function New-ToolsSyncPlan {
    param([Parameter(Mandatory)][object[]]$Payload, [Parameter(Mandatory)][string]$TargetDirectory, [Parameter(Mandatory)][string]$ReportDirectory)
    $target = Get-ToolsSyncAbsolutePath $TargetDirectory
    $report = Get-ToolsSyncAbsolutePath $ReportDirectory
    if ($target.Equals([IO.Path]::GetPathRoot($target), [StringComparison]::OrdinalIgnoreCase)) { throw 'An installation target cannot be a drive root.' }
    if ($report.Equals($target, [StringComparison]::OrdinalIgnoreCase) -or $report.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase) -or $target.StartsWith($report + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'The report/backup directory and installation directory must not overlap.' }
    Assert-ToolsSyncNoReparse $target
    Assert-ToolsSyncNoReparse $report
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $Payload) {
        $relative = Assert-ToolsSyncRelativePath $entry.Path
        if (-not $relative.StartsWith('dist/', [StringComparison]::OrdinalIgnoreCase) -and -not (Test-ToolsSyncNativePath $relative) -and $relative -ne 'BUILD-INFO.json') { throw "Not an application-managed path: $relative" }
        if (-not $seen.Add($relative)) { throw "Duplicate payload path: $relative" }
        $source = Get-ToolsSyncAbsolutePath $entry.Source
        Assert-ToolsSyncNoReparse $source
        if ($source.Equals($target, [StringComparison]::OrdinalIgnoreCase) -or $source.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Payload source is inside the installation: $source" }
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing payload file: $source" }
        if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Sha256 -or (Get-Item -LiteralPath $source).Length -ne $entry.Size) { throw "Payload file changed after validation: $source" }
        $destination = Assert-ToolsSyncWithinRoot (Join-Path $target $relative) $target
        if (Test-Path -LiteralPath $destination -PathType Container) { throw "A destination file is an existing directory: $destination" }
        $parent = [IO.Directory]::GetParent($destination)
        while ($null -ne $parent -and $parent.FullName.StartsWith($target, [StringComparison]::OrdinalIgnoreCase)) {
            if (Test-Path -LiteralPath $parent.FullName -PathType Leaf) { throw "A destination directory is an existing file: $($parent.FullName)" }
            $parent = $parent.Parent
        }
    }
    $before = @(if (Test-Path -LiteralPath $target) { Get-ToolsSyncInventory $target })
    $beforeMap = @{}
    foreach ($entry in $before) { $beforeMap[$entry.Path] = $entry }
    $obsolete = [Collections.Generic.List[string]]::new()
    $modifiedObsolete = [Collections.Generic.List[string]]::new()
    $priorManifest = Join-Path $target '.riic-install-manifest.json'
    if (Test-Path -LiteralPath $priorManifest -PathType Leaf) {
        $prior = [IO.File]::ReadAllText($priorManifest) | ConvertFrom-Json
        if ($prior.SchemaVersion -ne 1) { throw 'Unsupported previous install manifest; inspect it before replacing the installation.' }
        foreach ($entry in $prior.Files) {
            $relative = Assert-ToolsSyncRelativePath $entry.Path
            if (-not $relative.StartsWith('dist/', [StringComparison]::OrdinalIgnoreCase) -and -not (Test-ToolsSyncNativePath $relative) -and $relative -ne 'BUILD-INFO.json') { throw "Unsafe path in previous install manifest: $relative" }
            if ($seen.Contains($relative) -or -not $beforeMap.ContainsKey($relative)) { continue }
            # Frontend-only updates keep the native wrapper and its dependencies.
            if (-not $relative.StartsWith('dist/', [StringComparison]::OrdinalIgnoreCase)) { continue }
            if ($beforeMap[$relative].Sha256 -eq $entry.Sha256) { $obsolete.Add($relative) } else { $modifiedObsolete.Add($relative) }
        }
    }
    return [PSCustomObject]@{ TargetDirectory = $target; ReportDirectory = $report; Payload = $Payload; Before = $before; Obsolete = $obsolete.ToArray(); ModifiedObsolete = $modifiedObsolete.ToArray() }
}

function Copy-ToolsSyncVerifiedFile {
    param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Destination, [Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Sha256, [Parameter(Mandatory)][long]$Size)
    $destinationPath = Assert-ToolsSyncWithinRoot $Destination $Root
    Assert-ToolsSyncNoReparse $Source
    Assert-ToolsSyncNoReparse $destinationPath
    [IO.Directory]::CreateDirectory([IO.Directory]::GetParent($destinationPath).FullName) | Out-Null
    Copy-Item -LiteralPath $Source -Destination $destinationPath -Force
    if ((Get-Item -LiteralPath $destinationPath).Length -ne $Size -or (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha256) { throw "Copied file verification failed: $destinationPath" }
}

function Get-ToolsSyncCurrentFileState {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return [PSCustomObject]@{ Kind = 'missing'; Size = $null; Sha256 = $null } }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.PSIsContainer) { return [PSCustomObject]@{ Kind = 'directory'; Size = $null; Sha256 = $null } }
    return [PSCustomObject]@{ Kind = 'file'; Size = $item.Length; Sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
}

function Test-ToolsSyncFileSignature {
    param([Parameter(Mandatory)]$State, $Signature)
    return $State.Kind -eq 'file' -and $null -ne $Signature -and $State.Size -eq $Signature.Size -and $State.Sha256 -eq $Signature.Sha256
}

function Invoke-ToolsSyncUpdate {
    param([Parameter(Mandatory)]$Plan, [string]$SourceCommit = '', [string]$ApplicationVersion = '')
    $target = $Plan.TargetDirectory
    $report = $Plan.ReportDirectory
    $backup = Join-Path $report 'backup'
    $stage = Join-Path $report 'payload'
    if ((Test-Path -LiteralPath $backup) -or (Test-Path -LiteralPath $stage)) { throw 'This report directory already contains a backup or payload. Use a fresh report directory.' }
    Assert-ToolsSyncNoReparse $report
    [IO.Directory]::CreateDirectory($report) | Out-Null
    $beforeMap = @{}
    foreach ($entry in $Plan.Before) { $beforeMap[$entry.Path] = $entry }
    $mutated = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $written = @{}
    $deleted = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $result = [ordered]@{ SchemaVersion = 1; Status = 'preparing'; TargetDirectory = $target; BackupDirectory = $backup; SourceCommit = $SourceCommit; ApplicationVersion = $ApplicationVersion; StartedAt = [DateTime]::UtcNow.ToString('o'); ManagedFileCount = $Plan.Payload.Count; PreviousFileCount = $Plan.Before.Count; RemovedObsolete = @($Plan.Obsolete); PreservedModifiedObsolete = @($Plan.ModifiedObsolete); WrittenFiles = @(); DeletedFiles = @(); Rollback = $null; RollbackConflicts = @(); RollbackErrors = @(); RollbackActions = @() }
    try {
        [IO.Directory]::CreateDirectory($stage) | Out-Null
        foreach ($entry in $Plan.Payload) { Copy-ToolsSyncVerifiedFile $entry.Source (Join-Path $stage $entry.Path) $stage $entry.Sha256 $entry.Size }
        [IO.Directory]::CreateDirectory($backup) | Out-Null
        foreach ($entry in $Plan.Before) { Copy-ToolsSyncVerifiedFile (Join-Path $target $entry.Path) (Join-Path $backup $entry.Path) $backup $entry.Sha256 $entry.Size }
        Write-ToolsSyncJson (Join-Path $report 'backup-manifest.json') @{ SchemaVersion = 1; Files = @($Plan.Before) }
        $current = @(if (Test-Path -LiteralPath $target) { Get-ToolsSyncInventory $target })
        if (($current | ConvertTo-Json -Depth 5 -Compress) -ne ($Plan.Before | ConvertTo-Json -Depth 5 -Compress)) { throw 'The installation changed during staging/backup. No installation files were written.' }
        $result.BackupVerified = $true
        Assert-ToolsSyncNoReparse $target
        [IO.Directory]::CreateDirectory($target) | Out-Null
        # Publish the entry point after all referenced assets are present.
        foreach ($entry in ($Plan.Payload | Sort-Object @{Expression = { $_.Path -eq 'dist/index.html' }}, Path)) {
            [void]$mutated.Add($entry.Path)
            Copy-ToolsSyncVerifiedFile (Join-Path $stage $entry.Path) (Join-Path $target $entry.Path) $target $entry.Sha256 $entry.Size
            $written[$entry.Path] = [PSCustomObject]@{ Path = $entry.Path; Size = $entry.Size; Sha256 = $entry.Sha256 }
        }
        foreach ($relative in $Plan.Obsolete) {
            $destination = Assert-ToolsSyncWithinRoot (Join-Path $target $relative) $target
            Assert-ToolsSyncNoReparse $destination
            [void]$mutated.Add($relative)
            Remove-Item -LiteralPath $destination -Force
            [void]$deleted.Add($relative)
        }
        $installedFiles = @($Plan.Payload | Select-Object Path, Size, Sha256)
        $priorManifestPath = Join-Path $backup '.riic-install-manifest.json'
        if (Test-Path -LiteralPath $priorManifestPath -PathType Leaf) {
            $prior = [IO.File]::ReadAllText($priorManifestPath) | ConvertFrom-Json
            $newPaths = @{}
            foreach ($entry in $installedFiles) { $newPaths[$entry.Path] = $true }
            foreach ($entry in $prior.Files) {
                if (-not $entry.Path.StartsWith('dist/', [StringComparison]::OrdinalIgnoreCase) -and -not $newPaths.ContainsKey($entry.Path) -and $beforeMap.ContainsKey($entry.Path)) { $installedFiles += $beforeMap[$entry.Path] }
            }
        }
        $manifest = [ordered]@{ SchemaVersion = 1; InstalledAt = [DateTime]::UtcNow.ToString('o'); SourceCommit = $SourceCommit; ApplicationVersion = $ApplicationVersion; Files = @($installedFiles | Sort-Object Path) }
        $manifestRelative = '.riic-install-manifest.json'
        $stagedManifestPath = Assert-ToolsSyncWithinRoot (Join-Path $stage $manifestRelative) $stage
        Assert-ToolsSyncNoReparse $stagedManifestPath
        Write-ToolsSyncJson $stagedManifestPath $manifest
        $manifestSignature = [PSCustomObject]@{ Path = $manifestRelative; Size = (Get-Item -LiteralPath $stagedManifestPath).Length; Sha256 = (Get-FileHash -LiteralPath $stagedManifestPath -Algorithm SHA256).Hash.ToLowerInvariant() }
        [void]$mutated.Add($manifestRelative)
        Copy-ToolsSyncVerifiedFile $stagedManifestPath (Join-Path $target $manifestRelative) $target $manifestSignature.Sha256 $manifestSignature.Size
        $written[$manifestRelative] = $manifestSignature
        $afterMap = @{}
        foreach ($entry in @(Get-ToolsSyncInventory $target)) { $afterMap[$entry.Path] = $entry }
        foreach ($entry in $Plan.Payload) {
            if (-not $afterMap.ContainsKey($entry.Path) -or $afterMap[$entry.Path].Sha256 -ne $entry.Sha256 -or $afterMap[$entry.Path].Size -ne $entry.Size) { throw "Installed file does not match the payload: $($entry.Path)" }
        }
        if (-not $afterMap.ContainsKey($manifestRelative) -or -not (Test-ToolsSyncFileSignature ([PSCustomObject]@{ Kind = 'file'; Size = $afterMap[$manifestRelative].Size; Sha256 = $afterMap[$manifestRelative].Sha256 }) $manifestSignature)) { throw 'The install manifest changed after its verified write.' }
        foreach ($relative in $deleted) {
            if ($afterMap.ContainsKey($relative)) { throw "A removed obsolete file reappeared during installation: $relative" }
        }
        $preservedCount = 0
        foreach ($entry in $Plan.Before) {
            if ($mutated.Contains($entry.Path)) { continue }
            if (-not $afterMap.ContainsKey($entry.Path) -or $afterMap[$entry.Path].Sha256 -ne $entry.Sha256 -or $afterMap[$entry.Path].Size -ne $entry.Size) { throw "An unmanaged pre-existing file changed: $($entry.Path)" }
            $preservedCount++
        }
        $result.Status = 'verified'
        $result.PreservedFileCount = $preservedCount
        $result.ManagedFiles = $installedFiles
        $result.WrittenFiles = @($written.Values | Sort-Object Path)
        $result.DeletedFiles = @($deleted | Sort-Object)
        $result.ManifestSha256 = $manifestSignature.Sha256
        $result.CompletedAt = [DateTime]::UtcNow.ToString('o')
        Write-ToolsSyncJson (Join-Path $report 'sync-result.json') $result
        return [PSCustomObject]$result
    } catch {
        $originalError = $_.Exception.Message
        $result.Status = 'failed'
        $result.Error = $originalError
        $result.WrittenFiles = @($written.Values | Sort-Object Path)
        $result.DeletedFiles = @($deleted | Sort-Object)
        if ($mutated.Count -gt 0) {
            $conflicts = [Collections.Generic.List[object]]::new()
            $rollbackErrors = [Collections.Generic.List[object]]::new()
            $rollbackActions = [Collections.Generic.List[object]]::new()
            foreach ($relative in ($mutated | Sort-Object)) {
                try {
                    $destination = Assert-ToolsSyncWithinRoot (Join-Path $target $relative) $target
                    $original = $null
                    $thisWrite = $null
                    if ($beforeMap.ContainsKey($relative)) { $original = $beforeMap[$relative] }
                    if ($written.ContainsKey($relative)) { $thisWrite = $written[$relative] }
                    $reason = ''
                    try { Assert-ToolsSyncNoReparse $destination } catch { $reason = 'Destination or ancestor became unsafe: ' + $_.Exception.Message }
                    $state = $(if ($reason) { [PSCustomObject]@{ Kind = 'unsafe'; Size = $null; Sha256 = $null } } else { Get-ToolsSyncCurrentFileState $destination })
                    if (-not $reason -and $null -ne $original -and (Test-ToolsSyncFileSignature $state $original)) {
                        $rollbackActions.Add([PSCustomObject]@{ Path = $relative; Action = 'already-original' })
                        continue
                    }
                    if (-not $reason -and $null -eq $original -and $state.Kind -eq 'missing') {
                        $rollbackActions.Add([PSCustomObject]@{ Path = $relative; Action = 'already-absent' })
                        continue
                    }
                    if (-not $reason -and $deleted.Contains($relative)) {
                        if ($state.Kind -eq 'missing' -and $null -ne $original) {
                            Copy-ToolsSyncVerifiedFile (Join-Path $backup $relative) $destination $target $original.Sha256 $original.Size
                            $rollbackActions.Add([PSCustomObject]@{ Path = $relative; Action = 'restored-deleted-file' })
                            continue
                        }
                        $reason = 'A removed file was recreated externally; preserve it.'
                    } elseif (-not $reason -and (Test-ToolsSyncFileSignature $state $thisWrite)) {
                        if ($null -ne $original) {
                            Copy-ToolsSyncVerifiedFile (Join-Path $backup $relative) $destination $target $original.Sha256 $original.Size
                            $rollbackActions.Add([PSCustomObject]@{ Path = $relative; Action = 'restored-backup' })
                        } else {
                            Remove-Item -LiteralPath $destination -Force
                            if (Test-Path -LiteralPath $destination) { throw "A new file reappeared while rolling back: $relative" }
                            $rollbackActions.Add([PSCustomObject]@{ Path = $relative; Action = 'removed-new-file' })
                        }
                        continue
                    } elseif (-not $reason) {
                        $reason = $(if ($null -eq $thisWrite) { 'The attempted write was not verified and the original state changed; preserve it.' } else { 'The destination no longer matches this update or its original state; preserve external changes.' })
                    }
                    $originalHash = $null
                    $writtenHash = $null
                    if ($null -ne $original) { $originalHash = $original.Sha256 }
                    if ($null -ne $thisWrite) { $writtenHash = $thisWrite.Sha256 }
                    $conflicts.Add([PSCustomObject]@{ Path = $relative; Reason = $reason; CurrentKind = $state.Kind; CurrentSize = $state.Size; CurrentSha256 = $state.Sha256; OriginalSha256 = $originalHash; WrittenSha256 = $writtenHash; RemovedBySync = $deleted.Contains($relative) })
                    $rollbackActions.Add([PSCustomObject]@{ Path = $relative; Action = 'preserved-conflict' })
                } catch {
                    $rollbackErrors.Add([PSCustomObject]@{ Path = $relative; Error = $_.Exception.Message })
                }
            }
            $result.RollbackConflicts = $conflicts.ToArray()
            $result.RollbackErrors = $rollbackErrors.ToArray()
            $result.RollbackActions = $rollbackActions.ToArray()
            if ($rollbackErrors.Count -gt 0) {
                $result.Rollback = 'failed: ' + (($rollbackErrors | ForEach-Object { $_.Path + ': ' + $_.Error }) -join '; ')
                if ($conflicts.Count -gt 0) { $result.Rollback += '; rollback conflict: ' + (($conflicts | ForEach-Object Path) -join ', ') }
            } elseif ($conflicts.Count -gt 0) {
                $result.Rollback = 'rollback conflict: external changes preserved in ' + (($conflicts | ForEach-Object Path) -join ', ')
            } else {
                $result.Rollback = 'verified'
            }
        } else { $result.Rollback = 'not-needed; installation was not written' }
        Write-ToolsSyncJson (Join-Path $report 'sync-result.json') $result
        throw "Installation sync failed: $originalError. Rollback: $($result.Rollback). Backup/report: $report"
    }
}

Export-ModuleMember -Function Get-ToolsSyncAbsolutePath, Assert-ToolsSyncWithinRoot, Assert-ToolsSyncNoReparse, Assert-ToolsSyncRelativePath, Get-ToolsSyncInventory, Write-ToolsSyncJson, New-ToolsSyncPayload, New-ToolsSyncPlan, Invoke-ToolsSyncUpdate
