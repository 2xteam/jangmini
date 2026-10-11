# 표준이력서_보배써치.docx 채우기
#
#   powershell -NoProfile -File scripts/forms/bobae.ps1
#
# 먼저 `pnpm form:data` 로 tmp-form/data.json 을 만들어 둔다.
# 양식 구조를 다시 보려면:  scripts/forms/dump.ps1 -Path "<양식>"
#
# 이 양식의 특징 — **주요 project 내역** 칸이 따로 있다. 대표 프로젝트 4건이
# 거기 들어간다. 다른 양식에는 없는 칸이라 여기서만 쓴다.

. "$PSScriptRoot\lib.ps1"

$src = Find-FormFile '표준이력서_보배써치.docx'
$dst = File-Path '표준이력서_장민_보배써치.docx'

$d = Read-FormData
$f = Open-Form -Source $src -Dest $dst
$doc = $f.Doc

# ══════════ 칸마다 넣을 내용 ══════════

$personal = @(
  "생년월일 : $($d.personal.birthText)"
  "성별 : $($d.personal.gender)"
  "주소 : $(Or-Todo $d.personal.address '시/구/동까지')"
  "연락처 : $($d.personal.email) / (핸드폰) $($d.personal.phone)"
)

# 양식이 "4~6줄" 을 요구한다. 숫자가 든 것부터 여섯 줄.
$core = $d.core | ForEach-Object { "- $_" }

$edu = @()
foreach ($e in $d.education) { $edu += "$($e.title) ($($e.period), $(Or-Todo $e.place 소재지))" }
foreach ($s in $d.study) { $edu += "$s" }

$careerHead = "경 력 사 항 (총 경력: $($d.career.totalText))"

$career = @()
foreach ($c in $d.companies) {
  $career += "$($c.name) ($($c.from) ~ $($c.to)): $(Or-Todo $c.note '업종·규모·매출액')"
  $career += ""
  $rank = Or-Todo $c.rank '직급'
  $career += "$rank / $($c.dept) ($($c.from) - $($c.to))"
  $career += ""
  $career += " 주요 업무"
  foreach ($b in $c.bullets) { $career += "- $b" }
  $career += ""
}

$projects = @()
foreach ($p in $d.projects) {
  $projects += "- $($p.title) ($($p.company), $($p.period))"
  $projects += "        $($p.summary)"
  foreach ($h in $p.highlights) { $projects += "        · $h" }
  $projects += ""
}

$others = @(
  "병역 : $($d.personal.militaryText)"
  "영어구사능력 : TESOL 취득(2011.06), 호주 워킹홀리데이 1년 · 미국 어학연수      TOEIC $(Or-Todo $d.personal.toeic '점수')"
  "연수/교육사항 : 호주 어학연수·워킹홀리데이(2010.07 ~ 2011.07), 미국 어학연수(2010.01 ~ 2010.02)"
  "포상 : $(Or-Todo $d.personal.awards '수상 이력 (없으면 이 줄 삭제)')"
  "자격사항 : $(($d.certificates | ForEach-Object { "$($_.title)($($_.at))" }) -join ', ')"
  "보훈여부 : 해당 (   )  해당아님 ( O )"
  "PC활용능력 : MS-Office 상 / 협업도구 Notion, Jira, Confluence, Teams"
)

$pay = @(
  "현재연봉 : $(Or-Todo $d.personal.salaryCurrent '만원 (성과급 포함 여부 함께)')"
  "희망연봉 : $(Or-Todo $d.personal.salaryWanted '만원 or 면접 후 협의')"
  "입사시기 : $(Or-Todo $d.personal.availableFrom '채용확정 후 N주 이내')"
)

$reason = @(
  "퇴직 사유 (아주 중요함)"
  "1. 큐텐테크놀로지"
  "- $TODO (회사 사정/개인 사유를 솔직하고 납득 가능하게)"
  "2. 설로인"
  "- $TODO"
  ""
  "지원 사유"
  "- $TODO (2~6줄. 지원 회사의 도메인·과제와 본인 경험을 잇는 문장으로)"
)

# 자기소개서 — 기록에 남아 있는 실제 판단과 회고에서 뽑은 **초안**이다.
# 사람이 읽고 자기 말로 고쳐야 한다.
$self = @(
  "업무 스타일"
  "- 한 번에 다 바꾸지 않습니다. 레거시 전환에서 번들 주입 규칙을 설계해 화면 단위로 옮길 수 있게 했습니다. 되돌릴 수 없는 변경은 검증이 안 됩니다."
  "- 문제를 먼저 정의합니다. 대량 업로드가 느리다는 요구에서 처리량이 아니라 체감이 문제임을 확인하고, 진행 상태 표시로 방향을 바꿨습니다."
  "- 숫자로 확인하고 넘어갑니다. AI 추출 정확도를 실제 문서로 재서 29개 항목 중 6개가 틀린 것을 확인하고, 사람이 알아차릴 검증 장치를 따로 만들었습니다."
  ""
  "업무적 측면에서의 강점"
  "- 레거시와 신규를 동시에 끌고 갑니다. ASP.NET 을 12년 다룬 사람으로서 전환을 맡아 빌드·배포를 3분에서 10초로 줄였습니다."
  "- 여러 팀이 쓰는 것을 만듭니다. 공통 모듈 5종과 사내 플랫폼 4종을 만들어 팀마다 새로 만들던 화면을 하나로 모았습니다."
  "- 인원을 늘리지 않고 범위를 넓힙니다. 네이티브 대신 React Native 를 골라 추가 채용 없이 현장 PDA 앱까지 커버했습니다."
  ""
  "성격 및 대인관계"
  "- 요구가 갈리는 자리에서 선을 긋습니다. 공통 모듈은 쓰는 팀마다 원하는 것이 달라, 어디까지 받아들일지 정하는 일이 개발보다 어려웠습니다."
  "- 실무자에게 직접 묻습니다. 진행 표시 UI 는 현장 피드백을 반영해 만들었고, 그게 성공적인 개선으로 이어졌습니다."
  "- 꾸준한 편입니다. 업무 밖에서는 주기적으로 러닝을 하고, 가족과 함께 기획한 앱을 실제로 출시까지 해 봤습니다."
)

# ══════════ 뒤에서 앞으로 채운다 ══════════

Replace-Paras -Doc $doc -From 106 -To 116 -Lines $self
Replace-Paras -Doc $doc -From 95  -To 102 -Lines $reason
Replace-Paras -Doc $doc -From 89  -To 91  -Lines $pay
Replace-Paras -Doc $doc -From 78  -To 84  -Lines $others
Replace-Paras -Doc $doc -From 71  -To 73  -Lines $projects
Replace-Paras -Doc $doc -From 31  -To 66  -Lines $career
Set-Para      -Doc $doc -Index 29 -Lines @($careerHead)
Replace-Paras -Doc $doc -From 24  -To 26  -Lines $edu
Replace-Paras -Doc $doc -From 18  -To 21  -Lines $core
Replace-Paras -Doc $doc -From 11  -To 14  -Lines $personal

Close-Form -Form $f
