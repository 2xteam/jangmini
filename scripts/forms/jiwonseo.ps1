# 지원서 양식 (1).doc 채우기
#
#   powershell -NoProfile -File scripts/forms/jiwonseo.ps1
#
# 먼저 `pnpm form:data` 로 tmp-form/data.json 을 만들어 둔다.
#
# 이 양식의 특징 — 구형 Word 바이너리(.doc) 다. Word COM 은 그대로 읽는다.
# 상단에 사진 표(1x1)가 있고, 프로젝트 칸은 따로 없어 경력기술서에 녹인다.

. "$PSScriptRoot\lib.ps1"

$src = "C:\Users\Tracxlogis\Downloads\지원서 양식 (1).doc"
$dst = "C:\Users\Tracxlogis\Downloads\지원서_장민.doc"

$d = Read-FormData
$f = Open-Form -Source $src -Dest $dst
$doc = $f.Doc

# ══════════ 칸마다 넣을 내용 ══════════

$personal = @(
  "성    명      $($d.personal.name)"
  "생년월일`t     $($d.personal.birthDotted)"
  "전화번호      $($d.personal.phone)"
  "주    소      $(Or-Todo $d.personal.address '상세 주소')"
  "병    역      $($d.personal.militaryText)"
)

$edu = @()
foreach ($e in $d.education) { $edu += "$($e.period)`t$($e.title)" }
if ($d.study.Count) { $edu += "어학연수  " + ($d.study -join ' / ') }

$workHead = "Work Experience [경    력]   (총 $($d.career.totalText))"

$work = @()
foreach ($c in $d.companies) {
  $rank = Or-Todo $c.rank '직급'
  # 표 한 칸에 한 줄만 들어간다. 첫 불릿을 그대로 쓰면 넘친다
  $one = Or-Todo $c.oneLiner '담당 업무'
  $work += "$($c.from) ~ $($c.to) ($($c.monthsText))`t`t$($c.name) / $($c.dept) / $rank / $one"
}

# 양식이 세 줄짜리라 핵심역량은 앞 세 줄만 쓴다
$core = $d.core | Select-Object -First 3

$others = @(
  "영어: TESOL 취득(2011.06), 호주 워킹홀리데이 1년 · 미국 어학연수 경험"
  "자격: " + (($d.certificates | ForEach-Object { "$($_.title)($($_.at))" }) -join ', ')
  "직전 연봉: $(Or-Todo $d.personal.salaryCurrent) (고정 기본연봉: $TODO / 변동성 성과급: $TODO)"
  "[기본연봉 기준] 희망 고정연봉(Max): $(Or-Todo $d.personal.salaryWanted) / 최소 마지노선 고정연봉(Min): 내규에 따름"
  "이직 사유: $(Or-Todo $d.personal.leaveReason)"
  "입사 가능일: $(Or-Todo $d.personal.availableFrom)"
)

$career = @()
foreach ($c in $d.companies) {
  $rank = Or-Todo $c.rank '직급'
  $career += "$($c.from) ~ $($c.to)`t`t`t`t       $($c.name) / $($c.dept) / $rank"
  $career += "* $(Or-Todo $c.note '업종·인원·매출')"
  foreach ($b in $c.bullets) { $career += "  - $b" }
  $career += ""
}

# ══════════ 뒤에서 앞으로 채운다 ══════════

Set-Para      -Doc $doc -Index 50 -Lines @("작 성 자: $($d.personal.name)")
Set-Para      -Doc $doc -Index 49 -Lines @("작 성 일: 2026년   09월   20일")
Set-Para      -Doc $doc -Index 46 -Lines $d.intro
Replace-Paras -Doc $doc -From 38 -To 42 -Lines $career
Replace-Paras -Doc $doc -From 28 -To 33 -Lines $others
Replace-Paras -Doc $doc -From 23 -To 25 -Lines $core
Replace-Paras -Doc $doc -From 19 -To 20 -Lines $work
Set-Para      -Doc $doc -Index 18 -Lines @($workHead)
Replace-Paras -Doc $doc -From 14 -To 16 -Lines $edu
Replace-Paras -Doc $doc -From 7  -To 11 -Lines $personal

Close-Form -Form $f
