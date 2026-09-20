# 아무 Word 양식이나 구조를 훑어본다. 새 양식이 오면 이것부터 돌린다.
#
#   powershell -NoProfile -File scripts/forms/dump.ps1 -Path "C:\...\양식.docx"
#
# 문단 번호와 표 좌표를 찍어 준다 — 채우는 스크립트가 이 번호로 자리를 잡는다.
param([Parameter(Mandatory=$true)][string]$Path)

$ErrorActionPreference = 'Stop'
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$doc = $w.Documents.Open($Path, [ref]$false, [ref]$true)   # 읽기 전용. 원본은 절대 고치지 않는다

Write-Output "표 $($doc.Tables.Count)개 - 문단 $($doc.Paragraphs.Count)개"
Write-Output ""
Write-Output "=== 문단 ==="
$i = 0
foreach ($p in $doc.Paragraphs) {
  $i++
  $t = ($p.Range.Text -replace "`r","" -replace "`a","" -replace "`t"," <TAB> ")
  if ($t.Trim()) { Write-Output ("{0,3}  [{1}]" -f $i, $t) } else { Write-Output ("{0,3}  []" -f $i) }
}

$n = 0
foreach ($tb in $doc.Tables) {
  $n++
  Write-Output ""
  Write-Output "=== 표 $n : $($tb.Rows.Count)행 x $($tb.Columns.Count)열 ==="
  for ($r = 1; $r -le $tb.Rows.Count; $r++) {
    $cells = @()
    for ($c = 1; $c -le $tb.Columns.Count; $c++) {
      try { $cells += (($tb.Cell($r,$c).Range.Text -replace "`r","" -replace "`a","").Trim()) }
      catch { $cells += "(병합)" }
    }
    Write-Output ("  r{0,-3} | {1}" -f $r, ($cells -join " | "))
  }
}

$doc.Close([ref]$false)
$w.Quit()
