# migrations/

스키마 변경을 담는 곳. `d1_migrations` 테이블로 추적되어 **한 번만** 적용된다.

지금은 비어있다 — 기존 마이그레이션 0001·0002는 2026-08-13에 `db/schema.sql`
베이스라인으로 흡수했고, 원본은 `db/migrations-archive/`에 남아있다.

## 새 마이그레이션 추가

```bash
npx wrangler d1 migrations create quiztrivia <설명>
npx wrangler d1 migrations apply quiztrivia --local   # 로컬에서 먼저 검증
```

**`db/schema.sql`은 건드리지 않는다.** 그 파일은 배포마다 재실행되는 멱등
베이스라인이라, 이미 테이블이 있는 DB에서는 한 줄도 실행되지 않는다. 즉
거기를 고쳐도 실제 DB는 안 바뀐다.

## CHECK 제약을 넓혀야 할 때 (예: enum 값 추가)

`ALTER TABLE`로는 안 되고 테이블 재생성이 필요하다. D1은 `PRAGMA
foreign_keys=OFF`도 `defer_foreign_keys=ON`도 "참조당하는 테이블 DROP"을
허용하지 않는다. **그 테이블을 참조하는 자식 테이블의 FK 선언을 먼저 없앤
뒤에야** 대상 테이블을 재생성할 수 있다.

실제 절차는 `db/migrations-archive/0002_add_text_input_and_images.sql`에 있다.

배포 전 반드시 두 가지를 다 통과시킨다:
1. 기존 데이터가 있는 로컬 DB에 적용해보고 무결성 확인
2. 완전히 빈 DB에 `schema.sql`부터 전체를 순서대로 적용해보고 확인
   (`npm test`가 매번 이걸 한다 — `test/setup.ts`)
