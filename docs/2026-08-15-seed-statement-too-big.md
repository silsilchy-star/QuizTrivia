# 배포 실패 — seed의 SQL 문 하나가 D1 한도를 넘었다 (SQLITE_TOOBIG)

## 무슨 일이 있었나

sports 320문항을 머지한 직후 배포가 `Apply D1 seed` 단계에서 멈췄다.

```
✘ [ERROR] statement too long: SQLITE_TOOBIG
```

`scripts/build-seed.mjs`가 승인 문항 **전체를 여러 행 INSERT 한 문장**으로 뽑는다. 문항이 240개일 땐 문제가 없었는데 560개가 되자 그 한 문장이 **224,693바이트**가 됐다. D1의 SQL 문 하나 한도는 **100KB**다.

문항을 320개 늘린 것 말고는 아무것도 바꾸지 않았는데 배포가 깨졌다. 이 실패는 **콘텐츠가 늘어나면 언젠가 반드시 터지도록** 예약돼 있었던 것이다.

## 프로덕션은 어떻게 됐나

멀쩡하다. 단계 순서상 이 시점에 이미 지나간 것은:

| 단계 | 결과 |
|---|---|
| 검증(typecheck·test·validate·build) | 통과 |
| D1 백업 | 아티팩트로 보관됨 |
| `Apply D1 schema` | 적용됨 (멱등, 변경 없음) |
| `Apply D1 migrations` | `No migrations to apply!` |
| `Apply D1 seed` | **실패 — 롤백** |
| `Deploy Worker` | **실행 안 됨** |

wrangler가 `if the execution fails to complete, your DB will return to its original state`라고 알려주는 대로 seed는 통째로 롤백됐다. 워커도 옛 버전 그대로다. 즉 **새 문항 320개가 라이브에 안 올라갔을 뿐, 어긋난 상태는 없다.**

교훈 17번("배포가 실패해도 DB는 이미 앞서간 상태다")이 이번엔 다행히 물리지 않았다 — 이번 배포엔 적용할 마이그레이션이 없었기 때문이다. 마이그레이션이 하나라도 있었다면 "DB는 새 스키마, 워커는 옛 버전"이 됐다.

## 고친 것

### 1. 여러 행 INSERT를 예산 안에서 쪼갠다

`chunkedInsert(header, rows)`를 넣어 `questions`와 `question_topics` INSERT를 여러 문장으로 나눈다. 예산은 **40,000바이트** — 한도의 절반 아래로 잡아 문항 본문이 길어져도 여유가 남게 했다.

결과: 문장 1개(224KB) → 5개(각 40KB 이하).

**⚠ 크기는 글자 수가 아니라 바이트로 잰다.** 한글은 UTF-8에서 한 자가 3바이트라 `String.length`로 재면 실제 크기의 1/3만 보인다. 실제로 이 파일은 267,960자인데 바이트로는 그보다 훨씬 크다. `Buffer.byteLength(s, 'utf8')`를 쓴다.

### 2. 빌드에서 먼저 막는다

`build-seed.mjs`가 생성 직후 모든 문장의 바이트 크기를 재서, 100KB를 넘는 게 하나라도 있으면 파일을 쓰지 않고 **exit 1**한다.

이게 핵심이다. 배포 워크플로에서 `Build seed from JSON`은 **DB를 건드리기 전** 단계라, 앞으로 같은 문제가 생기면 프로덕션 근처에도 못 가고 로컬이나 CI에서 잡힌다.

문장 분리기는 작은따옴표 안의 세미콜론을 건너뛴다 — 문항 본문에 `;`가 들어가면 단순 `split(';')`은 문장 경계를 잘못 잡기 때문이다.

가드가 실제로 동작하는지는 `CHUNK_BUDGET_BYTES`를 크게 바꿔 돌려서 확인했다:

```
❌ D1 문장 크기 한도(100000바이트) 초과 1건:
   224695바이트 — INSERT OR REPLACE INTO questions (id, type, difficulty, bo…
exit=1
```

### 쪼개기가 데이터를 바꾸지 않았는지

옛 스크립트로 뽑은 seed와 새 seed에서 헤더·빈 줄을 걷어내고 데이터 줄만 비교했다 — **2,878줄 전부 동일**했다. 바뀐 건 문장 경계뿐이다.

## 아직 남은 한도 하나

`DELETE FROM questions WHERE author_uid IS NULL AND id NOT IN ('geo-101', ...)` 는 쪼갤 수 없다. 청크마다 "이 청크에 없는 것"을 지우면 서로가 서로를 지워버리기 때문이다.

지금 6,222바이트이고 문항당 약 11바이트씩 늘어난다 — 한도까지 **약 9,000문항** 여유가 있다. 계획된 규모(좁은 주제 1,040 + broad)로는 한참 남았고, 넘어서면 위 가드가 배포 전에 잡아준다. 그때는 `created_at`으로 이번 배치를 식별하는 방식(모든 승인 문항이 같은 `NOW`로 갱신되므로 `created_at <> NOW`가 곧 "이번에 빠진 문항")을 검토할 것. 다만 그건 `NOW`가 어긋나는 순간 공식 문항을 **전부** 지우는 형태라, 지금의 명시적 id 목록보다 사고 시 피해가 크다.

## 검증

- `npm run build:seed` — 최대 문장 40,007바이트 (한도의 40%)
- 데이터 2,878줄 옛 출력과 동일
- `npm test` 211개 통과 · `npm run typecheck` · `npm run build` 통과
