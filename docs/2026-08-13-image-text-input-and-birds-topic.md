# 이미지 첨부 + 단답형(TEXT_INPUT) 문제 유형, "새 맞추기" 주제

## 완료 판정
> "문제에 이미지 첨부 가능해지고 이미지를 보고 하나의 정답 입력하고 정답 여부 판단해주는 방식의 단항 문제 기능 추가해줘 / 주제 하나 추가해줄래: 새 맞추기 — 새의 사진을 보여주고 새의 학명을 입력하면 정답"

**충족.** 새 문제 유형 `TEXT_INPUT`(이미지 선택 첨부 + 자유 텍스트 단답)을 추가하고, 공식/창작마당 양쪽 파이프라인에 전부 연결했다. "새 맞추기" 주제를 실제 검증된 새 24종으로 채웠다(24/80 — 아직 활성화 하한 미달, 아래 참고).

## 데이터 모델 — 처음으로 실전 투입된 `migrations/`
`questions.type`의 CHECK 제약에 값을 추가하는 건 `ALTER TABLE ADD COLUMN`으로 안 되고 테이블 재생성이 필요하다. `migrations/0002_add_text_input_and_images.sql`:
- `type` CHECK에 `'TEXT_INPUT'` 추가, `image_url TEXT` 컬럼 추가.
- **⚠ 막힌 점**: D1은 `PRAGMA foreign_keys=OFF`도, `PRAGMA defer_foreign_keys=ON`도 로컬 테스트에서 "참조당하는 테이블을 DROP하는 것"을 온전히 봐주지 않았다(전자는 즉시 실패, 후자는 커밋 시점에 롤백). **해결책**: `questions(id)`를 참조하는 자식 테이블(`question_topics`, `question_stats`)의 FK 선언을 먼저 없애도록 그 두 테이블을 재생성한 뒤에야 `questions`를 안전하게 재생성했다. 로컬에서 기존 데이터(240문항, 480개 연결)로 실제 재현 후 고쳤고, 완전히 빈 DB에 `schema.sql` → `migrations 0001,0002` 순서로 다시 밟아 처음부터도 문제없이 적용됨을 확인했다.

## ⚠ 또 하나의 긴급 수정 — 이번엔 커뮤니티 문항이 대상
새 콘텐츠를 시드에 반영하려고 `npm run build:seed`를 돌리기 직전, **프로덕션에 이미 사용자가 만든 창작마당 콘텐츠가 있는 걸 확인했다**(주제 4개, 그중 "칵테일, 주류"에 문항 5개). 그런데 `scripts/build-seed.mjs`의 정리 로직이:
```sql
DELETE FROM question_topics;                              -- 전부 삭제!
DELETE FROM questions WHERE id NOT IN (공식 JSON 문항 id들); -- 커뮤니티 문항도 여기 안 걸림 = 삭제!
```
공식 JSON 파이프라인 문항만 알고 있어서, **다음 배포부터 모든 창작마당 문항이 통째로 지워질 뻔했다** — 오늘 아침 겪은 `db/schema.sql` DROP TABLE 사고와 같은 종류의 실수다. `author_uid IS NULL`(공식 문항은 항상 NULL, 커뮤니티 문항은 항상 작성자 uid)로 범위를 좁혀서 고쳤고, 로컬에 가짜 커뮤니티 문항을 만들어 시드를 재적용해도 살아남는 것까지 확인했다.

## 무엇을 만들었나

### 백엔드
- `worker/index.ts`
  - `isCorrect`에 `TEXT_INPUT` 분기 — 대소문자·앞뒤/중복 공백을 무시하고 비교(학명처럼 표기가 흔들리는 답에 맞춤).
  - `drawStageQuestions`/채점 쿼리가 `image_url`을 함께 내려주도록 확장, `ServedQuestion`/`GradedAnswer`에 `imageUrl` 필드 추가.
  - `handleTopics`에 `AND source='official'` 그대로 유지 — 새 컬럼과 무관.
