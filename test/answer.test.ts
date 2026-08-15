// 단답형 정답 비교와 별칭 (src/answer.ts).
//
// 이 파일이 지키는 것 두 가지:
//
// ① 별칭이 실제로 정답 처리되는가 — 표기가 흔들리는 답에서 아는 사람이
//    틀린 처리를 받지 않아야 한다.
// ② 정규화 규칙이 **두 곳에서 같은가** — 채점은 TypeScript(src/answer.ts)로,
//    공식 문항 검증은 .mjs(scripts/lib.mjs)로 돈다. 두 규칙이 어긋나면
//    validate는 통과시켰는데 채점에서는 정답이 아닌 별칭이 생긴다.

import { describe, expect, it } from 'vitest';

import {
  ANSWER_ALIASES_MAX,
  answerMatches,
  cleanAnswerAliases,
  normalizeAnswer,
  parseAnswerAliases,
} from '../src/answer';
import { isCorrect } from '../worker/index';
// @ts-expect-error — 순수 ESM 스크립트라 타입 선언이 없다
import { ANSWER_ALIASES_MAX as MJS_MAX, normalizeAnswer as mjsNormalizeAnswer } from '../scripts/lib.mjs';
// @ts-expect-error — 순수 ESM 스크립트라 타입 선언이 없다
import { textAnswerLeaked } from '../scripts/fairness.mjs';

describe('normalizeAnswer', () => {
  it('앞뒤 공백·중복 공백·대소문자만 정리한다', () => {
    expect(normalizeAnswer('  Passer   Montanus  ')).toBe('passer montanus');
  });

  // 여기까지만 하는 게 의도다. 조사나 어미까지 잘라내면 "참새들"도 정답이 되어
  // 아는 사람과 모르는 사람을 가르지 못한다.
  it('조사·어미는 건드리지 않는다', () => {
    expect(normalizeAnswer('참새들')).not.toBe(normalizeAnswer('참새'));
  });
});

describe('정규화 규칙이 TS와 .mjs에서 같다', () => {
  // 어긋나기 쉬운 것들만 모았다 — 공백 종류, 연속 공백, 대소문자, 빈 문자열.
  const cases = [
    '  에베레스트산 ',
    '에베레스트  산',
    'Washington D.C.',
    'WASHINGTON DC',
    'H₂O',
    'h2o',
    '',
    '   ',
    '국제 올림픽  위원회',
    'Grêco',
  ];

  it.each(cases)('같은 결과를 낸다: %j', (input) => {
    expect(mjsNormalizeAnswer(input)).toBe(normalizeAnswer(input));
  });

  it('별칭 개수 상한도 같은 값이다', () => {
    expect(MJS_MAX).toBe(ANSWER_ALIASES_MAX);
  });
});

describe('answerMatches — 별칭 인정', () => {
  it('정답과 같으면 맞다', () => {
    expect(answerMatches('에베레스트', '에베레스트')).toBe(true);
  });

  it('별칭과 같아도 맞다', () => {
    expect(answerMatches('에베레스트', '에베레스트산', ['에베레스트산', 'Everest'])).toBe(true);
  });

  it('별칭도 대소문자·공백을 무시하고 비교한다', () => {
    expect(answerMatches('에베레스트', '  everest ', ['Everest'])).toBe(true);
  });

  it('목록에 없으면 틀리다', () => {
    expect(answerMatches('에베레스트', '킬리만자로', ['에베레스트산'])).toBe(false);
  });

  // 빈 답이 별칭 배열의 빈 문자열과 맞아떨어지면 아무것도 안 써도 정답이 된다.
  it('빈 답은 빈 별칭이 있어도 정답이 아니다', () => {
    expect(answerMatches('서울', '', [''])).toBe(false);
    expect(answerMatches('서울', '   ', [''])).toBe(false);
  });
});

