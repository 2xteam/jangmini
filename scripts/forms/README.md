# 지원서 양식 채우기

회사마다 다른 지원서 양식에 이력 데이터를 채워 넣는다. 양식은 계속 새로
들어오므로 **데이터 한 벌 + 양식별 매핑**으로 나눠 둔다.

```
build-data.mjs    DB → tmp-form/data.json   (양식과 무관한 이력 데이터 한 벌)
wezon-data.mjs    Notion 위존 이력서 → tmp-form/wezon-form.json
lib.ps1           공통 함수 (사본 만들기 · 문단 바꾸기 · 경로 · 덮어쓰기 가드)
dump.ps1          아무 양식이나 구조를 훑어본다
jiwonseo.ps1      지원서 양식 (1).doc
bobae.ps1         표준이력서_보배써치.docx
turningpoint.ps1  성함_회사명_포지션명_터닝포인트HR..docx
header-image.ps1  옛 이력서 1쪽에서 머리글 범위를 재고 그림으로 잘라 낸다
html-to-docx.ps1  이력서 HTML → .docx (머리글은 그림으로 얹는다)
pdf-page-png.ps1  PDF 한 쪽을 PNG 로 — 눈으로 확인할 때
```

## 파일은 한곳에 둔다

양식 원본과 결과물은 모두 **`C:\Dev\jangmini-file`** 에 있다. 경로는 두 곳에
한 번씩만 적혀 있다 — `scripts/files-dir.mjs` (Node) 와 `lib.ps1` 의
`$script:FILES_DIR` (PowerShell). 다른 폴더를 쓰려면 환경변수 `RESUME_DIR`.

예전에는 `~/Downloads` 와 `~/Downloads/newenw` 에 흩어져 있어서 스크립트마다
경로를 박아 두었고, 폴더를 옮기니 여덟 군데를 고쳐야 했다. 아직 옛 자리에
남은 양식이 있어 `Find-FormFile` 이 새 폴더를 먼저 보고 없으면 옛 자리로
떨어진다 — 옛 자리에서 찾으면 그렇다고 알려 준다.

> ⚠️ 이 폴더에는 **사람이 손으로 고친 파일**이 있다 (예: `장민_이력서_ONE.docx`).
> 스크립트가 같은 이름으로 덮어쓰면 그 수정이 조용히 사라지므로,
> `Assert-Overwritable` 이 막는다. 정말 덮어쓸 때만 `-Force` 를 붙인다.

## 쓰는 법

```bash
pnpm form:data                                      # 데이터를 새로 만든다
powershell -NoProfile -File scripts/forms/bobae.ps1 # 양식을 채운다
```

결과는 이력서 폴더에 **새 파일**로 떨어진다. 원본 양식은 건드리지 않는다.

## 이력서를 Word 로

PDF 를 Word 로 역변환하지 않는다. **PDF 를 만든 그 HTML** 을 Word 로 연다.

```bash
node scripts/notion-to-pdf.mjs <페이지id> 장민_이력서_ONE_본문 --no-header
powershell -NoProfile -File scripts/forms/header-image.ps1
powershell -NoProfile -File scripts/forms/html-to-docx.ps1 -Source 장민_이력서_ONE_본문 -Name 장민_이력서_ONE
```

- `--no-header` 는 머리글 자리만 비워 둔다. 완성본 PDF 의 머리글은 옛 이력서에서
  떠 온 **벡터**인데, 그대로 Word 에 넣으면 도형 수천 개로 풀어 놓느라 변환이
  끝나지 않는다. 머리글은 그림 한 장으로 얹는다.
- 본문은 **진짜 표와 진짜 글자**로 들어가 바로 고칠 수 있다. 대신 줄바꿈 위치가
  PDF 와 미세하게 다를 수 있다.

> ⚠️ **`SaveAs2` 를 쓰지 말 것.** 이 PC 의 Word 에서는 문단 하나짜리 빈 문서조차
> 저장이 끝나지 않는다 (CPU 100% 로 몇 분). 구식 `SaveAs` 에 형식
> 12(`wdFormatXMLDocument`)를 주면 같은 .docx 가 2초에 나온다. PowerShell 의 COM
> 바인딩이 `SaveAs` 의 인자를 못 넘기므로 리플렉션으로 부른다.

## 새 양식이 오면

