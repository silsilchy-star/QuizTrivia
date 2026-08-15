// 문항에 붙는 미디어(이미지 링크 / 유튜브 영상 링크)를 판정하는 곳.
//
// 프론트와 워커가 **같은 파일**을 쓴다. 창작마당은 사람 검수가 없어서 여기가
// 사실상 유일한 방어선인데, 두 곳에 규칙을 따로 쓰면 언젠가 어긋나고 그때
// 느슨한 쪽이 뚫린다. 순수 함수만 두어 양쪽 tsconfig에서 함께 include 한다
// (src/types.ts와 같은 이유).
//
// 설계의 핵심 한 줄: **유저가 준 URL을 iframe src에 그대로 넣지 않는다.**
// 유튜브 링크에서 영상 id만 뽑아 엄격한 charset으로 검증하고, 실제 임베드
// 주소는 우리가 조립한다. 그래서 저장되는 값(video_id)에는 구조적으로
// 위험한 문자가 들어갈 수 없다.
import type { QuestionVideo } from './types';

/** 이미지·영상 URL 공통 길이 상한. DB 컬럼은 TEXT라 제한이 없으니 여기서 막는다. */
export const MEDIA_URL_MAX = 500;

/** 유튜브 영상 id는 항상 11자, URL-safe base64 문자만 쓴다.
 *  이 정규식이 임베드 주소 조립의 안전성을 떠받치므로 절대 느슨하게 바꾸지 말 것. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** watch/shorts/embed 형태를 쓰는 호스트들. */
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/** `/<id>` 하나만 오는 단축 도메인. */
const YOUTUBE_SHORT_HOST = 'youtu.be';

/** 경로 첫 칸이 이것들이면 두 번째 칸이 영상 id다. */
const YOUTUBE_ID_PREFIXES = new Set(['shorts', 'embed', 'live', 'v']);

/** URL 파싱 + 공통 거부 조건.
 *  `https://피싱주소@진짜주소/` 처럼 자격증명이 박힌 URL은 사람이 호스트를
 *  잘못 읽기 딱 좋아서 형태만으로 거른다. */
function parseUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  // javascript:, data:, blob: 등은 여기서 전부 걸린다.
  if (u.protocol !== 'https:') return null;
  if (!u.hostname) return null;
  if (u.username || u.password) return null;
  return u;
}

/** 유튜브 링크에서 영상 id만 뽑는다. 유튜브가 아니거나 형태가 어긋나면 null. */
export function parseYouTubeId(raw: string): string | null {
  const u = parseUrl(raw);
  if (!u) return null;

  const host = u.hostname.toLowerCase();
  const segments = u.pathname.split('/').filter(Boolean);

  // https://youtu.be/<id>
  if (host === YOUTUBE_SHORT_HOST) {
    if (segments.length !== 1) return null;
    return YOUTUBE_ID.test(segments[0]) ? segments[0] : null;
  }

  if (!YOUTUBE_HOSTS.has(host)) return null;

  // https://www.youtube.com/watch?v=<id>
  if (segments.length === 1 && segments[0] === 'watch') {
    const v = u.searchParams.get('v');
    return v && YOUTUBE_ID.test(v) ? v : null;
  }

  // https://www.youtube.com/{shorts,embed,live,v}/<id>
  if (segments.length === 2 && YOUTUBE_ID_PREFIXES.has(segments[0])) {
    return YOUTUBE_ID.test(segments[1]) ? segments[1] : null;
  }

  return null;
}

/** 영상 id로 임베드 주소를 만든다 — 이 함수만이 iframe에 들어갈 주소를 만든다.
 *  - youtube-nocookie: 재생 전에는 추적 쿠키를 심지 않는 도메인.
 *  - rel=0: 영상이 끝나고 남의 채널 영상을 추천하지 않게 한다(같은 채널로 제한).
 *    문제 화면에 엉뚱한 썸네일이 뜨면 그 자체가 스포일러가 될 수 있다.
 *  - playsinline=1: iOS에서 전체화면으로 튀지 않고 문항 안에서 재생된다. */
export function youTubeEmbedUrl(id: string): string {
  if (!YOUTUBE_ID.test(id)) throw new Error(`invalid youtube id: ${id}`);
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1`;
}

/** 유저가 붙여넣은 링크 → 저장·표시할 영상 정보. 지원하지 않는 링크면 null. */
export function parseVideoUrl(raw: string): QuestionVideo | null {
  if (raw.trim().length > MEDIA_URL_MAX) return null;
  const id = parseYouTubeId(raw);
  if (!id) return null;
  return { kind: 'youtube', id, embedUrl: youTubeEmbedUrl(id) };
}

/** DB에 저장된 (video_kind, video_id)를 화면용으로 되살린다.
 *  읽을 때도 다시 검증한다 — 어떤 경로로든 이상한 값이 들어갔다면
 *  그게 iframe까지 흘러가는 대신 그냥 영상 없는 문항이 되게 한다. */
export function videoFromStored(kind: string | null, id: string | null): QuestionVideo | null {
  if (kind !== 'youtube' || !id || !YOUTUBE_ID.test(id)) return null;
  return { kind: 'youtube', id, embedUrl: youTubeEmbedUrl(id) };
}

/** 이미지 URL이 왜 거부됐는지 — 호출부가 사람이 읽을 문구로 바꾼다. */
export type ImageUrlProblem = 'too-long' | 'is-video' | 'not-https';

/** 이미지 링크 검사. 통과면 null.
 *
 *  호스트는 일부러 열어둔다(개방성) — 어디에 올린 사진이든 붙일 수 있어야 한다.
 *  대신 스킴·형태만은 엄격히 본다. 문자열 정규식이 아니라 URL 파서로 판정하는
 *  이유는, `https://` 로 시작하기만 하면 통과시키던 예전 규칙이 사실상 아무것도
 *  거르지 못했기 때문이다. */
export function checkImageUrl(raw: string): ImageUrlProblem | null {
  const url = raw.trim();
  if (url.length > MEDIA_URL_MAX) return 'too-long';
  // 유튜브 링크를 이미지 칸에 넣은 경우 — 예전엔 그냥 저장돼서 화면에 깨진
  // 이미지로 떴다. 막는 김에 어디에 넣어야 하는지 알려준다.
  if (parseYouTubeId(url)) return 'is-video';
  if (!parseUrl(url)) return 'not-https';
  return null;
}
