# Windows PowerShell + Microsoft Access Database Engine (ACE) required.
# Read-only configuration evidence ONLY. Never update the source MDB.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SourceMdb,
  [Parameter(Mandatory = $true)][string]$TableManifestJson,
  [Parameter(Mandatory = $true)][string]$OutputJson
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Allowed = @('Test name','test','profile','normal','price','Unites','Tube','Tubes','Comment','ORGANISM','Antibiotic','Fungi','Referdby','Source','Gropes')
$Blocked = @('password','id','id2','idprice','result','profnam','abo','bhcg','bilh','cbc','clerance','coag','csf','cul','culture','esr','fertility','hepatitis','kidney','lipid','liver','marrow','occult','pcr','post_coital','pregnancy','prostata','pt','rotavirus','semin','serology','stone','stool','thyroid','torch','tumer','urine','widal','zn')
function Assert-AccessName([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value) -or
      $value -notmatch '^[A-Za-z][A-Za-z0-9 _.-]{0,79}$' -or
      $value.Trim() -ne $value) {
    throw 'f3_unsafe_access_identifier'
  }
}
function Quote-AccessName([string]$value) {
  Assert-AccessName $value
  return '[' + $value + ']'
}
$source = (Resolve-Path -LiteralPath $SourceMdb).Path
if (-not ($source.ToLowerInvariant().EndsWith('.mdb') -or
          $source.ToLowerInvariant().EndsWith('.accdb'))) {
  throw 'f3_access_source_extension_required'
}
$config = Get-Content -LiteralPath $TableManifestJson -Raw -Encoding UTF8 | ConvertFrom-Json
if (@($config.tables).Count -lt 1 -or @($config.tables).Count -gt 15) {
  throw 'f3_access_table_allowlist_invalid'
}
$sha = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
$out = [System.IO.Path]::GetFullPath($OutputJson)
if ($out -eq $source -or $out -eq [System.IO.Path]::GetFullPath($TableManifestJson)) {
  throw 'f3_access_output_must_be_separate'
}
$connection = New-Object -ComObject ADODB.Connection
$connection.Mode = 1
$connection.ConnectionString = 'Provider=Microsoft.ACE.OLEDB.12.0;Data Source=' +
  $source + ';Mode=Read;Persist Security Info=False;'
$seen = New-Object 'System.Collections.Generic.List[string]'
$tables = New-Object 'System.Collections.Generic.List[object]'
$total = 0
try {
  $connection.Open()
  foreach ($table in @($config.tables)) {
    $name = [string]$table.name
    Assert-AccessName $name
    if ($Allowed -cnotcontains $name) {
      throw 'f3_access_unlisted_configuration_table'
    }
    if ($Blocked -contains $name.ToLowerInvariant() -or
        @($seen | Where-Object { $_.ToLowerInvariant() -eq $name.ToLowerInvariant() }).Count -gt 0) {
      throw 'f3_access_unapproved_or_duplicate_table'
    }
    $seen.Add($name)
    $columns = @($table.columns)
    if ($columns.Count -lt 1 -or $columns.Count -gt 150) {
      throw 'f3_access_invalid_columns'
    }
    $used = New-Object 'System.Collections.Generic.List[string]'
    $selected = New-Object 'System.Collections.Generic.List[string]'
    foreach ($columnValue in $columns) {
      $column = [string]$columnValue
      Assert-AccessName $column
      if (@($used | Where-Object { $_.ToLowerInvariant() -eq $column.ToLowerInvariant() }).Count -gt 0) {
        throw 'f3_access_duplicate_column'
      }
      $used.Add($column)
      $selected.Add((Quote-AccessName $column))
    }
    $query = 'SELECT ' + ($selected -join ',') + ' FROM ' + (Quote-AccessName $name)
    $records = New-Object -ComObject ADODB.Recordset
    try {
      $records.Open($query, $connection, 0, 1) # forward-only and read-only
      $schema = New-Object 'System.Collections.Generic.List[object]'
      foreach ($field in $records.Fields) {
        $schema.Add(@{name=[string]$field.Name;accessType='ACE_TYPE_' + [string]$field.Type})
      }
      $rows = New-Object 'System.Collections.Generic.List[object]'
      while (-not $records.EOF) {
        $total++
        if ($total -gt 20000) { throw 'f3_access_extraction_row_limit' }
        $row = @{}
        foreach ($field in $records.Fields) {
          $value = $field.Value
          if ($null -eq $value -or [System.DBNull]::Value.Equals($value)) {
            $row[[string]$field.Name] = $null
          } elseif ($value -is [datetime]) {
            # Access stores timezone-naive dates. Keep the literal wall clock.
            $row[[string]$field.Name] = $value.ToString(
              'yyyy-MM-ddTHH:mm:ss.fff',
              [System.Globalization.CultureInfo]::InvariantCulture)
          } elseif ($value -is [bool]) {
            $row[[string]$field.Name] = [bool]$value
          } elseif ($value -is [byte[]]) {
            throw 'f3_access_binary_requires_separate_policy'
          } else {
            $row[[string]$field.Name] = [System.Convert]::ToString(
              $value,[System.Globalization.CultureInfo]::InvariantCulture)
          }
        }
        $rows.Add($row)
        $records.MoveNext()
      }
      $tables.Add(@{name=$name;columns=@($schema.ToArray());rows=@($rows.ToArray())})
    } finally {
      if ($records.State -eq 1) { $records.Close() }
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($records)
    }
  }
} finally {
  if ($connection.State -eq 1) { $connection.Close() }
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($connection)
}
$postReadSha = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
if ($postReadSha -ne $sha) {
  throw 'f3_access_source_changed_during_read'
}
if (Test-Path -LiteralPath $out) {
  throw 'f3_access_output_already_exists'
}
@{
  format='F3_ACE_OFFLINE_CONFIGURATION_EXTRACT_V1'
  sourceSha256=$sha
  sourceFileBytesHashedLocally=$true
  sourceIdentityExternallyAttested=$false
  migrated=$false
  tables=@($tables.ToArray())
} | ConvertTo-Json -Depth 25 | Set-Content -LiteralPath $out -Encoding UTF8 -NoNewline
Write-Output ('F3_OFFLINE_EXTRACTED tableCount=' + $tables.Count + ' rowCount=' + $total)
