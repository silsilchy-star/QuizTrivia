# 유저 창작마당 — 플레이어가 직접 주제·문제를 만든다

## 완료 판정
> "게임을 하는 유저 또한 문제를 만들 수 있도록 UI(기능 접근) 도구(주제와 문제 제작)를 만들어주었으면 해"

**충족.** 로그인한 유저가 주제를 만들고 문제를 채워 넣어, 하한을 넘으면 바로 플레이 가능한 콘텐츠가 되는 전체 흐름을 실제 API·브라우저 클릭스루로 검증했다.

## 설계 결정 (사용자 확인)
질문 3개로 확정:

| 질문 | 결정 |
|---|---|
| 공개 방식 | **자동 검증만 통과하면 즉시 공개** — 사람 검수 없음 |
| 랭킹 반영 | **제외** — 별도 섹션, 통합 랭킹·주제별 순위 모두 미반영 |
| 활성화 하한 | **낮춘 기준** — 난이도당 5문항(공식 주제 20문항의 1/4) |

이 세 결정이 곧 공식 콘텐츠 파이프라인(6.6절)과의 경계선이다: 공식은 사람 검수 + 높은 하한 + 랭킹 반영, 창작마당은 자동 검증만 + 낮은 하한 + 랭킹 미반영.

## ⚠ 스키마 변경 방식이 바뀌었다
바로 전 커밋(`a1fcdfe`)에서 "배포마다 실행되는 `db/schema.sql`에 DROP TABLE을 남겨서 실사용자 데이터를 지운" 사고가 있었다. 이번 기능은 `topics`/`questions`에 컬럼을 추가해야 해서 **그 교훈을 실제로 적용하는 첫 사례**다:

- `migrations/0001_add_community_workshop.sql` — `wrangler d1 migrations` 공식 기능을 도입. 적용 여부를 `d1_migrations` 테이블로 추적하므로, 같은 마이그레이션이 두 번 실행돼도(=매 배포) 아무 일도 안 일어난다(진짜 idempotent).
- `db/schema.sql`은 그대로 두되(전부 `CREATE TABLE IF NOT EXISTS`라 안전), **앞으로 컬럼을 추가/변경할 일이 생기면 `db/schema.sql`을 고치지 않고 `migrations/`에 새 파일을 추가한다.**
- `.github/workflows/deploy.yml`에 `wrangler d1 migrations apply quiztrivia --remote` 단계 추가. `package.json`의 `db:local`에도 로컬용 동일 단계 추가.

## 데이터 모델
```sql
ALTER TABLE topics ADD COLUMN source TEXT NOT NULL DEFAULT 'official' CHECK(source IN ('official','community'));
ALTER TABLE topics ADD COLUMN author_uid TEXT REFERENCES users(uid);
ALTER TABLE questions ADD COLUMN author_uid TEXT REFERENCES users(uid);  -- 공식 문항은 NULL
```
커뮤니티 주제는 `kind='broad'`로 통일(넓은/좁은 다중 태그 체계는 공식 콘텐츠 전용, D-16과 무관), `question_topics`에도 자기 자신에게만 태그 1개를 건다.

## `worker/community.ts` (신규)
- `requireAuthor` — 로그인(`is_anonymous=0`) + 닉네임 설정까지 요구. 둘 중 하나라도 없으면 403.
- `handleCreateCommunityTopic` — 이름 1~30자, 한 줄 설명 0~60자. 생성 즉시 `status='draft'`.
- `handleAddCommunityQuestion` — **사람 검수가 없으므로 기계 검증을 공식 파이프라인(`scripts/validate.mjs`)의 ERROR급 규칙과 동일하게 적용**: 유형/난이도 유효성, 선택지 4개·정답 포함·중복 없음, `NUMERIC_INPUT`은 선택지 없이 숫자 정답만, 문항 80자 이내, 이 주제 안에서 문항 중복(정규화 비교) 금지. 통과 시 즉시 `status='approved'`로 저장하고, 난이도별 개수를 다시 세어 4개 난이도 전부 5문항 이상이면 `draft → active`.
- `isRankedTopic` — `topics.source`가 `'official'`인지 확인. `worker/index.ts`의 `finalizeRun`이 이걸로 랭킹 반영 여부를 가른다.
- 소유권 검사: 주제의 `author_uid`와 요청자 uid가 다르면 문항 추가 403.

## `worker/index.ts`
- `handleTopics`(공식 주제 목록)에 `AND source = 'official'` 추가 — 창작마당 주제가 절대 섞여 들어가지 않는다.
- `finalizeRun`을 두 경로로 분리: `isRankedTopic`이 false면 `runs` 갱신과 `users.play_count`만 하고 끝 — `topic_best`/`topic_best_weekly`/`users.global_score`/`ranking_cache`는 건드리지 않는다. `RunFinalSummary`가 `{ranked:false, totalScore, stagesCleared}`만 담아 내려간다.
- 새 라우트: `GET/POST /api/community/topics`, `POST /api/community/topics/:topicId/questions`.

