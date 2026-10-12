Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'tools-sync-core.psm1') -Force -DisableNameChecking
$repositoryRoot = [IO.Directory]::GetParent($PSScriptRoot).FullName
$fixtureRoot = Assert-ToolsSyncWithinRoot (Join-Path $repositoryRoot ('artifacts/sync-tools-tests/' + [Guid]::NewGuid().ToString('N'))) (Join-Path $repositoryRoot 'artifacts')
[IO.Directory]::CreateDirectory($fixtureRoot) | Out-Null
$passed = [Collections.Generic.List[string]]::new()

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -cne $Expected) { throw "$Message (expected: $Expected; actual: $Actual)" }
}
function Assert-Rejects {
    param([scriptblock]$Action, [string]$Pattern)
    try { & $Action | Out-Null } catch {
        if ($_.Exception.Message -match $Pattern) { return }
        throw "Expected rejection matching '$Pattern'; received: $($_.Exception.Message)"
    }
    throw "Expected rejection matching '$Pattern'; action succeeded."
}
function Write-Fixture {
    param([string]$Path, [string]$Content)
    $resolved = Assert-ToolsSyncWithinRoot $Path $fixtureRoot
    [IO.Directory]::CreateDirectory([IO.Directory]::GetParent($resolved).FullName) | Out-Null
    [IO.File]::WriteAllText($resolved, $Content, [Text.UTF8Encoding]::new($false))
}
function Hash-Fixture {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Test-Case {
    param([string]$Name, [scriptblock]$Action)
    & $Action
    $passed.Add($Name)
    Write-Host "PASS $Name"
}

function Invoke-ToolsSyncInjectedFailure {
    param([Parameter(Mandatory)]$Plan, [Parameter(Mandatory)][scriptblock]$Injection)
    $module = Get-Module tools-sync-core
    $originalInventory = & $module { (Get-Item Function:Get-ToolsSyncInventory).ScriptBlock }
    try {
        # Modify real fixture files immediately before final validation, after all
        # successful writes/deletions have been recorded. Production has no test hook.
        & $module {
            param($Target, $EditFiles, $Original)
            $script:ToolsSyncTestTarget = $Target
            $script:ToolsSyncTestEditFiles = $EditFiles
            $script:ToolsSyncTestOriginalInventory = $Original
            $script:ToolsSyncTestTargetReads = 0
            Set-Item Function:script:Get-ToolsSyncInventory -Value {
                param([Parameter(Mandatory)][string]$Root)
                if ($Root.Equals($script:ToolsSyncTestTarget, [StringComparison]::OrdinalIgnoreCase)) {
                    $script:ToolsSyncTestTargetReads++
                    if ($script:ToolsSyncTestTargetReads -eq 2) {
                        & $script:ToolsSyncTestEditFiles $Root | Out-Null
                        throw 'Injected failure after an external fixture edit.'
                    }
                }
                return & $script:ToolsSyncTestOriginalInventory $Root
            } -Force
        } $Plan.TargetDirectory $Injection $originalInventory
        Invoke-ToolsSyncUpdate $Plan
    } finally {
        & $module {
            param($Original)
            Set-Item Function:script:Get-ToolsSyncInventory -Value $Original -Force
            Remove-Variable -Scope Script -Name ToolsSyncTestTarget, ToolsSyncTestEditFiles, ToolsSyncTestOriginalInventory, ToolsSyncTestTargetReads -ErrorAction SilentlyContinue
        } $originalInventory
    }
}

Test-Case 'Path traversal, root aliases and alternate streams are rejected' {
    foreach ($path in @('D:relative', '\relative', 'relative/file')) { Assert-Rejects { Get-ToolsSyncAbsolutePath $path } 'absolute local path' }
    Assert-Rejects { Assert-ToolsSyncWithinRoot (Join-Path $fixtureRoot '../escape') $fixtureRoot } 'outside'
    Assert-Rejects { Assert-ToolsSyncWithinRoot ($fixtureRoot + '-sibling/file') $fixtureRoot } 'outside'
    Assert-Rejects { Assert-ToolsSyncWithinRoot $fixtureRoot $fixtureRoot } 'outside'
    foreach ($path in @('../settings.json', 'dist/../settings.json', 'dist/file:stream', 'dist//file.js', 'dist/ending.', 'dist/CON.txt')) { Assert-Rejects { Assert-ToolsSyncRelativePath $path } 'Unsafe' }
}

$firstDist = Join-Path $fixtureRoot 'frontend-one'
Write-Fixture (Join-Path $firstDist 'index.html') '<html><script src="/assets/old.js"></script></html>'
Write-Fixture (Join-Path $firstDist 'assets/old.js') 'old managed asset'
Write-Fixture (Join-Path $firstDist 'assets/edited.js') 'original managed editable asset'
$native = Join-Path $fixtureRoot 'desktop-one'
Write-Fixture (Join-Path $native 'R.I.I.C-Calculator.exe') 'fixture native wrapper'
Write-Fixture (Join-Path $native 'README.txt') 'fixture instructions'

Test-Case 'Frontend referenced files and native payload ownership are checked' {
    $broken = Join-Path $fixtureRoot 'broken'
    Write-Fixture (Join-Path $broken 'index.html') '<script src="/repository/assets/missing.js"></script>'
    Assert-Rejects { New-ToolsSyncPayload $broken } 'missing frontend file'
    Write-Fixture (Join-Path $native 'settings.json') 'user settings must never be a native payload'
    Assert-Rejects { New-ToolsSyncPayload $firstDist $native } 'Unrecognized native payload'
    $unmanaged = Assert-ToolsSyncWithinRoot (Join-Path $native 'settings.json') $fixtureRoot
    Remove-Item -LiteralPath $unmanaged
}

$target = Join-Path $fixtureRoot 'installed'
Write-Fixture (Join-Path $target 'settings.json') '{"preserve":true}'
Write-Fixture (Join-Path $target 'profiles/WebView2Data/session') 'preserve local browser session'
$rosterName = (-join ([char[]]@(0x5e72, 0x5458, 0x7ec3, 0x5ea6))) + '/roster.json'
Write-Fixture (Join-Path $target $rosterName) '{"operators":["real user roster"]}'
Write-Fixture (Join-Path $target 'dist/assets/unknown.js') 'unknown user file'
$original = @(Get-ToolsSyncInventory $target)
$firstPayload = @(New-ToolsSyncPayload $firstDist $native)

Test-Case 'Junctions cannot redirect source, target or backup file operations' {
    $junction = Assert-ToolsSyncWithinRoot (Join-Path $fixtureRoot 'linked-source') $fixtureRoot
    New-Item -ItemType Junction -Path $junction -Target $firstDist | Out-Null
    try {
        Assert-Rejects { New-ToolsSyncPayload $junction } 'reparse points'
        Assert-Rejects { New-ToolsSyncPlan $firstPayload $junction (Join-Path $fixtureRoot 'report-link') } 'reparse points'
    } finally { [IO.Directory]::Delete($junction) }
    Assert-Equal (Test-Path -LiteralPath (Join-Path $firstDist 'index.html')) $true 'Removing a junction altered its target'
}

Test-Case 'Plan construction validates without writing to the installation' {
    $script:planOne = New-ToolsSyncPlan $firstPayload $target (Join-Path $fixtureRoot 'report-one')
    Assert-Equal (@(Get-ToolsSyncInventory $target) | ConvertTo-Json -Depth 5 -Compress) ($original | ConvertTo-Json -Depth 5 -Compress) 'Plan changed installation files'
    Assert-Rejects { New-ToolsSyncPlan $firstPayload $target (Join-Path $target 'backup') } 'overlap'
    Assert-Rejects { New-ToolsSyncPlan $firstPayload ([IO.Path]::GetPathRoot($fixtureRoot)) (Join-Path $fixtureRoot 'report-drive') } 'drive root'
}

Test-Case 'Verified backup and install preserve configuration, roster and browser files' {
    $result = Invoke-ToolsSyncUpdate $planOne ('a' * 40) 'fixture-version'
    Assert-Equal $result.Status 'verified' 'Installation did not verify'
    Assert-Equal $result.BackupVerified $true 'Backup was not verified'
    Assert-Equal $result.PreservedFileCount $original.Count 'Unmanaged file preservation count'
    foreach ($entry in $original) {
        Assert-Equal (Hash-Fixture (Join-Path $target $entry.Path)) $entry.Sha256 'Pre-existing file changed'
        Assert-Equal (Hash-Fixture (Join-Path $planOne.ReportDirectory ('backup/' + $entry.Path))) $entry.Sha256 'Backup hash changed'
    }
}

Test-Case 'Only unchanged owned old frontend assets are removed on a later update' {
    Write-Fixture (Join-Path $target 'dist/assets/edited.js') 'user edited this previously managed asset'
    $nextDist = Join-Path $fixtureRoot 'frontend-two'
    Write-Fixture (Join-Path $nextDist 'index.html') '<html><script src="/assets/new.js"></script></html>'
    Write-Fixture (Join-Path $nextDist 'assets/new.js') 'new managed asset'
    $script:secondPayload = @(New-ToolsSyncPayload $nextDist)
    $plan = New-ToolsSyncPlan $secondPayload $target (Join-Path $fixtureRoot 'report-two')
    Assert-Equal ($plan.Obsolete -join ',') 'dist/assets/old.js' 'Wrong obsolete assets'
    Assert-Equal ($plan.ModifiedObsolete -join ',') 'dist/assets/edited.js' 'Edited owned asset must be preserved'
    $exeHash = Hash-Fixture (Join-Path $target 'R.I.I.C-Calculator.exe')
    $result = Invoke-ToolsSyncUpdate $plan ('b' * 40) 'fixture-version-two'
    Assert-Equal (Test-Path -LiteralPath (Join-Path $target 'dist/assets/old.js')) $false 'Old owned asset retained'
    Assert-Equal ([IO.File]::ReadAllText((Join-Path $target 'dist/assets/edited.js'))) 'user edited this previously managed asset' 'Edited file changed'
    Assert-Equal ([IO.File]::ReadAllText((Join-Path $target 'dist/assets/unknown.js'))) 'unknown user file' 'Unknown file changed'
    Assert-Equal (Hash-Fixture (Join-Path $target 'R.I.I.C-Calculator.exe')) $exeHash 'Frontend update altered executable'
    Assert-Equal $result.Status 'verified' 'Second install did not verify'
}

Test-Case 'Changed payload is rejected before installation writes' {
    $plan = New-ToolsSyncPlan $secondPayload $target (Join-Path $fixtureRoot 'report-tampered')
    $before = @(Get-ToolsSyncInventory $target)
    $asset = $secondPayload | Where-Object Path -eq 'dist/assets/new.js'
    Write-Fixture $asset.Source 'tampered payload'
    Assert-Rejects { Invoke-ToolsSyncUpdate $plan } 'verification failed'
    Assert-Equal (@(Get-ToolsSyncInventory $target) | ConvertTo-Json -Depth 5 -Compress) ($before | ConvertTo-Json -Depth 5 -Compress) 'Tampered payload changed install'
    Write-Fixture $asset.Source 'new managed asset'
}

Test-Case 'Failure after asset writes restores original file hashes' {
    $rollbackDist = Join-Path $fixtureRoot 'frontend-rollback'
    Write-Fixture (Join-Path $rollbackDist 'index.html') '<html><script src="/assets/rollback.js"></script></html>'
    Write-Fixture (Join-Path $rollbackDist 'assets/rollback.js') 'must be removed if entry cannot publish'
    $payload = @(New-ToolsSyncPayload $rollbackDist)
    $plan = New-ToolsSyncPlan $payload $target (Join-Path $fixtureRoot 'report-rollback')
    $before = @(Get-ToolsSyncInventory $target)
    $lock = [IO.File]::Open((Join-Path $target 'dist/index.html'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try { Assert-Rejects { Invoke-ToolsSyncUpdate $plan } 'Rollback: verified' } finally { $lock.Dispose() }
    Assert-Equal (@(Get-ToolsSyncInventory $target) | ConvertTo-Json -Depth 5 -Compress) ($before | ConvertTo-Json -Depth 5 -Compress) 'Failed install did not restore original files'
}

Test-Case 'Rollback preserves an externally edited new file and removes only matching new files' {
    $install = Join-Path $fixtureRoot 'new-file-conflict-install'
    Write-Fixture (Join-Path $install 'dist/index.html') '<html>original entry</html>'
    $entryHash = Hash-Fixture (Join-Path $install 'dist/index.html')
    $source = Join-Path $fixtureRoot 'new-file-conflict-source'
    Write-Fixture (Join-Path $source 'index.html') '<script src="/assets/edited-new.js"></script><script src="/assets/safe-new.js"></script>'
    Write-Fixture (Join-Path $source 'assets/edited-new.js') 'verified update new file'
    Write-Fixture (Join-Path $source 'assets/safe-new.js') 'verified update safe file'
    $payload = @(New-ToolsSyncPayload $source)
    $plan = New-ToolsSyncPlan $payload $install (Join-Path $fixtureRoot 'report-new-file-conflict')
    Assert-Rejects {
        Invoke-ToolsSyncInjectedFailure $plan {
            param($Root)
            [IO.File]::WriteAllText((Join-Path $Root 'dist/assets/edited-new.js'), 'external new file edit', [Text.UTF8Encoding]::new($false))
        }
    } 'Rollback: rollback conflict'
    $report = [IO.File]::ReadAllText((Join-Path $plan.ReportDirectory 'sync-result.json')) | ConvertFrom-Json
    Assert-Equal $report.RollbackConflicts.Count 1 'Unexpected new-file rollback conflicts'
    Assert-Equal $report.RollbackConflicts[0].Path 'dist/assets/edited-new.js' 'The external new file was not reported'
    Assert-Equal $report.RollbackConflicts[0].OriginalSha256 $null 'A new file must not report an original hash'
    Assert-Equal ([IO.File]::ReadAllText((Join-Path $install 'dist/assets/edited-new.js'))) 'external new file edit' 'Rollback deleted an externally edited new file'
    Assert-Equal $report.RollbackConflicts[0].WrittenSha256 (Hash-Fixture (Join-Path $source 'assets/edited-new.js')) 'The verified new write hash was not recorded'
    Assert-Equal $report.RollbackConflicts[0].CurrentSha256 (Hash-Fixture (Join-Path $install 'dist/assets/edited-new.js')) 'External new content hash was not reported'
    Assert-Equal (Test-Path -LiteralPath (Join-Path $install 'dist/assets/safe-new.js')) $false 'An unchanged new artifact was retained'
    Assert-Equal (Test-Path -LiteralPath (Join-Path $install '.riic-install-manifest.json')) $false 'An unchanged newly written manifest was retained'
    Assert-Equal (Hash-Fixture (Join-Path $install 'dist/index.html')) $entryHash 'Entry point did not recover'
}

Test-Case 'Rollback preserves externally edited existing files and restores unchanged update writes' {
    $install = Join-Path $fixtureRoot 'existing-file-conflict-install'
    Write-Fixture (Join-Path $install 'dist/index.html') '<html>original entry</html>'
    Write-Fixture (Join-Path $install 'dist/assets/edited-existing.js') 'original existing file'
    Write-Fixture (Join-Path $install 'dist/assets/safe-existing.js') 'original safe existing file'
    $originalHash = Hash-Fixture (Join-Path $install 'dist/assets/edited-existing.js')
    $safeHash = Hash-Fixture (Join-Path $install 'dist/assets/safe-existing.js')
    $source = Join-Path $fixtureRoot 'existing-file-conflict-source'
    Write-Fixture (Join-Path $source 'index.html') '<script src="/assets/edited-existing.js"></script><script src="/assets/safe-existing.js"></script>'
    Write-Fixture (Join-Path $source 'assets/edited-existing.js') 'verified updated existing file'
    Write-Fixture (Join-Path $source 'assets/safe-existing.js') 'verified updated safe existing file'
    $plan = New-ToolsSyncPlan @(New-ToolsSyncPayload $source) $install (Join-Path $fixtureRoot 'report-existing-file-conflict')
    Assert-Rejects {
        Invoke-ToolsSyncInjectedFailure $plan {
            param($Root)
            [IO.File]::WriteAllText((Join-Path $Root 'dist/assets/edited-existing.js'), 'external existing file edit', [Text.UTF8Encoding]::new($false))
        }
    } 'Rollback: rollback conflict'
    $report = [IO.File]::ReadAllText((Join-Path $plan.ReportDirectory 'sync-result.json')) | ConvertFrom-Json
    Assert-Equal $report.RollbackConflicts.Count 1 'Unexpected existing-file rollback conflicts'
    Assert-Equal $report.RollbackConflicts[0].Path 'dist/assets/edited-existing.js' 'The external existing file was not reported'
    Assert-Equal $report.RollbackConflicts[0].OriginalSha256 $originalHash 'Original file hash was not reported'
    Assert-Equal $report.RollbackConflicts[0].WrittenSha256 (Hash-Fixture (Join-Path $source 'assets/edited-existing.js')) 'Verified updated file hash was not recorded'
    Assert-Equal ([IO.File]::ReadAllText((Join-Path $install 'dist/assets/edited-existing.js'))) 'external existing file edit' 'Rollback overwrote an externally edited existing file'
    Assert-Equal (Hash-Fixture (Join-Path $install 'dist/assets/safe-existing.js')) $safeHash 'A matching update write did not restore its backup'
}

Test-Case 'Rollback preserves an obsolete owned file recreated externally after removal' {
    $install = Join-Path $fixtureRoot 'deleted-file-conflict-install'
    $oldSource = Join-Path $fixtureRoot 'deleted-file-conflict-old-source'
    Write-Fixture (Join-Path $oldSource 'index.html') '<script src="/assets/obsolete.js"></script>'
    Write-Fixture (Join-Path $oldSource 'assets/obsolete.js') 'original owned obsolete file'
    Write-Fixture (Join-Path $oldSource 'assets/recoverable.js') 'original owned recoverable file'
    $firstPlan = New-ToolsSyncPlan @(New-ToolsSyncPayload $oldSource) $install (Join-Path $fixtureRoot 'report-deleted-file-baseline')
    Invoke-ToolsSyncUpdate $firstPlan | Out-Null
    $originalManifestHash = Hash-Fixture (Join-Path $install '.riic-install-manifest.json')
    $recoverableHash = Hash-Fixture (Join-Path $install 'dist/assets/recoverable.js')
    $source = Join-Path $fixtureRoot 'deleted-file-conflict-new-source'
    Write-Fixture (Join-Path $source 'index.html') '<script src="/assets/replacement.js"></script>'
    Write-Fixture (Join-Path $source 'assets/replacement.js') 'new replacement file'
    $plan = New-ToolsSyncPlan @(New-ToolsSyncPayload $source) $install (Join-Path $fixtureRoot 'report-deleted-file-conflict')
    Assert-Equal ($plan.Obsolete -join ',') 'dist/assets/obsolete.js,dist/assets/recoverable.js' 'Fixture did not plan the obsolete deletions'
    Assert-Rejects {
        Invoke-ToolsSyncInjectedFailure $plan {
            param($Root)
            [IO.File]::WriteAllText((Join-Path $Root 'dist/assets/obsolete.js'), 'external obsolete file recreation', [Text.UTF8Encoding]::new($false))
        }
    } 'Rollback: rollback conflict'
    $report = [IO.File]::ReadAllText((Join-Path $plan.ReportDirectory 'sync-result.json')) | ConvertFrom-Json
    Assert-Equal $report.RollbackConflicts.Count 1 'Unexpected deleted-file rollback conflicts'
    Assert-Equal $report.RollbackConflicts[0].RemovedBySync $true 'The successful deletion was not recorded'
    Assert-Equal $report.RollbackConflicts[0].WrittenSha256 $null 'A deleted old file must not report a new write hash'
    Assert-Equal ($report.DeletedFiles -join ',') 'dist/assets/obsolete.js,dist/assets/recoverable.js' 'Deletion report missing the owned obsolete files'
    Assert-Equal ([IO.File]::ReadAllText((Join-Path $install 'dist/assets/obsolete.js'))) 'external obsolete file recreation' 'Rollback overwrote the recreated file'
    Assert-Equal (Hash-Fixture (Join-Path $install 'dist/assets/recoverable.js')) $recoverableHash 'An unchanged removed file did not restore its backup'
    Assert-Equal (Hash-Fixture (Join-Path $install '.riic-install-manifest.json')) $originalManifestHash 'Unchanged updated manifest did not restore'
    Assert-Equal (Test-Path -LiteralPath (Join-Path $install 'dist/assets/replacement.js')) $false 'Replacement artifact was not removed'
}

Test-Case 'Rollback records manifest writes and preserves an externally edited existing manifest' {
    $install = Join-Path $fixtureRoot 'manifest-conflict-install'
    Write-Fixture (Join-Path $install 'dist/index.html') '<html>original entry</html>'
    Write-Fixture (Join-Path $install '.riic-install-manifest.json') '{"SchemaVersion":1,"Files":[]}'
    $originalManifestHash = Hash-Fixture (Join-Path $install '.riic-install-manifest.json')
    $source = Join-Path $fixtureRoot 'manifest-conflict-source'
    Write-Fixture (Join-Path $source 'index.html') '<script src="/assets/new.js"></script>'
    Write-Fixture (Join-Path $source 'assets/new.js') 'new manifest fixture asset'
    $plan = New-ToolsSyncPlan @(New-ToolsSyncPayload $source) $install (Join-Path $fixtureRoot 'report-manifest-conflict')
    Assert-Rejects {
        Invoke-ToolsSyncInjectedFailure $plan {
            param($Root)
            [IO.File]::WriteAllText((Join-Path $Root '.riic-install-manifest.json'), '{"SchemaVersion":1,"Files":[],"UserEdit":"preserve"}', [Text.UTF8Encoding]::new($false))
        }
    } 'Rollback: rollback conflict'
    $report = [IO.File]::ReadAllText((Join-Path $plan.ReportDirectory 'sync-result.json')) | ConvertFrom-Json
    Assert-Equal $report.RollbackConflicts.Count 1 'Unexpected manifest rollback conflicts'
    Assert-Equal $report.RollbackConflicts[0].Path '.riic-install-manifest.json' 'Edited manifest was not reported'
    Assert-Equal $report.RollbackConflicts[0].OriginalSha256 $originalManifestHash 'Original manifest hash was not reported'
    $writtenManifest = @($report.WrittenFiles | Where-Object Path -eq '.riic-install-manifest.json')
    Assert-Equal $writtenManifest.Count 1 'Successful manifest write was not recorded'
    Assert-Equal $writtenManifest[0].Sha256 (Hash-Fixture (Join-Path $plan.ReportDirectory 'payload/.riic-install-manifest.json')) 'Recorded manifest write hash differs from the staged artifact'
    Assert-Equal $report.RollbackConflicts[0].WrittenSha256 $writtenManifest[0].Sha256 'Conflict missing the manifest write hash'
    Assert-Equal ([IO.File]::ReadAllText((Join-Path $install '.riic-install-manifest.json'))) '{"SchemaVersion":1,"Files":[],"UserEdit":"preserve"}' 'Rollback overwrote the external manifest edit'
}

Test-Case 'Rollback recognizes files already restored or removed before failure' {
    $install = Join-Path $fixtureRoot 'already-restored-install'
    Write-Fixture (Join-Path $install 'dist/index.html') '<html>original entry</html>'
    Write-Fixture (Join-Path $install 'dist/assets/existing.js') 'original existing file'
    $before = @(Get-ToolsSyncInventory $install)
    $source = Join-Path $fixtureRoot 'already-restored-source'
    Write-Fixture (Join-Path $source 'index.html') '<script src="/assets/existing.js"></script><script src="/assets/new.js"></script>'
    Write-Fixture (Join-Path $source 'assets/existing.js') 'updated existing file'
    Write-Fixture (Join-Path $source 'assets/new.js') 'new file'
    $plan = New-ToolsSyncPlan @(New-ToolsSyncPayload $source) $install (Join-Path $fixtureRoot 'report-already-restored')
    Assert-Rejects {
        Invoke-ToolsSyncInjectedFailure $plan {
            param($Root)
            [IO.File]::WriteAllText((Join-Path $Root 'dist/assets/existing.js'), 'original existing file', [Text.UTF8Encoding]::new($false))
            [IO.File]::Delete((Join-Path $Root 'dist/assets/new.js'))
        }
    } 'Rollback: verified'
    $report = [IO.File]::ReadAllText((Join-Path $plan.ReportDirectory 'sync-result.json')) | ConvertFrom-Json
    Assert-Equal $report.RollbackConflicts.Count 0 'Already original files were reported as conflicts'
    Assert-Equal (@(Get-ToolsSyncInventory $install) | ConvertTo-Json -Depth 5 -Compress) ($before | ConvertTo-Json -Depth 5 -Compress) 'Rollback changed already recovered state'
}

Test-Case 'Unsafe previous ownership manifest cannot delete unrelated files' {
    $manifestPath = Join-Path $target '.riic-install-manifest.json'
    $prior = [IO.File]::ReadAllText($manifestPath)
    Write-Fixture $manifestPath '{"SchemaVersion":1,"Files":[{"Path":"../settings.json","Sha256":"fake"}]}'
    Assert-Rejects { New-ToolsSyncPlan $secondPayload $target (Join-Path $fixtureRoot 'report-bad-manifest') } 'Unsafe payload path'
    Write-Fixture $manifestPath $prior
}

Test-Case 'First install with no previous files still has a verified backup manifest' {
    $newTarget = Join-Path $fixtureRoot 'new-install'
    $plan = New-ToolsSyncPlan $secondPayload $newTarget (Join-Path $fixtureRoot 'report-new-install')
    $result = Invoke-ToolsSyncUpdate $plan
    Assert-Equal $result.Status 'verified' 'New install did not verify'
    Assert-Equal $result.PreviousFileCount 0 'Unexpected previous files'
    Assert-Equal $result.PreservedFileCount 0 'Unexpected preserved files'
}

Write-ToolsSyncJson (Join-Path $fixtureRoot 'test-result.json') @{ Passed = $passed.Count; Failed = 0; Tests = $passed.ToArray(); FixtureRoot = $fixtureRoot; ActualInstallationWritten = $false }
Write-Host "$($passed.Count) safe-sync tests passed. Fixtures/evidence: $fixtureRoot"
