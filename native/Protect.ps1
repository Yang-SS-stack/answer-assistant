param([Parameter(Mandatory=$true)][ValidateSet('Protect','Unprotect')][string]$Operation)
$ErrorActionPreference = 'Stop'
try {
 Add-Type -AssemblyName System.Security
 $encoded = [Console]::In.ReadToEnd()
 if ($encoded.Length -gt 131072) { throw 'size' }
 $bytes = [Convert]::FromBase64String($encoded)
 $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
 if ($Operation -eq 'Protect') { $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope) }
 else { $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope) }
 [Console]::Out.Write([Convert]::ToBase64String($result))
 exit 0
} catch { exit 1 }
