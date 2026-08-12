# Day 1 — 개발환경 · Firebase 연결 스캐폴드

## 한 일
- 기존 Cloudflare Workers/KV 데모(`wrangler.jsonc`, `src/index.js`, `public/`) 제거
- Vite + React 19 + TypeScript 프로젝트 구성 (`package.json`, `tsconfig*.json`, `vite.config.ts`)
- `src/firebase.ts`: env 변수 기반 Firebase 앱/Auth/Firestore 초기화
- `src/App.tsx`: 익명 로그인 실행 후 화면에 uid 표시
- `.env.example` 추가 (Firebase config 6개 키)
- `PLAN.md`를 저장소에 추가

## 확인함
- `npx tsc -b` 타입체크 통과
- `npm run build` 빌드 성공
- `npx vite` dev 서버 기동 후 `curl` 200 확인

## 완료 판정 (계획서 8장 Day 1 기준)
"화면에 내 uid가 뜬다" — **코드는 준비됨. 실제 확인은 Firebase 프로젝트 연결 후 가능.**

## 남은 일 (사용자 직접 필요)
1. Firebase 콘솔에서 프로젝트 생성
2. Authentication → 익명 로그인 활성화
3. 웹 앱 등록 → config 값 확인
4. Firebase 요금제 페이지에서 무료 한도 확인 (계획서 7.6절)
5. `.env`에 config 값 채우기

## 관련 커밋
`f2db32d` Replace Cloudflare demo with React+TS+Firebase quiz game scaffold (Day 1)
