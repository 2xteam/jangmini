# 이력서 PDF 를 Word 문서로 바꾼다. (쓰지 않음 — html-to-docx.ps1 을 쓰세요)
#
#   node scripts/notion-to-pdf.mjs <페이지id> 장민_이력서_ONE_본문 --no-header
#   powershell -NoProfile -File scripts/forms/header-image.ps1
#   powershell -NoProfile -File scripts/forms/pdf-to-docx.ps1 장민_이력서_ONE_본문 장민_이력서_ONE
#
# ## 왜 머리글 없는 PDF 를 받나
#
# 완성본 PDF 의 머리글은 옛 이력서에서 떠 온 **벡터**다. 그대로 Word 에 넣으면
# 도형 수천 개로 풀어 놓느라 변환이 끝나지 않는다 — CPU 3분을 넘겨도 저장이
# 안 됐다. 그래서 본문만 Word 로 바꾸고, 머리글은 **그림 한 장**으로 얹는다.
# 본문 글자와 표는 그대로 글자와 표로 남는다.
#
# ## Word 가 멈추는 두 가지 창
#
# 1. "PDF 를 편집 가능한 문서로 변환합니다" 안내 — Open 의 두 번째 인자
#    ConfirmConversions 를 $false 로 줘도 뜬다. 레지스트리로 꺼 둔다.
# 2. "마지막으로 열었을 때 오류가 발생했습니다" — Word 를 강제 종료하면 그
#    파일이 문제 목록에 오른다. Resiliency 키를 비워 둔다.
#
# 둘 다 숨은 채로 떠서 왜 멈췄는지 보이지 않는다. 미리 막는다.

param(
  [Parameter(Mandatory = $true)][string]$Source,   # 머리글 없는 본문 PDF (이름 또는 경로)
  [string]$Name,                                   # 만들 docx 이름 (기본: 본문 이름에서 _본문 제거)
  [string]$Header                                  # 머리글 그림 (기본: tmp-form/header.png)
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $repo) { $repo = (Get-Location).Path }
$downloads = Join-Path $env:USERPROFILE 'Downloads'

$pdf = if (Test-Path $Source) { (Resolve-Path $Source).Path } else { Join-Path $downloads "$Source.pdf" }
if (-not (Test-Path $pdf)) { throw "본문 PDF 가 없습니다: $pdf" }

if (-not $Name) { $Name = ([IO.Path]::GetFileNameWithoutExtension($pdf)) -replace '_본문$', '' }
$out = Join-Path $downloads "$Name.docx"

if (-not $Header) { $Header = Join-Path $repo 'tmp-form\header.png' }

# 머리글이 들어갈 자리. notion-to-pdf.mjs 의 HEAD_BOX 와 같은 값이다(포인트).
# 옛 이력서 1쪽을 2000px 로 그려 흰 줄을 찾아 **재서** 얻었다 —
#   powershell -NoProfile -File scripts/forms/header-image.ps1
$HeadLeft = 35.1; $HeadTop = 40.5; $HeadWidth = 522.7; $HeadHeight = 120.2

if (Test-Path $out) {
  try { $fs = [IO.File]::Open($out, 'Open', 'ReadWrite', 'None'); $fs.Close() }
  catch { throw "$out 가 열려 있습니다. 닫고 다시 돌리세요." }
}

# ── Word 가 멈추는 창을 미리 끈다 ──
$opt = 'HKCU:\Software\Microsoft\Office\16.0\Word\Options'
if (-not (Test-Path $opt)) { New-Item -Path $opt -Force | Out-Null }
New-ItemProperty -Path $opt -Name 'DisableConvertPdfWarning' -Value 1 -PropertyType DWord -Force | Out-Null
$res = 'HKCU:\Software\Microsoft\Office\16.0\Word\Resiliency'
foreach ($k in 'DisabledItems', 'DocumentRecovery') {
  $p = Join-Path $res $k
  if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}

$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0

try {
  $doc = $w.Documents.Open($pdf, $false, $false, $false)
  Write-Output "본문 변환: $($doc.Paragraphs.Count)문단 · 표 $($doc.Tables.Count)개"

  if (Test-Path $Header) {
    # 첫 문단에 걸고, **쪽 기준 절대 위치**로 세운다. 글 흐름과 무관해야
    # 본문이 늘어나도 머리글이 밀리지 않는다.
    $sh = $doc.Shapes.AddPicture($Header, $false, $true, $HeadLeft, $HeadTop, $HeadWidth, $HeadHeight,
                                 $doc.Paragraphs.Item(1).Range)
    $sh.RelativeHorizontalPosition = 1   # wdRelativeToPage
    $sh.RelativeVerticalPosition = 1
    $sh.Left = $HeadLeft
    $sh.Top = $HeadTop
    $sh.WrapFormat.Type = 3              # wdWrapNone — 글이 비켜 가지 않는다
    $sh.LockAspectRatio = 0
    $sh.Width = $HeadWidth
    $sh.Height = $HeadHeight
    Write-Output "머리글 그림: $Header"
  } else {
    Write-Output "⚠ 머리글 그림이 없습니다 ($Header) — 자리가 빈 채로 나갑니다."
    Write-Output "  powershell -NoProfile -File scripts/forms/header-image.ps1 로 먼저 만드세요."
  }

  $doc.SaveAs2($out, 16)   # 16 = wdFormatDocumentDefault (.docx)
  $pages = $doc.ComputeStatistics(2)
  $words = $doc.ComputeStatistics(0)
  $doc.Close([ref]$false)

  Write-Output "$pages쪽 · 단어 $words"
  Write-Output "완료: $out"
} finally {
  $w.Quit()
}
