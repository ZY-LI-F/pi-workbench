$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskDir = Split-Path -Parent $PSScriptRoot
$evidenceDir = Join-Path (Split-Path -Parent $taskDir) 'moleculenet-reproduction-20260918'
$summary = Get-Content -LiteralPath (Join-Path $evidenceDir 'verification/summary.json') -Raw | ConvertFrom-Json
$result = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'final-result.json') -Raw | ConvertFrom-Json
$archive = [System.IO.Compression.ZipFile]::OpenRead($result.finalPath)

function Read-Part([string] $name) {
  $entry = $archive.GetEntry($name)
  if ($null -eq $entry) { throw "Missing $name" }
  $reader = [System.IO.StreamReader]::new($entry.Open())
  try { return [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
}

function Format-Metric($row) {
  return [string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0:F3} ± {1:F3}', $row.test_rmse_mean, $row.test_rmse_sample_sd)
}

function Get-CellText($cell, $ns) {
  return (($cell.SelectNodes('.//a:t', $ns) | ForEach-Object { $_.InnerText }) -join '')
}

$checkedCells = 0
try {
  $models = @('mean', 'rf', 'krr', 'gc')
  foreach ($spec in @(@(6, 'esol'), @(7, 'freesolv'), @(8, 'lipophilicity'), @(9, 'esol'))) {
    $xml = Read-Part "ppt/slides/slide$($spec[0]).xml"
    $ns = [Xml.XmlNamespaceManager]::new($xml.NameTable)
    $ns.AddNamespace('a', 'http://schemas.openxmlformats.org/drawingml/2006/main')
    $rows = $xml.SelectNodes('//a:tbl/a:tr', $ns)
    if ($rows.Count -ne 5) { throw "Wrong result table rows on slide $($spec[0])" }
    for ($index = 0; $index -lt 4; $index++) {
      $row = @($summary.aggregate | Where-Object { $_.dataset -eq $spec[1] -and $_.model -eq $models[$index] -and $_.split -eq 'random' })
      if ($row.Count -ne 1) { throw 'Ambiguous evidence row' }
      $cells = $rows[$index+1].SelectNodes('./a:tc', $ns)
      if ((Get-CellText $cells[1] $ns) -cne (Format-Metric $row[0])) { throw "Current metric mismatch: slide $($spec[0]) / $($models[$index])" }
      $checkedCells++
      if ($spec[0] -eq 9) {
        $scaffold = @($summary.aggregate | Where-Object { $_.dataset -eq 'esol' -and $_.model -eq $models[$index] -and $_.split -eq 'scaffold' })
        $expected = Format-Metric $scaffold[0]
      } elseif ($null -ne $row[0].paper_test_rmse) {
        $expected = [string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0:F3} ± {1:F3}', $row[0].paper_test_rmse[0], $row[0].paper_test_rmse[1])
      } else { $expected = '未列此基线' }
      if ((Get-CellText $cells[2] $ns) -cne $expected) { throw "Reference metric mismatch: slide $($spec[0]) / $($models[$index])" }
      $checkedCells++
    }
  }
  for ($page = 1; $page -le 14; $page++) {
    $notes = Read-Part "ppt/notesSlides/notesSlide$page.xml"
    $ns = [Xml.XmlNamespaceManager]::new($notes.NameTable)
    $ns.AddNamespace('a', 'http://schemas.openxmlformats.org/drawingml/2006/main')
    $text = ($notes.SelectNodes('//a:t', $ns) | ForEach-Object { $_.InnerText }) -join "`n"
    if ($text.Length -lt 180) { throw "Empty or incomplete speaker notes: $page" }
  }
  $media = @($archive.Entries | Where-Object { $_.FullName -match '^ppt/media/.+\.(jpeg|jpg|png)$' })
  if ($media.Count -ne 2) { throw 'Source image count differs from intended two figures' }
  $hash = (Get-FileHash -LiteralPath $result.finalPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -cne $result.sha256) { throw 'Final file changed since validation' }
  [pscustomobject]@{status='pass';checked_result_cells=$checkedCells;complete_notes=14;source_images=$media.Count;sha256=$hash} | ConvertTo-Json
} finally { $archive.Dispose() }
