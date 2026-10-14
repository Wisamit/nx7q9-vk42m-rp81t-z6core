# Windows-only / Microsoft ACE OLE DB: deidentified table presence, schema and row counts.
# No SELECT * and no patient/order/result, medical value, price or free text exports.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$MdbPath,
  [string]$OutputPath = ".\\family-lab-legacy-source-coverage.json"
)
$ErrorActionPreference = "Stop"
if (!(Test-Path -LiteralPath $MdbPath -PathType Leaf)) { throw "MDB file not found." }
$source = (Resolve-Path -LiteralPath $MdbPath).Path
$destination = [IO.Path]::GetFullPath($OutputPath)
if ([string]::Equals($source,$destination,[StringComparison]::OrdinalIgnoreCase)) {
  throw "Cannot overwrite the source database."
}
$names = @("Test name","test","profile","normal","price","Unites","Tube","Tubes",
  "Comment","ORGANISM","Antibiotic","Fungi","Referdby","Source","Gropes")
$sourceFingerprint = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
$sourceLength = (Get-Item -LiteralPath $source).Length
$providers = @("Microsoft.ACE.OLEDB.16.0","Microsoft.ACE.OLEDB.12.0","Microsoft.Jet.OLEDB.4.0")
$conn = $null
foreach ($provider in $providers) {
  $candidate = $null
  try {
    $candidate = New-Object System.Data.OleDb.OleDbConnection(
      "Provider=$provider;Data Source=$source;Persist Security Info=False;Mode=Read;")
    $candidate.Open()
    $conn = $candidate
    break
  } catch { if ($null -ne $candidate) { $candidate.Dispose() } }
}
if ($null -eq $conn) {
  throw "Microsoft Access ACE OLE DB provider is required (matching PowerShell bitness)."
}
function Hash-Text([string]$value) {
  $algo = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($value)
    return ([BitConverter]::ToString($algo.ComputeHash($bytes))).Replace("-","").ToLowerInvariant()
  } finally { $algo.Dispose() }
}
function Quote-Access([string]$name) {
  return "[" + $name.Replace("]","]]") + "]"
}
$report = [ordered]@{
  schemaVersion = 1
  evidenceType = "FAMILY_LAB_LEGACY_MDB_SOURCE_COVERAGE_REVIEW_ONLY"
  sourceName = [IO.Path]::GetFileName($source)
  sourceSha256 = $sourceFingerprint
  sourceBytes = $sourceLength
  exportedAtUtc = [DateTime]::UtcNow.ToString("o")
  includesPatientData = $false
  tables = @()
}
try {
  $schemaTables = $conn.GetSchema("Tables")
  $available = @($schemaTables.Rows | Where-Object { [string]$_['TABLE_TYPE'] -eq 'TABLE' } |
    ForEach-Object { [string]$_['TABLE_NAME'] })
  foreach ($expected in $names) {
    $matches = @($available | Where-Object {
      [string]::Equals($_,$expected,[StringComparison]::OrdinalIgnoreCase)
    })
    if ($matches.Count -gt 1) { throw "Ambiguous source table: $expected" }
    if ($matches.Count -eq 0) {
      $report.tables += [ordered]@{
        tableName = $expected; present = $false; rowCount = 0;
        columnCount = 0; schemaSha256 = $null
      }
      continue
    }
    $table = $matches[0]
    $columnSchema = $conn.GetSchema("Columns",([string[]]@($null,$null,$table,$null)))
    $columnFields = @($columnSchema.Rows | Sort-Object { [int]$_['ORDINAL_POSITION'] } |
      ForEach-Object { "$($_['ORDINAL_POSITION'])|$($_['COLUMN_NAME'])|$($_['DATA_TYPE'])" })
    if ($columnFields.Count -lt 1 -or $columnFields.Count -gt 2000) {
      throw "Invalid column count in $table"
    }
    $cmd = $conn.CreateCommand()
    try {
      $cmd.CommandText = "SELECT COUNT(*) FROM " + (Quote-Access $table)
      $value = $cmd.ExecuteScalar()
      $count = [long]$value
      if ($count -lt 0 -or $count -gt 10000000) { throw "Row count exceeds evidence limit in $table" }
      $report.tables += [ordered]@{
        tableName = $expected; present = $true; rowCount = $count
        columnCount = $columnFields.Count
        schemaSha256 = Hash-Text ($columnFields -join "`n")
      }
    } finally { $cmd.Dispose() }
  }
} finally {
  $conn.Close()
  $conn.Dispose()
}
if ($report.tables.Count -ne $names.Count) { throw "Incomplete evidence; refusing partial output." }
$after = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
if ($sourceFingerprint -ne $after) {
  throw "MDB changed during metadata extraction. Refusing partial evidence."
}
$directory = [IO.Path]::GetDirectoryName($destination)
if (!(Test-Path -LiteralPath $directory)) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
$temp = $destination + ".partial." + [guid]::NewGuid().ToString("N")
try {
  $json = ConvertTo-Json -InputObject $report -Depth 6
  [IO.File]::WriteAllText($temp,$json,(New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temp -Destination $destination -Force
} finally {
  if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
}
Write-Host "Legacy MDB source coverage metadata exported (15 known tables, no data values)."
Write-Host "REVIEW ONLY — no clinical, financial or migration cutover approval is implied."
