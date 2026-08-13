# 조사 — 퀴즈 게임은 문항을 어떻게 수급하는가

Day 3(주제 등록 파이프라인) 착수 전, 업계 관행과 관련 연구를 조사해 PLAN의 설계 판단을 검증했다.

## 요약

1. **업계 표준은 예외 없이 "생성 → 검증 → 편집자 승인" 3단 구조**다. PLAN 6.6절 파이프라인은 이 표준과 일치한다.
2. **AI 생성의 약점이 PLAN 6.5절의 예측과 정확히 일치한다.** 연구에 따르면 LLM이 만든 오답 선택지는 타당성은 사람 수준이지만 **"실제 학습자의 흔한 오개념을 반영하지 못한다"**. 난이도 3(착각하기 쉬운 것)을 AI가 못 만든다는 PLAN의 판단이 독립 연구로 뒷받침된다.
3. **난이도는 저자가 붙이는 게 아니라 플레이 데이터로 측정하는 것이 정석**(IRT)이다. PLAN에는 없는 축이라 집계만이라도 미리 쌓아둘 가치가 있다.
4. **반려율이 생각보다 훨씬 높다.** FunTrivia는 커뮤니티 제출의 **약 80%를 편집자가 반려·수정 요청**한다.

## 근거

**① 업계 3단 구조 — HQ Trivia**
- 출처: [Inside HQ Trivia's Secret Formula to Writing Their Questions](https://time.com/5189381/hq-trivia-app-questions/) — TIME
- 내용: 작가·리서처 팀이 카테고리별로 문항을 만들어 **스톡파일에 순서 없이 적립**해두고, 방송 편성 시 꺼내 쓴다. 헤드라이터 Jesse Thompson 언급 — *"완벽한 문항 하나를 만들려면 작가가 통과해야 하는 필터가 50개쯤 된다"*. 팩트체커가 스톡파일에 들어가는 **모든** 문항을 검증한다. 수식·어두운 소재·과도한 길이는 배제.
- 신뢰도: 언론보도 (TIME, 제작진 직접 인터뷰)
- **우리 설계에 주는 함의**: "문항을 미리 쌓아두고 나중에 조합해 출제한다"는 구조가 PLAN의 문항 풀 + 무작위 추출과 같다. 배제 규칙(수식·길이)을 자동 검증에 넣을 만하다.

**② 반려율 80% — FunTrivia**
- 출처: [FunTrivia Quiz Creation FAQ](https://www.funtrivia.com/ftfaq_single.cfm?cat=Quizzes%3A+Creation) / [작성 가이드라인](https://www.funtrivia.com/author/index.cfm?action=guidelines)
- 내용: 제출된 퀴즈는 "Awaiting Editor Approval" 상태가 되고, **접수된 제출의 약 80%가 편집자에 의해 수정 요청으로 반송**된다.
- 신뢰도: 운영사 자체 공지
- **함의**: PLAN 6.6절은 "1.3배 선생성 폐기 — 반려된 만큼만 추가 요청"으로 결정했는데, 반려율이 80% 수준이라면 **추가 요청 왕복이 예상보다 훨씬 많아진다**. 다만 우리는 커뮤니티 제출이 아니라 정의서를 붙인 지시 생성이므로 반려율은 이보다 낮을 것으로 본다. Day 4에서 실제 반려율을 기록해두면 다음 주제 적재 때 계획이 정확해진다 (PLAN의 `rejectReason` 기록 결정과 맞물림).

**③ Sporcle — 사후 검열 모델 (우리는 채택 안 함)**
- 출처: [Sporcle](https://en.wikipedia.org/wiki/Sporcle) / [Quiz Lab](https://www.sporcle.com/contributed/)
- 내용: 사전 승인 없이 공개되고, 커뮤니티 플래그 + 스태프 감독으로 사후 관리. 에디터는 상위 제작자 중에서 선발.
- **함의**: 볼륨은 빠르지만 학습 게임에서 오답이 노출되는 비용이 크다. PLAN의 사전 승인(D-2 "환각을 사용자 도달 전 차단")이 우리 목적에 맞다.

**④ AI 생성 오답 선택지의 한계 — 연구**
- 출처: [Exploring Automated Distractor Generation for Math MCQs via LLMs](https://arxiv.org/abs/2404.02124) (arXiv:2404.02124)
- 내용: LLM이 생성한 오답 선택지는 **수학적 타당성 면에서는 사람이 쓴 것에 근접**하지만, **실제 학생들의 흔한 오류·오개념을 반드시 반영하지는 않는다**. 정답률(solve rate)로는 오답 선택지의 진짜 품질을 평가할 수 없다.
- 신뢰도: arXiv 프리프린트 (**동료심사 여부 미확인**)
- 보강: [Automatic distractor generation in MCQs: a systematic literature review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11623049/) — 2009~2024년 60개 연구를 정리한 체계적 문헌고찰
- **함의 (가장 중요)**: PLAN 6.5절 "AI는 사람들이 무엇을 착각하는지 모른다"가 **독립 연구로 확인됐다.** 난이도 3을 AI 생성물에서 기대하면 안 된다는 결정은 옳다.

**⑤ 난이도는 측정하는 것 — IRT**
- 출처: [Basic Concepts of Item Response Theory](https://files.eric.ed.gov/fulltext/ED614352.pdf) (ETS Research Memorandum RM-20-06) / [SMART: Simulated Students Aligned with IRT for Question Difficulty Prediction](https://arxiv.org/html/2507.05129v2)
- 내용: IRT는 **문항 난이도와 응시자 능력을 별개 파라미터로 분리**해 추정한다. 모든 응시자가 모든 문항을 풀 필요는 없고, 문항들이 서로 연결되는 응답 데이터만 있으면 같은 척도로 보정된다. 1PL(Rasch)은 난이도만, 2PL은 변별도까지.
- 신뢰도: ETS 기관 발행 (권위 있음) + arXiv 프리프린트(미심사)
- **함의**: PLAN은 저자가 판정한 난이도만 쓴다. 저자 판정은 첫 추정치로는 필요하지만, **플레이 기록이 쌓이면 "난이도 3이라 붙였는데 정답률 85%"** 같은 오분류가 드러난다. 지금 보정을 넣을 데이터는 없으므로 **집계 테이블만 만들어두기로 결정**.

**⑥ 공개 데이터셋 — OpenTDB (채택 안 함)**
- 출처: [Open Trivia DB](https://opentdb.com/api_config.php)
- 내용: 무료·API 키 불필요·JSON. **라이선스는 CC BY-SA 4.0** — 저작자 표시 + **파생물도 동일 라이선스로 공유** 의무.
- **함의**: 볼륨은 빨리 채우지만 ShareAlike 의무가 프로젝트에 붙는다. 게다가 영어·서구 중심이라 타겟층(한국 15~20세)과 안 맞는다. **채택하지 않음.**

**⑦ 퀴즈 문항의 저작권**
- 출처: [Are Trivia Questions Copyrighted? — Trivia Mastermind](https://triviamastermind.com/are-trivia-questions-copyrighted/) / [Can You Really Copyright a Trivia Question? — Trivia Bliss](https://triviabliss.com/are-trivia-questions-copyrighted/)
- 내용: 사실에 근거한 개별 문항은 저작권 보호를 받기 어렵다. 단 **문항 모음(편집저작물)**은 보호될 수 있다. Trivial Pursuit 관련 사례에서 트리비아 책의 사실을 25% 넘게 차용한 것이 침해가 아니라고 판단된 바 있다.
- 신뢰도: **업계 블로그 수준** — 법률 자문 아님. 판례 원문은 확인하지 못했다.
- **함의**: 우리는 사실 기반 문항을 직접 생성하므로 실질 위험은 낮다. 다만 **특정 문항집을 통째로 베끼는 것은 피한다**.

**⑧ 난이도 3의 실질적 씨앗 — Wikipedia 오해 목록**
- 출처: [List of common misconceptions](https://en.wikipedia.org/wiki/List_of_common_misconceptions) — 분야별로 분리되어 있음: [과학·기술·수학](https://en.wikipedia.org/wiki/List_of_common_misconceptions_about_science,_technology,_and_mathematics), [역사](https://en.wikipedia.org/wiki/List_of_common_misconceptions_about_history), [예술·문화](https://en.wikipedia.org/wiki/List_of_common_misconceptions_about_arts_and_culture)
- 내용: 각 항목이 **"정정" 형태로 서술**되고 출처가 붙는다. 오해 자체는 명시되지 않고 함축된다.
- **함의**: PLAN 6.5절이 "사람이 준 씨앗이 없으면 난이도 3이 통째로 빈다"고 했는데, **이 목록이 그 씨앗의 공급원이 될 수 있다.** 다만 영어권 기준이라 **"한국 사람도 똑같이 착각하는가"는 별도 판단이 필요**하다 (예: 바이킹 투구 뿔은 한국에서도 통하지만, 조지 워싱턴 나무 의치는 아님).

## 한계

- **국내 퀴즈 앱(잼라이브·더퀴즈라이브 등)의 실제 출제·검수 프로세스는 공개 자료를 찾지 못했다.** 한국어 검색은 개인 개발 블로그와 AI 문제생성 도구 위주로 나왔다. 국내 관행에 대한 근거는 이 문서에 없다.
- ④⑤의 arXiv 자료는 **동료심사 미완료 프리프린트**다.
- ⑦은 업계 블로그 수준이며 **판례 원문을 확인하지 못했다.** 법적 판단이 필요하면 별도 확인 필요.
- HQ Trivia의 "필터 50개"는 인터뷰 발언이며 **실제 체크리스트는 공개되지 않았다.**

## 이 조사가 바꾼 결정

| PLAN 원안 | 조사 후 | 근거 |
|---|---|---|
| 난이도 3은 사람이 직접 배치 | **유지 + Wikipedia 오해 목록을 씨앗 공급원으로 추가** | ④ AI 한계 확인, ⑧ 씨앗 소스 발견 |
| 난이도는 저자 판정만 | **집계 테이블 추가** (보정은 데이터 쌓인 뒤) | ⑤ IRT |
| 공개 데이터셋 미검토 | **OpenTDB 명시적 배제** (CC BY-SA 전염 + 타겟 불일치) | ⑥ |
| 반려분만 추가 요청 | 유지하되 **실제 반려율을 Day 4에 기록** | ② 업계 반려율 80% |

## 참고한 URL

- [Inside HQ Trivia's Secret Formula to Writing Their Questions (TIME)](https://time.com/5189381/hq-trivia-app-questions/)
- [FunTrivia — Quiz Creation FAQ](https://www.funtrivia.com/ftfaq_single.cfm?cat=Quizzes%3A+Creation)
- [FunTrivia — Author Guidelines](https://www.funtrivia.com/author/index.cfm?action=guidelines)
- [Sporcle (Wikipedia)](https://en.wikipedia.org/wiki/Sporcle)
- [Exploring Automated Distractor Generation for Math MCQs via LLMs (arXiv:2404.02124)](https://arxiv.org/abs/2404.02124)
- [Automatic distractor generation in MCQs: a systematic literature review (PMC11623049)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11623049/)
- [Basic Concepts of Item Response Theory (ETS RM-20-06)](https://files.eric.ed.gov/fulltext/ED614352.pdf)
- [SMART: Simulated Students Aligned with IRT (arXiv:2507.05129)](https://arxiv.org/html/2507.05129v2)
- [Open Trivia DB](https://opentdb.com/api_config.php)
- [List of common misconceptions (Wikipedia)](https://en.wikipedia.org/wiki/List_of_common_misconceptions)
- [Are Trivia Questions Copyrighted? (Trivia Mastermind)](https://triviamastermind.com/are-trivia-questions-copyrighted/)
