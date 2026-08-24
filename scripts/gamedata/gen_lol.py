import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
import json

IMG = "https://raw.githubusercontent.com/InFinity54/LoL_DDragon/master/latest/img/champion/{}"
SRC = "https://raw.githubusercontent.com/InFinity54/LoL_DDragon/master/latest/data/ko_KR/champion.json"

raw = json.load(open('lol_champion_ko.json', encoding='utf-8'))
CH = raw['data']

TEXT = {
 1: ['Ahri','Garen','Ashe','Teemo','Yasuo','Lux','Jinx','Ezreal','Darius','LeeSin',
     'Zed','Yone','Katarina','MasterYi','Annie','Malphite','Blitzcrank'],
 2: ['Vayne','Thresh','Riven','Akali','Jhin','Caitlyn','Morgana','Leona','Nautilus',
     'Sett','Viego','Lulu','Braum','Nami','Vi','Ekko','Draven'],
 3: ['Xayah','Rakan','Kayn','Kayle','Morgana','Swain','Sylas','Kassadin','Chogath','Khazix',
     'RekSai','Malzahar','Velkoz','KogMaw','Nasus','Renekton','Ziggs','Heimerdinger','Skarner','Zilean'],
 4: ['AurelionSol','Belveth','Rell','Ivern','Taliyah','Qiyana','Yuumi','Gnar',
     'Bard','Zac','Illaoi','Aurora','Smolder','Hwei','Naafiri','Briar'],
}
# d3는 Morgana가 d2와 겹친다 — 제거하고 다른 챔피언으로 채운다.
TEXT[3] = [c for c in TEXT[3] if c != 'Morgana'] + ['Karma']

# ⚠ 수치 문항은 패치와 무관한 고정 구조만 쓴다. 챔피언 능력치·아이템 가격·쿨다운은
#    주제 정의의 outOfScope다 — 한 번 넣으면 패치마다 틀린 문항이 된다.
NUM = {
 1: [('소환사의 협곡에서 한 팀은 몇 명으로 이루어지나요?', '5',
      '소환사의 협곡은 5대5로 진행됩니다.'),
     ('소환사의 협곡 한 경기에 들어가는 챔피언은 모두 몇 명인가요?', '10',
      '양 팀 5명씩 모두 10명입니다.'),
     ('챔피언이 올릴 수 있는 레벨의 상한은 몇인가요?', '18',
      '한 경기 안에서 챔피언은 18레벨까지 성장합니다.')],
 2: [('소환사의 협곡에는 라인이 몇 개 있나요?', '3',
      '탑·미드·바텀 세 개의 라인이 있습니다.'),
     ('챔피언이 궁극기를 처음 배울 수 있는 것은 몇 레벨인가요?', '6',
      '궁극기(R)는 6레벨부터 배울 수 있습니다.'),
     ('한 챔피언이 경기에 들고 갈 수 있는 소환사 주문은 몇 개인가요?', '2',
      '점멸·점화 같은 소환사 주문을 두 개 고릅니다.')],
 3: [],
 4: [('한 팀이 지켜야 하는 억제기는 몇 개인가요?', '3',
      '라인마다 하나씩, 팀당 세 개입니다.'),
     ('장신구를 뺀 아이템 칸은 몇 칸인가요?', '6',
      '장신구 칸은 따로 있고, 일반 아이템은 여섯 칸입니다.'),
     ('넥서스를 지키는 포탑은 팀당 몇 개인가요?', '2',
      '넥서스 앞에 두 개가 붙어 있습니다.'),
     ('넥서스 포탑을 빼고, 한 라인에 세워진 포탑은 몇 개인가요?', '3',
      '외곽·안쪽·억제기 포탑 세 개입니다.')],
}

missing = [c for lst in TEXT.values() for c in lst if c not in CH]
if missing: raise SystemExit(f'챔피언 id 없음: {missing}')
dupes = [c for c in {c for lst in TEXT.values() for c in lst}
         if sum(lst.count(c) for lst in TEXT.values()) > 1]
if dupes: raise SystemExit(f'중복 챔피언: {dupes}')

