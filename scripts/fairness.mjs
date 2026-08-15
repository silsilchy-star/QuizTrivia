// 문항 공정성 검사 — "형식은 멀쩡한데 아무것도 묻지 않는 문항"을 잡는다.
//
// validate.mjs의 나머지 규칙은 형식(선택지 4개인가, 정답이 선택지 안에 있나)을 본다.
// 그건 다 통과하면서도 문제에 답이 적혀 있으면 그 문항은 지식을 묻지 않는다.
// 실제로 라이브에 이런 것들이 있었다:
//
//   "럭비유니언(15인제)에서 한 팀은 몇 명이 경기장에 나가나요?"        답 15
//   "...몇 조각인가요? (전통적인 32조각 디자인 기준)"                 답 32
//   "태양계의 중심에 있는 천체는 무엇인가요?"                          답 태양
//
// node 내장 모듈에 의존하지 않는다 — 테스트가 Workers 런타임에서 돌기 때문이다.

/** 숫자입력 문항에서 정답 숫자가 본문에 그대로 있는가.
 *
 *  앞뒤가 숫자·소수점이 아닐 때만 센다. 정답 5가 "15"나 "0.5"에 걸리면
 *  멀쩡한 문항이 오탐으로 막힌다. */
export function numericAnswerLeaked(question) {
  if (question.type !== 'NUMERIC_INPUT') return false;
  if (typeof question.answer !== 'string' || typeof question.body !== 'string') return false;

  const answer = question.answer.trim();
  if (!/^-?\d+(\.\d+)?$/.test(answer)) return false;

  const asNumber = new RegExp(`(?<![\\d.])${answer.replace('.', '\\.')}(?![\\d.])`);
  return asNumber.test(question.body);
}

/** 객관식 문항에서 정답만 본문에 나오는가.
 *
 *  "육지와 바다 중 면적이 더 넓은 쪽은?"처럼 선택지를 나열하는 것은 정상적인
 *  비교 문항이다. 그래서 정답이 본문에 있다는 것만으로는 판단하지 않고,
 *  **다른 선택지는 하나도 안 나올 때만** 의심한다. */
export function choiceAnswerLeaked(question) {
  if (question.type !== 'MULTIPLE_CHOICE') return false;
  if (!Array.isArray(question.choices)) return false;
  if (typeof question.answer !== 'string' || typeof question.body !== 'string') return false;

  const answer = question.answer.trim();
  // 한 글자 정답은 우연히 겹치기 쉽다 (예: 답 "물"이 "물체"에 걸린다).
  if (answer.length < 2) return false;
  if (!question.body.includes(answer)) return false;

  const others = question.choices.map((c) => String(c).trim()).filter((c) => c !== answer);
  return !others.some((c) => c.length > 0 && question.body.includes(c));
}

/** 단답형 문항에서 정답(또는 인정 별칭)이 본문에 그대로 있는가.
 *
 *  단답형은 객관식보다 이 검사가 더 필요하다. 객관식은 "다른 선택지도 본문에
 *  나오면 정상적인 비교 문항"이라는 오탐 방지 장치를 쓸 수 있지만, 단답형은
 *  선택지가 없어서 그 장치가 없다. 그리고 **본문이 플레이어가 보는 전부**라,
 *  거기 답이 적혀 있으면 그냥 베껴 쓰면 된다.
 *
 *  그래서 판정은 단순하다 — 두 글자 이상인 정답이 본문에 있으면 의심한다.
 *  "육지와 바다 중 넓은 쪽은?" 같은 비교 문항은 이 규칙에 걸리는데, 그건
 *  오탐이 아니라 **애초에 단답형으로 낼 문항이 아니라는 신호**다. 선택지를
 *  없애는 순간 본문이 보기를 대신 나열하고 있는 꼴이기 때문이다.
 *
 *  별칭까지 보는 이유: 정답이 "에베레스트"라 본문에 없더라도, 별칭
 *  "에베레스트산"이 본문에 있으면 똑같이 베껴 쓸 수 있다. */
export function textAnswerLeaked(question) {
  if (question.type !== 'TEXT_INPUT') return false;
  if (typeof question.answer !== 'string' || typeof question.body !== 'string') return false;

  const candidates = [question.answer, ...(Array.isArray(question.answerAliases) ? question.answerAliases : [])];
  return candidates.some((raw) => {
    if (typeof raw !== 'string') return false;
    const value = raw.trim();
    // 한 글자는 우연히 겹치기 쉽다 (답 "물"이 "물체"에 걸린다) — 객관식과 같은 기준.
    if (value.length < 2) return false;
    return question.body.includes(value);
  });
}
