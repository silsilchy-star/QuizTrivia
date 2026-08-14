# 배포 실패 조사 — R2가 계정에서 비활성화돼 있었다

## 증상

`main`에 머지한 뒤 배포 결과를 확인하다가, **최근 두 번의 배포가 모두 실패**해 있는 걸 발견했다.

| run | 커밋 | 결과 |
|---|---|---|
| #41 | `ed81ba4` 난이도 도구 | ❌ Deploy Worker 실패 |
| #40 | `e90083b` 이미지 업로드 | ❌ Deploy Worker 실패 |
| #39 | `a28f0aa` 문항 공정성 | ✅ 성공 |

즉 **프로덕션 워커는 `a28f0aa` 버전에 멈춰 있다.** 이미지 직접 업로드 기능은 코드에만 있고 실제로는 안 돌아가고 있었다.

## 원인

```
✘ [ERROR] A request to the Cloudflare API (/accounts/***/r2/buckets/quiztrivia-images) failed.
  Please enable R2 through the Cloudflare Dashboard. [code: 10042]
```

계정에서 **R2 자체가 활성화돼 있지 않다.** `wrangler.jsonc`에 R2 바인딩이 생긴 순간부터 `wrangler deploy`가 그 바인딩을 해석하려다 실패한다. 토큰 권한 문제가 아니라 서비스가 꺼져 있는 것이라 코드로는 못 푼다 — **사용자가 Cloudflare 대시보드에서 R2를 켜야 한다.**

## 왜 즉시 안 드러났나 — 워크플로 버그

`Ensure R2 bucket` 단계가 R2 생성 실패를 **"버킷 생성됨"이라고 잘못 찍고 있었다.**

```bash
if npx wrangler r2 bucket create quiztrivia-images 2>&1 | tee /tmp/r2.log; then
  echo "버킷 생성됨"
```

`if`가 보는 건 파이프라인의 마지막 명령, 즉 **`tee`의 종료 코드**다. `tee`는 앞이 뭘로 끝나든 0을 돌려주므로 이 조건은 항상 참이다. 그래서 이 단계는 초록색으로 통과했고, 진짜 실패는 세 단계 뒤 `Deploy Worker`에서야 터졌다 — 원인 단계와 실패 단계가 떨어져 있으니 로그를 봐도 R2가 원인이라는 게 바로 안 보인다.

`set -o pipefail`을 넣어 고쳤다. 로컬에서 재현·검증했다:

```
$ bash -c 'if false | tee /tmp/x.log; then echo "오판"; fi'
오판                                    ← 버그 재현
$ bash -c 'set -o pipefail; if false | tee /tmp/x.log; then echo A; else echo "제대로 감지"; fi'
제대로 감지                              ← 수정 확인
```

에러 메시지에도 10042(R2 미활성화) 가능성을 적어, 다음에 같은 일이 나면 로그만 보고 바로 알 수 있게 했다.

## 부수 효과 — DB와 워커가 어긋난 상태

파이프라인은 `검증 → 백업 → D1 변경 → 워커 배포` 순이다. 워커 배포에서 실패했으므로 **D1에는 새 스키마·시드가 이미 적용됐고 워커만 옛 버전**이다. 다행히 지금 실패한 두 커밋에는 스키마 변경이 없어서(`migrations/`는 비어 있고 `schema.sql`은 멱등) 실질적 불일치는 없다. 하지만 스키마 변경이 있는 커밋에서 같은 일이 나면 진짜 문제가 된다 — 인수인계 문서 15번 항목으로 남겼다.

## 사용자가 해야 할 일

1. Cloudflare 대시보드 → R2 → 활성화 (무료 티어 있음, 결제수단 등록이 필요할 수 있음)
2. 알려주면 배포를 재실행한다 — 그때 `e90083b`(이미지 업로드)와 `ed81ba4`(난이도 도구)가 함께 올라간다

**R2가 켜지기 전까지는 창작마당 사진 업로드가 프로덕션에서 동작하지 않으므로, "새 맞추기" 56문항 Option C(직접 업로드) 계획도 이것부터 풀려야 시작할 수 있다.**
