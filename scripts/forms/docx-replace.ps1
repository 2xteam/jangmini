# .docx 안의 글귀를 바꾼다. 서식은 그대로 둔다.
#
#   powershell -NoProfile -File scripts/forms/docx-replace.ps1 `
#       -Source "원본.docx" -Dest "수정본.docx" -Pairs "tmp-form/fixes.json"
#
# Pairs 는 [{ "find": "...", "replace": "...", "why": "..." }, …] 꼴의 JSON 이다.
# `why` 는 로그에만 쓴다 — 무엇을 왜 바꿨는지 남겨 두면 나중에 되짚기 쉽다.
#
# ## 왜 Word 에 맡기나
#
# .docx 는 한 문장이 run 여러 개로 쪼개져 있다. "6개 페이지가 쓰던" 처럼 가운데
# 토막만 따로 run 이 된 경우도 흔하다. XML 을 직접 손대면 그 경계를 일일이
# 맞춰야 하고, 서식(굵게·색)이 어긋나기 쉽다. Word 의 찾기·바꾸기는 run 경계를
# 넘어 찾고 서식을 유지한다.
#
# ⚠️ **원본은 건드리지 않는다.** 사본을 만들고 사본만 연다.
#
# ⚠️ **SaveAs2 를 쓰지 말 것.** 이 PC 의 Word 에서는 문단 하나짜리 빈 문서조차
# 저장이 끝나지 않는다 (CPU 100% 로 몇 분). 구식 SaveAs 에 형식
# 12(wdFormatXMLDocument)를 주면 같은 .docx 가 2초에 나온다.

param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Dest,
  [Parameter(Mandatory = $true)][string]$Pairs,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"

if (-not (Test-Path $Source)) { throw "원본이 없습니다: $Source" }
if (-not (Test-Path $Pairs)) { throw "바꿀 목록이 없습니다: $Pairs" }

# ⚠️ `@(… | ConvertFrom-Json)` 로는 배열이 **한 덩어리**로 들어온다. 그러면
# 규칙이 3개여도 Count 가 1 이고, $r.find 가 문자열 셋을 담은 배열이 되어
# "못 찾음: 2,0 서비스 입사" 같은 엉뚱한 로그가 나온다. 하나씩 풀어 담는다.
$rules = @()
foreach ($x in (Get-Content $Pairs -Raw -Encoding UTF8 | ConvertFrom-Json)) { $rules += $x }
if (-not $rules.Count) { throw "$Pairs 가 비었습니다." }

Assert-Overwritable -Path $Dest -Force:$Force
Copy-Item $Source $Dest -Force

# 강제 종료했던 파일이 '문제 목록'에 올라 창을 띄우는 것을 막는다
foreach ($k in 'DisabledItems', 'DocumentRecovery') {
  $p = "HKCU:\Software\Microsoft\Office\16.0\Word\Resiliency\$k"
  if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}

$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0

try {
  $doc = $w.Documents.Open($Dest, $false, $false, $false)
  $done = 0

  foreach ($r in $rules) {
    # 바꾸기 전에 실제로 있는지 확인한다. 없는데 조용히 넘어가면
    # "고쳤습니다" 라고 찍어 놓고 아무것도 안 바뀐 파일을 보내게 된다.
    $before = $doc.Content.Text
    if ($before.IndexOf($r.find) -lt 0) {
      Write-Output "✗ 못 찾음: $($r.find.Substring(0, [Math]::Min(60, $r.find.Length)))…"
      continue
    }

    $f = $doc.Content.Find
    $f.ClearFormatting()
    $f.Replacement.ClearFormatting()
    # 위치 인자 그대로 — FindText, MatchCase, MatchWholeWord, MatchWildcards,
    # MatchSoundsLike, MatchAllWordForms, Forward, Wrap(1=wdFindContinue),
    # Format, ReplaceWith, Replace(2=wdReplaceAll)
    [void]$f.Execute($r.find, $true, $false, $false, $false, $false, $true, 1, $false, $r.replace, 2)

    if ($doc.Content.Text.IndexOf($r.find) -ge 0) {
      Write-Output "✗ 바꾸지 못했습니다: $($r.find.Substring(0, [Math]::Min(60, $r.find.Length)))…"
      continue
    }
    $done += 1
    Write-Output "✓ $(if ($r.why) { $r.why } else { '바꿈' })"
    Write-Output "   - $($r.find)"
    Write-Output "   + $($r.replace)"
    Write-Output ''
  }

  $saveArgs = [object[]]@([string]$Dest, [int]12)
  [void]$doc.GetType().InvokeMember('SaveAs', 'InvokeMethod', $null, $doc, $saveArgs)
  $pages = $doc.ComputeStatistics(2)
  $doc.Close([ref]$false)

  Write-Output "$done/$($rules.Count)건 반영 · $pages쪽"
  Write-Output "완료: $Dest"
  if ($done -lt $rules.Count) { throw "$($rules.Count - $done)건을 못 바꿨습니다. 위 '✗' 를 확인하세요." }
} finally {
  $w.Quit()
}
