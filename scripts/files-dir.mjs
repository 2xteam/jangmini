/**
 * 이력서 파일이 모여 있는 폴더.
 *
 * 양식 원본(.docx / .pdf)을 읽고 결과물을 내놓는 **한 곳**이다. 예전에는
 * `~/Downloads` 와 `~/Downloads/newenw` 에 흩어져 있어서 스크립트마다 경로를
 * 따로 박아 두었고, 폴더를 옮기면 여덟 군데를 고쳐야 했다.
 *
 * 다른 PC 나 다른 폴더에서 쓰려면 환경변수로 바꾼다 —
 *   RESUME_DIR=D:\문서\이력서  node scripts/notion-to-pdf.mjs …
 *
 * ⚠️ 이 폴더에는 **사람이 손으로 고친 파일**이 들어 있다. 스크립트가 같은
 * 이름으로 덮어쓰면 그 수정이 사라진다. 덮어쓰기 전에 반드시 확인한다.
 */
export const FILES_DIR = process.env.RESUME_DIR ?? 'C:\\Dev\\jangmini-file';

/** 옛 이력서 — 머리글을 떠 오는 원본 */
export const ORIGIN_PDF = '장민_이력서_경력기술서_자기소개서.pdf';
export const ORIGIN_DOCX = '장민_이력서_경력기술서_자기소개서.docx';
