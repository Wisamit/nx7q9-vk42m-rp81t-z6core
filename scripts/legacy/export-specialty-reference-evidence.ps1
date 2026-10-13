# Windows / Microsoft Access Database Engine (ACE) required.
# Exports ONLY selected legacy specialty reference-range evidence; no patient/order/result records.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$MdbPath,
  [string]$OutputPath = ".\\family-lab-specialty-evidence.json",
  [ValidateRange(1,20000)][int]$MaxObservationsPerTable = 5000
)
$ErrorActionPreference = "Stop"
if (!(Test-Path -LiteralPath $MdbPath -PathType Leaf)) { throw "MDB file not found." }
$source = (Resolve-Path -LiteralPath $MdbPath).Path
$forbiddenOutput = [IO.Path]::GetFullPath($OutputPath)
if ([string]::Equals($source,$forbiddenOutput,[StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to overwrite source MDB."
}
$providers = @("Microsoft.ACE.OLEDB.16.0","Microsoft.ACE.OLEDB.12.0","Microsoft.Jet.OLEDB.4.0")
$conn = $null
foreach ($provider in $providers) {
  try {
    $candidate = New-Object System.Data.OleDb.OleDbConnection("Provider=$provider;Data Source=$source;Persist Security Info=False;Mode=Read;")
    $candidate.Open()
    $conn = $candidate
    break
  } catch { if ($null -ne $candidate) { $candidate.Dispose() } }
}
if ($null -eq $conn) {
  throw "A compatible Microsoft Access OLE DB provider is required. Install Microsoft Access Database Engine (ACE) matching your PowerShell bitness."
}
# An explicit clinical-source list prevents accidental extraction of unrelated and potentially identifying legacy tables.
$knownSpecialties = @("cbcn","coagn","fertn","Glycosen","kidnyn","lipidn","livern","Thyroidn","TORCHn","Tumern")
function Select-Column([string[]]$columns,[string[]]$names) {
  foreach ($n in $names) {
    $item = @($columns | Where-Object { [string]::Equals($_,$n,[StringComparison]::OrdinalIgnoreCase) })
    if ($item.Count -eq 1) { return $item[0] }
  }
  return $null
}
function Quote-Access([string]$text) {
  return "[" + $text.Replace("]","]]") + "]"
}
function Read-Selector($reader,[string]$column) {
  if ($null -eq $column) { return $null }
  $value = $reader[$column]
  if ($null -eq $value -or $value -is [DBNull]) { return $null }
  $text = ([string]$value).Trim()
  if ($text.Length -gt 32 -or $text -match '[\x00-\x1f]') { return $null }
  return $text
}
function Read-Decimal($reader,[string]$column) {
  $value = $reader[$column]
  if ($null -eq $value -or $value -is [DBNull] -or "$value".Trim() -eq "") { return $null }
  $parsed = [decimal]0
  $text = [Convert]::ToString($value,[Globalization.CultureInfo]::InvariantCulture)
  if (![decimal]::TryParse($text,[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture,[ref]$parsed)) {
    return $null
  }
  return $parsed.ToString([Globalization.CultureInfo]::InvariantCulture)
}
$report = [ordered]@{
  schemaVersion = 1
  evidenceType = "FAMILY_LAB_LEGACY_SPECIALTY_RANGES_REVIEW_ONLY"
  sourceName = [IO.Path]::GetFileName($source)
  sourceSha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
  exportedAtUtc = [DateTime]::UtcNow.ToString("o")
  clinicalUseApproved = $false
  tables = @()
}
try {
  $catalog = $conn.GetSchema("Tables")
  $available = @($catalog.Rows | Where-Object { $_["TABLE_TYPE"] -eq "TABLE" } |
    ForEach-Object { [string]$_["TABLE_NAME"] })
  foreach ($expected in $knownSpecialties) {
    $table = Select-Column $available @($expected)
    if ($null -eq $table) { continue }
    $schema = $conn.GetSchema("Columns",([string[]]@($null,$null,$table,$null)))
    $columns = @($schema.Rows | ForEach-Object { [string]$_["COLUMN_NAME"] })
    $pairs = @()
    $lowByBase = @{}
    $highByBase = @{}
    foreach ($column in $columns) {
      # Names only; actual clinical meaning needs operator review.
      if ($column -match '^(?<base>.+?)[ _-]?(?<suffix>LOWER|LOW|L)$') {
        $base = $matches["base"].Trim(" ","_","-")
        if ($base -and $base -notmatch '^(?i:age|id|name|pname|patient|comment|date)$') {
          $lowByBase[$base.ToUpperInvariant()] = $column
        }
      } elseif ($column -match '^(?<base>.+?)[ _-]?(?<suffix>UPPER|HIGH|H)$') {
        $base = $matches["base"].Trim(" ","_","-")
        if ($base -and $base -notmatch '^(?i:age|id|name|pname|patient|comment|date)$') {
          $highByBase[$base.ToUpperInvariant()] = $column
        }
      }
    }
    $selectorColumns = [ordered]@{
      sex = Select-Column $columns @("sex","gender")
      ageFrom = Select-Column $columns @("agefrom","age_from")
      ageTo = Select-Column $columns @("ageto","age_to")
      ageUnit = Select-Column $columns @("ag","ageunit","age_unit")
    }
    foreach ($prefix in @($lowByBase.Keys | Sort-Object)) {
      if (!$highByBase.ContainsKey($prefix)) { continue }
      $lowCol = $lowByBase[$prefix];$highCol = $highByBase[$prefix]
      $selectedColumns = @($lowCol,$highCol) + @($selectorColumns.Values | Where-Object { $null -ne $_ })
      $selectedColumns = @($selectedColumns | Select-Object -Unique)
      $quoted = @($selectedColumns | ForEach-Object { Quote-Access $_ })
      $cmd = $conn.CreateCommand()
      $cmd.CommandText = "SELECT " + ($quoted -join ", ") + " FROM " + (Quote-Access $table)
      $reader = $null
      $observations = @()
      try {
        $reader = $cmd.ExecuteReader()
        $ordinal = 0
        while ($reader.Read()) {
          $ordinal++
          if ($ordinal -gt $MaxObservationsPerTable) {
            throw "Too many specialty evidence rows in $table. No partial evidence was saved; raise -MaxObservationsPerTable only after review."
          }
          $low = Read-Decimal $reader $lowCol
          $high = Read-Decimal $reader $highCol
          if ($null -eq $low -and $null -eq $high) { continue }
          $observations += [ordered]@{
            rowNumber = $ordinal
            low = $low
            high = $high
            sex = Read-Selector $reader $selectorColumns["sex"]
            ageFrom = Read-Selector $reader $selectorColumns["ageFrom"]
            ageTo = Read-Selector $reader $selectorColumns["ageTo"]
            ageUnit = Read-Selector $reader $selectorColumns["ageUnit"]
          }
        }
      } finally {
        if ($null -ne $reader) { $reader.Close() }
        $cmd.Dispose()
      }
      $pairs += [ordered]@{
        sourcePrefix = $prefix
        lowColumn = $lowCol
        highColumn = $highCol
        observations = $observations
      }
    }
    $report.tables += [ordered]@{
      tableName = $table
      candidatePairs = $pairs
      pairingComplete = ($pairs.Count -gt 0)
      warnings = if ($pairs.Count -eq 0) {
        @("No confidently paired low/high columns were found. Review table schema manually; never infer clinical reference ranges.")
      } else { @() }
    }
  }
  if ($report.tables.Count -eq 0) {
    throw "No known specialty range tables found. Review the MDB schema; no evidence file written."
  }
  $targetDir = [IO.Path]::GetDirectoryName($forbiddenOutput)
  if (!(Test-Path -LiteralPath $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }
  $json = ConvertTo-Json -InputObject $report -Depth 14
  # Write atomically so failed exports cannot masquerade as complete evidence.
  $temp = $forbiddenOutput + ".partial." + [guid]::NewGuid().ToString("N")
  try {
    [IO.File]::WriteAllText($temp,$json,(New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temp -Destination $forbiddenOutput -Force
  } finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
  }
  Write-Host "Exported $($report.tables.Count) specialty schema/evidence sources to $forbiddenOutput (REVIEW ONLY)."
  Write-Host "No patient/order/result rows or other Access tables were exported."
} finally {
  $conn.Close()
  $conn.Dispose()
}
