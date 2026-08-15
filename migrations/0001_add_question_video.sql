-- 문항에 영상(유튜브)을 붙일 수 있게 한다.
--
-- URL을 통째로 저장하지 않고 provider(video_kind) + 영상 id(video_id)로 쪼개
-- 저장한다. 재생은 iframe으로 하는데 유저가 준 URL을 그대로 iframe src에 넣으면
-- 그 자체가 공격면이 되기 때문이다. id만 뽑아 엄격한 charset으로 검증해두면
-- 임베드 주소는 우리가 조립할 수 있고, 저장된 값에 위험한 게 섞일 수 없다.
-- 파서는 src/media.ts 하나뿐이고 프론트·워커가 같은 걸 쓴다.
--
-- 나중에 다른 제공자를 붙일 여지를 두려고 kind를 따로 뒀다. 지금 들어가는 값은
-- 'youtube' 하나뿐이라 CHECK 제약은 걸지 않았다 — 값을 늘릴 때마다 D1에서
-- 테이블 재생성이 필요해지는데(migrations/README.md 참고) 그 비용이 얻는 것보다
-- 크다. 대신 읽을 때도 kind/id를 다시 검증한다(src/media.ts videoFromStored).
--
-- ⚠ db/schema.sql에는 이 컬럼을 넣지 않는다. 그 파일은 배포마다 재실행되는 멱등
-- 베이스라인이라 (a) 이미 테이블이 있는 프로덕션에서는 한 줄도 안 돌아 컬럼이
-- 안 생기고, (b) 반대로 CREATE 문에 컬럼을 넣어두면 빈 DB에서 이 ALTER가
-- "duplicate column name"으로 깨진다. schema.sql → migrations 순서로 적용하면
-- 기존 DB든 새 DB든 같은 모양으로 수렴한다 (test/setup.ts가 매번 (b)를 검증).

ALTER TABLE questions ADD COLUMN video_kind TEXT;
ALTER TABLE questions ADD COLUMN video_id TEXT;
