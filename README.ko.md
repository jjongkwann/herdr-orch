# herdr-orch

[English](README.md) | 한국어

[herdr](https://herdr.dev) 탭 하나를 코딩 에이전트 여러 개가 함께 일하는 팀으로 바꾸는 에이전트 스킬입니다. 스킬을 시작한 pane이 오케스트레이터가 됩니다. 오케스트레이터는 작업에 필요한 만큼 옆에 워커 pane을 열고, 각 워커에게 작업을 지시하고, 폴링 없이 결과를 기다리고, 작업이 끝나면 pane을 닫습니다.

```
┌──────────────┬──────────────┬──────────────┐
│ orchestrator │ worker       │ worker       │
├──────────────┼──────────────┼──────────────┤
│ worker       │ worker       │ worker       │
└──────────────┴──────────────┴──────────────┘
```

그리드는 탭 크기를 따릅니다. 모든 pane이 최소 80x24 셀을 유지하므로 노트북 화면에는 2x2, 넓은 모니터에는 2x3 그리드가 들어갈 수 있습니다. 레이아웃은 워커를 열 때마다 다시 계산하며, 터미널 크기가 바뀐 뒤에도 마찬가지입니다. herdr 서버를 보여 주는 터미널이 없으면(detach했거나 herdr 클라이언트가 다른 머신을 보여 줄 때) herdr는 모든 탭에 더 작은 대체 크기를 보고합니다. 이때 orch는 워커를 만들 때의 크기를 기준으로 계획하므로, 터미널이 그 탭을 다시 보여 주면 그리드가 제대로 맞습니다.

워커는 herdr가 인식하는 어떤 에이전트 종류든 될 수 있습니다. Claude Code, Codex, Gemini CLI, Antigravity CLI, OpenCode 등이 있고, 한 탭에서 여러 종류를 섞어 쓸 수 있습니다.

## herdr-app / herdr-core

이 스킬은 `hc` 명령으로 herdr-app도 지원합니다. `HC_TERMINAL_ID`가 설정되어 있으면 `orch.mjs` 대신 [hc 절차](skills/herdr-orch/references/herdr-core.md)를 따릅니다. 백그라운드 대화형 워커, 보고서 파일, 블로킹 대기를 쓰고, 정리는 자신이 만든 워커로 한정합니다. 워커는 보여 달라고 하지 않는 한 숨겨진 채로 실행되며, 기존 pane 그리드와 `ORCH_MIN_PANE`은 적용되지 않습니다. 설치된 API는 런타임 매뉴얼(`hc --skill`, `herdr-app --skill`)이 정의합니다. Node.js는 구 herdr용 헬퍼에만 필요합니다.

에이전트 하네스가 명령 환경에 `HC_TERMINAL_ID`를 넘기지 않으면, Herdr에서 정확한 터미널 주소를 확인한 뒤 직접 지정하세요. 이 스킬은 포커스된 pane을 세션 식별 대신 쓰지 않습니다. Codex 세션은 명령이 hc 컨텍스트를 유지하도록 `--no-daemon`으로 시작해야 합니다.

## 요구 사항 (구 herdr)

- herdr 0.9.5 이상, 그리고 사용할 에이전트
- Node.js 18 이상
- 스킬을 지원하는 에이전트 (Claude Code, Codex, Cursor, Gemini CLI 등)

## 설치

```bash
npx skills add jjongkwann/herdr-orch
```

현재 프로젝트 대신 사용자 전체에 설치하려면 `-g`를, 설치할 에이전트를 고르려면 `-a <agent>`를 붙이세요.

에이전트는 한 줄짜리 설명을 보고 스킬을 고르는데, 대개 내장 서브에이전트가 선택됩니다. 그래서 스킬을 처음 실행하면 에이전트가 전역 지침(`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`)에 규칙 한 줄을 추가할지 묻습니다. herdr 안에서는 요청이 없어도 herdr-orch를 쓰라는 규칙입니다. 동의하지 않으면 아무것도 쓰지 않고, 거절한 것을 기억합니다. 규칙을 직접 추가하려면 에이전트가 읽는 파일을 지정해 `node <skill directory>/scripts/orch.mjs setup add ~/.codex/AGENTS.md`를 실행하세요.

## 사용법

1. herdr에서 새 탭을 열고 에이전트를 시작합니다.
2. 작업을 요청합니다. Claude Code에서는 예를 들어 `/herdr-orch 회원가입 API에 입력 검증을 추가하고 다른 워커에게 diff를 리뷰받아 줘`, 다른 에이전트에서는 "herdr-orch 스킬을 사용해서 ..."처럼 요청합니다.

herdr 안에서는 작업에 독립적인 부분이 있거나 코드 변경에 두 번째 리뷰어가 필요할 때, 요청하지 않아도 에이전트가 이 스킬을 씁니다. 워커는 `references/roles/`에 있는 역할 reviewer, implementer, researcher, debugger 중 하나로 지시를 받습니다. 작업은 역할이 아니라 컨텍스트를 기준으로 나누고, 계획은 오케스트레이터가 직접 세웁니다. 어떤 에이전트를 얼마나 아껴 쓸지에 대한 사용자 지침이 우선합니다.

`--role`로 띄우면 reviewer와 debugger는 역할 파일이 정한 기본값인 `xhigh` reasoning effort로 시작합니다. 다른 역할은 각 에이전트에 설정된 effort를 그대로 쓰고, 모델을 정하는 역할은 없습니다. `spawn --model`과 `--effort`는 이 둘을 모두 덮어쓰며, `orch`는 종류별 형식으로 넘깁니다. Claude Code와 Antigravity에는 `--effort`, Codex에는 `-c model_reasoning_effort=`입니다. 선호하는 설정은 에이전트 지침에 적으세요. 예: "herdr-orch reviewer는 Opus로 실행해." Claude Code는 모델이 지원하지 않는 단계를 받으면 지원하는 가장 높은 단계로 실행합니다. Codex에서는 그 단계를 지원하는 모델을 쓰세요.

오케스트레이터는 `scripts/orch.mjs`를 호출하며, herdr pane에서 직접 실행할 수도 있습니다.

```
node scripts/orch.mjs spawn <name> <kind> [--cwd DIR] [--worktree [--base REF]] [--mcp] [--role ROLE] [--model MODEL] [--effort LEVEL] [-- agent args]
node scripts/orch.mjs send <name> "<prompt>"
node scripts/orch.mjs wait [<name>...] [--any] [--timeout SEC]
node scripts/orch.mjs ask <name> "<prompt>"
node scripts/orch.mjs ls
node scripts/orch.mjs worktrees [--clean] [--base REF]
node scripts/orch.mjs log [--lines N]
node scripts/orch.mjs lessons
node scripts/orch.mjs setup [add <file> | decline]
node scripts/orch.mjs stop <name>... | --all
node scripts/orch.mjs close [--force]
```

파일을 병렬로 수정하는 워커는 각자 git worktree를 받습니다. `spawn --worktree`는 새 브랜치 `<name>`으로 `../<repo>-<name>`을 만들고 그곳에서 워커를 시작합니다. 오케스트레이터가 브랜치를 병합한 뒤 `worktrees --clean`을 실행하면, 완전히 병합되어 더 이상 쓰지 않는 worktree를 지우고 그 브랜치도 삭제합니다. 커밋하지 않은 변경이나 병합되지 않은 커밋이 있는 것은 남겨 두고, `orch`가 만들지 않은 worktree는 건드리지 않습니다.

`orch`는 탭마다 journal을 남깁니다. 각 spawn과 그때 에이전트가 받은 인자, 그리고 각 prompt, result, stop, close를 기록합니다. `log`는 journal에서 현재 실행을 출력하고, 마지막 프롬프트가 아직 끝나지 않은 워커도 함께 보여 줍니다. 보고서를 아직 읽지 않았는지, 아직 작업 중인지, 보고서 없이 종료했는지가 표시됩니다. 오케스트레이터는 컨텍스트가 압축되거나 재시작된 뒤 이 명령을 실행합니다. `wait`는 워커가 승인이나 질문에서 멈춘 것을 보면 herdr 알림을 띄웁니다.

`lessons`는 교훈을 담은 Markdown 파일 두 개를 출력합니다. 하나는 현재 프로젝트용(git remote 기준)이고 다른 하나는 모든 프로젝트용입니다. 오케스트레이터는 첫 워커를 열기 전에 이 파일들을 읽고, 마지막 `close` 전에 journal을 보고 갱신합니다. 각 교훈에는 trigger, action, confidence와 근거가 있습니다. 예: "Codex 워커는 새 worktree에서 trust 프롬프트에 멈춘다."

## 토큰 사용을 줄이는 방법

- `wait`는 herdr의 에이전트 상태를 기다리며 블록하므로, 워커가 일하는 동안 오케스트레이터는 토큰을 쓰지 않습니다. Claude Code는 이 명령을 백그라운드에서 실행하고 끝나면 알림을 받습니다.
- 각 워커는 전체 결과를 보고서 파일에 씁니다. 오케스트레이터는 앞의 몇 줄만 읽고, 워커 사이에는 내용 대신 경로를 넘깁니다.
- pane 레이아웃, ID, JSON은 오케스트레이터의 컨텍스트가 아니라 스크립트 안에서 처리됩니다.
- Claude Code 워커는 `--mcp`를 주지 않으면 MCP 서버 없이 시작하므로, 시작 컨텍스트와 메모리 사용이 작습니다.
- 같은 영역의 후속 작업에는 워커를 재사용하고, 그 영역의 작업이 끝나면 멈춥니다. `ls`와 `wait`는 각 Claude Code 워커가 가진 컨텍스트 토큰 수를 세션 기록에서 읽어 보여 주므로, 오케스트레이터는 컨텍스트가 커진 워커를 교체할 수 있습니다.

## 설정

| 변수 | 기본값 | 의미 |
|---|---|---|
| `ORCH_MIN_PANE` | `80x24` | 가장 작은 pane 크기(열 x 행). 탭에 들어갈 pane 수를 정합니다 |
| `ORCH_MAX_WORKERS` | `5` | 탭 크기와 관계없는 워커 수 상한 |
| `XDG_STATE_HOME` | `~/.local/state` (Windows는 `%LOCALAPPDATA%`) | `herdr-orch/`가 슬롯 상태, journal, 교훈, 보고서를 저장하는 위치 |

오케스트레이터가 선호할 에이전트는 에이전트 지침(예: `AGENTS.md`)에 적으세요. 예: "herdr-orch로 오케스트레이션할 때는 기본으로 Claude Code 워커를 쓰고, Codex는 요청할 때만 써."

## 상태

macOS에서 herdr 0.9.5로 테스트했습니다. Claude Code는 오케스트레이터와 워커 모두 전체 흐름을, Codex와 Antigravity CLI 워커는 시작과 종료를 확인했습니다. 스크립트는 셸 전용 명령을 피하므로 Windows와 Linux에서도 실행할 수 있게 작성했지만, 이 플랫폼들에서는 아직 전체 흐름을 테스트하지 않았습니다.

## 라이선스

MIT
