// 창작마당 이미지 업로드 (R2).
//
// 지금까지는 "이미 어딘가에 호스팅된 URL 붙여넣기"만 됐다. 기기 사진을 바로
// 올릴 수 있게 하면서, 사용자가 올린 파일을 **같은 오리진에서 서빙**하게 됐다.
// 그건 XSS 통로가 될 수 있으므로 여기서 집중적으로 검증한다:
//   - 선언된 Content-Type이 아니라 실제 바이트로 판정하는가
//   - SVG처럼 스크립트를 품을 수 있는 것을 막는가
//   - 응답에 nosniff·CSP가 붙는가
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { sniffImage } from '../worker/images';
import { isUploadedImagePath } from '../worker/community';
import { Client, logIn, newSession } from './helpers';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');

async function upload(client: Client, bytes: Uint8Array, contentType = 'image/png') {
  return client.fetch('/api/community/images', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: bytes,
  });
}

describe('sniffImage — 실제 바이트로 판정', () => {
  it('네 가지 형식을 알아본다', () => {
    expect(sniffImage(JPEG)).toEqual({ contentType: 'image/jpeg', ext: 'jpg' });
    expect(sniffImage(PNG)).toEqual({ contentType: 'image/png', ext: 'png' });
    expect(sniffImage(GIF)).toEqual({ contentType: 'image/gif', ext: 'gif' });
    expect(sniffImage(WEBP)).toEqual({ contentType: 'image/webp', ext: 'webp' });
  });

  // SVG는 스크립트를 실행할 수 있는 문서다. 같은 오리진에서 서빙하면 XSS가 된다.
  it('SVG는 이미지로 보지 않는다', () => {
    expect(sniffImage(SVG)).toBeNull();
  });

  it('HTML·빈 파일·짧은 조각을 거부한다', () => {
    expect(sniffImage(HTML)).toBeNull();
    expect(sniffImage(new Uint8Array([]))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  // RIFF로 시작하지만 WEBP가 아닌 것(예: WAV)이 통과하면 안 된다.
  it('RIFF지만 WebP가 아니면 거부한다', () => {
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d,
    ]);
    expect(sniffImage(wav)).toBeNull();
  });
});

describe('업로드 권한', () => {
  it('세션이 없으면 401', async () => {
    const res = await new Client().fetch('/api/community/images', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: PNG,
    });
    expect(res.status).toBe(401);
  });

  it('익명 유저는 403', async () => {
    const client = await newSession();
    expect((await upload(client, PNG)).status).toBe(403);
  });

  it('로그인했어도 닉네임이 없으면 403 — 문항 생성과 같은 문턱', async () => {
    const client = await newSession();
    await env.DB.prepare('UPDATE users SET is_anonymous = 0 WHERE uid = ?').bind(client.uid).run();
    expect((await upload(client, PNG)).status).toBe(403);
  });
});

describe('업로드', () => {
  it('올리면 /images/<해시>.<확장자> 경로를 돌려준다', async () => {
    const client = await newSession();
    await logIn(client, '업로더');

    const res = await upload(client, PNG);
    expect(res.status).toBe(200);

    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/^\/images\/[0-9a-f]{64}\.png$/);
    expect(isUploadedImagePath(url)).toBe(true);
  });

  // 키가 내용 해시라 같은 사진을 여러 번 올려도 하나만 남는다.
  it('같은 파일을 두 번 올리면 같은 경로가 나온다', async () => {
    const client = await newSession();
    await logIn(client, '중복업로더');

    const first = (await (await upload(client, JPEG, 'image/jpeg')).json()) as { url: string };
    const second = (await (await upload(client, JPEG, 'image/jpeg')).json()) as { url: string };
    expect(first.url).toBe(second.url);
  });

  // 확장자·Content-Type은 클라이언트가 마음대로 적을 수 있다.
  it('Content-Type이 거짓이어도 실제 바이트를 따른다', async () => {
    const client = await newSession();
    await logIn(client, '거짓타입');

    const res = await upload(client, JPEG, 'image/png'); // png라고 주장하지만 실제론 jpeg
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/\.jpg$/);
  });

  it('SVG는 415로 거부한다', async () => {
    const client = await newSession();
    await logIn(client, 'svg시도');
    const res = await upload(client, SVG, 'image/svg+xml');
    expect(res.status).toBe(415);
  });

  it('HTML을 이미지라고 우겨도 거부한다', async () => {
    const client = await newSession();
    await logIn(client, 'html시도');
    expect((await upload(client, HTML, 'image/png')).status).toBe(415);
  });

  it('빈 파일은 400', async () => {
    const client = await newSession();
    await logIn(client, '빈파일');
    expect((await upload(client, new Uint8Array([]))).status).toBe(400);
  });

  it('5MB를 넘으면 413', async () => {
    const client = await newSession();
    await logIn(client, '대용량');

    const big = new Uint8Array(5 * 1024 * 1024 + 10);
    big.set(PNG, 0); // 헤더는 멀쩡한 PNG — 크기 때문에 막혀야 한다
    expect((await upload(client, big)).status).toBe(413);
  });
});

