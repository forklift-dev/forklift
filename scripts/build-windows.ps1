# Builds the Windows packages (NSIS installer and ZIP) in one go, from a fresh machine if need be:
#   powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
# Installs what is missing (git, Node.js, Python 3.12, Visual Studio 2022 Build Tools with C++ and Spectre
# libraries) with winget, then: npm ci, native modules for Electron, packaging, fuse check. Artifacts land
# in dist\.
#
#   -SkipSetup   do not check or install the tools (they are there)
#   -Test        also typecheck, lint and unit tests (many unit tests assume a POSIX shell: expect failures)
#   -Clean       rebuild native modules and OpenSSL from scratch
#   -Arch arm64  build for ARM64 (default: this machine's architecture; build each on a matching machine)
param(
    [switch]$SkipSetup,
    [switch]$Test,
    [switch]$Clean,
    [ValidateSet('x64', 'arm64')][string]$Arch = $(if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' })
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

function Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }

function Invoke-Checked([string]$What, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)" }
}

function Update-Path {
    $env:Path = (@([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User')) |
        Where-Object { $_ }) -join ';'
}

# winget: installs only what is missing. Exit codes: already installed / no newer version.
function Install-Package([string]$Id, [string]$Override = '') {
    Step "Installing $Id"
    $arguments = @('install', '--id', $Id, '--exact', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity')
    if ($Override) { $arguments += @('--override', $Override) }
    & winget @arguments
    if (@(0, -1978335189, -1978334963, -1978334962) -notcontains $LASTEXITCODE) { throw "winget failed for $Id (exit code $LASTEXITCODE)" }
}

$VsWhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$VcTools = if ($Arch -eq 'arm64') { 'Microsoft.VisualStudio.Component.VC.Tools.ARM64' } else { 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64' }
# nodegit's build asks for the Spectre-mitigated libraries.
$Spectre = if ($Arch -eq 'arm64') { 'Microsoft.VisualStudio.Component.VC.Runtimes.ARM64.Spectre' } else { 'Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre' }

function Get-BuildTools([string[]]$Requires = @()) {
    if (-not (Test-Path -LiteralPath $VsWhere)) { return $null }
    $arguments = @('-latest', '-products', 'Microsoft.VisualStudio.Product.BuildTools', '-version', '[17.0,18.0)', '-property', 'installationPath')
    foreach ($component in $Requires) { $arguments += @('-requires', $component) }
    $path = & $VsWhere @arguments 2>$null | Select-Object -First 1
    if ($path) { return $path.Trim() } else { return $null }
}

function Get-Python {
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($launcher) {
        $path = & $launcher.Source -3.12 -c 'import sys; print(sys.executable)' 2>$null
        if ($LASTEXITCODE -eq 0 -and $path) { return $path.Trim() }
    }
    $candidate = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
    if (Test-Path -LiteralPath $candidate) { return $candidate } else { return $null }
}

if (-not $SkipSetup) {
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'winget was not found: install "App Installer" from the Microsoft Store' }
    if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { Install-Package 'Git.Git' }
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node -or [version]((& node.exe --version).TrimStart('v')) -lt [version]'22.12.0') { Install-Package 'OpenJS.NodeJS.LTS' }
    if (-not (Get-Python)) { Install-Package 'Python.Python.3.12' }
    $workload = "--add Microsoft.VisualStudio.Workload.VCTools --add $VcTools --add $Spectre --includeRecommended"
    if (-not (Get-BuildTools)) {
        Install-Package 'Microsoft.VisualStudio.2022.BuildTools' "--wait --passive --norestart $workload"
    } elseif (-not (Get-BuildTools @($VcTools, $Spectre))) {
        Step 'Adding the C++ tools and Spectre libraries to Visual Studio Build Tools'
        $setup = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\setup.exe'
        $modify = @('modify', '--installPath', "`"$(Get-BuildTools)`"", '--passive', '--norestart') + ($workload -split ' ')
        $process = Start-Process -FilePath $setup -Verb RunAs -Wait -PassThru -ArgumentList $modify
        if (@(0, 1641, 3010) -notcontains $process.ExitCode) { throw "Visual Studio Installer failed (exit code $($process.ExitCode))" }
    }
    Update-Path
}

Step 'Checking the tools'
$BuildTools = Get-BuildTools @($VcTools, $Spectre)
if (-not $BuildTools) { throw "Visual Studio 2022 Build Tools with $VcTools and $Spectre were not found (run without -SkipSetup)" }
$Python = Get-Python
if (-not $Python) { throw 'Python 3.12 was not found (run without -SkipSetup)' }
$NodeDir = Split-Path -Parent (Get-Command node.exe).Source
$NodeVersion = (& node.exe --version).TrimStart('v')
if ([version]$NodeVersion -lt [version]'22.12.0') { throw "Node.js $NodeVersion is too old: 22.12 or newer is needed (winget upgrade OpenJS.NodeJS.LTS)" }
# Unquoted PATH entries with node first: MSBuild's custom build steps otherwise fail with "'node' is not recognized".
$env:Path = (@($NodeDir, (Split-Path -Parent $Python)) + ($env:Path -split ';' | ForEach-Object { $_.Trim().Trim('"') } | Where-Object { $_ }) | Select-Object -Unique) -join ';'
& git.exe --version; & node.exe --version; & $Python --version
Write-Host "Build Tools: $BuildTools"

$env:NODE_GYP_FORCE_PYTHON = $Python
$env:GYP_MSVS_VERSION = '2022'
$env:GYP_MSVS_OVERRIDE_PATH = $BuildTools
# Deprecated in npm 11 (it warns about them).
Remove-Item Env:npm_config_python, Env:npm_config_msvs_version -ErrorAction SilentlyContinue
# OpenSSL for nodegit is built once and kept here (npm ci deletes node_modules).
$env:FORKLIFT_OPENSSL_CACHE = Join-Path $env:LOCALAPPDATA 'forklift-build\openssl'

# Without install scripts: nodegit's own would build it for plain Node, and npm then often fails on Windows
# with EBUSY. scripts/rebuild-native.mjs builds every native module for Electron instead.
Step 'Installing dependencies'
Invoke-Checked 'npm ci' { & npm.cmd ci --ignore-scripts --no-audit --no-fund }

Step 'Building native modules for Electron'
$rebuildArguments = @('scripts\rebuild-native.mjs')
if ($Clean) { $rebuildArguments += '--force' }
Invoke-Checked 'Native module build' { & node.exe @rebuildArguments }

Step 'Loading the native modules in Electron'
$env:ELECTRON_RUN_AS_NODE = '1'
try {
    Invoke-Checked 'Native module check' {
        & (Join-Path $Root 'node_modules\.bin\electron.cmd') -e "for (const m of ['@axosoft/nodegit', 'node-pty', 'nsfw', 'find-git-repositories']) { require(m); console.log('OK', m); }"
    }
} finally {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
}

if ($Test) {
    Step 'Typecheck, lint, unit tests'
    Invoke-Checked 'Typecheck' { & npm.cmd run typecheck }
    Invoke-Checked 'Lint' { & npm.cmd run lint }
    Invoke-Checked 'Unit tests' { & npm.cmd test }
}

Step "Packaging for Windows $Arch"
Invoke-Checked 'Packaging' { & npm.cmd run dist -- --win nsis zip "--$Arch" --publish never }
Invoke-Checked 'Fuse check' { & node.exe scripts\check-fuses.mjs }

Write-Host "`nDone. Packages:" -ForegroundColor Green
Get-ChildItem -LiteralPath (Join-Path $Root 'dist') -File | Where-Object { $_.Extension -in '.exe', '.zip' } | ForEach-Object { Write-Host "  $($_.FullName)" }
