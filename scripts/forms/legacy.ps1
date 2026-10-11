# 옛 이력서(장민_이력서_경력기술서_자기소개서.docx)를 **틀로 써서** 다시 채운다.
#
#   node scripts/forms/legacy-data.mjs one          먼저 데이터를 뽑고
#   powershell -NoProfile -File scripts/forms/legacy.ps1 one
#
# ## 왜 HTML 로 새로 그리지 않는가
#
# 이 서식의 얼굴은 **문단이 아니라 도형**이다. 절 제목마다 회색 띠 도형이
# 하나씩 붙어 있고(8개), 이름 옆 증명사진도 도형이다. CSS 로 흉내 내면
# "비슷하지만 다른" 것이 나온다 — 실제로 두 번 시도했고 두 번 다 어긋났다.
# 원본 파일을 열어 내용만 갈아끼우면 서식은 건드릴 일이 없다.
#
# ## 지켜야 하는 것
#
# 1. **절 제목 문단은 지우지 않는다.** 도형 8개가 전부 그 문단에 걸려 있어서,
#    문단을 지우면 도형도 같이 사라진다. 보배써치 양식에서 구분선 2개를 이렇게
#    날려 먹은 적이 있다. 제목은 두고 **그 사이의 내용만** 지운다.
# 2. **뒤에서 앞으로 고친다.** 앞 절을 먼저 늘리면 뒤 절의 문단 번호가 밀려
#    엉뚱한 자리를 덮어쓴다.
# 3. **원본을 열지 않는다.** 사본을 만들고 사본만 연다.

param([string]$Key = 'one')

$ErrorActionPreference = 'Stop'

$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $repo) { $repo = (Get-Location).Path }

$src  = 'C:\Users\Tracxlogis\Downloads\newenw\장민_이력서_경력기술서_자기소개서.docx'
$json = Join-Path $repo "tmp-form\legacy-$Key.json"
$names = @{ one = '장민_이력서_ONE'; wezon = '장민_이력서_위존'; base = '장민_이력서' }
$name = if ($names.ContainsKey($Key)) { $names[$Key] } else { "장민_이력서_$Key" }
$dst  = Join-Path $env:USERPROFILE "Downloads\$name.docx"
$pdf  = Join-Path $env:USERPROFILE "Downloads\$name.pdf"

if (-not (Test-Path $src))  { throw "원본 서식이 없습니다: $src" }
if (-not (Test-Path $json)) { throw "먼저 'node scripts/forms/legacy-data.mjs $Key' 를 돌리세요." }

$d = Get-Content $json -Raw -Encoding UTF8 | ConvertFrom-Json

Copy-Item $src $dst -Force
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0
$doc = $w.Documents.Open($dst)

$shapesBefore = $doc.Shapes.Count

# ── 도우미 ───────────────────────────────────────────────────────────────

function Clean([string]$t) { ($t -replace "`r", '' -replace "`a", '' -replace [char]7, '').Trim() }

# 어디서 오래 걸리는지 보이게 한다. Word COM 은 한 번 멈추면 왜 멈췄는지
# 알 길이 없어서, 단계마다 찍어 두지 않으면 통째로 다시 돌려야 한다.
$script:T0 = Get-Date
function Step([string]$Msg) {
  $s = [int]((Get-Date) - $script:T0).TotalSeconds
  Write-Output ("  [{0,4}s] {1}" -f $s, $Msg)
}

# 절 제목 문단의 번호를 **한 번에** 찾는다. 못 찾으면 바로 세운다 —
# 조용히 넘어가면 엉뚱한 곳을 지운다.
#
# ⚠️ 제목마다 따로 훑으면 안 된다. `Paragraphs.Item($i)` 는 호출마다 COM 을
# 건너가므로 1,300문단 × 7회에 115초가 걸렸다. 열거자로 한 바퀴만 돈다.
function Find-Paras($Doc, [string[]]$Starts) {
  $found = @{}
  $i = 0
  foreach ($p in $Doc.Paragraphs) {
    $i++
    $t = Clean $p.Range.Text
    foreach ($s in $Starts) {
      if (-not $found.ContainsKey($s) -and $t.StartsWith($s)) { $found[$s] = $i }
    }
    if ($found.Count -eq $Starts.Count) { break }
  }
  foreach ($s in $Starts) { if (-not $found.ContainsKey($s)) { throw "'$s' 로 시작하는 절 제목을 못 찾았습니다" } }
  return $found
}

# $From 다음부터 $ToExclusive 앞까지 지운다. 절 제목 두 개는 남는다.
#
# ⚠️ 문단을 하나씩 지우면 "범위를 편집할 수 없습니다" 로 멈춘다. 표의 행 끝
# 표시와 문서 마지막 문단 기호는 지울 수 없기 때문이다. **범위째** 지우면
# 표가 통째로 빠지고 훨씬 빠르다 — 1,170개 문단을 하나씩 지우던 것이 한 번에
# 끝난다.
function Clear-Between($Doc, [int]$From, $ToExclusive) {
  $s = $Doc.Paragraphs.Item($From).Range.End
  $e = if ($ToExclusive -le $Doc.Paragraphs.Count) {
    $Doc.Paragraphs.Item($ToExclusive).Range.Start
  } else {
    $Doc.Content.End - 1          # 마지막 문단 기호는 남겨 둔다
  }
  if ($e -gt $s) { $Doc.Range($s, $e).Delete() | Out-Null }
}