describe('서빙', () => {
  it('올린 이미지를 다시 받을 수 있고, 원래 형식으로 내려온다', async () => {
    const client = await newSession();
    await logIn(client, '서빙테스트');
    const { url } = (await (await upload(client, GIF, 'image/gif')).json()) as { url: string };

    const res = await SELF.fetch(`https://example.com${url}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/gif');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(GIF);
  });

  // 사용자가 올린 파일을 같은 오리진에서 서빙하므로 이 헤더들이 없으면
  // 브라우저가 내용을 추측하거나 실행할 여지가 생긴다.
  it('nosniff와 아무것도 실행하지 못하는 CSP가 붙는다', async () => {
    const client = await newSession();
    await logIn(client, '헤더테스트');
    const { url } = (await (await upload(client, PNG)).json()) as { url: string };

    const res = await SELF.fetch(`https://example.com${url}`);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(res.headers.get('Cache-Control')).toContain('immutable');
  });

  it('로그인하지 않아도 볼 수 있다 — 플레이 중 누구에게나 보여야 한다', async () => {
    const owner = await newSession();
    await logIn(owner, '주인');
    const { url } = (await (await upload(owner, PNG)).json()) as { url: string };

    const res = await new Client().fetch(url);
    expect(res.status).toBe(200);
  });

  it('없는 키는 404', async () => {
    const res = await SELF.fetch(`https://example.com/images/${'a'.repeat(64)}.png`);
    expect(res.status).toBe(404);
  });

  // 키 형식을 강제하지 않으면 경로 조작이나 임의 객체 조회로 이어진다.
  it('형식에 맞지 않는 키는 R2를 건드리지도 않고 404', async () => {
    for (const bad of ['../secret', 'short.png', `${'a'.repeat(64)}.svg`, `${'z'.repeat(64)}.png`]) {
      const res = await SELF.fetch(`https://example.com/images/${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(404);
    }
  });
});

describe('문항에 붙이기', () => {
  it('업로드한 경로를 imageUrl로 쓴 문항이 통과한다', async () => {
    const client = await newSession();
    await logIn(client, '문항작성자');
    const { url } = (await (await upload(client, PNG)).json()) as { url: string };

    const topic = await client.json<{ id: string }>('/api/community/topics', {
      method: 'POST',
      body: JSON.stringify({ name: '이미지주제' }),
    });
    const res = await client.fetch(`/api/community/topics/${topic.id}/questions`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'TEXT_INPUT',
        difficulty: 1,
        body: '이 사진은 무엇인가요?',
        choices: null,
        answer: '고양이',
        explanation: '해설',
        imageUrl: url,
      }),
    });
    expect(res.status).toBe(200);
  });

  it('https 외부 링크도 계속 허용한다', () => {
    expect(isUploadedImagePath('https://commons.wikimedia.org/wiki/Special:FilePath/x.jpg')).toBe(false);
  });

  it('경로 조작이나 위험한 스킴은 업로드 경로로 인정하지 않는다', () => {
    for (const bad of [
      '/images/../../etc/passwd',
      '/images/short.png',
      `/images/${'a'.repeat(64)}.svg`,
      `javascript:alert(1)//images/${'a'.repeat(64)}.png`,
      `/images/${'a'.repeat(63)}.png`,
    ]) {
      expect(isUploadedImagePath(bad), bad).toBe(false);
    }
  });
});