## 프론트엔드
- `src/types.ts` — `RunFinalSummary`를 `ranked` 판별 유니온으로 변경(랭킹 필드는 `ranked:true`일 때만 존재), `CommunityTopic`/`NewCommunityQuestionInput` 추가.
- `src/Workshop.tsx`(신규) — 창작마당 화면 전체: 목록(활성/준비중 배지, 작성자, 내 주제 표시) → 새 주제 만들기 폼 → 주제 상세(난이도별 게이트 진행 바, 플레이/문제추가 버튼) → 문제 추가 폼(유형·난이도 선택, 객관식이면 선택지 4칸, 숫자입력이면 선택지 없음). 문제 추가 후 폼을 비우고 그 자리에서 계속 추가할 수 있게 해 — 공식 파이프라인이 "1회 20~30문항"이었던 것처럼 — 반복 입력 마찰을 줄였다.
- `src/App.tsx` — 헤더 네비에 "창작마당" 추가, `onPick`의 로직을 `startPlaying(topicId, topicName)`으로 뽑아내 창작마당의 플레이 버튼과 공유. `Final` 화면이 `ranked` 여부로 분기해 커뮤니티 주제면 "창작마당 주제는 랭킹에 반영되지 않습니다"만 보여준다.

## 검증
로컬 `wrangler dev` + curl/Playwright로 전 구간 확인:

| # | 케이스 | 결과 |
|---|---|---|
| 1 | 익명 상태로 주제 생성 시도 | 403 `must be logged in` ✅ |
| 2 | 로그인 후 주제 생성 | `draft`, 4개 난이도 전부 0 ✅ |
| 3 | 공식 `GET /api/topics` | 생성한 커뮤니티 주제가 안 보임 ✅ |
| 4 | MC 정답이 선택지에 없음 / NUMERIC_INPUT에 선택지 있음 | 각각 400 ✅ |
| 5 | 같은 문항(정규화 비교) 재제출 | 409 ✅ |
| 6 | 소유자가 아닌 유저가 문항 추가 시도 | 403 ✅ |
| 7 | 난이도별 5문항씩 채움 | 정확히 5/5/5/5 순간 `draft → active` ✅ |
| 8 | 활성화된 주제로 실제 판 플레이 | 스테이지 클리어 후 문항 풀 소진으로 자연스럽게 판 종료(기존 로직 그대로) ✅ |
| 9 | 판 종료 응답 | `{ranked:false, totalScore:50, stagesCleared:1}` — 랭킹 필드 없음 ✅ |
| 10 | `topic_best`/`users.global_score`/주제별 랭킹 조회 | 전부 이 판의 영향 없음(0건/불변) ✅ |
| 11 | 브라우저 — 헤더 3버튼("주제/랭킹/창작마당") 390px에서 안 깨짐, 목록→상세→문제추가폼→플레이→최종결과 전체 클릭스루 | 정상 ✅ |
| 12 | 브라우저 — 익명 상태에서 창작마당 진입 | "만들기" 버튼 대신 로그인 유도 문구만 보임 ✅ |

## 후속 추가 — 주제 삭제 (같은 날)
작성 중 "제거하고 싶어졌는데 제거 기능도 있나?"라는 질문에 없다는 걸 확인하고 바로 추가했다.

- `DELETE /api/community/topics/:topicId` — 작성자 본인만, 초안이든 활성이든 언제든 삭제 가능. `question_topics` → `runs`/`topic_best`/`topic_best_weekly` → `question_stats` → `questions` → `topics` 순서로 지운다 (FK 참조 역순). 첫 시도에서 `question_stats`(문항이 한 번이라도 출제되면 생기는 정답률 집계 테이블)를 빼먹어 FK 오류가 났고, 바로 잡아 재검증했다.
- UI: 상세 화면 맨 아래 "이 주제 삭제" → 클릭하면 "문항 N개도 함께 삭제되고 되돌릴 수 없습니다" 확인 문구 + 삭제/취소 버튼으로 한 번 더 확인한 뒤 진행 (되돌릴 수 없는 동작이라 확인 단계를 넣었다).

## 남은 일 / 의도적으로 안 한 것
- 사람 검수·신고 기능 없음 — MVP 범위 밖. 품질/어뷰징 콘텐츠가 나오면 랭킹 미반영이 유일한 방어선이라는 걸 인지하고 있어야 한다.
- 한 주제에 여러 사람이 같이 문제를 채우는 협업은 미지원 — 지금은 작성자 본인만 추가 가능.
- 문항 풀이 하한(5개)에 딱 걸친 주제는 같은 난이도 문항이 금방 바닥나 스테이지 1~2에서 판이 끝난다 — 버그가 아니라 "낮춘 기준" 결정의 자연스러운 결과. 창작자가 계속 채우면 더 길게 플레이된다.
- 실제 배포 후 검증은 아직 안 함 — 다음 배포에서 `wrangler d1 migrations apply`가 원격에서도 정상 작동하는지 확인 필요.
