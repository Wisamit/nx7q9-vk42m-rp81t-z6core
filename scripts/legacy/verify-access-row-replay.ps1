# Windows-only local row-HMAC replay. Never commit the MDB, key or private pages.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$MdbPath,
  [Parameter(Mandatory=$true)][string]$HmacKeyFile,
  [Parameter(Mandatory=$true)][string]$CoveragePath,
  [Parameter(Mandatory=$true)][string]$OriginalLineageDirectory,
  [Parameter(Mandatory=$true)][string]$PrivateScratchRoot,
  [string]$NodeExecutable = "node"
)
$ErrorActionPreference = "Stop"
foreach ($path in @($MdbPath, $HmacKeyFile, $CoveragePath)) {
  if (!(Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required private input file missing."
  }
}
foreach ($path in @($OriginalLineageDirectory, $PrivateScratchRoot)) {
  if (!(Test-Path -LiteralPath $path -PathType Container)) {
    throw "Required private evidence directory missing."
  }
}
$source = (Resolve-Path -LiteralPath $MdbPath).Path
$key = (Resolve-Path -LiteralPath $HmacKeyFile).Path
$coverage = (Resolve-Path -LiteralPath $CoveragePath).Path
$original = (Resolve-Path -LiteralPath $OriginalLineageDirectory).Path
$scratchRoot = (Resolve-Path -LiteralPath $PrivateScratchRoot).Path
if ([string]::Equals($original, $scratchRoot,
    [StringComparison]::OrdinalIgnoreCase) -or
    [string]::Equals([IO.Path]::GetDirectoryName($source), $scratchRoot,
    [StringComparison]::OrdinalIgnoreCase)) {
  throw "Private scratch must not be the source or the original evidence directory."
}
$exportScript = Join-Path $PSScriptRoot "export-row-lineage.ps1"
$verifyScript = Join-Path $PSScriptRoot "verify-evidence-package.mjs"
if (!(Test-Path -LiteralPath $exportScript -PathType Leaf) -or
    !(Test-Path -LiteralPath $verifyScript -PathType Leaf)) {
  throw "Versioned local verifier components missing."
}
$replay = Join-Path $scratchRoot ("stage144-ace-replay-" + [guid]::NewGuid().ToString("N"))
try {
  New-Item -ItemType Directory -Path $replay -ErrorAction Stop | Out-Null
  # The existing read-only ACE exporter recalculates every HMAC over the
  # source table rows into a fresh random directory. Never reuse old pages.
  & $exportScript -MdbPath $source -HmacKeyFile $key -OutputDirectory $replay
  if (!$?) { throw "ACE source replay failed." }
  & $NodeExecutable --experimental-strip-types $verifyScript --mdb $source `
    --coverage $coverage --lineage-dir $original --ace-replay-dir $replay
  if ($LASTEXITCODE -ne 0) { throw "ACE replay comparison failed." }
  Write-Host "Fresh ACE HMAC pages matched original private evidence."
  Write-Host "SAME-EXTRACTOR REPLAY ONLY: not independent mapping/clinical/financial approval."
} finally {
  if (Test-Path -LiteralPath $replay -PathType Container) {
    Remove-Item -LiteralPath $replay -Force -Recurse -ErrorAction Stop
  }
}
