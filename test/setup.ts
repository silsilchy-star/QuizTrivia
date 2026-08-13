// 테스트용 D1을 프로덕션과 같은 순서로 만든다: db/schema.sql(멱등 베이스라인)
// → migrations/*.sql. 배포 파이프라인과 같은 순서여야 "로컬은 되는데 배포하면
// 깨지는" 상황을 테스트가 잡아낼 수 있다.
//
// 문항 데이터(data/*.json)는 일부러 넣지 않는다 — 테스트는 자기가 쓸 문항을
// 직접 만든다. 콘텐츠가 늘어난다고 테스트가 깨지면 안 되기 때문이다.
import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';
import schemaSql from '../db/schema.sql?raw';
import { splitSqlStatements } from './helpers';

beforeAll(async () => {
  const statements = splitSqlStatements(schemaSql);
  for (const sql of statements) {
    await env.DB.prepare(sql).run();
  }
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
