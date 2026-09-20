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
