param(
  [int]$Port = 7432,
  [switch]$Quiet
)

function Log($msg) {
  if (-not $Quiet) { Write-Host $msg }
}

$pids = @()
try {
  $pids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
} catch {
  $lines = netstat -ano | Select-String ":$Port\s+.*LISTENING"
  foreach ($line in $lines) {
    if ($line -match '\s+(\d+)\s*$') { $pids += [int]$Matches[1] }
  }
  $pids = $pids | Select-Object -Unique
}

if (-not $pids -or $pids.Count -eq 0) {
  Log "Port $Port tidak digunakan."
  exit 0
}

foreach ($procId in $pids) {
  try {
    $proc = Get-Process -Id $procId -ErrorAction Stop
    Log "Menghentikan PID $procId ($($proc.ProcessName)) pada port $Port..."
    Stop-Process -Id $procId -Force -ErrorAction Stop
  } catch {
    Log "Gagal menghentikan PID ${procId}: $($_.Exception.Message)"
  }
}

Start-Sleep -Milliseconds 400
exit 0
