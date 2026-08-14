// 문항 공정성 규칙 (scripts/fairness.mjs).
//
// 형식 검증은 다 통과하면서도 문제에 답이 적혀 있으면 그 문항은 지식을
// 묻지 않는다. 실제로 라이브에 세 건이 있었다 — 럭비 "15인제"(답 15),
// 축구공 "32조각 디자인 기준"(답 32), "태양계의 중심"(답 태양).
//
// 규칙이 무엇을 잡고 무엇을 **안 잡는지**가 똑같이 중요하다. 오탐이 나면
// 멀쩡한 비교 문항("육지와 바다 중 넓은 쪽은?")이 막힌다.
import { describe, expect, it } from 'vitest';
// @ts-expect-error — 순수 ESM 스크립트라 타입 선언이 없다
import { choiceAnswerLeaked, numericAnswerLeaked } from '../scripts/fairness.mjs';

const numeric = (body: string, answer: string) => ({ type: 'NUMERIC_INPUT', body, answer });
const choice = (body: string, answer: string, choices: string[]) => ({
  type: 'MULTIPLE_CHOICE',
  body,
  answer,
  choices,
});

describe('숫자입력 — 정답이 본문에 노출', () => {
  it('실제로 있었던 두 문항을 잡는다', () => {
    expect(numericAnswerLeaked(numeric('럭비유니언(15인제)에서 한 팀은 몇 명인가요?', '15'))).toBe(true);
    expect(
      numericAnswerLeaked(numeric('몇 조각인가요? (전통적인 32조각 디자인 기준)', '32')),
    ).toBe(true);
  });

  it('고친 뒤 문항은 통과한다', () => {
    expect(numericAnswerLeaked(numeric('럭비 유니언에서 한 팀은 몇 명이 경기장에 나가나요?', '15'))).toBe(false);
    expect(
      numericAnswerLeaked(
        numeric('정오각형과 정육각형으로 이루어진 전통적인 축구공은 표면이 모두 몇 조각인가요?', '32'),
      ),
    ).toBe(false);
  });

  // 오탐이 나면 멀쩡한 문항이 배포를 막는다.
  it('더 큰 수에 부분 일치해도 잡지 않는다', () => {
    expect(numericAnswerLeaked(numeric('15세기에 일어난 일은 몇 년도인가요?', '5'))).toBe(false);
    expect(numericAnswerLeaked(numeric('1950년에 시작된 전쟁은 몇 년간 이어졌나요?', '3'))).toBe(false);
  });

  it('소수점에 걸쳐 부분 일치해도 잡지 않는다', () => {
    expect(numericAnswerLeaked(numeric('중력가속도가 9.8일 때 답은?', '8'))).toBe(false);
    expect(numericAnswerLeaked(numeric('0.5초 뒤의 값은?', '5'))).toBe(false);
  });

  it('소수 정답도 본문에 그대로 있으면 잡는다', () => {
    expect(numericAnswerLeaked(numeric('원주율 3.14를 소수 둘째 자리까지 쓰면?', '3.14'))).toBe(true);
  });

  it('숫자입력이 아닌 유형은 보지 않는다', () => {
    expect(numericAnswerLeaked({ type: 'TEXT_INPUT', body: '15명입니다', answer: '15' })).toBe(false);
  });

  it('정답이 숫자가 아니면 보지 않는다', () => {
    expect(numericAnswerLeaked(numeric('약 15명입니다', '열다섯'))).toBe(false);
  });
});

describe('객관식 — 정답만 본문에 노출', () => {
  it('정답만 본문에 있으면 잡는다', () => {
    expect(
      choiceAnswerLeaked(choice('태양계의 중심에 있는 천체는?', '태양', ['지구', '달', '태양', '목성'])),
    ).toBe(true);
  });

  // 이게 이 규칙의 핵심 — 비교 문항은 선택지를 본문에 쓰는 게 정상이다.
  it('다른 선택지도 본문에 있으면 잡지 않는다', () => {
    expect(
      choiceAnswerLeaked(
        choice('육지와 바다 중 면적이 더 넓은 쪽은?', '바다', ['바다', '육지', '거의 같다', '계절에 따라']),
      ),
    ).toBe(false);
    expect(
      choiceAnswerLeaked(
        choice('북극과 남극 중 대륙 위에 있는 쪽은?', '남극', ['남극', '북극', '둘 다 대륙', '둘 다 바다']),
      ),
    ).toBe(false);
  });

  it('고친 뒤 문항은 통과한다', () => {
    expect(
      choiceAnswerLeaked(
        choice('지구가 공전하는 중심에 있는 천체는?', '태양', ['지구', '달', '태양', '목성']),
      ),
    ).toBe(false);
  });

  it('정답이 본문에 아예 없으면 잡지 않는다', () => {
    expect(choiceAnswerLeaked(choice('대한민국의 수도는?', '서울', ['서울', '부산', '대구', '인천']))).toBe(
      false,
    );
  });

  // 한 글자는 우연히 겹치기 쉬워 오탐이 난다.
  it('한 글자 정답은 보지 않는다', () => {
    expect(choiceAnswerLeaked(choice('물체의 상태는?', '물', ['물', '불', '흙', '풀']))).toBe(false);
  });

  it('객관식이 아닌 유형은 보지 않는다', () => {
    expect(
      choiceAnswerLeaked({ type: 'TEXT_INPUT', body: '태양계의 중심은?', answer: '태양', choices: null }),
    ).toBe(false);
  });
});
