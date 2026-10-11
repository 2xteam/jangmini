# 양식 채우기 공통 함수.
#
# 각 양식 스크립트가 맨 위에서 dot-source 한다:  . "$PSScriptRoot\lib.ps1"
#
# ## 지켜야 하는 것 두 가지
#
# 1. **원본을 고치지 않는다.** 사본을 만들고 사본만 연다. 양식은 다시 받기
#    번거롭고, 덮어쓰면 표본 문구가 사라져 다음에 구조를 알 수 없다.
# 2. **문단은 뒤에서 앞으로 바꾼다.** 앞에서부터 여러 줄로 늘리면 뒤 문단의
#    번호가 밀려서 엉뚱한 자리를 덮어쓴다. 한 번 그렇게 날려 먹으면 어디가
#    틀렸는지 찾는 데 오래 걸린다.

$ErrorActionPreference = 'Stop'

# 사람이 채워야 하는 자리. Word 에서 이 말로 검색하면 전부 나온다.
$script:TODO = '【직접 입력】'

function Open-Form {
  param([string]$Source, [string]$Dest)
  Copy-Item $Source $Dest -Force
  $w = New-Object -ComObject Word.Application
  $w.Visible = $false
  $w.DisplayAlerts = 0
  $doc = $w.Documents.Open($Dest)
  return @{ App = $w; Doc = $doc; Path = $Dest }
}

function Close-Form {
  param($Form)
  $Form.Doc.Save()
  $Form.Doc.Close([ref]$false)
  $Form.App.Quit()
  Write-Output "완료: $($Form.Path)"
}

# 문단 하나 자리에 여러 줄을 넣는다. Word 는 Chr(13) 을 문단 나눔으로 읽는다.
function Set-Para {
  param($Doc, [int]$Index, [string[]]$Lines)
  $r = $Doc.Paragraphs.Item($Index).Range
  $r.MoveEnd(1, -1) | Out-Null   # 문단 기호는 남기고 본문만
  $r.Text = ($Lines -join [char]13)
}

# $From..$To 문단을 $Lines 로 통째로 갈아끼운다. 뒤에서부터 지운다.
function Replace-Paras {
  param($Doc, [int]$From, [int]$To, [string[]]$Lines)
  for ($i = $To; $i -gt $From; $i--) { $Doc.Paragraphs.Item($i).Range.Delete() | Out-Null }
  Set-Para -Doc $Doc -Index $From -Lines $Lines
}

# 값이 없으면 【직접 입력】. 지어내지 않는다.
function Or-Todo {
  param($Value, [string]$Hint = '')
  if ($null -eq $Value -or "$Value".Trim() -eq '') {
    if ($Hint) { return "$script:TODO $Hint" } else { return $script:TODO }
  }
  return "$Value"
}

function Read-FormData {
  param([string]$Path = "$PSScriptRoot\..\..\tmp-form\data.json")
  if (-not (Test-Path $Path)) {
    throw "데이터가 없습니다. 먼저 'pnpm form:data' 를 돌리세요: $Path"
  }
  return Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

# 이력서 파일이 모여 있는 폴더. scripts/files-dir.mjs 와 같은 값이다.
#
# 양식 원본(.docx / .pdf)을 읽고 결과물을 내놓는 **한 곳**이다. 예전에는
# ~\Downloads 와 ~\Downloads\newenw 에 흩어져 있어서 스크립트마다 경로를 따로
# 박아 두었고, 폴더를 옮기면 여덟 군데를 고쳐야 했다.
#
# 다른 폴더를 쓰려면 환경변수 RESUME_DIR 를 준다.
$script:FILES_DIR = if ($env:RESUME_DIR) { $env:RESUME_DIR } else { 'C:\Dev\jangmini-file' }

# 이력서 폴더 안의 경로를 만든다.
function File-Path { param([string]$Name) return (Join-Path $script:FILES_DIR $Name) }

# 양식 원본을 찾는다 — 새 폴더를 먼저 보고, 없으면 옛 위치로 떨어진다.
#
# 파일을 한곳으로 모으는 중이라 아직 ~\Downloads 에 남은 것이 있다. 스크립트가
# 남의 파일을 옮기지는 않으므로, 찾을 수 있는 자리를 차례로 본다. 옛 자리에서
# 찾으면 알려 준다 — 그래야 옮길 것이 무엇인지 보인다.
function Find-FormFile {
  param([Parameter(Mandatory = $true)][string]$Name)
  $here = File-Path $Name
  if (Test-Path $here) { return $here }
  foreach ($dir in (Join-Path $env:USERPROFILE 'Downloads\newenw'), (Join-Path $env:USERPROFILE 'Downloads')) {
    $p = Join-Path $dir $Name
    if (Test-Path $p) {
      Write-Output "  (옛 자리에서 찾았습니다: $p — $script:FILES_DIR 로 옮기는 편이 좋습니다)"
      return $p
    }
  }
  throw "양식 원본을 못 찾았습니다: $Name`n  찾아본 곳: $script:FILES_DIR, ~\Downloads\newenw, ~\Downloads"
}

# 덮어쓰기 전에 묻는다.
#
# ⚠️ 이 폴더에는 **사람이 손으로 고친 파일**이 있다. 스크립트가 같은 이름으로
# 덮어쓰면 그 수정이 조용히 사라진다. 한 번 날릴 뻔했다. 덮어쓰려면 -Force 를
# 명시해야 한다.
function Assert-Overwritable {
  param([string]$Path, [switch]$Force)
  if (-not (Test-Path $Path)) { return }
  try { $fs = [IO.File]::Open($Path, 'Open', 'ReadWrite', 'None'); $fs.Close() }
  catch { throw "$Path 가 열려 있습니다. 닫고 다시 돌리세요." }
  if (-not $Force) {
    $when = (Get-Item $Path).LastWriteTime
    throw "$Path 가 이미 있습니다 (마지막 수정 $when).`n" +
          "  손으로 고친 파일일 수 있습니다. 덮어쓰려면 -Force 를 붙이세요."
  }
}
