# Update this copy of OfficeX and restart it. Meant for the production copy.
#   stop (agents finish their step) -> git pull (only for a git clone) -> npm ci -> build -> start
# A copy made without git (folder copy or zip): put the new files in place first, then run this to rebuild.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$launcher = Join-Path $PSScriptRoot 'OfficeX.ps1'

$isClone = Test-Path (Join-Path $Root '.git')
if ($isClone -and -not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is not installed. Install it with: winget install Git.Git' }

$status = & $launcher -Action status
$wasRunning = "$status" -like 'running*'
if ($wasRunning) { Write-Host 'Stopping OfficeX...'; & $launcher -Action stop }

if ($isClone) {
  Write-Host 'Pulling the latest version...'
  git fetch origin
  if ($LASTEXITCODE -ne 0) { throw 'git fetch failed. Check the network and the repository URL, then run update again.' }
  $branch = (git rev-parse --abbrev-ref HEAD).Trim()
  $dirty = (git status --porcelain --untracked-files=no)
  if ($dirty) { throw "This copy has local changes; commit, stash or discard them first, then run update again.`n$dirty" }
  # a production copy mirrors the branch exactly, also after the history was rewritten upstream
  git reset --hard "origin/$branch"
  if ($LASTEXITCODE -ne 0) { throw 'git reset failed. See the output above.' }
  git log -1 --format='Now at %h  %s  (%cr)'
}
else { Write-Host 'Not a git clone: skipping pull, rebuilding from the files in this folder.' }

Write-Host 'Installing packages...'
cmd /c 'npm ci --no-audit --no-fund'
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed. See the output above.' }
Write-Host 'Building...'
cmd /c 'npm run build'
if ($LASTEXITCODE -ne 0) { throw 'Build failed. The previous version is still in dist\ only if the build did not start; run the build again after fixing.' }

if ($wasRunning) { Write-Host 'Starting OfficeX...'; & $launcher -Action start }
Write-Host 'Done.'
