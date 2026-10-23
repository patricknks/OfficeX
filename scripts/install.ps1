# One-time setup for OfficeX on Windows. Run install.cmd (double-click). Safe to run again.
#  1. server.json: instance name, language, port, URL path, password for other devices, company folder
#  2. packages + build
#  3. "OfficeX" shortcut on the Desktop and in the Start menu (start/stop toggle)
#  4. Windows Firewall rule: allow the GUI port from the local network and from Tailscale (100.64.0.0/10)

param(
  [switch]$FirewallOnly,
  [int]$Port = 80,
  [string]$Instance = 'OfficeX'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

function Add-FirewallRule([int]$p) {
  $RuleName = "$Instance (TCP $p)"
  Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $RuleName `
    -Description 'OfficeX: local network and Tailscale only' `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort $p `
    -RemoteAddress @('LocalSubnet', '100.64.0.0/10') -Profile Any | Out-Null
  Write-Host "Firewall: TCP $p allowed from the local network and Tailscale."
}

if ($FirewallOnly) { Add-FirewallRule $Port; exit 0 }

function Ask([string]$question, [string]$current) {
  $answer = Read-Host "$question [$current]"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $current }
  return $answer.Trim()
}

Write-Host ''
Write-Host 'OfficeX setup' -ForegroundColor Cyan
Write-Host '------------------'

# ---- 1. config ----
# Enter keeps the value in brackets, so running this again only changes what you type.
$ConfigFile = Join-Path $Root 'server.json'
if (Test-Path $ConfigFile) { $cfg = (Get-Content $ConfigFile -Raw) -replace '^\uFEFF', '' | ConvertFrom-Json }
else { $cfg = Get-Content (Join-Path $Root 'server.example.json') -Raw | ConvertFrom-Json }
function Pick($value, [string]$default) { if ($value) { return [string]$value } return $default }
$cur = @{
  instance    = Pick $cfg.instanceName 'OfficeX'
  language    = Pick $cfg.language 'en'
  port        = Pick $cfg.port '80'
  basePath    = '/OfficeX'
  password    = Pick $cfg.password ''
  companyRoot = Pick $cfg.companyRoot ''
}

Write-Host 'Use a different instance name and port for a development copy, e.g. "OfficeX DEV" on 8080.'
$Instance = Ask 'Instance name (shortcut and firewall rule)' $cur.instance
$lang = Ask 'GUI language (en/id)' $cur.language
if ($lang -ne 'en') { $lang = 'id' }
$portIn = Ask 'Port for the GUI (80 = http://<ip>/ without a port)' $cur.port
if ($portIn -notmatch '^\d+$') { $portIn = '80' }
if ($null -ne $cfg.basePath) { $cur.basePath = [string]$cfg.basePath; if (-not $cur.basePath) { $cur.basePath = '/' } }
if ($cur.basePath -eq '/officeai') { $cur.basePath = '/OfficeX' }  # old default before the rename
$baseIn = Ask 'URL path, e.g. /OfficeX -> http://<ip>/OfficeX/  ("/" = no path)' $cur.basePath
$baseIn = $baseIn.Trim().Trim('/')
if ($baseIn) { $baseIn = "/$baseIn" }

Write-Host ''
Write-Host 'Other devices (LAN / Tailscale) can be asked for a password. This computer never is.'
$pwShown = '(none)'
if ($cur.password) { $pwShown = '(keep current)' }
$pw = Read-Host "Password for other devices, '-' to remove $pwShown"
if ([string]::IsNullOrWhiteSpace($pw)) { $pw = $cur.password } elseif ($pw -eq '-') { $pw = '' }

Write-Host ''
Write-Host 'Company folder: goals, projects, chats and agent memory live here. Keep it outside this app folder.'
$companyRoot = Ask 'Company folder' $cur.companyRoot
if ($companyRoot -and -not (Test-Path $companyRoot)) {
  New-Item -ItemType Directory -Force (Join-Path $companyRoot 'projects') | Out-Null
  Write-Host "Created $companyRoot"
}

$out = [ordered]@{ instanceName = $Instance; host = '0.0.0.0'; port = [int]$portIn; basePath = $baseIn; password = $pw; language = $lang; companyRoot = $companyRoot }
# keep every other setting (engine limits, claudePath, python, ...) from the current or example file
foreach ($prop in $cfg.PSObject.Properties) { if (-not $out.Contains($prop.Name)) { $out[$prop.Name] = $prop.Value } }
# UTF-8 without BOM so Node reads it as-is
[IO.File]::WriteAllText($ConfigFile, ($out | ConvertTo-Json), (New-Object System.Text.UTF8Encoding $false))
Write-Host "Saved $ConfigFile"

# ---- 2. Node.js, packages, build ----
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ''
  Write-Host 'Node.js is not installed.' -ForegroundColor Yellow
  $ans = Read-Host 'Install Node.js LTS now with winget? [Y/n]'
  if ($ans -ne 'n') {
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  }
}
if (Get-Command node -ErrorAction SilentlyContinue) {
  Push-Location $Root
  Write-Host ''
  Write-Host 'Installing packages and building the app...'
  cmd /c 'npm install --no-audit --no-fund'
  cmd /c 'npm run build'
  Pop-Location
  # GUI sign-in to a Claude account (Connect dialog) runs claude in a pseudo terminal: needs pywinpty
  if (Get-Command python -ErrorAction SilentlyContinue) { cmd /c 'python -m pip install --user --quiet pywinpty' }
}
else {
  Write-Host 'Skipping install: Node.js is still missing. Install it, then run install.cmd again.' -ForegroundColor Yellow
}

# ---- 3. shortcuts ----
$shell = New-Object -ComObject WScript.Shell
$launcher = Join-Path $PSScriptRoot 'OfficeX.ps1'
$icon = Join-Path $PSScriptRoot 'officex.ico'
function New-Shortcut([string]$path, [string]$action, [string]$description) {
  $s = $shell.CreateShortcut($path)
  $s.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`" $action"
  $s.WorkingDirectory = $Root
  $s.IconLocation = "$icon,0"
  $s.WindowStyle = 7
  $s.Description = $description
  $s.Save()
}
$desktop = [Environment]::GetFolderPath('Desktop')
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'OfficeX'
New-Item -ItemType Directory -Force $menu | Out-Null
New-Shortcut (Join-Path $desktop "$Instance.lnk") 'toggle' "Start $Instance, or open/stop it when it is running"
New-Shortcut (Join-Path $menu "$Instance.lnk") 'toggle' "Start $Instance, or open/stop it when it is running"
New-Shortcut (Join-Path $menu "Stop $Instance.lnk") 'stop' "Stop $Instance and all agents"
Write-Host ''
Write-Host "Shortcuts: Desktop\$Instance, Start menu\OfficeX\$Instance"

# ---- 4. firewall (needs administrator) ----
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) { Add-FirewallRule $out.port }
else {
  Write-Host 'Asking for administrator rights to add the firewall rule...'
  try {
    Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -FirewallOnly -Port $($out.port) -Instance `"$Instance`""
    Write-Host "Firewall: TCP $($out.port) allowed from the local network and Tailscale."
  }
  catch { Write-Host 'Firewall rule skipped. Other devices may not reach the GUI until port is allowed.' -ForegroundColor Yellow }
}

# ---- 5. where to open it ----
$suffix = ''
if ($out.port -ne 80) { $suffix = ":$($out.port)" }
Write-Host ''
Write-Host 'Open OfficeX from:' -ForegroundColor Cyan
Write-Host "  this computer:  http://localhost$suffix$($out.basePath)/"
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  ForEach-Object { Write-Host "  other devices:  http://$($_.IPAddress)$suffix$($out.basePath)/   ($($_.InterfaceAlias))" }
Write-Host ''
Write-Host 'From Tailscale devices, the LAN address works when the subnet router advertises this LAN'
Write-Host '(and the route is approved in the Tailscale admin console).'
Write-Host ''
