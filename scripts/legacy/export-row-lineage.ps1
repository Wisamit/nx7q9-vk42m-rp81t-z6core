# Windows / ACE OLE DB only. Source rows are read locally and emitted as
# HMAC digests (never identifiers, raw values, clinical records or prices).
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$MdbPath,
  [Parameter(Mandatory=$true)][string]$HmacKeyFile,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = "Stop"
if (!(Test-Path -LiteralPath $MdbPath -PathType Leaf)) { throw "MDB source not found." }
if (!(Test-Path -LiteralPath $HmacKeyFile -PathType Leaf)) { throw "Private HMAC key file not found." }
$source = (Resolve-Path -LiteralPath $MdbPath).Path
$keyFile = (Resolve-Path -LiteralPath $HmacKeyFile).Path
$destination = [IO.Path]::GetFullPath($OutputDirectory)
if ($destination.StartsWith([IO.Path]::GetDirectoryName($source) + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase) -and
    $destination -eq [IO.Path]::GetDirectoryName($source)) {
  throw "Use a separate private output directory."
}
$key = [IO.File]::ReadAllBytes($keyFile)
if ($key.Length -lt 32) { throw "A cryptographically random HMAC key of at least 32 bytes is required." }
$keyDigest = (Get-FileHash -LiteralPath $keyFile -Algorithm SHA256).Hash.ToLowerInvariant()
$sourceFingerprint = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
$sourceLength = (Get-Item -LiteralPath $source).Length
$names = @("Test name","test","profile","normal","price","Unites","Tube","Tubes",
  "Comment","ORGANISM","Antibiotic","Fungi","Referdby","Source","Gropes")
