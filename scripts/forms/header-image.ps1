# 옛 이력서 PDF 의 **머리글 띠만** 잘라 그림으로 저장한다.
#
#   powershell -NoProfile -File scripts/forms/header-image.ps1
#   → tmp-form/header.png   (notion-to-pdf.mjs 가 머리글 자리에 그대로 쓴다)
#
# ## 왜 그림으로 쓰는가
#
# 머리글(이름 / 직함 / Birthday / Contact / 증명사진 / 회색 띠)을 CSS 로 두 번
# 흉내 냈지만 두 번 다 "비슷하지만 다른" 것이 나왔다. 글꼴(HY헤드라인M)이 이
# PC 에 없고, 색도 Word COM 이 BGR 로 돌려줘 한 번 틀렸다. 원본에서 그대로
# 떠 오면 어긋날 자리가 없다.
#
# ## 어떻게 렌더링하나
#
# 이 PC 에는 poppler(pdftoppm)도 ImageMagick 도 Ghostscript 도 없다. 대신
# Windows 에 들어 있는 **Windows.Data.Pdf** (WinRT) 로 쪽을 비트맵으로 그린다.
# 추가 설치가 필요 없다.

$ErrorActionPreference = 'Stop'

$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $repo) { $repo = (Get-Location).Path }

$src = 'C:\Users\Tracxlogis\Downloads\newenw\장민_이력서_경력기술서_자기소개서.pdf'
$out = Join-Path $repo 'tmp-form\header.png'
$full = Join-Path $repo 'tmp-form\page1.png'

# 가로 폭(px). 인쇄용이라 넉넉히 뽑는다.
$Width = 2000
# 머리글이 끝났다고 보는 흰 줄의 높이(px). 줄 사이 간격(약 25px)보다 커야
# 하고, 머리글과 다음 절 사이 간격(약 56px)보다 작아야 한다.
$GapPx = 40

if (-not (Test-Path $src)) { throw "원본 PDF 가 없습니다: $src" }
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null

# ── WinRT 비동기 호출을 동기로 기다리는 도우미 ──
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
function Await($op, $type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  return $t.Result
}
function AwaitAction($op) {
  $m = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
                   $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
  $t = $m.Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
}

[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($src)) ([Windows.Storage.StorageFile])
$pdf  = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
Write-Output "PDF $($pdf.PageCount)쪽"

$page = $pdf.GetPage(0)
$opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
$opts.DestinationWidth = $Width

# 메모리 스트림에 그린 뒤 파일로 떨군다
$ms = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
AwaitAction ($page.RenderToStreamAsync($ms, $opts))

$reader = New-Object Windows.Storage.Streams.DataReader($ms.GetInputStreamAt(0))
$size = [uint32]$ms.Size
Await ($reader.LoadAsync($size)) ([uint32]) | Out-Null
$bytes = New-Object byte[] $size
$reader.ReadBytes($bytes)
[IO.File]::WriteAllBytes($full, $bytes)
Write-Output "1쪽 전체: $full"

# ── 머리글 범위를 **재서** 잘라 낸다 ──
#
# 비율을 눈대중으로 박아 두면 PDF 가 조금만 바뀌어도 사진 아래가 잘린다
# (처음에 0.185 로 넣었다가 Contact 줄과 사진 턱이 날아갔다). 흰 줄을 찾아
# 경계를 직접 구한다.
Add-Type -AssemblyName System.Drawing
$img = [Drawing.Bitmap]::FromFile($full)

function Row-HasInk($Bmp, [int]$Y) {
  for ($x = 0; $x -lt $Bmp.Width; $x += 4) {
    $c = $Bmp.GetPixel($x, $Y)
    if ((($c.R + $c.G + $c.B) / 3) -lt 245) { return $true }
  }
  return $false
}

# 위에서부터 첫 내용 줄
$top = 0
while ($top -lt $img.Height -and -not (Row-HasInk $img $top)) { $top += 2 }
# 그 뒤 $GapPx 만큼 이어지는 흰 줄이 머리글의 끝이다
$y = $top
$bottom = $img.Height
while ($y -lt $img.Height) {
  if (Row-HasInk $img $y) { $y += 2; continue }
  $run = $y
  while ($run -lt $img.Height -and -not (Row-HasInk $img $run)) { $run += 2 }
  if (($run - $y) -ge $GapPx) { $bottom = $y; break }
  $y = $run + 2
}
# 좌우 — 쪽 여백을 떼어 본문 단과 폭을 맞춘다
$minX = $img.Width; $maxX = 0
for ($yy = $top; $yy -lt $bottom; $yy += 3) {
  for ($x = 0; $x -lt $img.Width; $x += 2) {
    $c = $img.GetPixel($x, $yy)
    if ((($c.R + $c.G + $c.B) / 3) -lt 245) {
      if ($x -lt $minX) { $minX = $x }
      if ($x -gt $maxX) { $maxX = $x }
    }
  }
}
$pad = [int]($img.Width * 0.004)
$rect = New-Object Drawing.Rectangle(
  [Math]::Max(0, $minX - $pad), [Math]::Max(0, $top - $pad),
  [Math]::Min($img.Width, $maxX - $minX + 2 * $pad), ($bottom - $top + 2 * $pad))

$crop = $img.Clone($rect, $img.PixelFormat)
$crop.Save($out, [Drawing.Imaging.ImageFormat]::Png)
$w = $crop.Width; $h = $crop.Height
$crop.Dispose()
$img.Dispose()

$kb = [int]((Get-Item $out).Length / 1KB)
Write-Output "잘라 낸 범위  x $minX~$maxX · y $top~$bottom"
Write-Output "머리글: $out  (${w}x${h}px, ${kb}KB)"
