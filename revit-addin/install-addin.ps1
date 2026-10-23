# Compila a ponte BoxBim e registra o add-in no Revit 2025 do usuário atual.
# Uso: powershell -ExecutionPolicy Bypass -File install-addin.ps1 [-RevitDir "E:\Autodesk\Revit 2025"]
param(
    [string]$RevitDir = "E:\Autodesk\Revit 2025",
    [string]$RevitYear = "2025"
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot

dotnet build "$here\BoxBimBridge.csproj" -c Release "/p:RevitDir=$RevitDir"
if ($LASTEXITCODE -ne 0) { throw "Falha na compilação do add-in." }

$dll = Join-Path $here "bin\Release\net8.0-windows\BoxBimBridge.dll"
$addinDir = Join-Path $env:APPDATA "Autodesk\Revit\Addins\$RevitYear"
New-Item -ItemType Directory -Force -Path $addinDir | Out-Null

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns>
  <AddIn Type="Application">
    <Name>BoxBim Bridge</Name>
    <Assembly>$dll</Assembly>
    <AddInId>6F1C2B7E-5B0B-4C55-9D3E-B0CB1B1A2025</AddInId>
    <FullClassName>BoxBimBridge.App</FullClassName>
    <VendorId>BOXB</VendorId>
    <VendorDescription>BoxBim</VendorDescription>
  </AddIn>
</RevitAddIns>
"@
Set-Content -Path (Join-Path $addinDir "BoxBimBridge.addin") -Value $manifest -Encoding UTF8
Write-Host "Add-in registrado em $addinDir\BoxBimBridge.addin -> $dll"
Write-Host "Reinicie o Revit. A ponte escuta em http://127.0.0.1:48884/"
