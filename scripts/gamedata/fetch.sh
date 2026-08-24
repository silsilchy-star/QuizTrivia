#!/usr/bin/env bash
# 게임 주제 3개의 원본 데이터를 받아온다. 생성기(gen_*.py)가 이 파일들을 읽는다.
#
# ⚠ 이름·수치를 기억으로 쓰지 않는 것이 이 디렉터리의 존재 이유다. 한글 이름,
#   도감 분류·설명, 최대 스택 수는 전부 각 게임의 공식 데이터에서 그대로 온다.
#
# ⚠ 받은 원본(sp_*.json 등)은 커밋하지 않는다 — 수십 MB이고 언제든 다시 받을 수 있다.
set -euo pipefail
cd "$(dirname "$0")"

echo "== 리그오브레전드 (Data Dragon ko_KR) =="
curl -sfL -o lol_champion_ko.json \
  "https://raw.githubusercontent.com/InFinity54/LoL_DDragon/master/latest/data/ko_KR/champion.json"

echo "== 마인크래프트 (mcmeta) =="
curl -sfL -o mc_ko.json \
  "https://raw.githubusercontent.com/misode/mcmeta/assets/assets/minecraft/lang/ko_kr.json"
curl -sfL -o mc_components.json \
  "https://raw.githubusercontent.com/misode/mcmeta/summary/item_components/data.json"

echo "== 포켓몬 (PokeAPI api-data) =="
# idlist.txt에 적힌 종만 받는다. 전체를 받으면 수 GB다.
fetch_sp() {
  local id=$1
  for try in 1 2 3; do
    curl -sfL --max-time 25 -o "sp_$id.json" \
      "https://raw.githubusercontent.com/PokeAPI/api-data/master/data/api/v2/pokemon-species/$id/index.json" && return 0
    sleep $((try * 2))
  done
  echo "FAIL $id" >&2; return 1
}
export -f fetch_sp
xargs -P 4 -I{} bash -c 'fetch_sp {}' < idlist.txt

echo "완료. 이제 python3 gen_pokemon.py / gen_minecraft.py / gen_lol.py 를 돌린다."
