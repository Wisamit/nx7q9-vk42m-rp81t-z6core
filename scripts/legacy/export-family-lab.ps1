param(
  [Parameter(Mandatory=$true)][string]$MdbPath,
  [string]$OutputPath = ".\\family-lab-catalog-export.json"
)
$ErrorActionPreference = "Stop"
if (!(Test-Path $MdbPath)) { throw "MDB file not found: $MdbPath" }

$providers = @("Microsoft.ACE.OLEDB.16.0","Microsoft.ACE.OLEDB.12.0","Microsoft.Jet.OLEDB.4.0")
$conn = $null
foreach ($provider in $providers) {
  try {
    $candidate = New-Object System.Data.OleDb.OleDbConnection("Provider=$provider;Data Source=$MdbPath;Persist Security Info=False;")
    $candidate.Open(); $conn = $candidate; break
  } catch {}
}
if ($null -eq $conn) { throw "No compatible Microsoft Access OLE DB provider was found. Install Microsoft Access Database Engine (ACE) and retry." }

function Read-Table([string]$table) {
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = "SELECT * FROM [$table]"
  try { $reader = $cmd.ExecuteReader() } catch { return @() }
  $rows = @()
  while ($reader.Read()) {
    $obj = [ordered]@{}
    for ($i=0; $i -lt $reader.FieldCount; $i++) {
      $value = $reader.GetValue($i)
      $obj[$reader.GetName($i)] = if ($value -is [DBNull]) { $null } else { $value }
    }
    $rows += [pscustomobject]$obj
  }
  $reader.Close(); return $rows
}
function First([object]$row,[string[]]$names) {
  foreach($n in $names){$p=$row.PSObject.Properties[$n]; if($null-ne $p -and $null-ne $p.Value -and "$($p.Value)".Trim() -ne ""){return "$($p.Value)".Trim()}}
  return ""
}

$out=@()
$tests=Read-Table "Test name"
foreach($r in $tests){$name=First $r @("Testname","test name");$code=First $r @("Abrev","Abre");if($name -or $code){$out += @{entityType="TEST";legacyKey="$code|$name";data=$r}}}
$units=Read-Table "Unites"
foreach($r in $units){$v=First $r @("unit","Unit","Unites","name");if($v){$out += @{entityType="UNIT";legacyKey=$v;data=@{unit=$v}}}}
$profiles=Read-Table "profile"
foreach($r in $profiles){$v=First $r @("profilname","Profile","name");if($v){$out += @{entityType="PANEL";legacyKey=$v;data=@{profilname=$v}}}}
$tubes=@(Read-Table "Tubes") + @(Read-Table "Tube")
foreach($r in $tubes){$v=First $r @("Tube","Tubes","name","tube");if($v){$out += @{entityType="CONTAINER";legacyKey=$v;data=@{name=$v}}}}
$ranges=Read-Table "normal"
foreach($r in $ranges){$name=First $r @("test name","Testname");if($name){$out += @{entityType="REFERENCE_INTERVAL";legacyKey="$name|$(First $r @('sex'))|$(First $r @('agefrom'))|$(First $r @('ageto'))";data=$r}}}
$conn.Close()

$payload=[ordered]@{sourceName=[IO.Path]::GetFileName($MdbPath);exportedAt=(Get-Date).ToUniversalTime().ToString("o");rows=$out}
$payload | ConvertTo-Json -Depth 8 | Set-Content -Path $OutputPath -Encoding UTF8
Write-Host "Exported $($out.Count) staged catalog rows to $OutputPath"