CONFUSE = {
 'Xayah':'라칸과 짝을 이루는 챔피언이라 서로 바꿔 부르기 쉽습니다.',
 'Rakan':'자야와 짝을 이루는 챔피언이라 서로 바꿔 부르기 쉽습니다.',
 'Kayn':'케일과 이름이 비슷해 헷갈립니다.',
 'Kayle':'모르가나와 자매이고, 케인과 이름이 비슷해 두 번 헷갈립니다.',
 'Swain':'사일러스와 이름이 비슷해 자주 혼동됩니다.',
 'Sylas':'스웨인과 이름이 비슷해 자주 혼동됩니다.',
 'Kassadin':'카시오페아·카사딘처럼 이름이 비슷한 챔피언이 많습니다.',
 'Chogath':'공허 출신 챔피언끼리 생김새가 비슷해 헷갈립니다.',
 'Khazix':'렉사이와 같은 공허 곤충형이라 자주 혼동됩니다.',
 'RekSai':'카직스와 같은 공허 곤충형이라 자주 혼동됩니다.',
 'Malzahar':'말파이트와 이름 앞부분이 같아 헷갈립니다.',
 'Velkoz':'공허 눈알 형태라 초가스·렉사이와 함께 묶여 기억됩니다.',
 'KogMaw':'공허 출신이라 다른 공허 챔피언과 헷갈립니다.',
 'Nasus':'레넥톤과 같은 슈리마 수인형이라 서로 바꿔 부르기 쉽습니다.',
 'Renekton':'나서스와 같은 슈리마 수인형이라 서로 바꿔 부르기 쉽습니다.',
 'Ziggs':'하이머딩거와 같은 요들 발명가라 헷갈립니다.',
 'Heimerdinger':'직스와 같은 요들 발명가라 헷갈립니다.',
 'Skarner':'전갈 형태라 다른 공허·사막 챔피언과 혼동됩니다.',
 'Zilean':'질리언과 이름이 비슷한 챔피언이 여럿입니다.',
 'Karma':'카르마와 카사딘처럼 이름 앞부분이 같은 챔피언이 많습니다.',
}

out, seq = [], {1:0,2:0,3:0,4:0}
def add(d, q):
    seq[d] += 1
    out.append({'id': f"lol-{d}{seq[d]:02d}", **q})

for d in (1,2,3,4):
    for cid in TEXT[d]:
        c = CH[cid]
        expl = f"{c['name']}, '{c['title']}'입니다."
        if d == 3 and cid in CONFUSE: expl = f"{CONFUSE[cid]} {expl}"
        q = {'type':'TEXT_INPUT','difficulty':d,
             'body':'그림 속 리그오브레전드 챔피언의 이름은 무엇인가요?',
             'choices':None,'answer':c['name'],'answerAliases':[cid],
             'explanation':expl,'imageUrl':IMG.format(c['image']['full']),
             'topicIds':['game','lol'],'status':'approved','source':'manual'}
        if d == 3: q['seedRef'] = SRC
        add(d, q)
    for body, ans, expl in NUM[d]:
        q = {'type':'NUMERIC_INPUT','difficulty':d,'body':body,'choices':None,
             'answer':ans,'explanation':expl,
             'topicIds':['game','lol'],'status':'approved','source':'manual'}
        add(d, q)

doc = {"$comment":"리그오브레전드 주제. 한글 챔피언명과 별명은 Data Dragon의 공식 ko_KR 데이터에서 그대로 가져왔다. 이미지는 공식 챔피언 초상. ⚠ 수치 문항은 패치와 무관한 고정 구조만 쓴다 — 능력치·쿨다운·아이템 가격을 넣으면 패치마다 틀린 문항이 된다. 재생성: scripts/gamedata/gen_lol.py",
       "questions": out}
p='../../data/questions/lol.json'
json.dump(doc, open(p,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
open(p,'a',encoding='utf-8').write('\n')
from collections import Counter
c = Counter((q['difficulty'], q['type']) for q in out)
print('총', len(out))
for d in (1,2,3,4): print(f"  d{d}: TEXT {c[(d,'TEXT_INPUT')]} / NUM {c[(d,'NUMERIC_INPUT')]}")
