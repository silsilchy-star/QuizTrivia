// 단답형(TEXT_INPUT) 정답 비교 규칙 — 프론트·워커 공용.
//
// 왜 별도 모듈인가:
//
// ① 순환 참조를 피한다. 채점은 worker/index.ts에, 창작마당 입력 정리는
//    worker/community.ts에 있는데 index가 community를 import한다. 정규화가
//    index에 있으면 community가 거꾸로 index를 불러야 해서 고리가 생긴다.
//
// ② 규칙이 하나여야 한다. "정답과 같은 별칭인가"를 판정하는 자리가 두 곳
//    (입력 검증과 실제 채점)인데, 두 규칙이 어긋나면 검증은 통과했는데
//    채점에서는 정답으로 안 쳐지는 별칭이 생긴다. src/media.ts에서 배운 것과
//    같은 이유다 — 규칙이 둘이면 언젠가 느슨한 쪽이 뚫린다.
//
// ⚠ scripts/lib.mjs의 normalizeAnswer가 이 함수와 같은 규칙이어야 한다.
//    거기는 평범한 .mjs라 TypeScript를 import할 수 없어 한 벌 더 쓴 것이고,
//    test/answer.test.ts가 두 구현을 같은 입력표로 대조해 어긋남을 막는다.

/** 한 문항이 가질 수 있는 별칭 개수 상한.
 *  표기 흔들림을 적는 자리이지, 아무 말이나 맞게 만드는 자리가 아니다. */
export const ANSWER_ALIASES_MAX = 6;

/** 앞뒤·중복 공백과 대소문자 차이를 없앤다.
 *
 *  일부러 여기까지만 한다. 조사(참새/참새를)나 어미까지 잘라내면 "참새들"도
 *  정답이 되어 버려서, 아는 사람과 모르는 사람을 가르지 못한다. 표기가 흔들리는
 *  경우는 문항마다 별칭으로 적는다 — 규칙으로 뭉개지 않는다. */
export function normalizeAnswer(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 정답 또는 별칭 중 하나와 일치하는가. */
export function answerMatches(answer: string, given: string, aliases: readonly string[] = []): boolean {
  const g = normalizeAnswer(given);
  if (g === '') return false;
  if (normalizeAnswer(answer) === g) return true;
  return aliases.some((alt) => typeof alt === 'string' && normalizeAnswer(alt) === g);
}

/** 입력된 별칭 목록을 저장 형태로 다듬는다 — 공백 정리, 빈 값 제거, 중복 제거.
 *
 *  중복 판정에 정답 자신을 먼저 넣어 두는 게 핵심이다. 정답과 (공백·대소문자만
 *  다른) 같은 별칭은 채점에서 아무 일도 하지 않으므로 남겨 둘 이유가 없다. */
export function cleanAnswerAliases(answer: string, raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set([normalizeAnswer(answer)]);
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const value = item.trim();
    if (!value) continue;
    const key = normalizeAnswer(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** 저장된 별칭 JSON을 배열로 되돌린다.
 *
 *  깨진 값이 채점을 통째로 터뜨리면 안 된다 — 파싱 실패나 배열이 아닌 값은
 *  "별칭 없음"으로 본다. 최악의 경우도 예전(정답 하나만 인정) 동작이다. */
export function parseAnswerAliases(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}
