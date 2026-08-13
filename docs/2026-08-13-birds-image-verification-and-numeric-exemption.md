# birds 이미지 검증 + NUMERIC_INPUT 면제 결정 (2026-08-13)

P1(새 맞추기 76문항) 착수 전에 두 가지를 확정했다. **코드 변경 없음 — 문서만.**

## 1. NUMERIC_INPUT 비율 목표에서 birds 면제 (사용자 결정)

`npm run validate`가 `birds: NUMERIC_INPUT 비율 0% — 목표 20~25% 미달`을 경고한다. 이 목표를 맞추려면 "이 새의 날개폭은 몇 cm?" 같은 수치 문항을 20개 가까이 넣어야 하는데, **"사진을 보고 종을 맞춘다"는 이 주제의 정체성이 흐려진다.**

**결정: birds는 이 목표에서 면제한다.** 76문항도 전부 사진 기반(객관식/단답형)으로 채운다.

→ **`birds: NUMERIC_INPUT 비율 0%` WARN은 앞으로도 계속 남는다. 이건 미처리 할 일이 아니라 수용된 예외다.** 다음 세션이 이 경고를 보고 "고쳐야 할 것"으로 오해하지 않도록 `docs/question-authoring-standard.md` §5와 `인수인계.md`에 명시했다. 다른 넓은 주제(과학·지리·스포츠)에는 목표가 그대로 적용된다.

## 2. 기존 24장 이미지 검증 — 확인 경로를 새로 찾았다

인수인계에 "이 환경의 네트워크 제약(429)으로 전량 확인 못 했음, 사용자에게 부탁하는 게 낫다"고 적혀 있던 항목이다. **그런데 사용자도 확인할 방법이 없다고 해서(2026-08-13), 양쪽이 막혔다.** 그래서 다른 경로를 찾았다.

### 해법: 이미지를 하나씩 GET하지 말고 Wikimedia API로 일괄 조회

24개 URL을 각각 요청하는 대신, `action=query&prop=imageinfo&titles=File:A|File:B|...`로 **요청 1번**에 24개를 조회했다. 레이트리밋을 아예 안 건드린다.

```
HTTP 200 · 존재 확인 24/24 · 없는 파일 0건
```

**깨진 링크는 없다.** 이 방법은 앞으로 birds 76문항을 채울 때도 그대로 쓸 수 있다 — 이미지 URL 검증의 표준 절차로 삼는다. **주의: `User-Agent`를 반드시 지정해야 한다**(Wikimedia 정책). 기본 curl UA로는 막힌다.

### 종 이름 대조도 24/24 일치

파일명과 문항의 기대 학명을 대조했다. 16개는 파일명에 학명이 그대로 들어있고, 나머지 8개는 영문 통용명이었는데 **전부 기대 학명과 정확히 대응했다** — Large-billed Crow = *Corvus macrorhynchos*, Brown-eared bulbul = *Hypsipetes amaurotis*, Mallard = *Anas platyrhynchos*, Japanese tit = *Parus minor*, Eastern spot-billed duck = *Anas zonorhyncha*, Eurasian hoopoe = *Upupa epops*, Scaly-sided Merganser = *Mergus squamatus*, Fairy Pitta = *Pitta nympha*. **불일치 0건.**

### 429의 진짜 원인 — 앱 문제가 아니다 (교훈 6번 보정)

처음에는 `Special:FilePath`(MediaWiki 앱 서버를 거쳐 302 리다이렉트)가 원인이라 의심했고, 직접 `upload.wikimedia.org` URL로 바꾸면 나아질 거라 생각했다. **틀렸다** — API로 받은 CDN(`upload.wikimedia.org`) 썸네일 URL로 내려받을 때도 똑같이 429가 났다(24장 중 10장 실패 → 재시도).

즉 **레이트리밋은 URL 방식이 아니라 이 실행 환경의 공용 egress IP에 걸린다.** 실제 플레이어는 각자 다른 IP에서 스테이지당 5장을 보므로 해당되지 않는다.

→ **`data/questions/birds.json`의 `Special:FilePath` URL 방식을 바꿀 이유가 없다.** 오히려 `Special:FilePath`는 Commons에서 파일이 이름이 바뀌어도 따라가므로, 직접 CDN URL보다 링크가 잘 안 깨진다. 유지한다.

교훈 6번은 "외부 이미지 호스트에 요청을 많이 보내면 429"라고만 적혀 있었는데, **정확히는 (a) 호스트를 바꿔도 안 풀리고 (b) 요청 횟수를 줄이는 API 일괄 조회로는 풀린다**는 걸 이번에 확인했다.

### 재시도 시 주의 — 크기로 성공 판정하면 안 된다

429 응답이 **HTML 에러 페이지(1966~2190 bytes)**로 내려온다. 처음에 "2000 bytes 초과면 성공"으로 판정했다가 **2190 bytes짜리 에러 페이지 2개를 성공으로 잘못 세었다.** `file` 명령으로 `JPEG|PNG|WebP` 여부를 봐야 한다.

## 3. 남은 것 — 사진의 육안 확인

이름이 맞아도 "사진이 새를 알아볼 수 있게 찍혔는지"는 사람이 봐야 한다. 24장 썸네일을 내려받아 사전 설치된 Chromium(`/opt/pw-browsers/chromium`, playwright 패키지 설치 불필요)으로 한 장의 확인용 시트로 렌더링해 사용자에게 전달하는 방식을 쓴다 — 링크를 하나씩 열지 않아도 되게.

이 방식이 되면 인수인계의 "24장 육안 확인" 항목과, 앞으로 76장에 대한 같은 문제를 함께 해결한다.