describe('isCorrect — 유형별로 별칭이 어디에 쓰이는가', () => {
  it('단답형에서 별칭이 정답 처리된다', () => {
    expect(isCorrect('TEXT_INPUT', '이자', '췌장', ['췌장'])).toBe(true);
  });

  it('별칭을 안 넘기면 예전대로 정답 하나만 인정한다', () => {
    expect(isCorrect('TEXT_INPUT', '이자', '췌장')).toBe(false);
  });

  // 객관식은 선택지를 고르는 것이고 숫자입력은 숫자로 비교한다 — 표기가
  // 흔들린다는 문제 자체가 없으므로 별칭이 끼어들면 안 된다.
  it('객관식에서는 별칭을 보지 않는다', () => {
    expect(isCorrect('MULTIPLE_CHOICE', '산소', '수소', ['수소'])).toBe(false);
  });

  it('숫자입력에서는 별칭을 보지 않는다', () => {
    expect(isCorrect('NUMERIC_INPUT', '15', '열다섯', ['열다섯'])).toBe(false);
  });
});

describe('cleanAnswerAliases — 저장 전 정리', () => {
  it('공백을 다듬고 빈 값을 버린다', () => {
    expect(cleanAnswerAliases('서울', ['  한양 ', '', '   '])).toEqual(['한양']);
  });

  it('정답과 (정규화하면) 같은 별칭은 버린다 — 채점에서 아무 일도 안 한다', () => {
    expect(cleanAnswerAliases('Seoul', ['  seoul  ', '한양'])).toEqual(['한양']);
  });

  it('별칭끼리의 중복도 버린다', () => {
    expect(cleanAnswerAliases('서울', ['한양', '한양', ' 한양 '])).toEqual(['한양']);
  });

  it('배열이 아니면 빈 목록이다', () => {
    expect(cleanAnswerAliases('서울', null)).toEqual([]);
    expect(cleanAnswerAliases('서울', '한양')).toEqual([]);
  });
});

describe('parseAnswerAliases — 저장된 값 읽기', () => {
  it('정상 JSON 배열을 읽는다', () => {
    expect(parseAnswerAliases('["가","나"]')).toEqual(['가', '나']);
  });

  // 깨진 값 때문에 채점 전체가 터지면 안 된다 — 최악이라도 "별칭 없음"이어야 한다.
  it('깨진 값은 별칭 없음으로 본다', () => {
    expect(parseAnswerAliases('{oops')).toEqual([]);
    expect(parseAnswerAliases('{"a":1}')).toEqual([]);
    expect(parseAnswerAliases(null)).toEqual([]);
  });

  it('배열 안의 문자열이 아닌 값은 걸러낸다', () => {
    expect(parseAnswerAliases('["가",1,null,"나"]')).toEqual(['가', '나']);
  });
});

describe('textAnswerLeaked — 단답형 정답 유출', () => {
  // 단답형은 선택지가 없어 본문이 플레이어가 보는 전부다. 거기 답이 있으면
  // 그냥 베껴 쓰면 되므로 객관식보다 무겁게 막는다.
  it('정답이 본문에 있으면 잡는다', () => {
    expect(textAnswerLeaked({ type: 'TEXT_INPUT', body: '대한민국의 수도 서울은?', answer: '서울' })).toBe(true);
  });

  it('별칭이 본문에 있어도 잡는다', () => {
    expect(
      textAnswerLeaked({
        type: 'TEXT_INPUT',
        body: '에베레스트산의 높이는 몇 m인가요?',
        answer: '8848',
        answerAliases: ['에베레스트산'],
      }),
    ).toBe(true);
  });

  it('정상 문항은 통과시킨다', () => {
    expect(
      textAnswerLeaked({ type: 'TEXT_INPUT', body: '프랑스의 수도는 어디인가요?', answer: '파리', answerAliases: ['Paris'] }),
    ).toBe(false);
  });

  // 객관식과 같은 기준 — 한 글자는 우연히 겹친다 (답 "물"이 "물체"에 걸린다).
  it('한 글자 정답은 보지 않는다', () => {
    expect(textAnswerLeaked({ type: 'TEXT_INPUT', body: '물체의 상태는?', answer: '물' })).toBe(false);
  });

  it('단답형이 아닌 유형은 보지 않는다', () => {
    expect(textAnswerLeaked({ type: 'MULTIPLE_CHOICE', body: '서울은?', answer: '서울', choices: [] })).toBe(false);
  });
});
