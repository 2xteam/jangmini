# 지원서 양식 채우기

회사마다 다른 지원서 양식에 이력 데이터를 채워 넣는다. 양식은 계속 새로
들어오므로 **데이터 한 벌 + 양식별 매핑**으로 나눠 둔다.

```
build-data.mjs   DB → tmp-form/data.json   (양식과 무관한 이력 데이터 한 벌)
lib.ps1          공통 함수 (사본 만들기 · 문단 바꾸기 · 【직접 입력】)
dump.ps1         아무 양식이나 구조를 훑어본다
jiwonseo.ps1     지원서 양식 (1).doc
bobae.ps1        표준이력서_보배써치.docx
```

## 쓰는 법

```bash
pnpm form:data                                      # 데이터를 새로 만든다
powershell -NoProfile -File scripts/forms/bobae.ps1 # 양식을 채운다
```

결과는 `~/Downloads` 에 **새 파일**로 떨어진다. 원본 양식은 건드리지 않는다.

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
