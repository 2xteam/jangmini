# 이미 만들어 둔 보배써치 이력서에서 **회사 정보 줄만** 고친다.
#
#   powershell -NoProfile -File scripts/forms/bobae-patch.ps1
#
# ## 왜 다시 만들지 않는가
#
# `bobae.ps1` 은 양식에서 새로 만든다. 그러면 사람이 넣은 사진과 손본 문장이
# 전부 날아간다. 이미 손댄 파일이 있을 때는 **바꿀 줄만 찾아 바꾼다.**
#
# 고치는 줄 — `<회사명> (기간): 업종·규모·매출액` 넷과, 값이 있으면 직급 줄.
# 나머지는 손대지 않는다.
#
# 만약을 위해 옆에 `.bak` 사본을 남긴다.

. "$PSScriptRoot\lib.ps1"

$target = "C:\Users\Tracxlogis\Downloads\표준이력서_장민_보배써치.docx"
$backup = [IO.Path]::ChangeExtension($target, $null) + "bak.docx"

if (-not (Test-Path $target)) { throw "파일이 없습니다: $target" }
Copy-Item $target $backup -Force
Write-Output "백업: $backup"

$d = Read-FormData

$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0
$doc = $w.Documents.Open($target)

$changed = 0

# ⚠️ **문단을 번호로 돈다.** `foreach ($p in $doc.Paragraphs)` 로 돌면서 본문을
# 바꾸면 COM 열거자가 무효화돼 그 뒤로 아무것도 못 찾는다 — 실제로 첫 줄만
# 바뀌고 나머지 셋이 조용히 넘어갔다. 번호로 돌면 매번 새로 읽는다.
function Get-Text($doc, $i) {
  return ($doc.Paragraphs.Item($i).Range.Text -replace "`r","" -replace "`a","")
}
function Set-Line($doc, $i, $text) {
  $r = $doc.Paragraphs.Item($i).Range
  $r.MoveEnd(1, -1) | Out-Null
  $r.Text = $text
}

foreach ($c in $d.companies) {
  if (-not $c.note) { Write-Output "  건너뜀(값 없음): $($c.name)"; continue }

  for ($i = 1; $i -le $doc.Paragraphs.Count; $i++) {
    $t = Get-Text $doc $i
    if ($t.StartsWith("$($c.name) (") -and $t.Contains($script:TODO)) {
      Set-Line $doc $i "$($c.name) ($($c.from) ~ $($c.to)): $($c.note)"
      Write-Output "  고침: $($c.name) → $($c.note)"
      $changed++
      break
    }
  }

  if ($c.rank) {
    for ($i = 1; $i -le $doc.Paragraphs.Count; $i++) {
      $t = Get-Text $doc $i
      if ($t.Contains("$script:TODO 직급") -and $t.Contains($c.dept)) {
        Set-Line $doc $i ($t.Replace("$script:TODO 직급", $c.rank).TrimEnd())
        Write-Output "  고침: $($c.name) 직급 → $($c.rank)"
        $changed++
        break
      }
    }
  }
}

$doc.Save()
$doc.Close([ref]$false)
$w.Quit()

Write-Output "$changed 줄 고침 — $target"
