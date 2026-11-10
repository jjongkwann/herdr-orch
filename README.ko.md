# herdr-orch

[English](README.md) | 한국어

[herdr](https://herdr.dev) 탭 하나를 코딩 에이전트 여러 개가 함께 일하는 팀으로 바꾸는 에이전트 스킬입니다. 스킬을 시작한 pane이 오케스트레이터가 됩니다. 오케스트레이터는 작업에 필요한 만큼 옆에 워커 pane을 열고, 각 워커에게 작업을 지시하고, 폴링 없이 결과를 기다리고, 작업이 끝나면 pane을 닫습니다. herdr에서는 오케스트레이터 옆의 워커 pane으로, herdr-app에서는 오케스트레이터 터미널의 자식인 숨겨진 hc 터미널로 워커를 실행합니다.

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

이 스킬은 `hc` 명령으로 herdr-app도 지원합니다. `HC_TERMINAL_ID`가 설정되어 있으면 `orch.mjs` 대신 [hc 절차](skills/herdr-orch/references/herdr-core.md)를 따릅니다. 백그라운드 대화형 워커, 보고서 파일, 블로킹 대기를 쓰고, 정리는 자신이 만든 워커로 한정합니다. 워커는 보여 달라고 하지 않는 한 숨겨진 채로 실행되며, 기존 pane 그리드와 `ORCH_MIN_PANE`은 적용되지 않습니다. 설치된 API는 런타임 매뉴얼(`hc --skill`, `herdr-app --skill`)이 정의합니다.

`hc`와 herdr-app이 필요합니다. Node.js는 구 herdr용 헬퍼와 `orch.mjs setup`에만 필요합니다.

- **역할 템플릿:** `skills/herdr-orch/templates/orch-<role>.md`에 reviewer, implementer, researcher, debugger 템플릿이 하나씩 들어 있습니다. `hc templates`에 없으면 에이전트가 `~/.config/herdr-core/templates`에 설치할지 묻고, `{{SKILL}}`은 스킬 디렉터리로, `{{PATH}}`는 `claude`와 `hc`가 있는 폴더 뒤에 시스템 폴더(`/usr/bin:/bin:/usr/sbin:/sbin`)를 이어 붙인 값으로 바꿉니다. 템플릿이 없으면 워커를 직접 실행합니다.
- **실행 라벨:** 각 워커는 `orch.run`, `orch.report` 라벨과, worktree가 있으면 `orch.worktree` 라벨을 달고 시작합니다. 오케스트레이터의 컨텍스트가 압축된 뒤에는 `hc ls --all --label orch.run=<id>`로 그 실행의 워커를 찾습니다.
- **다른 머신:** `--on <machine>`으로 다른 머신에서 워커를 시작합니다. 워커는 그 머신에 보고서를 쓰고, 오케스트레이터는 `hc file read --on <machine> <path>`로 읽습니다.
- **작업(task):** 자체 카드와 Accept 단계가 있는 추적 작업으로 맡기려는 일은 `herdr-task`의 몫입니다. herdr-orch는 세션이 이미 하고 있는 작업의 일부를 위임합니다.

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

에이전트는 한 줄짜리 설명을 보고 스킬을 고르는데, 대개 내장 서브에이전트가 선택됩니다. 그래서 스킬을 처음 실행하면 에이전트가 전역 지침(`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`)에 규칙 한 줄을 추가할지 묻습니다. herdr와 herdr-app(`HERDR_ENV=1` 또는 `HC_TERMINAL_ID`) 안에서는 요청이 없어도 herdr-orch를 쓰라는 규칙입니다. 동의하지 않으면 아무것도 쓰지 않고, 거절한 것을 기억합니다. `orch.mjs setup`은 두 런타임 모두에서 동작하고, `setup add <file>`은 그 파일에 herdr만 언급하는 이전 문구의 규칙이 있으면 현재 문구로 바꿉니다. 규칙을 직접 추가하려면 에이전트가 읽는 파일을 지정해 `node <skill directory>/scripts/orch.mjs setup add ~/.codex/AGENTS.md`를 실행하세요.

## 사용법

1. herdr에서 새 탭을 열고 에이전트를 시작합니다.
2. 작업을 요청합니다. Claude Code에서는 예를 들어 `/herdr-orch 회원가입 API에 입력 검증을 추가하고 다른 워커에게 diff를 리뷰받아 줘`, 다른 에이전트에서는 "herdr-orch 스킬을 사용해서 ..."처럼 요청합니다.

herdr 안에서는 작업에 독립적인 부분이 있거나 코드 변경에 두 번째 리뷰어가 필요할 때, 요청하지 않아도 에이전트가 이 스킬을 씁니다. 워커는 `references/roles/`에 있는 역할 reviewer, implementer, researcher, debugger 중 하나로 지시를 받습니다. 작업은 역할이 아니라 컨텍스트를 기준으로 나누고, 계획은 오케스트레이터가 직접 세웁니다. 어떤 에이전트를 얼마나 아껴 쓸지에 대한 사용자 지침이 우선합니다.

`--role`로 띄우면 워커는 역할 파일이 정한 모델과 reasoning effort로 시작합니다. reviewer와 debugger는 Opus `high`, researcher는 Opus `medium`, implementer는 Sonnet `medium`입니다. implementer는 완성된 지시를 받아 일하고 결과를 reviewer가 다시 보기 때문입니다. 모델은 Claude Code 별칭이므로 다른 에이전트는 설정된 모델을 그대로 쓰고 effort만 받습니다. `spawn --model`과 `--effort`는 역할 값을 덮어씁니다. 설계 판단이 필요하거나 마이그레이션, 성능 최적화인 부분을 맡는 implementer는 Opus로 시작합니다. 막히거나 리뷰에 두 번 실패한 워커는 먼저 스스로 검증할 수단을 받고, 그다음 effort를 한 단계 올리고, 그래도 안 되면 한 단계 큰 모델을 effort 한 단계 낮춰 씁니다. effort는 `high`를 넘기지 않습니다. Opus `high`로 부족하면 다음은 Fable `medium`입니다. `orch`는 이 값을 종류별 형식으로 넘깁니다. Claude Code와 Antigravity에는 `--effort`, Codex에는 `-c model_reasoning_effort=`입니다. 선호하는 설정은 에이전트 지침에 적으세요. 예: "herdr-orch implementer는 Opus로 실행해." Claude Code는 모델이 지원하지 않는 단계를 받으면 지원하는 가장 높은 단계로 실행합니다. Codex에서는 그 단계를 지원하는 모델을 쓰세요.

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

## 작업 지시, 리뷰, 증거

구 herdr와 herdr-app 모두에서 오케스트레이터 쪽 규칙은 `references/workflow.md`에, 워커 쪽 규칙은 `references/worker.md`에 있습니다.

- 모든 작업 지시는 Settings 블록으로 끝납니다. 역할, 범위, 기준 커밋, `Review: on, 2 rounds, must fix: major`, `Proof: required`, 커밋 여부, 완료 조건을 적습니다.
- 리뷰어는 지적마다 등급(blocker, major, minor)과 근거를 달고, 리뷰한 커밋을 적습니다. must-fix 기준 이상의 지적은 같은 구현 워커에게 돌려보냅니다. 기준 이상의 지적이 없는 라운드가 나오거나 횟수를 다 쓰면 멈추고, 리뷰를 거친 최종 커밋만 받아들입니다. 구현 워커가 반박한 지적은 근거를 보고 판단해 보고하며, 루프를 끝내려고 버리지 않습니다.
- 보고서는 상태, 바뀐 파일, 최종 커밋, 160자 이내의 쉬운 요약으로 시작하고, 그 아래에 세부 내용, 증거, 확인하지 못한 것, 후속 과제, 저장소 `AGENTS.md`에 넣을 메모를 둡니다. 버그 수정은 같은 재현 방법이 고치기 전에는 실패하고 고친 뒤에는 통과하는 것을 보여야 하며, mock 테스트는 사람이 보는 동작의 증거가 되지 않습니다.
- 결정이 필요한 워커는 CLI의 질문 도구로 묻고, 오케스트레이터가 그 질문을 사용자에게 전한 뒤 고른 답으로 대답합니다.
- herdr-app에서는 워커가 자기 터미널에 `orch.status`와 `orch.done` 라벨을 달고, `hc get`으로 볼 수 있습니다.
- 오케스트레이터는 워커를 띄우기 전마다 남은 메모리를 확인합니다. `orch spawn`은 15% 미만이면 거부합니다.

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
| `ORCH_MIN_FREE_MEM` | `15` | 새 워커를 띄우는 데 필요한 남은 메모리 비율(%) |
| `XDG_STATE_HOME` | `~/.local/state` (Windows는 `%LOCALAPPDATA%`) | `herdr-orch/`가 슬롯 상태, journal, 교훈, 보고서를 저장하는 위치 |

오케스트레이터가 선호할 에이전트는 에이전트 지침(예: `AGENTS.md`)에 적으세요. 예: "herdr-orch로 오케스트레이션할 때는 기본으로 Claude Code 워커를 쓰고, Codex는 요청할 때만 써."

## 상태

macOS에서 herdr 0.9.5로 테스트했습니다. Claude Code는 오케스트레이터와 워커 모두 전체 흐름을, Codex와 Antigravity CLI 워커는 시작과 종료를 확인했습니다. 스크립트는 셸 전용 명령을 피하므로 Windows와 Linux에서도 실행할 수 있게 작성했지만, 이 플랫폼들에서는 아직 전체 흐름을 테스트하지 않았습니다.

hc 절차는 2026-11-10에 macOS에서 hc 0.1.19, herdr-app 0.1.14로 전체 흐름을 실행했습니다. Claude Code가 오케스트레이터였고, 같은 머신에서 Claude Code, Codex, Antigravity 워커를, `--on`으로 두 번째 Mac과 Windows에서 Claude Code 워커를 실행했으며, 워커의 질문에는 `hc keys`로 답했습니다.

## 라이선스

MIT
