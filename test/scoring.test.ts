// 채점 규칙과 스테이지→난이도 매핑. 게임의 모든 점수가 여기서 나오므로
// 여기가 틀리면 랭킹 전체가 틀린다.
import { describe, expect, it } from 'vitest';
import { difficultyForStage, isCorrect, normalizeText } from '../worker/index';
import { validateQuestion } from '../worker/community';
import { isoWeekId } from '../worker/ranking';

describe('difficultyForStage — 12스테이지 난이도 구간 (PLAN 4.2절)', () => {
  it('스테이지 1~3은 난이도 1', () => {
    expect([1, 2, 3].map(difficultyForStage)).toEqual([1, 1, 1]);
  });

  it('구간 경계에서 난이도가 정확히 한 칸씩 오른다', () => {
    expect(difficultyForStage(3)).toBe(1);
    expect(difficultyForStage(4)).toBe(2);
    expect(difficultyForStage(6)).toBe(2);
    expect(difficultyForStage(7)).toBe(3);
    expect(difficultyForStage(9)).toBe(3);
    expect(difficultyForStage(10)).toBe(4);
    expect(difficultyForStage(12)).toBe(4);
  });

  it('12를 넘겨도 난이도 4를 넘지 않는다', () => {
    expect(difficultyForStage(13)).toBe(4);
    expect(difficultyForStage(999)).toBe(4);
  });

  it('12스테이지 전체의 난이도 분포는 각 난이도당 정확히 3스테이지다', () => {
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (let s = 1; s <= 12; s += 1) dist[difficultyForStage(s)] += 1;
    expect(dist).toEqual({ 1: 3, 2: 3, 3: 3, 4: 3 });
  });
});

describe('isCorrect — 객관식', () => {
  it('정확히 일치해야 정답', () => {
    expect(isCorrect('MULTIPLE_CHOICE', '서울', '서울')).toBe(true);
    expect(isCorrect('MULTIPLE_CHOICE', '서울', '부산')).toBe(false);
  });

  it('앞뒤 공백은 무시한다', () => {
    expect(isCorrect('MULTIPLE_CHOICE', ' 서울 ', '서울')).toBe(true);
  });

  it('대소문자는 구분한다 — 선택지를 그대로 고르는 것이므로', () => {
    expect(isCorrect('MULTIPLE_CHOICE', 'Seoul', 'seoul')).toBe(false);
  });
});

describe('isCorrect — 숫자입력', () => {
  it('표기가 달라도 수치가 같으면 정답', () => {
    expect(isCorrect('NUMERIC_INPUT', '42', '42.0')).toBe(true);
    expect(isCorrect('NUMERIC_INPUT', '3.14', '3.140')).toBe(true);
    expect(isCorrect('NUMERIC_INPUT', '1000', ' 1000 ')).toBe(true);
  });

  it('수치가 다르면 오답', () => {
    expect(isCorrect('NUMERIC_INPUT', '42', '43')).toBe(false);
  });

  it('숫자로 파싱되지 않는 답은 오답', () => {
    expect(isCorrect('NUMERIC_INPUT', '42', 'abc')).toBe(false);
  });

  // 회귀 테스트: Number('')이 0이라서, 가드가 없으면 정답이 0인 문항에
  // 공백만 제출해도 정답 처리됐다. 호출부의 `given !== ''` 검사는 원본
  // 문자열만 보기 때문에 공백 한 칸을 걸러내지 못했다.
  it('빈 답과 공백만 있는 답은 정답이 0이어도 오답이다', () => {
    expect(isCorrect('NUMERIC_INPUT', '0', '')).toBe(false);
    expect(isCorrect('NUMERIC_INPUT', '0', ' ')).toBe(false);
    expect(isCorrect('NUMERIC_INPUT', '0', '   ')).toBe(false);
  });

  it('어떤 유형이든 공백만 낸 답은 오답이다', () => {
    expect(isCorrect('TEXT_INPUT', '', ' ')).toBe(false);
    expect(isCorrect('MULTIPLE_CHOICE', '', ' ')).toBe(false);
  });
});

describe('isCorrect — 단답형', () => {
  it('대소문자와 중복 공백 차이를 무시한다 (학명 입력용)', () => {
    expect(isCorrect('TEXT_INPUT', 'Passer montanus', 'passer montanus')).toBe(true);
    expect(isCorrect('TEXT_INPUT', 'Passer montanus', 'Passer   montanus')).toBe(true);
    expect(isCorrect('TEXT_INPUT', 'Passer montanus', '  PASSER MONTANUS  ')).toBe(true);
  });

  it('철자가 다르면 오답 — 정규화가 오답까지 정답으로 만들지 않는다', () => {
    expect(isCorrect('TEXT_INPUT', 'Passer montanus', 'Passer domesticus')).toBe(false);
    expect(isCorrect('TEXT_INPUT', '참새', '참새들')).toBe(false);
  });

  it('공백을 통째로 지우지는 않는다 — 단어 경계는 유지되어야 한다', () => {
    expect(isCorrect('TEXT_INPUT', 'Passer montanus', 'Passermontanus')).toBe(false);
  });
});

