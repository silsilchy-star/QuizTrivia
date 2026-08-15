// src/media.ts — 문항에 붙는 링크(이미지·유튜브 영상) 판정.
//
// 창작마당은 사람 검수가 없어서 이 파서가 사실상 유일한 방어선이다. 그리고
// 유튜브 영상은 iframe으로 재생되므로, 여기서 흘린 값은 곧바로 남의 페이지를
// 우리 화면 안에서 띄우는 경로가 된다. 그래서 "정상 링크를 받는지"보다
// **"이상한 걸 확실히 막는지"**를 더 두껍게 확인한다.
import { describe, expect, it } from 'vitest';
import {
  MEDIA_URL_MAX,
  checkImageUrl,
  isUploadedImagePath,
  parseVideoUrl,
  parseYouTubeId,
  videoFromStored,
  youTubeEmbedUrl,
} from '../src/media';

const ID = 'dQw4w9WgXcQ'; // 11자, 실제 유튜브 id 형식

describe('유튜브 링크에서 영상 id 뽑기 — 받아야 하는 형태', () => {
  it.each([
    ['watch', `https://www.youtube.com/watch?v=${ID}`],
    ['www 없는 watch', `https://youtube.com/watch?v=${ID}`],
    ['모바일 m.youtube', `https://m.youtube.com/watch?v=${ID}`],
    ['music.youtube', `https://music.youtube.com/watch?v=${ID}`],
    ['단축 youtu.be', `https://youtu.be/${ID}`],
    ['쇼츠', `https://www.youtube.com/shorts/${ID}`],
    ['임베드', `https://www.youtube.com/embed/${ID}`],
    ['nocookie 임베드', `https://www.youtube-nocookie.com/embed/${ID}`],
    ['라이브', `https://www.youtube.com/live/${ID}`],
    ['옛 /v/ 경로', `https://www.youtube.com/v/${ID}`],
  ])('%s', (_label, url) => {
    expect(parseYouTubeId(url)).toBe(ID);
  });

  it('watch 링크에 재생목록·타임스탬프가 붙어 있어도 영상 id만 가져온다', () => {
    expect(parseYouTubeId(`https://www.youtube.com/watch?v=${ID}&list=PL123&t=42s`)).toBe(ID);
  });

  it('호스트 대소문자가 섞여 있어도 받는다', () => {
    expect(parseYouTubeId(`https://WWW.YouTube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('앞뒤 공백은 흔한 붙여넣기 실수라 다듬어준다', () => {
    expect(parseYouTubeId(`  https://youtu.be/${ID}  `)).toBe(ID);
  });
});

describe('유튜브 링크 — 막아야 하는 것', () => {
  it.each([
    ['빈 문자열', ''],
    ['URL이 아님', '그냥 텍스트'],
    ['http (평문)', `http://www.youtube.com/watch?v=${ID}`],
    ['javascript 스킴', 'javascript:alert(1)'],
    ['data 스킴', 'data:text/html,<script>alert(1)</script>'],
    ['유튜브가 아닌 호스트', `https://vimeo.com/watch?v=${ID}`],
    ['유튜브를 흉내낸 호스트', `https://youtube.com.evil.test/watch?v=${ID}`],
    ['유튜브를 접두사로 쓴 호스트', `https://notyoutube.com/watch?v=${ID}`],
    ['자격증명이 박힌 URL', `https://youtube.com@evil.test/watch?v=${ID}`],
    ['v 파라미터 없음', 'https://www.youtube.com/watch'],
    ['id가 짧음', 'https://www.youtube.com/watch?v=abc'],
    ['id가 김', `https://www.youtube.com/watch?v=${ID}XXXX`],
    ['id에 허용 안 되는 문자', 'https://www.youtube.com/watch?v=abcdefghij!'],
    ['경로가 더 깊음', `https://www.youtube.com/embed/${ID}/extra`],
    ['모르는 경로', `https://www.youtube.com/channel/${ID}`],
    ['채널 홈', 'https://www.youtube.com/@somechannel'],
  ])('%s', (_label, url) => {
    expect(parseYouTubeId(url)).toBeNull();
  });

  it('id 자리에 경로 탈출을 넣어도 통하지 않는다', () => {
    expect(parseYouTubeId('https://www.youtube.com/embed/../../etc/passwd')).toBeNull();
    expect(parseYouTubeId('https://youtu.be/../watch')).toBeNull();
  });

  it('너무 긴 링크는 파싱 전에 거른다', () => {
    const long = `https://www.youtube.com/watch?v=${ID}&pad=${'x'.repeat(MEDIA_URL_MAX)}`;
    expect(parseVideoUrl(long)).toBeNull();
  });
});

describe('임베드 주소는 우리가 조립한다', () => {
  it('저장된 id로만 만들어지고, 유저가 준 URL은 섞이지 않는다', () => {
    const video = parseVideoUrl(`https://www.youtube.com/watch?v=${ID}&list=PL123`);
    expect(video).toEqual({
      kind: 'youtube',
      id: ID,
      embedUrl: `https://www.youtube-nocookie.com/embed/${ID}?rel=0&playsinline=1`,
    });
    // 유저가 붙여넣은 재생목록 파라미터가 임베드 주소로 새어나가지 않는다.
    expect(video!.embedUrl).not.toContain('list=');
  });

  it('추적을 덜 하는 nocookie 도메인을 쓴다', () => {
    expect(youTubeEmbedUrl(ID)).toContain('youtube-nocookie.com');
  });

  it('형식에 안 맞는 id로는 아예 주소를 만들지 못한다', () => {
    // 어떤 경로로든 이상한 id가 흘러들어오면 조용히 통과시키는 대신 터진다.
    expect(() => youTubeEmbedUrl('"><script>')).toThrow();
    expect(() => youTubeEmbedUrl('../../evil')).toThrow();
    expect(() => youTubeEmbedUrl('')).toThrow();
  });
});

describe('DB에 저장된 값을 되살릴 때도 다시 검증한다', () => {
  it('정상 값은 그대로 살아난다', () => {
    expect(videoFromStored('youtube', ID)).toEqual({
      kind: 'youtube',
      id: ID,
      embedUrl: youTubeEmbedUrl(ID),
    });
  });

  it('영상이 없는 문항은 null', () => {
    expect(videoFromStored(null, null)).toBeNull();
  });

  it.each([
    ['모르는 제공자', 'vimeo', ID],
    ['kind만 있고 id가 없음', 'youtube', null],
    ['id 형식이 깨짐', 'youtube', '"><script>alert(1)</script>'],
    ['id가 경로 탈출', 'youtube', '../../evil'],
  ])('%s — iframe까지 흘려보내지 않고 영상 없는 문항으로 만든다', (_label, kind, id) => {
    expect(videoFromStored(kind, id)).toBeNull();
  });
});

describe('업로드 이미지 경로', () => {
  const hash = 'a'.repeat(64);

  it('우리가 만든 형태만 통과한다', () => {
    expect(isUploadedImagePath(`/images/${hash}.jpg`)).toBe(true);
    expect(isUploadedImagePath(`/images/${hash}.webp`)).toBe(true);
  });

  it.each([
    ['경로 탈출', '/images/../../etc/passwd'],
    ['해시 길이가 다름', '/images/abc.jpg'],
    ['해시에 대문자', `/images/${'A'.repeat(64)}.jpg`],
    ['모르는 확장자', `/images/${hash}.svg`],
    ['앞에 뭔가 붙음', `/x/images/${hash}.jpg`],
  ])('%s는 막는다', (_label, path) => {
    expect(isUploadedImagePath(path)).toBe(false);
  });
});

describe('이미지 링크 검사', () => {
  it('업로드한 이미지는 통과', () => {
    expect(checkImageUrl(`/images/${'b'.repeat(64)}.png`)).toBeNull();
  });

  it('외부 https 링크는 호스트를 가리지 않고 통과 — 개방성이 이 기능의 목적', () => {
    expect(checkImageUrl('https://commons.wikimedia.org/wiki/Special:FilePath/x.jpg')).toBeNull();
    expect(checkImageUrl('https://example.test/사진.png')).toBeNull();
    expect(checkImageUrl('https://cdn.example.test/a/b/c?w=800&h=600')).toBeNull();
  });

  it.each([
    ['http 평문', 'http://example.test/a.jpg'],
    ['javascript 스킴', 'javascript:alert(1)'],
    ['data 스킴', 'data:image/svg+xml,<svg onload=alert(1)>'],
    ['URL이 아님', 'not a url'],
    ['상대 경로', '/somewhere/a.jpg'],
    ['자격증명이 박힌 URL', 'https://real.test@evil.test/a.jpg'],
  ])('%s는 not-https로 막는다', (_label, url) => {
    expect(checkImageUrl(url)).toBe('not-https');
  });

  it('길이 상한을 넘기면 too-long', () => {
    expect(checkImageUrl(`https://example.test/${'x'.repeat(MEDIA_URL_MAX)}.jpg`)).toBe('too-long');
  });

  // 예전엔 https로 시작하기만 하면 통과해서, 유튜브 링크가 이미지로 저장되고
  // 화면엔 깨진 이미지가 떴다. 이제 어디에 넣어야 하는지 알려준다.
  it('유튜브 링크를 이미지 칸에 넣으면 is-video로 되돌려준다', () => {
    expect(checkImageUrl(`https://www.youtube.com/watch?v=${ID}`)).toBe('is-video');
    expect(checkImageUrl(`https://youtu.be/${ID}`)).toBe('is-video');
  });
});
