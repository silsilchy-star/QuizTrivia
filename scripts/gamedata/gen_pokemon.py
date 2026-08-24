import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
import json, glob, re

ART = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{}.png"
SRC = "https://raw.githubusercontent.com/PokeAPI/api-data/master/data/api/v2/pokemon-species/{}/index.json"
GEN = {'generation-i':1,'generation-ii':2,'generation-iii':3,'generation-iv':4,
       'generation-v':5,'generation-vi':6,'generation-vii':7,'generation-viii':8,'generation-ix':9}

sp = {}
for f in glob.glob('sp_*.json'):
    d = json.load(open(f, encoding='utf-8'))
    names = {n['language']['name']: n['name'] for n in d['names']}
    genera = [g['genus'] for g in d.get('genera', []) if g['language']['name'] == 'ko']
    flav = [f_['flavor_text'] for f_ in d.get('flavor_text_entries', []) if f_['language']['name'] == 'ko']
    ev = d.get('evolves_from_species')
    sp[d['id']] = {
        'ko': names.get('ko'), 'en': names.get('en'),
        'gen': GEN.get(d['generation']['name']),
        'genus': genera[0] if genera else None,
        'flavor': re.sub(r'\s+', ' ', flav[0]).strip() if flav else None,
        'evolves_from': ev['name'] if ev else None,
        'legendary': d.get('is_legendary'), 'mythical': d.get('is_mythical'),
    }

# 난이도별 배치. TEXT = 이미지 보고 이름 맞히기, NUM = 이미지 보고 도감 번호.
TEXT = {
 1: [25,4,7,6,143,133,129,130,39,52,54,131,12,35,58],
 2: [26,65,68,94,95,142,149,144,145,146,132,137,113,115,123],
 3: [105,124,126,135,136,197,381,484,644,889,92,88,245,244,212],
 4: [887,890,998,1025,1017,1024,802,800,720,719,706,869,849,845,823],
}
NUM = {1:[1,150,151,9,3], 2:[79,81,63,112,76], 3:[104,380,483,888,461], 4:[493,646,718,1000,935]}

# d3는 "왜 헷갈리는지"를 사람이 적어야 한다 — 데이터에 없는 정보다.
CONFUSE = {
 105:"탕구리가 진화한 모습입니다. 둘 다 뼈를 들고 있어 서로 헷갈리기 쉽습니다.",
 124:"마임맨과 함께 사람 모습을 한 1세대 포켓몬이라 자주 혼동됩니다.",
 126:"에레브와 짝을 이루는 포켓몬이라 이름이 자주 바뀌어 불립니다.",
 135:"샤미드·부스터와 같은 이브이 진화형이라 셋을 헷갈리기 쉽습니다.",
 136:"샤미드·쥬피썬더와 같은 이브이 진화형이라 셋을 헷갈리기 쉽습니다.",
 197:"에브이와 짝을 이루는 이브이 진화형입니다. 밤/낮 진화 조건 때문에 서로 바꿔 부르기 쉽습니다.",
 381:"라티아스와 색만 다른 짝 포켓몬이라 가장 자주 혼동됩니다.",
 484:"디아루가와 짝을 이루는 전설의 포켓몬이라 서로 바꿔 부르기 쉽습니다.",
 644:"레시라무와 짝을 이루는 전설의 포켓몬입니다. 흑백이 반대인 쪽과 헷갈리기 쉽습니다.",
 889:"자시안과 짝을 이루는 전설의 포켓몬이라 이름이 자주 바뀌어 불립니다.",
  92:"팬텀으로 진화하기 전 단계라, 유령 포켓몬을 통틀어 팬텀으로 부르는 경우가 많습니다.",
  88:"질뻐기로 진화하기 전 단계입니다.",
 245:"라이코·앤테이와 함께 다니는 전설의 세 마리라 서로 헷갈리기 쉽습니다.",
 244:"라이코·스이쿤과 함께 다니는 전설의 세 마리라 서로 헷갈리기 쉽습니다.",
 212:"스라크가 진화한 모습이라 스라크로 착각하기 쉽습니다.",
 461:"포푸니가 진화한 모습입니다.",
 104:"텅구리로 진화하기 전 단계라, 둘 다 뼈를 들고 있어 헷갈립니다.",
 380:"라티오스와 색만 다른 짝 포켓몬이라 가장 자주 혼동됩니다.",
 483:"펄기아와 짝을 이루는 전설의 포켓몬이라 서로 바꿔 부르기 쉽습니다.",
 888:"자마젠타와 짝을 이루는 전설의 포켓몬이라 이름이 자주 바뀌어 불립니다.",
}

def base_expl(i):
    s = sp[i]
    bits = [f"{s['ko']}({s['en']})는 {s['gen']}세대 {s['genus'] or '포켓몬'}으로 전국도감 {i}번입니다."]
    if s['legendary']: bits.append("전설의 포켓몬입니다.")
    elif s['mythical']: bits.append("환상의 포켓몬입니다.")
    if s['flavor']: bits.append(f"도감 설명: {s['flavor']}")
    return ' '.join(bits)

out, seq = [], {1:0, 2:0, 3:0, 4:0}
def add(d, q):
    seq[d] += 1
    q = {'id': f"pkm-{d}{seq[d]:02d}", **q}
    out.append(q)

for d in (1, 2, 3, 4):
    for i in TEXT[d]:
        s = sp[i]
        expl = base_expl(i)
        if d == 3 and i in CONFUSE:
            expl = f"{CONFUSE[i]} {expl}"
        q = {'type':'TEXT_INPUT', 'difficulty':d,
             'body':'그림 속 포켓몬의 이름은 무엇인가요?',
             'choices':None, 'answer':s['ko'], 'answerAliases':[s['en']],
             'explanation':expl, 'imageUrl':ART.format(i),
             'topicIds':['game','pokemon'], 'status':'approved', 'source':'manual'}
        if d == 3: q['seedRef'] = SRC.format(i)
        add(d, q)
    for i in NUM[d]:
        s = sp[i]
        expl = base_expl(i)
        if d == 3 and i in CONFUSE:
            expl = f"{CONFUSE[i]} {expl}"
        q = {'type':'NUMERIC_INPUT', 'difficulty':d,
             'body':'그림 속 포켓몬의 전국도감 번호는 몇 번인가요?',
             'choices':None, 'answer':str(i),
             'explanation':expl, 'imageUrl':ART.format(i),
             'topicIds':['game','pokemon'], 'status':'approved', 'source':'manual'}
        if d == 3: q['seedRef'] = SRC.format(i)
        add(d, q)

doc = {"$comment": "포켓몬스터 주제. 한글 이름·도감 분류·도감 설명은 PokeAPI 공식 데이터(ko)에서 그대로 가져왔다 — 기억으로 쓰지 않는다. 이미지는 PokeAPI sprites의 공식 아트워크. 재생성: scripts/gamedata/gen_pokemon.py",
       "questions": out}
json.dump(doc, open('../../data/questions/pokemon.json','w',encoding='utf-8'), ensure_ascii=False, indent=2)
open('../../data/questions/pokemon.json','a',encoding='utf-8').write('\n')
from collections import Counter
c = Counter((q['difficulty'], q['type']) for q in out)
print('총', len(out), '문항')
for d in (1,2,3,4):
    print(f"  d{d}: TEXT {c[(d,'TEXT_INPUT')]} / NUMERIC {c[(d,'NUMERIC_INPUT')]}")
n = sum(1 for q in out if q['type']=='NUMERIC_INPUT')
print(f"NUMERIC 비율: {n/len(out)*100:.1f}%")