# 문단 $At 뒤에 줄들을 새 문단으로 넣는다. 서식은 $At 를 따라간다.
function Add-After($Doc, [int]$At, [string[]]$Lines) {
  if (-not $Lines -or $Lines.Count -eq 0) { return }
  $r = $Doc.Paragraphs.Item($At).Range
  $r.InsertParagraphAfter()
  $new = $Doc.Paragraphs.Item($At + 1)
  $new.Range.Text = ($Lines -join [char]13)
  # 제목 서식이 따라붙으므로 본문으로 되돌린다
  for ($i = $At + 1; $i -le $At + $Lines.Count; $i++) {
    $p = $Doc.Paragraphs.Item($i)
    try { $p.Style = $Doc.Styles.Item('표준') } catch { }   # 영문판 Word 는 'Normal'
    $p.Range.Font.Size = 10
    $p.Range.Font.Bold = 0
    # ⚠️ Word 는 색을 **BGR** 로 받는다. #141515 → 0x151514 = 1381140
    $p.Range.Font.Color = 1381140
  }
}

Write-Output "틀: $src"
Write-Output "대상: $Key → $dst"
Write-Output ''

# ── 절 제목 위치 ─────────────────────────────────────────────────────────

$h = Find-Paras $doc @(
  '소개 / About Me', '기술스택 / Skill Set', '경력 사항 / Work Experience',
  '주요 프로젝트 / Projects', '자기 소개', '지원 동기', '기타 사항'
)
$pIntro   = $h['소개 / About Me']
$pSkill   = $h['기술스택 / Skill Set']
$pCareer  = $h['경력 사항 / Work Experience']
$pProject = $h['주요 프로젝트 / Projects']
$pEssay   = $h['자기 소개']
$pMotive  = $h['지원 동기']
$pEtc     = $h['기타 사항']

Write-Output "절 제목 문단  소개 $pIntro · 기술 $pSkill · 경력 $pCareer · 프로젝트 $pProject · 자소 $pEssay · 동기 $pMotive · 기타 $pEtc"

# ══════════ 뒤에서 앞으로 ══════════

# ── 기타 사항 ──
Step '기타 사항'
Clear-Between $doc $pEtc ($doc.Paragraphs.Count + 1)
Add-After $doc $pEtc $d.etc

# ── 지원 동기 ──
Step '지원 동기'
Clear-Between $doc $pMotive $pEtc
$motive = if ($d.motive.Count) { $d.motive } else { @('【직접 입력】 지원 동기') }
Add-After $doc $pMotive $motive

# ── 자기 소개 ──
Step '자기 소개'
Clear-Between $doc $pEssay $pMotive
Add-After $doc $pEssay $d.essay

# ── 주요 프로젝트 ──
#
# 블록(제목 문단 + 5행 표)을 **만들지 않고 골라 쓴다.** 원본에 이미 40개쯤
# 들어 있으므로 앞에서 필요한 수만큼 채우고 나머지를 지우면 된다.
#
# ⚠️ 처음에는 블록 하나만 남기고 `FormattedText` 로 복제했는데 두 번 깨졌다.
#   1. `FormattedText` 는 스냅샷이 아니라 **살아 있는 범위**다. 먼저 떠 두고
#      원본을 지우면 떠 둔 것도 같이 빈다.
#   2. 표 끝 경계에 붙이면 복사본이 **표 안으로** 들어가 문서가 불어난다.
#      (문단 수가 폭증해 몇 분을 돌다 멈췄다)
# 있는 것을 쓰면 두 함정이 모두 없다.
Step '주요 프로젝트 — 블록 모으기'
$projStart = $doc.Paragraphs.Item($pProject).Range.End
$projLimit = $doc.Paragraphs.Item($pEssay).Range.Start
$projTables = @()
foreach ($t in $doc.Tables) {
  if ($t.Range.Start -gt $projStart -and $t.Range.Start -lt $projLimit) { $projTables += $t }
}
Step "쓸 수 있는 블록 $($projTables.Count)개 · 채울 프로젝트 $($d.projects.Count)건"
if ($projTables.Count -lt $d.projects.Count) {
  throw "원본의 프로젝트 블록이 $($projTables.Count)개뿐입니다 — $($d.projects.Count)건을 담을 수 없습니다"
}

# 쓰고 남는 블록은 뒤에서부터 지운다. 마지막으로 쓸 표의 끝부터 절 끝까지.
$lastKept = $projTables[$d.projects.Count - 1]
$doc.Range($lastKept.Range.End, $projLimit).Delete() | Out-Null
$projTables = $projTables[0..($d.projects.Count - 1)]
Step "남는 블록 삭제 (문단 $($doc.Paragraphs.Count))"

