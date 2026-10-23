# OfficeX launcher for Windows.
#   OfficeX.ps1 toggle   start if stopped; if running, ask whether to open the GUI or stop
#   OfficeX.ps1 start | stop | status | open | tray
#   tray: the icon next to the clock while the server runs (started by start; right-click for open / stop / log)
# The desktop shortcut made by install.cmd runs "toggle".

param(
  [ValidateSet('toggle', 'start', 'stop', 'status', 'open', 'tray')]
  [string]$Action = 'toggle'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Logs = Join-Path $Root 'logs'
$PidFile = Join-Path $Logs 'server.pid'
$ConfigFile = Join-Path $Root 'server.json'
$IconFile = Join-Path $PSScriptRoot 'officex.ico'
New-Item -ItemType Directory -Force $Logs | Out-Null

if (-not (Test-Path $ConfigFile)) { Copy-Item (Join-Path $Root 'server.example.json') $ConfigFile }
$Config = (Get-Content $ConfigFile -Raw) -replace '^\uFEFF', '' | ConvertFrom-Json
$Port = 80
if ($Config.port) { $Port = [int]$Config.port }
$AppTitle = 'OfficeX'
if ($Config.instanceName) { $AppTitle = [string]$Config.instanceName }
# Windows notifications and dialogs are English only; the GUI follows server.json language.
$Lang = 'en'
$Suffix = ''
if ($Port -ne 80) { $Suffix = ":$Port" }
# URL path of the GUI, e.g. /OfficeX -> http://localhost/OfficeX/
$Base = '/OfficeX'
if ($null -ne $Config.basePath) { $Base = ([string]$Config.basePath).Trim('/'); if ($Base) { $Base = "/$Base" } }
$LocalUrl = "http://localhost$Suffix$Base/"
$ApiBase = "http://127.0.0.1:$Port"

$Text = @{
  en = @{
    noNode     = "Node.js is not installed.`n`nInstall Node.js LTS from https://nodejs.org (or run: winget install OpenJS.NodeJS.LTS), then open OfficeX again."
    installing = 'First run: installing packages. This can take a few minutes.'
    building   = 'Building the app...'
    started    = "OfficeX is running.`n{0}"
    failed     = "OfficeX could not start.`n`n{0}`n`nFull log: {1}"
    running    = "OfficeX is running.`n{0}`n`nYes: open the app`nNo: stop OfficeX`nCancel: do nothing"
    stopping   = 'Stopping OfficeX. Agents finish their current step first.'
    stopped    = 'OfficeX has stopped.'
    trayRunning = 'OfficeX is running'
    trayOpen   = 'Open OfficeX'
    trayStop   = 'Stop OfficeX'
    trayLog    = 'Show log'
    trayHide   = 'Hide this icon'
    notRunning = 'OfficeX is not running.'
    npmFailed  = "Installing or building failed. See {0}"
  }
}
function Msg([string]$key, [object[]]$fmt = @()) {
  $s = $Text[$Lang][$key]
  if ($fmt.Count) { $s = $s -f $fmt }
  return $s
}

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Show-Box([string]$message, [string]$buttons = 'OK', [string]$icon = 'Information') {
  return [System.Windows.MessageBox]::Show($message, $AppTitle, $buttons, $icon)
}

$script:Tray = $null
function Show-Note([string]$message) {
  # non-blocking notification near the clock
  if (-not $script:Tray) {
    $script:Tray = New-Object System.Windows.Forms.NotifyIcon
    if (Test-Path $IconFile) { $script:Tray.Icon = New-Object System.Drawing.Icon $IconFile }
    else { $script:Tray.Icon = [System.Drawing.SystemIcons]::Information }
    $script:Tray.Visible = $true
  }
  $script:Tray.ShowBalloonTip(4000, $AppTitle, $message, 'Info')
}
function Close-Note {
  if ($script:Tray) { Start-Sleep -Seconds 4; $script:Tray.Dispose(); $script:Tray = $null }
}

function Get-ServerProcess {
  if (Test-Path $PidFile) {
    $id = (Get-Content $PidFile -Raw).Trim()
    if ($id) {
      $p = Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue
      if ($p -and $p.ProcessName -eq 'node') { return $p }
    }
  }
  return $null
}

function Test-Health {
  try { Invoke-RestMethod "$ApiBase/api/health" -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

function Get-Urls {
  $list = @($LocalUrl)
  try { $list += (Invoke-RestMethod "$ApiBase/api/info" -TimeoutSec 2).urls } catch { }
  return ($list -join "`n")
}

function Invoke-Npm([string]$npmArgs) {
  $log = Join-Path $Logs 'npm.log'
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList "/c npm $npmArgs >> `"$log`" 2>&1" -WorkingDirectory $Root -WindowStyle Hidden -Wait -PassThru
  if ($p.ExitCode -ne 0) { Show-Box (Msg 'npmFailed' @($log)) 'OK' 'Error' | Out-Null; exit 1 }
}

function Test-NeedsBuild {
  $index = Join-Path $Root 'dist\index.html'
  if (-not (Test-Path $index)) { return $true }
  $built = (Get-Item $index).LastWriteTime
  $sources = @(Join-Path $Root 'src') + @(Join-Path $Root 'index.html') + @(Join-Path $Root 'package.json')
  $newer = Get-ChildItem $sources -Recurse -File | Where-Object { $_.LastWriteTime -gt $built } | Select-Object -First 1
  return [bool]$newer
}

function Start-App {
  if ((Get-ServerProcess) -or (Test-Health)) { Start-Process $LocalUrl; return }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Show-Box (Msg 'noNode') 'OK' 'Warning' | Out-Null; exit 1 }

  # install when packages are missing or package-lock.json changed since the last install
  $lockSrc = Join-Path $Root 'package-lock.json'
  $lockInst = Join-Path $Root 'node_modules\.package-lock.json'
  if (-not (Test-Path $lockInst) -or ((Get-Item $lockSrc).LastWriteTime -gt (Get-Item $lockInst).LastWriteTime)) {
    Show-Note (Msg 'installing'); Invoke-Npm 'install --no-audit --no-fund'
  }
  if (Test-NeedsBuild) { Show-Note (Msg 'building'); Invoke-Npm 'run build' }

  $node = (Get-Command node).Source
  $proc = Start-Process -FilePath $node -ArgumentList 'server\serve.mjs' -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Health) { break }
    if ($proc.HasExited) { break }
  }
  if (-not (Test-Health)) {
    $logFile = Join-Path $Logs 'server.log'
    $tail = ''
    if (Test-Path $logFile) { $tail = (Get-Content $logFile -Tail 3) -join "`n" }
    Show-Box (Msg 'failed' @($tail, $logFile)) 'OK' 'Error' | Out-Null
    exit 1
  }
  Start-Tray
  Show-Note (Msg 'started' @(Get-Urls))
  Start-Process $LocalUrl
  Close-Note
}

# ---- persistent tray icon (its own hidden PowerShell process; one per port)
function Start-Tray {
  $created = $false
  $m = New-Object System.Threading.Mutex($false, "Local\OfficeX.tray.$Port", [ref]$created)
  $free = $m.WaitOne(0)
  if ($free) { $m.ReleaseMutex() }
  $m.Dispose()
  if (-not $free) { return }  # already shown
  $ps = (Get-Command powershell).Source
  Start-Process -FilePath $ps -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" tray" -WindowStyle Hidden | Out-Null
}
function Run-Tray {
  $created = $false
  $script:TrayMutex = New-Object System.Threading.Mutex($false, "Local\OfficeX.tray.$Port", [ref]$created)
  if (-not $script:TrayMutex.WaitOne(0)) { exit 0 }
  $script:TrayIcon = New-Object System.Windows.Forms.NotifyIcon
  if (Test-Path $IconFile) { $script:TrayIcon.Icon = New-Object System.Drawing.Icon $IconFile } else { $script:TrayIcon.Icon = [System.Drawing.SystemIcons]::Application }
  $script:TrayIcon.Text = "$AppTitle - $(Msg 'trayRunning')"
  $menu = New-Object System.Windows.Forms.ContextMenuStrip
  $title = $menu.Items.Add("$AppTitle  $LocalUrl"); $title.Enabled = $false
  $menu.Items.Add('-') | Out-Null
  $menu.Items.Add((Msg 'trayOpen'), $null, { Start-Process $LocalUrl }) | Out-Null
  $menu.Items.Add((Msg 'trayLog'), $null, { Start-Process (Join-Path $Logs 'server.log') }) | Out-Null
  $menu.Items.Add('-') | Out-Null
  $menu.Items.Add((Msg 'trayStop'), $null, {
    $script:TrayIcon.Visible = $false
    try { Invoke-RestMethod -Method Post "$ApiBase/api/shutdown" -TimeoutSec 5 | Out-Null } catch { }
    [System.Windows.Forms.Application]::Exit()
  }) | Out-Null
  $menu.Items.Add((Msg 'trayHide'), $null, { $script:TrayIcon.Visible = $false; [System.Windows.Forms.Application]::Exit() }) | Out-Null
  $script:TrayIcon.ContextMenuStrip = $menu
  $script:TrayIcon.add_DoubleClick({ Start-Process $LocalUrl })
  $script:TrayIcon.Visible = $true
  # leave with the server: gone for two checks in a row, the icon goes too
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 10000
  $script:TrayMisses = 0
  $timer.add_Tick({
    if ((Get-ServerProcess) -or (Test-Health)) { $script:TrayMisses = 0 }
    else { $script:TrayMisses++; if ($script:TrayMisses -ge 2) { $script:TrayIcon.Visible = $false; [System.Windows.Forms.Application]::Exit() } }
  })
  $timer.Start()
  [System.Windows.Forms.Application]::Run()
  $script:TrayIcon.Dispose()
}

function Stop-App {
  $proc = Get-ServerProcess
  if (-not $proc -and -not (Test-Health)) { Show-Box (Msg 'notRunning') | Out-Null; return }
  Show-Note (Msg 'stopping')
  try { Invoke-RestMethod -Method Post "$ApiBase/api/shutdown" -TimeoutSec 5 | Out-Null } catch { }
  if ($proc) {
    # give agents time to finish their current step, then force
    if (-not $proc.WaitForExit(30000)) { Stop-Process -Id $proc.Id -Force }
  }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
  Show-Note (Msg 'stopped')
  Close-Note
}

switch ($Action) {
  'tray' { Run-Tray }
  'start' { Start-App }
  'stop' { Stop-App }
  'open' { Start-Process $LocalUrl }
  'status' {
    if ((Get-ServerProcess) -or (Test-Health)) { Write-Output "running`n$(Get-Urls)" } else { Write-Output 'stopped' }
  }
  'toggle' {
    if ((Get-ServerProcess) -or (Test-Health)) {
      $answer = Show-Box (Msg 'running' @(Get-Urls)) 'YesNoCancel' 'Question'
      if ($answer -eq 'Yes') { Start-Process $LocalUrl }
      elseif ($answer -eq 'No') { Stop-App }
    }
    else { Start-App }
  }
}
