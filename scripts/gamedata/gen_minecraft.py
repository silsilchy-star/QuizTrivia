import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
import json

TEX = "https://raw.githubusercontent.com/misode/mcmeta/assets/assets/minecraft/textures/{}/{}.png"
LANG = "https://raw.githubusercontent.com/misode/mcmeta/assets/assets/minecraft/lang/ko_kr.json"

ko = json.load(open('mc_ko.json', encoding='utf-8'))
comp = json.load(open('mc_components.json', encoding='utf-8'))
where = dict(l.strip().split(':') for l in open('texok.txt'))

def name(n):  return ko.get('item.minecraft.' + n) or ko.get('block.minecraft.' + n)
def stack(n): return (comp.get(n) or {}).get('minecraft:max_stack_size')
def url(n):   return TEX.format(where[n], n)

TEXT = {
 1: ['apple','bread','coal','stick','iron_ingot','bucket','bow','arrow','wheat','torch',
     'dirt','cobblestone','sand','gravel','oak_planks'],
 2: ['diamond','gold_ingot','redstone','emerald','obsidian','blaze_rod','slime_ball','gunpowder',
     'string','feather','leather','flint','bone','bookshelf','netherrack'],
 3: ['raw_iron','raw_gold','raw_copper','copper_ingot','amethyst_shard','echo_shard','netherite_scrap',
     'deepslate','tuff','calcite','dripstone_block','moss_block','mud','glow_ink_sac','ink_sac'],
 4: ['prismarine_shard','prismarine_crystals','nautilus_shell','heart_of_the_sea','phantom_membrane',
     'shulker_shell','ghast_tear','dragon_breath','breeze_rod','heavy_core','trial_key','ominous_bottle',
     'sea_lantern','purpur_block','end_stone'],
}
NUM = {1:['egg','snowball','glowstone','sugar','clay_ball'],
       2:['ender_pearl','honey_bottle','magma_cream','blaze_powder','gold_nugget'],
       3:['netherite_ingot','fermented_spider_eye','budding_amethyst','sculk','turtle_scute'],
       4:['elytra','trident','totem_of_undying','mace','crying_obsidian']}

# d3는 "왜 헷갈리는지"를 사람이 적는다. ⚠ 버전 번호는 적지 않는다 — 확인 못 한 수치를
#    쓰면 sports d3처럼 사실 검수 부채가 쌓인다. 생김새가 비슷하다는 것만 말한다.
SIMILAR = {
 'raw_iron':'가공하지 않은 금·구리와 덩어리 모양이 거의 같아 색으로만 구분됩니다.',
 'raw_gold':'가공하지 않은 철·구리와 덩어리 모양이 거의 같아 색으로만 구분됩니다.',
 'raw_copper':'가공하지 않은 철·금과 덩어리 모양이 거의 같아 색으로만 구분됩니다.',
 'copper_ingot':'철 주괴·금 주괴와 모양이 같아 색으로만 구분됩니다.',
 'amethyst_shard':'조각 모양 아이템이 여럿이라 다른 파편류와 헷갈리기 쉽습니다.',
 'echo_shard':'자수정 조각과 생김새가 비슷해 자주 혼동됩니다.',
 'netherite_scrap':'네더라이트 주괴와 이름이 비슷하지만 다른 아이템입니다.',
 'deepslate':'석재·응회암·방해석과 모두 회색 계열이라 구분이 어렵습니다.',
 'tuff':'심층암·방해석과 색이 비슷해 헷갈립니다.',
 'calcite':'응회암·심층암과 함께 정동 주변에서 나와 서로 헷갈립니다.',
 'dripstone_block':'거친 돌 계열과 표면이 비슷해 보입니다.',
 'moss_block':'잔디 블록과 초록색이라 멀리서 보면 구분이 어렵습니다.',
 'mud':'흙·점토와 색이 비슷해 헷갈립니다.',
 'glow_ink_sac':'먹물 주머니와 모양이 같고 색만 다릅니다.',
 'ink_sac':'발광 먹물 주머니와 모양이 같고 색만 다릅니다.',
 'turtle_scute':'조각·비늘류 아이템이 여럿이라 이름을 헷갈리기 쉽습니다.',
 'netherite_ingot':'네더라이트 조각과 이름이 비슷하지만 다른 아이템입니다.',
 'budding_amethyst':'자수정 블록과 겉모습이 거의 같습니다.',
 'sculk':'스컬크 계열 블록이 여럿이라 서로 헷갈립니다.',
 'fermented_spider_eye':'거미 눈과 색만 다르고 모양이 같습니다.',
}

out, seq = [], {1:0,2:0,3:0,4:0}
def add(d, q):
    seq[d] += 1
    out.append({'id': f"mcr-{d}{seq[d]:02d}", **q})

for d in (1,2,3,4):
    for n in TEXT[d]:
        ko_name = name(n)
        expl = f"{ko_name}(`{n}`)입니다."
        if d == 3 and n in SIMILAR: expl = f"{SIMILAR[n]} {expl}"
        q = {'type':'TEXT_INPUT','difficulty':d,
             'body':'그림 속 마인크래프트 블록 또는 아이템의 이름은 무엇인가요?',
             'choices':None,'answer':ko_name,'answerAliases':[n.replace('_',' ')],
             'explanation':expl,'imageUrl':url(n),
             'topicIds':['game','minecraft'],'status':'approved','source':'manual'}
        if d == 3: q['seedRef'] = LANG
        add(d, q)
    for n in NUM[d]:
        ko_name, s = name(n), stack(n)
        assert s is not None, n
        expl = f"{ko_name}은(는) 한 칸에 {s}개까지 겹쳐 놓입니다."
        if d == 3 and n in SIMILAR: expl = f"{SIMILAR[n]} {expl}"
        q = {'type':'NUMERIC_INPUT','difficulty':d,
             'body':'그림 속 아이템은 한 칸에 몇 개까지 겹쳐 놓을 수 있나요?',
             'choices':None,'answer':str(s),
             'explanation':expl,'imageUrl':url(n),
             'topicIds':['game','minecraft'],'status':'approved','source':'manual'}
        if d == 3: q['seedRef'] = LANG
        add(d, q)

doc = {"$comment":"마인크래프트 주제. 한글 이름은 misode/mcmeta의 공식 ko_kr 번역, 최대 스택 수는 item_components 데이터에서 그대로 가져왔다. 이미지는 자바 에디션 기본 텍스처. ⚠ 버전 번호는 일부러 쓰지 않았다 — 확인하지 못한 수치를 적으면 사실 검수 부채가 된다. 재생성: scripts/gamedata/gen_minecraft.py",
       "questions": out}
p='../../data/questions/minecraft.json'
json.dump(doc, open(p,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
open(p,'a',encoding='utf-8').write('\n')
from collections import Counter
c = Counter((q['difficulty'], q['type']) for q in out)
print('총', len(out))
for d in (1,2,3,4): print(f"  d{d}: TEXT {c[(d,'TEXT_INPUT')]} / NUM {c[(d,'NUMERIC_INPUT')]}")
n = sum(1 for q in out if q['type']=='NUMERIC_INPUT'); print(f"NUMERIC {n/len(out)*100:.1f}%")
