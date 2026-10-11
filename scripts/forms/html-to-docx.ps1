# 이력서를 Word 문서로 만든다.
#
#   node scripts/notion-to-pdf.mjs <페이지id> 장민_이력서_ONE_본문 --no-header
#   powershell -NoProfile -File scripts/forms/header-image.ps1
#   powershell -NoProfile -File scripts/forms/html-to-docx.ps1 장민_이력서_ONE_본문 장민_이력서_ONE
#
# ## 왜 PDF 가 아니라 HTML 에서 만드나
#
# Word 는 PDF 를 편집 가능한 문서로 되살려 주지만, **그 결과를 .docx 로 쓰는
# 단계에서 끝나지 않는다.** 열기는 5초인데 저장이 CPU 100% 로 몇 분을 돌아도
# 안 끝났다. 머리글 벡터를 빼고 본문만 넣어도, 그림을 아예 빼도 같았다.
# 되살리면서 본문을 글상자 더미로 만들어 놓기 때문으로 보인다.
#
# PDF 를 만든 그 HTML 을 Word 로 열면 빠르고, 표는 표로 글자는 글자로 들어와
# 고치기도 쉽다. 대신 줄바꿈 위치가 PDF 와 미세하게 다를 수 있다.
#
# ## Word 가 멈추는 창
#
# 강제 종료한 파일은 "마지막으로 열었을 때 오류가 발생했습니다" 창을 띄운다.
# 창이 숨은 채로 떠서 왜 멈췄는지 보이지도 않으므로 Resiliency 를 비워 둔다.

param(
  [Parameter(Mandatory = $true)][string]$Source,   # tmp-form 의 HTML 이름 또는 경로
  [string]$Name,                                   # 만들 docx 이름 (기본: 이름에서 _본문 제거)
  [string]$Header,                                 # 머리글 그림 (기본: tmp-form/header.png)
  [switch]$Force                                   # 이미 있는 .docx 를 덮어쓴다
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib.ps1"

$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $repo) { $repo = (Get-Location).Path }

$html = if (Test-Path $Source) { (Resolve-Path $Source).Path } else { Join-Path $repo "tmp-form\$Source.html" }
if (-not (Test-Path $html)) { throw "HTML 이 없습니다: $html" }

if (-not $Name) { $Name = ([IO.Path]::GetFileNameWithoutExtension($html)) -replace '_본문$', '' }
$out = File-Path "$Name.docx"
if (-not $Header) { $Header = Join-Path $repo 'tmp-form\header.png' }

# 머리글이 들어갈 자리(포인트). notion-to-pdf.mjs 의 HEAD_BOX 와 같은 값이고,
# 눈대중이 아니라 scripts/forms/header-image.ps1 이 재서 알려 준 값이다.
$HeadLeft = 35.1; $HeadTop = 40.5; $HeadWidth = 522.7; $HeadHeight = 120.2

Assert-Overwritable -Path $out -Force:$Force

$res = 'HKCU:\Software\Microsoft\Office\16.0\Word\Resiliency'
foreach ($k in 'DisabledItems', 'DocumentRecovery') {
  $p = Join-Path $res $k
  if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}

$sw = [Diagnostics.Stopwatch]::StartNew()
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0

try {
  $doc = $w.Documents.Open($html, $false, $false, $false)
  Write-Output "열기 $([int]$sw.Elapsed.TotalSeconds)s — $($doc.Paragraphs.Count)문단 · 표 $($doc.Tables.Count)개"

  # HTML 에서 오면 쪽 여백이 기본값이다. PDF 와 같게 맞춘다 (위 15mm / 옆 16mm).
  $ps = $doc.PageSetup
  $ps.TopMargin = $w.MillimetersToPoints(15)
  $ps.BottomMargin = $w.MillimetersToPoints(15)
  $ps.LeftMargin = $w.MillimetersToPoints(16)
  $ps.RightMargin = $w.MillimetersToPoints(16)

  if (Test-Path $Header) {
    # 첫 문단에 걸되 **쪽 기준 절대 위치**로 세운다. 글 흐름과 떨어뜨려야
    # 본문이 늘어나도 머리글이 밀리지 않는다.
    $sh = $doc.Shapes.AddPicture($Header, $false, $true, $HeadLeft, $HeadTop, $HeadWidth, $HeadHeight,
                                 $doc.Paragraphs.Item(1).Range)
    $sh.WrapFormat.Type = 3              # wdWrapNone — 글이 비켜 가지 않는다
    $sh.RelativeHorizontalPosition = 1   # wdRelativeToPage
    $sh.RelativeVerticalPosition = 1
    $sh.LockAspectRatio = 0
    $sh.Left = $HeadLeft
    $sh.Top = $HeadTop
    $sh.Width = $HeadWidth
    $sh.Height = $HeadHeight
    Write-Output "머리글 그림 얹음 ($([int]$sw.Elapsed.TotalSeconds)s)"
  } else {
    Write-Output "⚠ 머리글 그림이 없습니다 ($Header) — 자리가 빈 채로 나갑니다."
    Write-Output "  powershell -NoProfile -File scripts/forms/header-image.ps1 로 먼저 만드세요."
  }

  # ⚠️ `SaveAs2($out, 16)` 를 쓰면 **안 된다.** 이 PC 의 Word 에서는 문단 하나짜리
  # 빈 문서조차 저장이 끝나지 않는다 (CPU 100% 로 몇 분). 구식 `SaveAs` 에
  # 형식 12(wdFormatXMLDocument)를 주면 같은 .docx 가 2초에 나온다.
  #
  # PowerShell 의 COM 바인딩은 SaveAs 의 [ref] 인자를 못 넘기므로 리플렉션으로
  # 부른다 — 그냥 부르면 "psobject 를 Object 로 변환할 수 없습니다" 가 난다.
  $saveArgs = [object[]]@([string]$out, [int]12)
  [void]$doc.GetType().InvokeMember('SaveAs', 'InvokeMethod', $null, $doc, $saveArgs)
  $pages = $doc.ComputeStatistics(2)
  $doc.Close([ref]$false)

  Write-Output "저장 $([int]$sw.Elapsed.TotalSeconds)s — $pages쪽 · $([int]((Get-Item $out).Length / 1KB))KB"
  Write-Output "완료: $out"
} finally {
  $w.Quit()
}
