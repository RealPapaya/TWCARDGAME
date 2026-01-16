
$filePath = Join-Path $PSScriptRoot "../src/legacy/app.js"
Write-Host "Reading $filePath..."

# Force UTF8 reading
$lines = Get-Content $filePath -Encoding UTF8
$lineCount = $lines.Count

function Find-LineIndex {
    param (
        [string]$Pattern,
        [int]$StartIndex = 0
    )
    for ($i = $StartIndex; $i -lt $lineCount; $i++) {
        if ($lines[$i] -match [regex]::Escape($Pattern)) {
            return $i
        }
    }
    return -1
}

$ranges = @()

# Range 1: formatDesc
$start1 = Find-LineIndex -Pattern "function formatDesc"
if ($start1 -ne -1) {
    $end1Marker = Find-LineIndex -Pattern "function renderMana" -StartIndex $start1
    if ($end1Marker -ne -1) {
        # Delete up to renderMana - 1
        $obj = New-Object PSObject -Property @{Start = $start1; End = $end1Marker - 1 }
        $ranges += $obj
        Write-Host "Marked formatDesc for deletion: $($start1+1) to $end1Marker"
    }
}

# Range 2: Drag Logic & Visuals (Modified pattern check)
$start2 = Find-LineIndex -Pattern "function onDragStart"
if ($start2 -ne -1) {
    # Check context menu listener
    $end2Marker = Find-LineIndex -Pattern "document.addEventListener('contextmenu'" -StartIndex $start2
    if ($end2Marker -ne -1) {
        $obj = New-Object PSObject -Property @{Start = $start2; End = $end2Marker - 1 }
        $ranges += $obj
        Write-Host "Marked Drag Logic for deletion: $($start2+1) to $end2Marker"
    }
    else {
        # Fallback if contextmenu not found or moved
        Write-Warning "Could not find end marker for Drag Logic"
    }
}
else {
    Write-Warning "Could not find onDragStart"
}

# Range 3: Remaining Visuals
$start3 = Find-LineIndex -Pattern "function triggerFullBoardHealAnimation"
if ($start3 -ne -1) {
    $end3Marker = Find-LineIndex -Pattern "// Make function globally accessible" -StartIndex $start3
    if ($end3Marker -ne -1) {
        $obj = New-Object PSObject -Property @{Start = $start3; End = $end3Marker - 1 }
        $ranges += $obj
        Write-Host "Marked Visuals 2 for deletion: $($start3+1) to $end3Marker"
    }
}

# Sort ranges descending
$ranges = $ranges | Sort-Object -Property Start -Descending

$newLines = [System.Collections.ArrayList]::new($lines)

foreach ($r in $ranges) {
    $count = $r.End - $r.Start
    if ($count -gt 0) {
        for ($i = 0; $i -lt $count; $i++) {
            if ($r.Start -lt $newLines.Count) {
                $newLines.RemoveAt($r.Start)
            }
        }
        Write-Host "Deleted $count lines starting at $($r.Start)"
    }
}

# Force UTF8 writing (Set-Content uses default unless specified, but usually UTF8 in Core or ANSI in WinPS)
# Using [System.IO.File]::WriteAllLines to be safe and consistent
$finalContent = $newLines.ToArray()
[System.IO.File]::WriteAllLines($filePath, $finalContent)

Write-Host "Done."
