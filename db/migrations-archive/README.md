# db/migrations-archive/

`db/schema.sql` 베이스라인에 **흡수 완료된** 마이그레이션들. 실행되지 않는다 —
기록으로만 남긴다.

## 왜 흡수했나

원래 `db/schema.sql`은 옛 모습을 담고 있었고, 진짜 스키마를 알려면 여기 있는
마이그레이션들을 순서대로 읽어 머릿속에서 합쳐야 했다. 진실의 출처가 둘로
갈라진 상태라, 마이그레이션이 쌓일수록 아무도 스키마를 모르게 된다.

2026-08-13에 `schema.sql`을 실제 스키마와 일치하도록 다시 쓰고, 이 두 파일을
`migrations/`에서 빼냈다.

## 왜 안전했나

- **이미 돌아가는 DB(프로덕션 포함)**: `schema.sql`은 전부
  `CREATE TABLE IF NOT EXISTS`라 테이블이 있으면 한 줄도 실행되지 않는다.
  그리고 `d1_migrations` 테이블에 0001·0002가 이미 기록돼 있어서, 파일이
  사라져도 wrangler는 `✅ No migrations to apply!`로 넘어간다 (로컬에서 직접 확인).
- **빈 DB**: 새 `schema.sql` 하나로 지금 모습이 그대로 만들어진다.
  `npm test`가 매번 빈 D1에 이걸 적용하고 스키마를 검증한다
  (`test/setup.ts`, `test/schema.test.ts`).

## 여기 남은 지식

`0002_add_text_input_and_images.sql`에는 **D1에서 CHECK 제약을 넓히는 절차**가
들어있다. 참조당하는 테이블은 DROP할 수 없어서, 자식 테이블의 FK 선언을 먼저
없앤 뒤에야 대상 테이블을 재생성할 수 있다. 같은 일이 또 필요하면 이 파일을
그대로 참고하면 된다.

이것이 `question_topics.question_id`와 `question_stats.question_id`에
`questions(id)` FK가 없는 이유이기도 하다.
