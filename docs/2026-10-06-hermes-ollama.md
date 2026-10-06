# Hermes Agent + 로컬 Ollama 연결

[Hermes Agent](https://github.com/NousResearch/hermes-agent)(Nous Research의 오픈소스 에이전트)를
로컬 Ollama 모델로 돌려 이 저장소에서 작업하게 하는 설정. API 비용이 없고 코드가 밖으로 나가지 않는다.

연결 자체는 **내 컴퓨터 설정**(`~/.hermes/config.yaml`)이고, 저장소에는 Hermes가 읽을
프로젝트 지침 `.hermes.md`만 둔다. Hermes는 git 루트까지 올라가며 `.hermes.md`를 찾아
`AGENTS.md`·`CLAUDE.md`보다 먼저 쓴다.

## 1. Ollama + 모델

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull gemma4:31b          # 도구 호출(tool calling) 되는 모델이어야 파일 수정·명령 실행이 된다
```

Hermes는 **컨텍스트 64K 이상**을 요구하는데 Ollama 기본값은 훨씬 작다. 둘 중 하나:

```bash
# (a) 서버 전체에 적용
OLLAMA_CONTEXT_LENGTH=64000 ollama serve

# (b) 64K 전용 모델 만들기
printf 'FROM gemma4:31b\nPARAMETER num_ctx 64000\n' > Modelfile
ollama create gemma4-64k -f Modelfile
```

## 2. Hermes 설치 · 연결

설치는 Hermes 공식 문서(Quickstart)를 따른다. 그다음:

```bash
hermes setup
#   Provider: Custom Endpoint
#   Base URL: http://localhost:11434/v1
#   API Key : 비워 두거나 no-key
#   Model   : gemma4-64k   (1-(b)를 했으면. 아니면 gemma4:31b)
```

또는 `~/.hermes/config.yaml`을 직접:

```yaml
model:
  default: "gemma4-64k"
  provider: "custom"
  base_url: "http://localhost:11434/v1"
```

CPU만 있으면 응답이 느리니 `~/.hermes/.env`에 `HERMES_API_TIMEOUT=1800`.

## 3. 이 저장소에서 실행

```bash
cd QuizTrivia
hermes
```

확인: "이 프로젝트에서 하면 안 되는 것 세 가지를 말해줘" → `main` push 금지, 배포·remote D1 명령 금지,
문항 승인 금지가 나오면 `.hermes.md`가 로드된 것이다.

예시 요청:

- `npm run generate:ollama -- --topic=geography --difficulty=2 --count=10 --model=gemma4-64k 를 돌리고 validate 결과를 정리해줘`
- `data/questions/science.json의 pending 문항 중 정답이 본문에 섞인 게 있는지 봐줘`

## 주의

- **`main` push = 프로덕션 배포.** `.hermes.md`에 금지로 적었지만 로컬 모델은 지침을 놓칠 수 있다.
  Hermes의 명령 승인 프롬프트를 끄지 말고, `git push`·`wrangler` 명령은 직접 보고 승인할 것.
- 문항 생성 스크립트(`generate:ollama`)는 Hermes와 별개로 Ollama 네이티브 API(`/api/chat`)를 쓴다.
  같은 모델을 쓰려면 `--model=` 또는 `OLLAMA_MODEL`을 맞춘다.

## 문제 해결

**`Model 'tencent/hy3:free' was not found in this provider's model listing`**
(데스크톱 앱: "Connected, but Hermes still cannot resolve a usable provider")

Ollama가 아니라 **Nous Portal**(`provider: nous`)에 연결된 상태이고, 기본 모델로 잡힌 무료 변형
`tencent/hy3:free`가 Portal 목록에서 빠져서 나는 오류다. Ollama와는 무관하다.

- Ollama로 바꾸기: 오류 창의 **Pick a different provider** → **self-hosted**(Local / custom endpoint)
  → URL `http://localhost:11434/v1`, 키는 비움, 모델은 `ollama list`에 나오는 이름.
  설정 화면에서는 **Settings → Providers → Custom Endpoints**.
- 터미널: `hermes model`로 고르거나 `~/.hermes/config.yaml`의 `model:` 블록을 위 2절처럼 바꾼다.
- Nous Portal을 계속 쓰려면 모델만 목록에 있는 것(`tencent/hy3` 등)으로 바꾼다 — 유료일 수 있다.
