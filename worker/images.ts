// 이미지 업로드·서빙 (R2).
//
// 지금까지 창작마당은 "이미 어딘가에 호스팅된 이미지의 URL 붙여넣기"만
// 지원했다. 그건 문제를 만드는 사람에게 부담이고(어딘가에 먼저 올려야 한다),
// 남의 서버에 의존하므로 링크가 언제든 끊긴다. 기기에서 사진을 바로 고를 수
// 있어야 실제로 쓸 만하다.
//
// 저장은 R2, 서빙은 이 워커가 한다. 버킷을 공개로 열지 않아도 되고 별도
// 도메인 설정도 필요 없다.
//
// ⚠ 사용자가 올린 파일을 같은 오리진에서 서빙하는 것은 XSS 통로가 될 수 있다.
//    그래서 세 겹으로 막는다:
//      1) 선언된 Content-Type을 믿지 않고 실제 바이트(매직 넘버)로 판정한다
//      2) SVG는 아예 받지 않는다 — SVG는 스크립트를 품을 수 있는 문서다
//      3) 응답에 nosniff + 아무것도 실행하지 못하는 CSP를 붙인다

import { ADD_IMAGE, checkRateLimit, tooManyRequests } from './ratelimit';

export interface ImagesEnv {
  DB: D1Database;
  IMAGES: R2Bucket;
}

/** 5MB. 휴대폰 사진 한 장은 보통 이 안에 들어온다. */
const MAX_BYTES = 5 * 1024 * 1024;

/** 우리가 서빙할 때 쓰는 경로. 문항의 imageUrl에 이 형태로 저장된다. */
export const IMAGE_PATH_PREFIX = '/images/';

interface SniffResult {
  contentType: string;
  ext: string;
}

/** 선언된 타입이 아니라 실제 바이트로 판정한다. 확장자와 Content-Type은
 *  클라이언트가 마음대로 적을 수 있으므로 신뢰하지 않는다. */
export function sniffImage(bytes: Uint8Array): SniffResult | null {
  const at = (i: number) => bytes[i];

  // JPEG: FF D8 FF
  if (bytes.length > 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return { contentType: 'image/jpeg', ext: 'jpg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length > 8 &&
    at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
    at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a
  ) {
    return { contentType: 'image/png', ext: 'png' };
  }
  // GIF: "GIF8"
  if (bytes.length > 4 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) {
    return { contentType: 'image/gif', ext: 'gif' };
  }
  // WebP: "RIFF" ....  "WEBP"
  if (
    bytes.length > 12 &&
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return { contentType: 'image/webp', ext: 'webp' };
  }
  // SVG·그 밖의 모든 것은 거부한다. 특히 SVG는 스크립트를 실행할 수 있어
  // 같은 오리진에서 서빙하면 XSS가 된다.
  return null;
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 저장 키가 내용의 해시다 — 같은 사진을 여러 번 올려도 하나만 남고,
 *  키가 곧 내용이므로 캐시를 영구히 걸어도 안전하다. */
export async function handleUploadImage(
  request: Request,
  env: ImagesEnv,
  uid: string,
): Promise<Response> {
  const limited = await checkRateLimit(env, ADD_IMAGE, uid);
  if (!limited.ok) return tooManyRequests(limited);

  // 본문을 통째로 읽기 전에 선언된 길이로 먼저 거른다.
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BYTES) {
    return json({ error: '이미지는 5MB 이하만 올릴 수 있습니다.' }, { status: 413 });
  }

  const buffer = await request.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (bytes.byteLength === 0) return json({ error: '빈 파일입니다.' }, { status: 400 });
  // Content-Length는 없거나 거짓일 수 있으므로 실제 크기로 다시 본다.
  if (bytes.byteLength > MAX_BYTES) {
    return json({ error: '이미지는 5MB 이하만 올릴 수 있습니다.' }, { status: 413 });
  }

  const sniffed = sniffImage(bytes);
  if (!sniffed) {
    return json(
      { error: 'JPG · PNG · GIF · WebP 이미지만 올릴 수 있습니다.' },
      { status: 415 },
    );
  }

  const key = `${await sha256Hex(bytes)}.${sniffed.ext}`;
  await env.IMAGES.put(key, bytes, {
    httpMetadata: { contentType: sniffed.contentType },
    customMetadata: { uploadedBy: uid, uploadedAt: new Date().toISOString() },
  });

  return json({ url: `${IMAGE_PATH_PREFIX}${key}` });
}

/** 업로드된 이미지를 돌려준다. 키가 내용 해시라 내용이 바뀔 일이 없으므로
 *  영구 캐시를 건다. */
export async function handleServeImage(env: ImagesEnv, key: string): Promise<Response> {
  // 경로 조작을 막는다 — 키는 항상 "<64자리 hex>.<확장자>" 형태다.
  if (!/^[0-9a-f]{64}\.(jpg|png|gif|webp)$/.test(key)) {
    return new Response('Not found', { status: 404 });
  }

  const object = await env.IMAGES.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);
  // 사용자가 올린 파일이다. 브라우저가 타입을 추측하거나 무언가를 실행하지
  // 못하게 막는다.
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");

  return new Response(object.body, { headers });
}
