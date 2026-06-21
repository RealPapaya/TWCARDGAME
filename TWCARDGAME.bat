@echo off
REM === KEEP THIS BATCH SECTION 100%% ASCII ===
REM Do NOT chcp 65001 and do NOT put any non-ASCII (Chinese) text above the
REM PSCODE marker. Under cmd's OEM codepage, multi-byte UTF-8 bytes desync the
REM batch parser and it falls through "exit /b" into the PowerShell section.
REM All encoding/Chinese is handled INSIDE PowerShell below.
setlocal
set "BATDIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%~f0'; $m='#PS'+'CODE#'; $f=[IO.File]::ReadAllText($p,[Text.Encoding]::UTF8); $i=$f.IndexOf($m); Invoke-Expression $f.Substring($i+$m.Length)"
if errorlevel 1 (
  echo.
  echo [ERROR] PowerShell exited abnormally. errorlevel=%errorlevel%
  pause
)
endlocal
exit /b

#PSCODE#
# ===================== TWCARDGAME 控制台 (PowerShell) =====================
try {
  $ErrorActionPreference = 'Stop'
  try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

  $root = $env:BATDIR
  if (-not $root) { $root = (Get-Location).Path }
  $root = $root.TrimEnd('\')
  Set-Location -LiteralPath $root

  # 在新視窗開長駐指令 (dev server)，選單不會被卡住
  function Start-DevWindow($title, $cmd) {
    Start-Process -FilePath "cmd.exe" -ArgumentList @('/k', "title $title & $cmd") -WorkingDirectory $root | Out-Null
  }

  # 在目前視窗跑一次性指令 (部署)，結束後回選單
  function Run-Inline($cmd) {
    Write-Host ""
    Write-Host "  > 執行: $cmd" -ForegroundColor Yellow
    Write-Host "  ----------------------------------------------------------" -ForegroundColor DarkGray
    & cmd.exe /c $cmd
    $code = $LASTEXITCODE
    Write-Host "  ----------------------------------------------------------" -ForegroundColor DarkGray
    if ($code -eq 0) { Write-Host "  [OK] 完成 (exit $code)" -ForegroundColor Green }
    else { Write-Host "  [FAIL] 失敗 (exit $code)" -ForegroundColor Red }
  }

  $items = @(
    @{ Label = '啟動 前端 (vite, http://localhost:5173)';       Pause = $false; Action = { Start-DevWindow 'web-dev'      'npm run dev:web' } }
    @{ Label = '啟動 後端 realtime (wrangler dev)';             Pause = $false; Action = { Start-DevWindow 'realtime-dev' 'npm run dev -w @twcardgame/realtime' } }
    @{ Label = '啟動 前端 + 後端 (兩個視窗)';                   Pause = $false; Action = { Start-DevWindow 'web-dev' 'npm run dev:web'; Start-DevWindow 'realtime-dev' 'npm run dev -w @twcardgame/realtime' } }
    @{ Label = '-- 開啟瀏覽器 ------------------------------';   Separator = $true }
    @{ Label = '開啟 平衡編輯器  /balance-editor.html';         Pause = $false; Action = { Start-Process 'http://localhost:5173/balance-editor.html' } }
    @{ Label = '開啟 測試模式    /?auth=dev&testMode=1';        Pause = $false; Action = { Start-Process 'http://localhost:5173/?auth=dev&testMode=1' } }
    @{ Label = '-- 部署上線 --------------------------------';   Separator = $true }
    @{ Label = '部署 前端 Pages  (build + pages deploy)';        Pause = $true;  Action = { Run-Inline 'npm run build && npm run pages:deploy -w @twcardgame/web -- --branch=main' } }
    @{ Label = '部署 後端 Worker (realtime deploy)';            Pause = $true;  Action = { Run-Inline 'npm run deploy -w @twcardgame/realtime' } }
    @{ Label = '上傳 R2 資產     (assets upload)';              Pause = $true;  Action = { Run-Inline 'npm run assets:upload -w @twcardgame/web' } }
    @{ Label = '一鍵部署全部     (前端 + 後端 + 資產)';         Pause = $true;  Action = { Run-Inline 'npm run build && npm run pages:deploy -w @twcardgame/web -- --branch=main && npm run deploy -w @twcardgame/realtime && npm run assets:upload -w @twcardgame/web' } }
    @{ Label = '-- 其他 ------------------------------------';   Separator = $true }
    @{ Label = '測試 + 型別檢查  (npm test && npm run check)';  Pause = $true;  Action = { Run-Inline 'npm test && npm run check' } }
  )

  function Show-Menu($sel) {
    Clear-Host
    Write-Host ""
    Write-Host "   ============================================" -ForegroundColor Cyan
    Write-Host "          TWCARDGAME  開發 / 部署 控制台" -ForegroundColor Cyan
    Write-Host "   ============================================" -ForegroundColor Cyan
    Write-Host ""
    for ($i = 0; $i -lt $items.Count; $i++) {
      $it = $items[$i]
      if ($it.Separator) { Write-Host ("      " + $it.Label) -ForegroundColor DarkGray; continue }
      if ($i -eq $sel) { Write-Host ("    > " + $it.Label + " ") -ForegroundColor Black -BackgroundColor Cyan }
      else { Write-Host ("      " + $it.Label) -ForegroundColor Gray }
    }
    Write-Host ""
    Write-Host "   方向鍵 上/下 移動    Enter 執行    Esc / Q 離開" -ForegroundColor DarkGray
  }

  function Move-Sel($sel, $dir) {
    $n = $items.Count
    do { $sel = (($sel + $dir) % $n + $n) % $n } while ($items[$sel].Separator)
    return $sel
  }

  function Invoke-Item($it) {
    Clear-Host
    & $it.Action
    if ($it.Pause) {
      Write-Host ""
      Write-Host "   按 Enter 返回選單..." -ForegroundColor DarkGray
      Read-Host | Out-Null
    }
  }

  # 起始落在第一個非分隔列
  $sel = 0
  while ($items[$sel].Separator) { $sel++ }

  # 偵測能否用方向鍵 (互動式 console)；不能就退回數字輸入模式
  $useArrows = $true
  try { [void][Console]::KeyAvailable } catch { $useArrows = $false }

  if (-not $useArrows) {
    # ---- 數字輸入備援模式 ----
    while ($true) {
      Show-Menu -1
      $pick = Read-Host "   輸入編號 (1-$($items.Count))，或 q 離開"
      if ($pick -eq 'q') { return }
      $idx = 0
      if ([int]::TryParse($pick, [ref]$idx) -and $idx -ge 1 -and $idx -le $items.Count) {
        $it = $items[$idx - 1]
        if (-not $it.Separator) { Invoke-Item $it }
      }
    }
  }

  # ---- 方向鍵模式 ----
  while ($true) {
    Show-Menu $sel
    $key = [Console]::ReadKey($true)
    switch ($key.Key) {
      'UpArrow'   { $sel = Move-Sel $sel -1 }
      'DownArrow' { $sel = Move-Sel $sel 1 }
      'Escape'    { Clear-Host; return }
      'Q'         { Clear-Host; return }
      'Enter'     { Invoke-Item $items[$sel] }
    }
  }
}
catch {
  Write-Host ""
  Write-Host "  [控制台錯誤] $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "  位置: $($_.InvocationInfo.PositionMessage)" -ForegroundColor DarkRed
  Write-Host ""
  Write-Host "  按 Enter 關閉..." -ForegroundColor DarkGray
  try { Read-Host | Out-Null } catch {}
  exit 1
}
