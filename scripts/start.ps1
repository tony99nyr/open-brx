# Open BRX: set up and start Mission Control on Windows. Run it through start.cmd in the repository root.
# This file only makes sure Node.js 20.11 or later exists; scripts/start.mjs does the rest.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-Node {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  node -e 'const [a,b]=process.versions.node.split(/[.]/).map(Number);process.exit(a>20||(a===20&&b>=11)?0:1)'
  return ($LASTEXITCODE -eq 0)
}

if (-not (Test-Node)) {
  Write-Host 'Open BRX needs Node.js 20.11 or later, and this computer does not have it.'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $answer = Read-Host 'Install Node.js with winget now? [Y/n]'
    if ($answer -notmatch '^[Nn]') {
      winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
      # winget writes PATH to the registry. Read it back so this window can see the new node.exe.
      $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    }
  }
  if (-not (Test-Node)) {
    Write-Host ''
    Write-Host 'Install the LTS version of Node.js from https://nodejs.org/'
    Write-Host 'Then open a new terminal and run start.cmd again.'
    exit 1
  }
}

node scripts/start.mjs @args
exit $LASTEXITCODE
