# PDF 한 쪽을 PNG 로 그린다. 눈으로 확인할 때 쓴다.
#
#   powershell -NoProfile -File scripts/forms/pdf-page-png.ps1 <pdf> <출력png> [쪽번호] [가로px]
#
# 이 PC 에는 poppler 도 ImageMagick 도 Ghostscript 도 없다. Windows 에 들어
# 있는 Windows.Data.Pdf (WinRT) 를 쓰면 추가 설치 없이 그릴 수 있다.

param(
  [Parameter(Mandatory = $true)][string]$Pdf,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Page = 1,
  [int]$Width = 1100
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Pdf)) { throw "PDF 가 없습니다: $Pdf" }

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
$asAct = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function Await($op, $type) { $t = $asOp.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
function AwaitAct($op) { $asAct.Invoke($null, @($op)).Wait(-1) | Out-Null }

[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path $Pdf).Path)) ([Windows.Storage.StorageFile])
$doc  = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
if ($Page -lt 1 -or $Page -gt $doc.PageCount) { throw "$Page 쪽은 없습니다 (전체 $($doc.PageCount)쪽)" }

$pg = $doc.GetPage($Page - 1)
$opt = New-Object Windows.Data.Pdf.PdfPageRenderOptions
$opt.DestinationWidth = $Width
$ms = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
AwaitAct ($pg.RenderToStreamAsync($ms, $opt))

$rd = New-Object Windows.Storage.Streams.DataReader($ms.GetInputStreamAt(0))
$sz = [uint32]$ms.Size
Await ($rd.LoadAsync($sz)) ([uint32]) | Out-Null
$bytes = New-Object byte[] $sz
$rd.ReadBytes($bytes)
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
[IO.File]::WriteAllBytes($Out, $bytes)

Write-Output "$Page/$($doc.PageCount)쪽 → $Out"
