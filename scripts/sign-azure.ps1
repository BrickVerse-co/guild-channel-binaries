param(
    [string]$MetadataPath = ".\scripts\sign\metadata.json",
    [string]$SignToolPath = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.28000.0\x64\signtool.exe",
    [string]$DlibPath = "C:\Windows\System32\Microsoft.ArtifactSigning.Client\bin\x64\Azure.CodeSigning.Dlib.dll"
)

$ErrorActionPreference = "Stop"

$ResolvedMetadataPath = (Resolve-Path $MetadataPath).Path
$ResolvedSignToolPath = (Resolve-Path $SignToolPath).Path
$ResolvedDlibPath = (Resolve-Path $DlibPath).Path

Write-Host "Metadata path: $ResolvedMetadataPath"
Write-Host "SignTool path: $ResolvedSignToolPath"
Write-Host "Dlib path: $ResolvedDlibPath"

$metadataRaw = Get-Content -LiteralPath $ResolvedMetadataPath -Raw
$metadataRaw | ConvertFrom-Json | Out-Null
Write-Host "Metadata JSON is valid."

$files = @()

$appExe = ".\dist\win-unpacked\BrickVerseGuildChannels.exe"
if (Test-Path -LiteralPath $appExe) {
    $files += (Resolve-Path $appExe).Path
}

$setupExes = Get-ChildItem ".\dist" -Filter "*.exe" -File | Select-Object -ExpandProperty FullName
$files += $setupExes

$files = $files | Select-Object -Unique

if ($files.Count -eq 0) {
    throw "No EXE files found to sign."
}

foreach ($ResolvedFilePath in $files) {
    Write-Host "Signing: $ResolvedFilePath"

    & $ResolvedSignToolPath sign `
        /v `
        /fd SHA256 `
        /tr "http://timestamp.acs.microsoft.com" `
        /td SHA256 `
        /dlib $ResolvedDlibPath `
        /dmdf $ResolvedMetadataPath `
        $ResolvedFilePath

    if ($LASTEXITCODE -ne 0) {
        throw "Signing failed for $ResolvedFilePath with exit code $LASTEXITCODE"
    }
}

Write-Host "All files signed successfully."