param([Parameter(Mandatory=$true)][string]$OutputDirectory)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'The fixture requires Windows.' }
[void][System.IO.Directory]::CreateDirectory($OutputDirectory)
$executable = Join-Path $OutputDirectory 'OttoSmokeFixture.exe'
if (Test-Path $executable) { throw 'Refusing to overwrite an existing fixture executable.' }
Add-Type -Path (Join-Path $PSScriptRoot 'SmokeFixture.cs') -OutputAssembly $executable -OutputType WindowsApplication -ReferencedAssemblies System.dll, System.Core.dll, System.Drawing.dll, System.Windows.Forms.dll, System.Web.Extensions.dll
if (-not (Test-Path $executable)) { throw 'The fixture executable was not created.' }
