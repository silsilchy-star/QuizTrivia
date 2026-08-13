# 문항 생성 프롬프트 템플릿

PLAN 6.6절 [2]. `{주제}`·`{난이도}`·`{개수}`만 바꿔 끼운다.
매번 손으로 쓰면 주제·난이도별 지시가 달라져 품질이 들쭉날쭉해진다.

> **난이도 3은 이 템플릿으로 만들지 않는다.** AI는 사람들이 무엇을 착각하는지 모른다
> (PLAN 6.5절 · 연구로도 확인됨 — `docs/2026-08-12-question-sourcing-research.md` ④).
> 난이도 3은 아래 "난이도 3 전용 절차"를 따른다.

---

## 템플릿

```
아래 주제 정의서를 읽고 난이도 {난이도} 문항을 {개수}개 만들어라.

## 주제 정의서
이름: {주제명}
한 줄: {tagline}
다루는 범위: {scope}
다루지 않는 범위: {outOfScope}

## 이 난이도의 정의
{difficultySpec[난이도].rule}

## 이 난이도의 예시문 (패턴을 여기서 잡아라)
{difficultySpec[난이도].examples}

## 쓸 수 있는 태그 (이 목록 밖의 태그는 절대 만들지 마라)
{allowedTags}

## 규칙
1. 출력은 JSON 배열만. 설명 문장을 붙이지 마라.
2. 각 문항 형식:
   {
     "id": "{주제id}-{일련번호 3자리}",
     "type": "MULTIPLE_CHOICE" | "NUMERIC_INPUT",
     "difficulty": {난이도},
     "body": "문항",
     "choices": ["...", "...", "...", "..."],   // NUMERIC_INPUT이면 null
     "answer": "정답",
     "explanation": "왜 그런지. 학습이 목적이므로 필수.",
     "topicIds": ["{넓은태그}", "{좁은태그}"],
     "status": "pending",
     "source": "ai_generated",
     "generatedBy": "{모델명}"
   }
3. 정답은 **완전한 문장이 아니라 단어 형태로**. "김치입니다" ❌ → "김치" ⭕
4. MULTIPLE_CHOICE는 선택지 4개, 정답은 반드시 그 안에 포함.
5. 오답 선택지는 **그럴듯해야 한다.** 너무 허술하면 정답이 보인다.
   같은 범주에서 고른다 — 원소기호 문항이면 오답도 전부 원소.
6. NUMERIC_INPUT은 정답이 숫자로만 파싱되어야 한다. 단위는 문항에 쓰고 정답에는 쓰지 마라.
   "몇 km인가?" → 42.195  ("42.195km" ❌)
7. **"가장/최고/제일"을 쓸 거면 측정 기준을 문항 안에 명시하라.**
   "가장 큰 나라" ❌ → "면적이 가장 넓은 나라" ⭕
8. 다루지 않는 범위에 걸리는 문항은 만들지 마라.
9. 넓은 태그 1개 + 좁은 태그 1~2개를 붙여라.
10. 문항은 80자 이내. 타겟이 15~20세이고 대부분 폰으로 푼다.
```

---

## 난이도 3 전용 절차

난이도 3은 **"정답은 명확한데 많은 사람이 틀리게 아는 것"**이다.
"덜 알려진 것"(난이도 4)과 헷갈리면 안 된다.

1. **씨앗을 먼저 확보한다.** AI에게 "착각하기 쉬운 것을 만들어라"라고 하지 않는다.
   - [Wikipedia: List of common misconceptions](https://en.wikipedia.org/wiki/List_of_common_misconceptions)
     ([과학·기술](https://en.wikipedia.org/wiki/List_of_common_misconceptions_about_science,_technology,_and_mathematics) ·
      [역사](https://en.wikipedia.org/wiki/List_of_common_misconceptions_about_history))
   - 규칙이 개정된 스포츠 종목 (개정 = 옛 정보로 아는 사람이 많다)
   - 더 유명한 도시가 수도가 아닌 나라
2. **한국 맥락 필터를 건다.** 영어권 오해가 한국에서도 통하는지 따로 판단한다.
   - 통함: 고래는 포유류, 바이킹 투구에 뿔 없음
   - 안 통함: 조지 워싱턴의 나무 의치
3. **씨앗 출처를 `seedRef`에 남긴다.** 자동 검증이 난이도 3에 `seedRef`가 없으면 경고한다.
4. **반려 기준** (PLAN 6.4절 ①): 정답 자체가 논쟁적이거나 이미 폐기된 통설이면 난이도 3이 아니라 **반려**다.
   판정 한 줄 — **"공식 자료 한 곳을 펴서 확인할 수 있는가?"**

---

## 생성 후

```bash
npm run validate     # 형식 검증 — 여기서 걸리면 고치고 다시
npm run review       # 로컬 검수 UI에서 승인/반려
npm run build:seed   # 승인된 것만 SQL로. 하한 넘으면 자동 active
```

**반려 사유를 반드시 적는다.** 어떤 주제에서 생성 품질이 떨어지는지 알려주므로
다음 적재 때 이 템플릿을 고치는 근거가 된다 (PLAN 6.6절 [5]).
