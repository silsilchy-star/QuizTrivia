# 게임 주제 문항 생성기

`data/questions/{pokemon,minecraft,lol}.json` 240문항을 만든 스크립트다. 손으로 고치지 말고
여기서 다시 생성한다.

```bash
./scripts/gamedata/fetch.sh          # 원본 데이터 내려받기 (커밋 안 함)
python3 scripts/gamedata/gen_pokemon.py
python3 scripts/gamedata/gen_minecraft.py
python3 scripts/gamedata/gen_lol.py
```

## 왜 생성기로 만드나

**이름과 수치를 기억으로 쓰지 않기 위해서다.** 한글 포켓몬 이름·도감 분류·도감 설명,
마인크래프트 블록의 한글 이름과 최대 스택 수, 챔피언의 한글 이름과 별명은 전부 각 게임의
공식 데이터에서 그대로 가져온다. sports 난이도 3처럼 "나중에 사람이 사실 확인을 해야 하는"
문항이 쌓이지 않는다.

| 게임 | 이름·데이터 출처 | 이미지 |
|---|---|---|
| 포켓몬스터 | PokeAPI `api-data` (한국어 names·genera·flavor_text) | PokeAPI sprites 공식 아트워크 |
| 마인크래프트 | mcmeta `lang/ko_kr.json`, `item_components` | mcmeta 자바 에디션 기본 텍스처 |
| 리그오브레전드 | Data Dragon `ko_KR/champion.json` | Data Dragon 챔피언 초상 |

셋 다 GitHub(raw.githubusercontent.com)로 받는다. Riot의 ddragon 도메인과 minecraft.wiki는
이 작업 환경의 프록시가 막아서 GitHub 미러를 쓴다.

## 손으로 정하는 부분

데이터에 없는 것만 스크립트 안에 표로 적혀 있다.

- **난이도 배치** (`TEXT`/`NUM` 딕셔너리) — 어떤 대상이 쉽고 어려운지는 데이터가 모른다.
- **난이도 3의 "왜 헷갈리는지"** (`CONFUSE`/`SIMILAR`) — 비슷하게 생겼거나 이름을 착각하는
  이유를 사람이 적는다.

## 지켜야 할 것

- **⚠ 패치·업데이트마다 바뀌는 수치는 쓰지 않는다.** 챔피언 능력치·쿨다운·아이템 가격,
  마인크래프트의 버전별 변경 사항이 여기 해당한다. 한 번 넣으면 패치마다 틀린 문항이 되고,
  틀린 걸 알아채는 사람도 없다. 그래서 롤의 수치 문항은 소환사의 협곡의 고정 구조만 쓰고,
  마인크래프트 문항에는 버전 번호를 하나도 적지 않았다.
- **이미지 URL은 넣기 전에 전부 HTTP 200을 확인한다.** "새 맞추기" 주제가 죽은 이유가
  검증 못 한 외부 이미지였다(인수인계 6번).
  ```bash
  python3 -c "import json,sys;[print(q['imageUrl']) for f in ['pokemon','minecraft','lol'] for q in json.load(open(f'data/questions/{f}.json'))['questions'] if q.get('imageUrl')]" \
    | sort -u | xargs -P 6 -I{} sh -c 'c=$(curl -s -o /dev/null -w "%{http_code}" "{}"); [ "$c" = 200 ] || echo "BAD $c {}"'
  ```
