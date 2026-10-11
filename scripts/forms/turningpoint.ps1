# 터닝포인트HR 양식(성함_회사명_포지션명_터닝포인트HR.docx)을 채운다.
#
#   node scripts/forms/wezon-data.mjs              먼저 데이터를 뽑고
#   powershell -NoProfile -File scripts/forms/turningpoint.ps1
#
# 내용의 원본은 Notion '위존' 페이지다. 여기서는 옮겨 적기만 한다.
#
# ## 이 양식의 특징
#
# 회사 블록이 **표본으로 2개**만 있는데 우리는 5개다. 28~68 문단(표본 두 블록)을
# 통째로 갈아끼운다. 회사마다 주요업무·주요성과·이직 사유를 따로 쓰게 되어
# 있는 것이 이 양식의 핵심이라 그 모양을 지킨다.
#
# 절 제목에 지원자용 안내가 섞여 있다("JD참고하셔서 관련 역량 기재" 등).
# 제출본에 남으면 안 되므로 걷어낸다.

. "$PSScriptRoot\lib.ps1"

$src  = Find-FormFile '성함_회사명_포지션명_터닝포인트HR..docx'
$dst  = File-Path '장민_위존_제조AI서비스개발_터닝포인트HR.docx'
$json = "$PSScriptRoot\..\..\tmp-form\wezon-form.json"

if (-not (Test-Path $json)) { throw "먼저 'node scripts/forms/wezon-data.mjs' 를 돌리세요." }
$d = Get-Content $json -Raw -Encoding UTF8 | ConvertFrom-Json

$f = Open-Form -Source $src -Dest $dst
$doc = $f.Doc

# ══════════ 칸마다 넣을 내용 ══════════

$personal = @(
  "이    름 :  $($d.personal.name)"
  "출생년도 :  $($d.personal.birth)"
  "주    소 :  $($d.personal.address)"
  "연 락 처 :  $($d.personal.contact)"
  "병역사항 :  $($d.personal.military)"
)

$edu = @()
foreach ($e in $d.education) { $edu += "$($e[0])`t$($e[1])" }

# 양식은 3줄짜리지만 핵심역량은 4개다. 줄 수를 늘려 쓴다.
$core = @()
foreach ($c in $d.core) { $core += $c }

$careerHead = "경력사항 (총 경력: $($d.totalText))"
$career = @()
foreach ($c in $d.careerSummary) { $career += "$($c[0]) / $($c[1])`t`t$($c[2])" }

# 상세 경력 — 표본 블록의 모양(제목 / 회사정보 / 주요업무 / 주요성과 / 이직 사유)을 지킨다
$detail = @()
foreach ($x in $d.details) {
  $detail += $x.head
  $detail += $x.meta
  $detail += ""
  $detail += "주요업무"
  foreach ($w in $x.work) { $detail += "  - $w" }
  $detail += ""
  $detail += "주요성과"
  foreach ($p in $x.perf) { $detail += "  - $p" }
  $detail += ""
  $detail += "이직 사유"
  $detail += "  $($x.reason)"
  $detail += ""
  $detail += ""
}

$certs = @()
foreach ($c in $d.certs) { $certs += $c }

$etc = @()
foreach ($e in $d.etc) { $etc += "$($e[0]): $($e[1])" }

$intro = @()
foreach ($p in $d.intro) { $intro += $p; $intro += "" }

# ══════════ 뒤에서 앞으로 ══════════
# 앞에서부터 늘리면 뒤 문단 번호가 밀려 엉뚱한 자리를 덮어쓴다.

Set-Para      -Doc $doc -Index 87 -Lines $intro
Replace-Paras -Doc $doc -From 77 -To 81 -Lines $etc
Replace-Paras -Doc $doc -From 71 -To 73 -Lines $certs
Set-Para      -Doc $doc -Index 70 -Lines @("어학, 수상 및 자격사항")
Replace-Paras -Doc $doc -From 28 -To 68 -Lines $detail
Set-Para      -Doc $doc -Index 27 -Lines @("상세 경력사항")
Replace-Paras -Doc $doc -From 23 -To 24 -Lines $career
Set-Para      -Doc $doc -Index 22 -Lines @($careerHead)
Replace-Paras -Doc $doc -From 17 -To 19 -Lines $core
Set-Para      -Doc $doc -Index 16 -Lines @("핵심역량")
Replace-Paras -Doc $doc -From 12 -To 13 -Lines $edu
Replace-Paras -Doc $doc -From 4  -To 8  -Lines $personal
Set-Para      -Doc $doc -Index 1  -Lines @("지원 분야: $($d.applyFor)")

# 동의서 하단 — 작성일과 본인. 서명은 사람이 하므로 이름만 적는다.
$today = Get-Date -Format 'yyyy. MM. dd'
$shortName = ($d.personal.name -split ' \(')[0]
for ($i = $doc.Paragraphs.Count; $i -ge 1; $i--) {
  $t = ($doc.Paragraphs.Item($i).Range.Text -replace "`r", '' -replace "`a", '').Trim()
  if ($t -eq '0000. 00. 00') { Set-Para -Doc $doc -Index $i -Lines @($today) }
  if ($t -like '본인 :*OOO*') { Set-Para -Doc $doc -Index $i -Lines @("본인 :   $shortName   (서명)") }
}

# 증명사진 — 양식 상단 도형 안을 그림으로 채운다.
# 도형을 지우고 그림을 새로 넣으면 위치와 테두리가 흐트러진다.
# $PSScriptRoot 가 비는 실행 경로가 있어 저장소 기준으로 잡는다
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $repo) { $repo = (Get-Location).Path }
$photo = Join-Path $repo 'tmp-form\photo-print.jpg'
if (Test-Path $photo) {
  foreach ($sh in $doc.Shapes) {
    $has = $false
    try { $has = $sh.TextFrame.HasText -eq -1 } catch { }
    if ($has -and (($sh.TextFrame.TextRange.Text -replace '\s', '') -match '사진')) {
      $sh.TextFrame.TextRange.Text = ''
      $sh.Fill.UserPicture($photo)
      Write-Output '  증명사진 삽입'
      break
    }
  }
} else {
  Write-Output '  (사진 없음 — tmp-form/photo-print.jpg 가 필요합니다)'
}

Close-Form -Form $f
