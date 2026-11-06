param(
 [Parameter(Mandatory=$true)][ValidatePattern('\A[a-p]{32}\z')][string]$ExtensionId,
 [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$hostName = 'com.answer_assistant.quota'
$version = '4.12.0'
$productRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'AnswerAssistant\quota-bridge'))
$target = [IO.Path]::GetFullPath((Join-Path $productRoot $version))
$marker = 'AnswerAssistant.quota-bridge.v1'
$origin = 'chrome-extension://' + $ExtensionId + '/'
$registryPath = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\' + $hostName
function Assert-OwnedPath([string]$candidate) {
 $full = [IO.Path]::GetFullPath($candidate)
 if (-not $full.StartsWith($productRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe component path' }
 $cursor = $full
 while ($cursor) {
  if (Test-Path -LiteralPath $cursor) {
   if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked installation paths are not supported' }
  }
  $parent = [IO.Path]::GetDirectoryName($cursor)
  if ($parent -eq $cursor) { break }; $cursor = $parent
 }
}
function Assert-ExistingRegistration {
 if (-not (Test-Path -LiteralPath $registryPath)) { return }
 $registered = (Get-Item -LiteralPath $registryPath).GetValue('')
 if ($registered -isnot [string] -or -not [IO.Path]::IsPathRooted($registered)) { throw 'Existing registration is not owned by this component' }
 Assert-OwnedPath $registered
 $full = [IO.Path]::GetFullPath($registered)
 $directory = [IO.Path]::GetDirectoryName($full)
 if ([IO.Path]::GetFileName($full) -ne ($hostName + '.json')) { throw 'Existing host manifest did not match' }
 $ownedMarker = Join-Path $directory 'product-marker.txt'
 Assert-OwnedPath $ownedMarker
 if (-not (Test-Path -LiteralPath $ownedMarker -PathType Leaf) -or (Get-Item -LiteralPath $ownedMarker).Length -gt 128 -or ([IO.File]::ReadAllText($ownedMarker)).Trim() -ne $marker) { throw 'Existing registration product marker did not match' }
 if (-not (Test-Path -LiteralPath $full -PathType Leaf) -or (Get-Item -LiteralPath $full).Length -gt 65536) { throw 'Existing host manifest did not match' }
 $old = [IO.File]::ReadAllText($full) | ConvertFrom-Json
 if ($old.name -isnot [string] -or $old.type -isnot [string] -or $old.path -isnot [string] -or $old.allowed_origins -isnot [array] -or $old.name -cne $hostName -or $old.type -cne 'stdio' -or $old.path -ne (Join-Path $directory 'NativeLauncher.exe') -or @($old.allowed_origins).Count -ne 1 -or $old.allowed_origins[0] -isnot [string] -or $old.allowed_origins[0] -cnotmatch '\Achrome-extension://[a-p]{32}/\z') { throw 'Existing host manifest did not match' }
 Assert-OwnedPath $old.path
}
Assert-OwnedPath $target
Assert-ExistingRegistration
if (Test-Path -LiteralPath $target) {
 $markerPath = Join-Path $target 'product-marker.txt'
 Assert-OwnedPath $markerPath
 if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf) -or ([IO.File]::ReadAllText($markerPath)).Trim() -ne $marker) { throw 'Existing directory is not owned by this component' }
}
$command = Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
$nodePath = [IO.Path]::GetFullPath($command.Source)
$rawVersion = & $nodePath --version
if ($LASTEXITCODE -ne 0 -or $rawVersion -notmatch '\Av(\d+)\.(\d+)\.(\d+)\z') { throw 'Node version could not be verified' }
$nodeVersion = [Version]($Matches[1] + '.' + $Matches[2] + '.' + $Matches[3])
if ($nodeVersion -lt [Version]'24.5.0') { throw 'Node 24.5.0 or newer is required' }
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc -PathType Leaf)) { throw '.NET Framework compiler is required' }
$files = @('host.mjs','framing.mjs','qwen-console.mjs','credential-store.mjs','Protect.ps1','NativeLauncher.cs','Install.ps1','Uninstall.ps1','README.md','LICENSE-bailian.txt','LICENSE','THIRD_PARTY_NOTICES.md')
function Source-Path([string]$file) {
 $source = Join-Path $PSScriptRoot $file
 if (($file -eq 'LICENSE' -or $file -eq 'THIRD_PARTY_NOTICES.md') -and -not (Test-Path -LiteralPath $source -PathType Leaf)) { $source = Join-Path (Split-Path -Parent $PSScriptRoot) $file }
 return $source
}
if ($DryRun) {
 Write-Output 'DRY RUN: no files or registry values will be written'
 Write-Output ('Install component ' + $version + ' under current-user LOCALAPPDATA/AnswerAssistant/quota-bridge')
 Write-Output ('Allow exactly ' + $origin)
 Write-Output ('Register only HKCU Edge NativeMessagingHosts/' + $hostName)
 Write-Output 'Resolve Node 24.5+ and compile the fixed launcher; no global Node/npm/CLI changes'
 exit 0
}
foreach ($file in $files) { if (-not (Test-Path -LiteralPath (Source-Path $file) -PathType Leaf)) { throw ('Missing component source: ' + $file) } }
New-Item -ItemType Directory -Path $target -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $target 'product-marker.txt'), $marker)
foreach ($file in $files) {
 $destination = Join-Path $target $file
 Assert-OwnedPath $destination
 if (Test-Path -LiteralPath $destination) {
  if ((Get-Item -LiteralPath $destination -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked files are not supported' }
 }
 Copy-Item -LiteralPath (Source-Path $file) -Destination $destination -Force
}
$exe = Join-Path $target 'NativeLauncher.exe'
Assert-OwnedPath $exe
& $csc /nologo /target:exe ('/out:' + $exe) /r:System.Web.Extensions.dll (Join-Path $target 'NativeLauncher.cs') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed; registration was not changed' }
$config = @{version=1;bridgeVersion=$version;origin=$origin;nodePath=$nodePath}
$manifest = @{name=$hostName;description='Answer Assistant Beijing free-token quota bridge';path=$exe;type='stdio';allowed_origins=@($origin)}
$utf8 = New-Object Text.UTF8Encoding($false)
$configPath = Join-Path $target 'host-config.json'
$manifestPath = Join-Path $target ($hostName + '.json')
Assert-OwnedPath $configPath
Assert-OwnedPath $manifestPath
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 4), $utf8)
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 4), $utf8)
# Registration is the final step, after all sources and the compiled launcher exist.
Assert-ExistingRegistration
New-Item -Path $registryPath -Force | Out-Null
Set-Item -LiteralPath $registryPath -Value $manifestPath
Write-Output 'Installed current-user Edge quota bridge. Restart the extension before connecting.'