1. **구조를 본다.** 문단 번호와 표 좌표가 찍힌다 — 채우는 자리를 이걸로 잡는다.

   ```bash
   powershell -NoProfile -File scripts/forms/dump.ps1 -Path "C:\...\새양식.docx"
   ```

2. **`bobae.ps1` 을 복사해 이름을 바꾼다.** 위쪽 `$src`/`$dst` 를 고치고,
   맨 아래 `Replace-Paras` 의 문단 번호를 새 양식에 맞춘다.

3. **돌리고, 다시 `dump.ps1` 로 결과를 읽어 확인한다.** 눈으로 열어 보기 전에
   텍스트로 먼저 본다 — 줄이 밀렸는지 한눈에 보인다.

## 반드시 지키는 것

**원본을 고치지 않는다.** `Open-Form` 이 사본을 만들고 사본만 연다. 양식을
덮어쓰면 표본 문구가 사라져 다음에 구조를 알 수 없다.

**문단은 뒤에서 앞으로 바꾼다.** 앞에서부터 여러 줄로 늘리면 뒤 문단 번호가
밀려 엉뚱한 자리를 덮어쓴다. `Replace-Paras` 호출을 문단 번호 **내림차순**으로
쓴다.

**모르는 값은 지어내지 않는다.** 연봉·주소·이직 사유처럼 사람만 아는 것은
`build-data.mjs` 에서 `null` 로 두고 `Or-Todo` 로 `【직접 입력】` 을 찍는다.
Word 에서 그 말로 검색하면 남은 자리가 전부 나온다. 이력서에 지어낸 값을
넣으면 면접에서 그대로 무너진다 — 이 저장소에서 "API 호출 99% 감소" 로 한 번
겪었다.

**.ps1 은 UTF-8 BOM 으로 저장한다.** Windows PowerShell 5.1 은 BOM 이 없으면
ANSI 로 읽어서 한글 경로가 깨진다 (`지원서` → `吏?먯꽌`). 편집한 뒤에는
BOM 이 남아 있는지 확인한다.

## ⚠️ 문단을 지우면 거기 매달린 도형도 사라진다

이 양식들의 **절 구분선은 문단이 아니라 도형**(Straight Connector)이다.
문단에 매달려 있어서 `Replace-Paras` 가 그 문단을 지우면 선도 함께 사라진다.
본문만 읽어서는 알아채지 못한다 — 도형 수를 세야 보인다.

보배써치 양식에서 실제로 두 줄을 잃었다(13개 → 11개): 핵심 역량 · 학 력 사 항
아래 선. 채운 뒤 **도형 수를 원본과 비교**하고, 줄었으면 Word 에서 직접 선을
그어 넣는 편이 빠르다. `Shapes.AddLine` 으로 되돌려 보려 했지만 Word 자동화가
대화상자에 걸려 멈췄다.

```powershell
# 원본과 결과의 도형 수를 비교한다
$w = New-Object -ComObject Word.Application; $w.Visible = $false
foreach ($p in @("<원본>", "<결과>")) {
  $d = $w.Documents.Open($p, [ref]$false, [ref]$true)
  Write-Output ("{0} 도형 {1}" -f (Split-Path $p -Leaf), $d.Shapes.Count)
  $d.Close([ref]$false)
}
$w.Quit()
```

## ⚠️ Word 를 강제 종료하면 다음 실행이 멈춘다

자동화가 멈췄다고 `Stop-Process -Force` 로 여러 번 죽이면, Word 가 다음에 뜰 때
**문서 복구 창**을 띄우려다 자동화가 그 창에서 멈춘다. 그때는 사람이 Word 를
한 번 직접 열어 복구 창을 닫아 줘야 풀린다.

## 주의 — 신상 정보

`tmp-form/data.json` 에 **휴대폰 번호와 생년월일**이 들어 있다. `.gitignore`
에 있으니 커밋되지 않는다. 지원서에는 넣되 공개 사이트에는 넣지 않는다 —
사이트 쪽 규칙은 `scripts/ingest.mjs` 의 `stripNotionChrome` 이 지킨다.

## Word 프로세스가 남을 때

COM 인스턴스가 파일을 잡고 있어 `Copy-Item` 이 실패하면, 창 제목이 없는
WINWORD 만 골라 정리한다. **제목이 있는 것은 사람이 열어 둔 문서다.**

```powershell
Get-Process WINWORD | Where-Object { -not $_.MainWindowTitle } | Stop-Process -Force
```