- `worker/community.ts`
  - `validateQuestion`이 `TEXT_INPUT`(선택지 없음, 정답 형식 제약 없음)과 `imageUrl`(https:// 필수, 500자 이내) 검증.
  - 문항 중복 검사가 **문구 + imageUrl까지 같아야 중복**으로 보도록 수정 — 이미지 문제는 문구가 똑같아도(예: "이 새의 학명은?") 사진이 다르면 다른 문항이기 때문. (`scripts/validate.mjs`도 동일하게 수정)
- `scripts/validate.mjs`/`build-seed.mjs`/`review.html` — 공식 콘텐츠 파이프라인도 `TEXT_INPUT`/`imageUrl`을 인식하도록 확장.

### 프론트엔드
- `src/App.tsx`의 `Quiz` — `q.imageUrl`이 있으면 문항 위에 이미지 표시, `TEXT_INPUT`이면 일반 텍스트 입력창. `StageResult` 리뷰 목록에도 이미지 표시.
- `src/Workshop.tsx` — 문제 추가 폼에 "단답형 (텍스트)" 유형과 이미지 URL 입력칸 추가.

### 이미지 첨부 방식 — 파일 업로드 아님, URL 붙여넣기
"이미지 첨부"를 실제 파일 업로드(기기 사진 선택 → 서버 저장)로 구현하려면 Cloudflare R2 버킷 신규 프로비저닝 + 업로드 엔드포인트가 필요해서, 이번엔 **이미 어딘가에 호스팅된 이미지의 URL을 붙여넣는 방식**으로 구현했다(공식 콘텐츠는 Wikimedia Commons 링크 사용). 진짜 업로드가 필요하면 R2를 새로 놓는 별도 작업이 필요하다.

## "새 맞추기" 주제
실제 한국에서 흔히 보이는 새 24종을 난이도별 6종씩 채웠다. 학명은 IOC/Clements 기준 현재 통용되는 이명법으로 리서치 에이전트가 확인했고(예: 까치는 옛 *Pica pica*가 아니라 분리된 *Pica serica*), 사진은 전부 Wikimedia Commons `Special:FilePath` 링크(항상 최신 파일로 리다이렉트되는 안정적인 형태)를 썼다.

**⚠ 24/80 — 아직 `draft`(비공개) 상태다.** 활성화 하한(난이도당 20문항)에 한참 못 미친다. 로컬에서 이미지 24개를 한꺼번에 열어 검증하려 했으나, 이 작업 환경 자체가 Wikimedia에 요청을 많이 보내 속도 제한(429)·연결 재설정에 자주 걸려 안정적인 자동 검증은 못 했다(curl로 개별 확인했을 땐 성공한 것도 있었음). 실제 서비스는 사용자 브라우저에서 직접 Wikimedia에 접속하므로 이 환경 특유의 제약이며, 배포 후 실제로 몇 장만 눈으로 확인해보길 권한다.

## 검증
| # | 케이스 | 결과 |
|---|---|---|
| 1 | 완전히 빈 DB에 schema.sql → migrations 0001·0002 순서 적용 | 성공 (240행 무결성 유지 확인은 기존 DB 기준, 빈 DB는 스키마 모양만 확인) ✅ |
| 2 | 기존 데이터(240문항) 있는 로컬 DB에서 재생성 | 재현 후 재수정, 데이터 240/480/87 그대로 보존 ✅ |
| 3 | `TEXT_INPUT` 판 실제 플레이 — 대소문자·공백 다르게 입력 | 정규화 비교로 정답 처리, 오답은 오답 처리 ✅ |
| 4 | 창작마당에서 `TEXT_INPUT` + 이미지 URL로 문제 생성 | 정상 추가, 선택지 입력칸 안 보임 ✅ |
| 5 | 배포 전 프로덕션에 실제 커뮤니티 문항 존재 확인 → 수정 전 build-seed 시뮬레이션 | 커뮤니티 문항 삭제됨(버그 재현) → 수정 후 재시도 | 살아남음 ✅ |
| 6 | `npm run validate` | 264문항 승인, 오류 0건 (경고만 있음: 새 맞추기의 NUMERIC_INPUT 0%·난이도3 seedRef 없음 — 이 주제 특성상 정상) ✅ |

## 남은 일
- "새 맞추기"를 실제로 플레이 가능하게 하려면 56문항(난이도당 14개)이 더 필요하다. 원하면 이어서 채울 수 있다.
- 이미지 URL이 실제로 깨지지 않았는지 배포 후 육안 확인 권장.
- 진짜 파일 업로드가 필요하면 Cloudflare R2 프로비저닝이 별도 작업으로 필요하다.
