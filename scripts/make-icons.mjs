/**
 * public/avatar.png 에서 파비콘·애플 아이콘·OG 이미지를 만든다.
 *
 *   pnpm icons
 *
 * 생성물은 커밋한다 — 빌드마다 만들면 Vercel 에 sharp 네이티브 바이너리가
 * 필요해지고, 아바타를 바꿀 때만 다시 돌리면 되는 일이다.
 *
 * 파비콘 위치는 Next 의 파일 컨벤션을 따른다 — `src/app/icon.png` 과
 * `src/app/apple-icon.png` 를 두면 <link rel="icon"> 태그가 **자동 생성**된다.
 * 그래서 layout.tsx 의 metadata.icons 를 손으로 적지 않는다.
 */
import sharp from 'sharp';

const SRC = 'public/avatar.png';

const meta = await sharp(SRC).metadata();
console.log(`원본  ${meta.width}x${meta.height} ${meta.format}${meta.hasAlpha ? ' (알파)' : ''}`);

/**
 * 메모지 PNG 는 사방에 투명 여백이 넓다. 그대로 32px 로 줄이면 얼굴이
 * 아주 작아져 탭에서 알아볼 수 없다. 여백을 먼저 걷어낸다.
 */
const trimmed = await sharp(SRC).trim({ threshold: 10 }).toBuffer();
const t = await sharp(trimmed).metadata();
console.log(`여백 제거  ${t.width}x${t.height}`);

for (const [file, size] of [
  ['src/app/icon.png', 64],
  ['src/app/apple-icon.png', 180],
]) {
  await sharp(trimmed)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(file);
  console.log(`생성  ${file}  ${size}x${size}`);
}

/** OG 이미지 — 링크를 공유할 때 보이는 카드 */
const avatar = await sharp(trimmed)
  .resize(400, 400, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toBuffer();

const bg = Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#856ED9"/>
      <stop offset="55%" stop-color="#329696"/>
      <stop offset="100%" stop-color="#C19433"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="#fbfbfd"/>
  <rect width="1200" height="10" fill="url(#g)"/>
  <text x="110" y="286" font-family="sans-serif" font-size="76" font-weight="700" fill="#18181b">장민</text>
  <text x="110" y="356" font-family="sans-serif" font-size="38" fill="#52525b">Full Stack Developer</text>
  <text x="110" y="424" font-family="sans-serif" font-size="26" fill="#a1a1aa">jangmini.myjane.co.kr</text>
</svg>`);

await sharp(bg).composite([{ input: avatar, top: 115, left: 720 }]).png().toFile('public/og.png');
console.log('생성  public/og.png  1200x630');