Step '프로젝트 칸 채우기'
for ($i = 0; $i -lt $d.projects.Count; $i++) {
  $p = $d.projects[$i]
  $tbl = $projTables[$i]

  # 표 바로 앞 문단이 그 블록의 제목이다
  $before = $doc.Range(0, $tbl.Range.Start)
  $before.Paragraphs.Item($before.Paragraphs.Count).Range.Text = $p.title

  $cells = @($p.stack, $p.role, $p.work, $p.result, $p.link)
  for ($r = 1; $r -le [Math]::Min(5, $tbl.Rows.Count); $r++) {
    $v = $cells[$r - 1]
    if ($null -eq $v) { $v = '' }
    $tbl.Cell($r, 2).Range.Text = ($v -replace "`n", [string][char]11)   # 셀 안 줄바꿈
  }
}
$pos = $projTables[$projTables.Count - 1].Range.End

# 연표 — 한 건마다 표를 만들 분량이 아니다. 제목만 한 줄씩 붙인다.
if ($d.timeline.Count) {
  $ins = $doc.Range($pos, $pos)
  $ins.Text = [char]13 + '그 밖의 참여 프로젝트' + [char]13 + ($d.timeline -join [char]13)
  foreach ($p in $ins.Paragraphs) {
    $p.Style = $doc.Styles.Item('표준')
    $p.Range.Font.Size = 10
    $p.Range.Font.Color = 1381140
  }
  $ins.Paragraphs.Item(2).Range.Font.Bold = 1
  $pos = $ins.End
}

# ── 경력 사항 ──
Step '경력 사항'
# 표는 지우지 않고 행 수만 맞춘 뒤 칸을 덮어쓴다.
$careerTable = $null
foreach ($t in $doc.Tables) {
  if ($t.Range.Start -gt $doc.Paragraphs.Item($pCareer).Range.Start) { $careerTable = $t; break }
}
if ($careerTable) {
  $want = $d.career.Count + 1            # 머리글 한 줄
  while ($careerTable.Rows.Count -lt $want) { $careerTable.Rows.Add() | Out-Null }
  while ($careerTable.Rows.Count -gt $want) { $careerTable.Rows.Item($careerTable.Rows.Count).Delete() }
  for ($i = 0; $i -lt $d.career.Count; $i++) {
    for ($c = 1; $c -le 4; $c++) {
      $v = $d.career[$i][$c - 1]
      if ($null -eq $v) { $v = '' }
      $careerTable.Cell($i + 2, $c).Range.Text = ($v -replace "`n", [string][char]11)
    }
  }
}
# 제목의 총 경력을 고친다. 문단을 다시 쓰면 도형이 날아가므로 숫자만 바꾼다.
$f = $doc.Content.Find
$f.ClearFormatting()
$f.Text = '총 14년 4개월'
$f.Replacement.ClearFormatting()
$f.Replacement.Text = $d.careerTotal
$f.Execute([ref]$null, [ref]$null, [ref]$null, [ref]$null, [ref]$null, [ref]$null, [ref]$null, [ref]$null, [ref]$null, [ref]$null, [ref]2) | Out-Null

# ── 기술스택 ──
Step '기술스택'
$skillTable = $null
foreach ($t in $doc.Tables) {
  if ($t.Range.Start -gt $doc.Paragraphs.Item($pSkill).Range.Start) { $skillTable = $t; break }
}
if ($skillTable) {
  $want = $d.skills.Count + 1
  while ($skillTable.Rows.Count -lt $want) { $skillTable.Rows.Add() | Out-Null }
  while ($skillTable.Rows.Count -gt $want) { $skillTable.Rows.Item($skillTable.Rows.Count).Delete() }
  for ($i = 0; $i -lt $d.skills.Count; $i++) {
    $skillTable.Cell($i + 2, 1).Range.Text = $d.skills[$i][0]
    $skillTable.Cell($i + 2, 2).Range.Text = $d.skills[$i][1]
  }
}

# ── 소개 ──
Step '소개'
Clear-Between $doc $pIntro $pSkill
Add-After $doc $pIntro ($d.intro -split "`n")

# ── 저장 ──
Step '저장 · PDF 내보내기'
$shapesAfter = $doc.Shapes.Count
$doc.Save()
$doc.ExportAsFixedFormat($pdf, 17)   # 17 = wdExportFormatPDF
$pages = $doc.ComputeStatistics(2)
$doc.Close([ref]$false)
$w.Quit()

Write-Output ''
Write-Output "도형 $shapesBefore → $shapesAfter$(if ($shapesAfter -lt $shapesBefore) { '   ⚠ 도형이 사라졌습니다' })"
Write-Output "$pages 쪽"
Write-Output "완료: $dst"
Write-Output "완료: $pdf"