describe('normalizeText', () => {
  it('앞뒤 공백 제거, 중복 공백 축약, 소문자화만 한다', () => {
    expect(normalizeText('  Hello   World  ')).toBe('hello world');
  });
});

describe('isoWeekId — 주간 보드의 키', () => {
  const week = (iso: string) => isoWeekId(new Date(iso));

  it('같은 주의 월요일과 일요일은 같은 주차다', () => {
    expect(week('2026-08-10T00:00:00Z')).toBe(week('2026-08-16T23:59:59Z'));
  });

  it('일요일과 그 다음 월요일은 다른 주차다 — 주가 월요일에 바뀐다', () => {
    expect(week('2026-08-16T23:59:59Z')).not.toBe(week('2026-08-17T00:00:00Z'));
  });

  // 연말연시가 ISO 주차 계산이 가장 잘 틀리는 자리다. 여기가 틀리면 주간
  // 보드가 연말에 조용히 초기화되거나 두 해가 섞인다.
  it('연말이 다음 해의 1주차로 넘어가는 경우를 맞게 계산한다', () => {
    // 2025-12-29(월)은 ISO 기준 2026년 1주차의 시작이다.
    expect(week('2025-12-29T00:00:00Z')).toBe('2026-W01');
    expect(week('2026-01-01T00:00:00Z')).toBe('2026-W01');
    expect(week('2026-01-04T00:00:00Z')).toBe('2026-W01');
    expect(week('2026-01-05T00:00:00Z')).toBe('2026-W02');
  });

  it('연초가 전년도 마지막 주차에 속하는 경우를 맞게 계산한다', () => {
    // 2027-01-01은 금요일이라 ISO 기준 2026년 53주차다.
    expect(week('2027-01-01T00:00:00Z')).toBe('2026-W53');
  });

  it('항상 YYYY-Www 형식이다', () => {
    expect(week('2026-03-05T00:00:00Z')).toMatch(/^\d{4}-W\d{2}$/);
  });
});

describe('validateQuestion — 창작마당 자동 검증 (사람 검수가 없는 자리)', () => {
  const mc = {
    type: 'MULTIPLE_CHOICE' as const,
    difficulty: 1 as const,
    body: '수도는?',
    choices: ['서울', '부산', '대구', '인천'],
    answer: '서울',
    explanation: '해설',
  };

  it('올바른 객관식은 통과한다', () => {
    expect(validateQuestion(mc)).toBeNull();
  });

  it('선택지가 4개가 아니면 막는다', () => {
    expect(validateQuestion({ ...mc, choices: ['서울', '부산'] })).toBe('선택지는 정확히 4개여야 한다');
  });

  it('선택지에 중복이 있으면 막는다', () => {
    expect(validateQuestion({ ...mc, choices: ['서울', '서울', '대구', '인천'] })).toBe('선택지에 중복이 있다');
  });

  it('정답이 선택지 안에 없으면 막는다 — 풀 수 없는 문항이 공개되는 걸 막는 규칙', () => {
    expect(validateQuestion({ ...mc, answer: '광주' })).toBe('정답이 선택지 안에 없다');
  });

  it('해설이 비면 막는다', () => {
    expect(validateQuestion({ ...mc, explanation: '   ' })).toBe('해설이 비었다');
  });

  it('난이도가 1~4 밖이면 막는다', () => {
    expect(validateQuestion({ ...mc, difficulty: 5 as never })).toBe('difficulty가 잘못됨');
    expect(validateQuestion({ ...mc, difficulty: 0 as never })).toBe('difficulty가 잘못됨');
  });

  it('숫자입력인데 정답이 숫자가 아니면 막는다', () => {
    const num = { ...mc, type: 'NUMERIC_INPUT' as const, choices: null, answer: '마흔둘' };
    expect(validateQuestion(num)).toBe('정답이 숫자로 파싱되지 않는다');
  });

  it('입력형인데 선택지가 붙어 있으면 막는다', () => {
    expect(validateQuestion({ ...mc, type: 'NUMERIC_INPUT', answer: '42' })).toBe(
      'NUMERIC_INPUT은 선택지가 없어야 한다',
    );
    expect(validateQuestion({ ...mc, type: 'TEXT_INPUT' })).toBe('TEXT_INPUT은 선택지가 없어야 한다');
  });

  it('이미지 URL은 https만 허용한다 — http/javascript 스킴을 막는다', () => {
    const withImg = (imageUrl: string) => validateQuestion({ ...mc, type: 'TEXT_INPUT', choices: null, imageUrl });
    expect(withImg('https://example.com/a.jpg')).toBeNull();
    expect(withImg('http://example.com/a.jpg')).toBe('이미지 URL은 https://로 시작해야 한다');
    expect(withImg('javascript:alert(1)')).toBe('이미지 URL은 https://로 시작해야 한다');
    expect(withImg('data:image/png;base64,AAAA')).toBe('이미지 URL은 https://로 시작해야 한다');
  });

  it('알 수 없는 문제 유형은 막는다', () => {
    expect(validateQuestion({ ...mc, type: 'ESSAY' as never })).toBe('type이 잘못됨');
  });
});
