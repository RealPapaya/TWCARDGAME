# Batch convert PNG to WebP using cwebp (Google's official WebP encoder)
# This script will download cwebp if not found

$quality = 85  # WebP quality (0-100)

Write-Host "PNG to WebP Batch Converter" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan
Write-Host ""

# Check if cwebp exists
$cwebpPath = ".\cwebp.exe"
if (-not (Test-Path $cwebpPath)) {
    Write-Host "cwebp not found. Downloading..." -ForegroundColor Yellow
    
    # Download libwebp
    $webpUrl = "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.3.2-windows-x64.zip"
    $zipFile = ".\libwebp.zip"
    
    try {
        Invoke-WebRequest -Uri $webpUrl -OutFile $zipFile
        Expand-Archive -Path $zipFile -DestinationPath ".\libwebp" -Force
        Copy-Item ".\libwebp\libwebp-1.3.2-windows-x64\bin\cwebp.exe" -Destination $cwebpPath
        Remove-Item $zipFile
        Remove-Item ".\libwebp" -Recurse
        Write-Host "Downloaded cwebp successfully!" -ForegroundColor Green
    }
    catch {
        Write-Host "Failed to download cwebp: $_" -ForegroundColor Red
        Write-Host "Please download manually from: https://developers.google.com/speed/webp/download" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "Using cwebp from: $cwebpPath" -ForegroundColor Green
Write-Host ""

# Find all PNG files
$pngFiles = Get-ChildItem -Path "." -Recurse -Include "*.webp", "*.webp" -File
$totalFiles = $pngFiles.Count
$convertedFiles = 0
$totalOriginalSize = 0
$totalNewSize = 0

Write-Host "Found $totalFiles PNG files" -ForegroundColor Cyan
Write-Host ""

foreach ($file in $pngFiles) {
    $relativePath = $file.FullName.Substring((Get-Location).Path.Length + 1)
    $outputPath = [System.IO.Path]::ChangeExtension($file.FullName, "webp")
    
    $originalSize = $file.Length
    $originalSizeKB = [math]::Round($originalSize / 1KB, 2)
    
    Write-Host "[$($convertedFiles + 1)/$totalFiles] $relativePath" -ForegroundColor Yellow
    Write-Host "  Original: $originalSizeKB KB" -ForegroundColor Gray
    
    try {
        # Run cwebp
        $process = Start-Process -FilePath $cwebpPath -ArgumentList "-q $quality `"$($file.FullName)`" -o `"$outputPath`"" -Wait -NoNewWindow -PassThru
        
        if ($process.ExitCode -eq 0 -and (Test-Path $outputPath)) {
            $newSize = (Get-Item $outputPath).Length
            $newSizeKB = [math]::Round($newSize / 1KB, 2)
            $savedPct = [math]::Round(100 - ($newSize / $originalSize * 100), 1)
            
            Write-Host "  WebP: $newSizeKB KB (saved $savedPct%)" -ForegroundColor Green
            
            $totalOriginalSize += $originalSize
            $totalNewSize += $newSize
            $convertedFiles++
        }
        else {
            Write-Host "  FAILED to convert" -ForegroundColor Red
        }
    }
    catch {
        Write-Host "  ERROR: $_" -ForegroundColor Red
    }
    
    Write-Host ""
}

$totalOriginalMB = [math]::Round($totalOriginalSize / 1MB, 2)
$totalNewMB = [math]::Round($totalNewSize / 1MB, 2)
$totalSavedPct = [math]::Round(100 - ($totalNewSize / $totalOriginalSize * 100), 1)

Write-Host "====== Conversion Complete ======" -ForegroundColor Green
Write-Host "Converted: $convertedFiles / $totalFiles files" -ForegroundColor Cyan
Write-Host "Original size: $totalOriginalMB MB" -ForegroundColor Yellow
Write-Host "New size: $totalNewMB MB" -ForegroundColor Green
Write-Host "Total saved: $totalSavedPct%" -ForegroundColor Magenta
Write-Host ""
Write-Host "Next step: Replace .webp with .webp in your code" -ForegroundColor Cyan