$providers = @("Microsoft.ACE.OLEDB.16.0","Microsoft.ACE.OLEDB.12.0","Microsoft.Jet.OLEDB.4.0")
$conn = $null
foreach ($provider in $providers) {
  $candidate = $null
  try {
    $candidate = New-Object System.Data.OleDb.OleDbConnection(
      "Provider=$provider;Data Source=$source;Persist Security Info=False;Mode=Read;")
    $candidate.Open(); $conn = $candidate; break
  } catch { if ($null -ne $candidate) { $candidate.Dispose() } }
}
if ($null -eq $conn) { throw "A matching Access ACE OLE DB provider is required." }
function Hash-Text([string]$value) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash(
      [Text.Encoding]::UTF8.GetBytes($value)))).Replace("-","").ToLowerInvariant()
  } finally { $algorithm.Dispose() }
}
function Hmac-Text([byte[]]$bytes,[string]$value) {
  $algo = New-Object Security.Cryptography.HMACSHA256(,$bytes)
  try {
    return ([BitConverter]::ToString($algo.ComputeHash(
      [Text.Encoding]::UTF8.GetBytes($value)))).Replace("-","").ToLowerInvariant()
  } finally { $algo.Dispose() }
}
function Quote-Access([string]$name) {
  return "[" + $name.Replace("]","]]") + "]"
}
function Canonical-Value($value) {
  if ($null -eq $value -or $value -eq [DBNull]::Value) { return "null" }
  if ($value -is [byte[]]) { return "bytes:" + [Convert]::ToBase64String($value) }
  if ($value -is [DateTime]) {
    return "date:" + $value.ToString("yyyy-MM-ddTHH:mm:ss.fffffff",
      [Globalization.CultureInfo]::InvariantCulture)
  }
  if ($value -is [IFormattable]) {
    return "value:" + $value.ToString($null,[Globalization.CultureInfo]::InvariantCulture)
  }
  return "text:" + [string]$value
}
$manifests = New-Object 'System.Collections.Generic.List[object]'
try {
  $available = @($conn.GetSchema("Tables").Rows | Where-Object {
    [string]$_['TABLE_TYPE'] -eq 'TABLE'
  } | ForEach-Object { [string]$_['TABLE_NAME'] })
  foreach ($expected in $names) {
    $matches = @($available | Where-Object {
      [string]::Equals($_,$expected,[StringComparison]::OrdinalIgnoreCase)
    })
    if ($matches.Count -gt 1) { throw "Ambiguous source table." }
    if ($matches.Count -eq 0) { continue }
    $table = $matches[0]
    $columnSchema = $conn.GetSchema("Columns",([string[]]@($null,$null,$table,$null)))
    $columns = @($columnSchema.Rows | Sort-Object { [int]$_['ORDINAL_POSITION'] })
    if ($columns.Count -lt 1 -or $columns.Count -gt 2000) { throw "Invalid source column count." }
    $fields = @($columns | ForEach-Object {
      "$($_['ORDINAL_POSITION'])|$($_['COLUMN_NAME'])|$($_['DATA_TYPE'])"
    })
    $schemaSha = Hash-Text ($fields -join "`n")
    $cmd = $conn.CreateCommand()
    $digests = New-Object 'System.Collections.Generic.List[string]'
    try {
      # SELECT * is strictly local and read-only; the exported file contains
      # only HMAC digests. No row values are ever serialized to evidence.
      $cmd.CommandText = "SELECT * FROM " + (Quote-Access $table)
      $reader = $cmd.ExecuteReader()
      try {
        while ($reader.Read()) {
          if ($digests.Count -ge 200000) { throw "Evidence table exceeds safe row limit." }
          $builder = New-Object Text.StringBuilder
          for ($i=0;$i -lt $reader.FieldCount;$i++) {
            $cell = Canonical-Value $reader.GetValue($i)
            $utf8Length = [Text.Encoding]::UTF8.GetByteCount($cell)
            [void]$builder.Append($i).Append(":").Append($utf8Length).Append(":").
              Append($cell).Append(";")
          }
          $digests.Add((Hmac-Text $key $builder.ToString()))
        }
      } finally { $reader.Dispose() }
    } finally { $cmd.Dispose() }
    $sorted = @($digests | Sort-Object)
    $occurrences = @{}
    $rows = New-Object 'System.Collections.Generic.List[object]'
    foreach ($digest in $sorted) {
      if (!$occurrences.ContainsKey($digest)) { $occurrences[$digest] = 0 }
      $occurrences[$digest] = [int]$occurrences[$digest] + 1
      $rows.Add([ordered]@{ rowDigest=$digest; occurrence=[int]$occurrences[$digest] })
    }
    $chunks = [Math]::Max(1,[Math]::Ceiling($rows.Count / 500.0))
    for ($page=0;$page -lt $chunks;$page++) {
      $start = $page*500; $length = [Math]::Min(500,$rows.Count-$start)
      $pageRows = if ($length -gt 0) { @($rows.GetRange($start,$length).ToArray()) } else { @() }
      $manifests.Add([ordered]@{
        schemaVersion=1; evidenceType="FAMILY_LAB_LEGACY_MDB_ROW_HASHES_REVIEW_ONLY"
        sourceName=[IO.Path]::GetFileName($source); sourceSha256=$sourceFingerprint
        sourceBytes=$sourceLength; tableName=$expected; schemaSha256=$schemaSha
        digestKeyId=$keyDigest; sourceRowCount=$rows.Count
        chunkIndex=$page; chunkCount=[int]$chunks
        exportedAtUtc=[DateTime]::UtcNow.ToString("o")
        includesPatientData=$false; rows=$pageRows
      })
    }
  }
} finally { $conn.Close(); $conn.Dispose() }
if ($sourceFingerprint -ne (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()) {
  throw "MDB changed during read-only extraction; evidence rejected."
}
if (!(Test-Path -LiteralPath $destination -PathType Container)) {
  New-Item -Path $destination -ItemType Directory -Force | Out-Null
}
foreach ($manifest in $manifests) {
  $tableSlug = [Regex]::Replace($manifest.tableName,"[^A-Za-z0-9]","_")
  $path = Join-Path $destination ("legacy-row-hashes-" + $tableSlug + "-" +
    $manifest.chunkIndex.ToString("D5") + ".json")
  $temp = $path + ".partial." + [guid]::NewGuid().ToString("N")
  try {
    [IO.File]::WriteAllText($temp,(ConvertTo-Json -InputObject $manifest -Depth 8),
      (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temp -Destination $path -Force
  } finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
  }
}
[Array]::Clear($key,0,$key.Length)
Write-Host "Deidentified, keyed Access row lineage pages written to PRIVATE output."
Write-Host "Not independent source verification, mapping approval or clinical/price activation."
