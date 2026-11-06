param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$productRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'AnswerAssistant\quota-bridge'))
$registryPath = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.answer_assistant.quota'
if (-not (Test-Path -LiteralPath $registryPath)) { Write-Output 'Quota bridge is not registered'; exit 0 }
$manifestPath = (Get-Item -LiteralPath $registryPath).GetValue('')
if (-not $manifestPath -or -not [IO.Path]::IsPathRooted($manifestPath)) { throw 'Registration is not owned by this component' }
$full = [IO.Path]::GetFullPath($manifestPath)
if (-not $full.StartsWith($productRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Registration is outside this component installation root' }
$cursor = $full
while ($cursor) {
 if (Test-Path -LiteralPath $cursor) { if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked installation path is not supported' } }
 $parent = [IO.Path]::GetDirectoryName($cursor); if ($parent -eq $cursor) { break }; $cursor = $parent
}
$directory = [IO.Path]::GetDirectoryName($full)
$marker = Join-Path $directory 'product-marker.txt'
if (-not (Test-Path -LiteralPath $marker -PathType Leaf) -or ([IO.File]::ReadAllText($marker)).Trim() -ne 'AnswerAssistant.quota-bridge.v1') { throw 'Product marker did not match' }
$manifest = [IO.File]::ReadAllText($full) | ConvertFrom-Json
if ($manifest.name -ne 'com.answer_assistant.quota' -or $manifest.path -ne (Join-Path $directory 'NativeLauncher.exe')) { throw 'Native host manifest did not match' }
if ($DryRun) { Write-Output 'DRY RUN: remove only this product HKCU Edge NativeMessagingHosts registration; preserve all files and user data'; exit 0 }
# Do not remove siblings, parent keys, installation files, or user credentials.
Remove-Item -LiteralPath $registryPath
Write-Output 'Removed quota bridge registration. Files and local encrypted session were preserved; disconnect in the extension to revoke this local session.'
