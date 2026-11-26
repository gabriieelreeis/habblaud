# Modelo e esforço na gaveta do agente

A seção **Modelo e esforço** da gaveta mostra o modelo e o esforço (nível de raciocínio) de cada sessão principal do
Claude Code e do OpenCode e deixa trocar os dois pelo escritório, com a situação da troca na hora (enviando, entregue,
confirmado ou o erro). Funciona no celular pela mesma trava das mensagens (`HABBLAUD_REMOTE_ALLOW` com `messages`).
O Codex e os subagentes não têm a seção.

## O que aparece

| Linha | Claude Code | OpenCode |
| --- | --- | --- |
| Modelo | `AgentInfo.model` (modelo da última resposta) e, se for outro, `AgentInfo.modelChoice` ("próximas: …") | o modelo escolhido na sessão (`modelChoice`), senão o da última resposta |
| Esforço / Raciocínio | `AgentInfo.effort` com a origem | `effort` = o `variant` escolhido junto com o modelo |

Origem do esforço no Claude Code (`server/claude-defaults/defaults.ts`, `sessionEffort`), nesta ordem:

1. `command`: a saída do `/effort` gravada na conversa **depois** da abertura do processo
   (`<local-command-stdout>Set effort level to <nível> …`; também `Current effort level: …`, `Effort level set to auto`
   e o "exceeds the cap … set to '<nível>'"). O parser é `commandOutputOf` em `server/sources/transcript.ts`. Um
   `/effort` de antes de uma retomada não vale.
2. `flag`: o `--effort` das sessões em segundo plano, lido de `<conta>/jobs/<jobId>/state.json` (`respawnFlags`).
   O `jobId` vem do registro `<conta>/sessions/<pid>.json`.
3. `settings`: o padrão do `<conta>/settings.json` (`modelSettings[<modelo>].effortLevel`, senão `effortLevel`).
   Mostrado como "provável": `CLAUDE_CODE_EFFORT_LEVEL` ou um agente com `effort` podem mudar.
4. Nada disso: "não informado".

## Como a troca funciona

`POST /api/controls {agentId, kind: 'effort' | 'model', value, variant?, asDefault?}` (`server/controls/`), situação em
`GET /api/controls/:id`, modelos do OpenCode em `GET /api/controls/models?agentId=`. A trava é a das mensagens
(`server/http/app.ts`, `isMessagesPath`).

### Claude Code

1. Sem `asDefault`, o servidor guarda o padrão de agora (só `model`, `effortLevel` e `modelSettings.*.effortLevel`).
2. Põe `/effort <nível>` ou `/model <modelo>` na fila de mensagens; o plugin `habblaud-mensagens` (sem mudança, 1.0.5)
   roda com `$.command.run`.
3. A confirmação é a saída do comando na conversa com hora depois do envio (`AgentInfo.effort.source === 'command'` ou
   `AgentInfo.modelChoice`). Prazo: 30 min (a sessão pode estar no meio de um turno).
4. Confirmado, devolve ao `settings.json` só o que o comando mudou (`restoreText`): no esforço, cada nível igual ao
   enviado (ou apagado, no `auto`) que antes era outro; no modelo, o `model`. O resto do arquivo não muda (mesmos
   bytes quando nada mais mudou). Duas trocas do mesmo tipo na mesma conta usam o retrato de antes da primeira.

Por que restaurar: no Claude Code 2.1.332, `/effort` e `/model` numa sessão interativa sempre gravam o padrão das
sessões novas ("saved as your default for new sessions"); não há opção "só esta sessão" no comando (só no seletor
interativo). Foi assim que um `/effort xhigh` de uma sessão virou o padrão de todo o Opus em 25/11.

**Trava do `/model`:** com a conversa em cache (até 1 h depois da última resposta), o Claude Code abre uma confirmação
na tela da sessão ("Switch model? … the full history gets re-read") e a sessão fica parada até alguém responder. Pelo
escritório ninguém vê essa tela. Por isso `/model` é recusado até 1 h depois da última resposta desta abertura
(`AgentInfo.replyAt`, `MODEL_SWITCH_LOCK_MS` em `shared/messages.ts`) e a gaveta mostra a hora em que libera. Sessão
sem resposta ainda (aberta agora) troca na hora. O esforço não abre essa tela nos modelos atuais e troca a qualquer
momento.

**Não mande `/effort` ou `/model` sem argumento** pela caixa de mensagem: os dois abrem um seletor na tela da sessão,
que também a deixa parada (o escritório mostra "Precisa de você: fechar um diálogo aberto"). A gaveta nunca manda os
comandos sem argumento.

### Docker

O contêiner só monta `projects/` e `sessions/` das contas: não enxerga `settings.json` nem `jobs/`. Quem lê e devolve o
padrão é o auxiliar do host (`npm run codex:bridge`, `claudeRound` em `scripts/codex-bridge.ts`):
`POST /api/host/claude/poll?wait=1` entrega `{requests: [{op: 'read', configDir, jobs} | {op: 'restore', …}]}` e
`POST /api/host/claude/ack` devolve o resultado. Só pastas de conta que o próprio auxiliar descobre são aceitas, e só
saem o modelo e o esforço (`parseDefaults`). Sem o auxiliar, a troca só na sessão é recusada com o motivo; marcando
**Também como padrão das sessões novas** ela vai assim mesmo. O auxiliar precisa ser reiniciado para pegar este
código.

### OpenCode

Nesta versão do serviço o prompt não aceita modelo (corpo com `additionalProperties: false`). A troca usa
`POST /api/session/<id>/model {model: {id, providerID, variant?}}`, que vale para os próximos turnos e o próprio
OpenCode guarda (mensagem `model-switched`, evento `session.model.selected`). A lista vem de `GET /api/model` (e os
nomes dos provedores de `GET /api/provider`), guardada 5 min; para a página só vão id, nome, provedor e os níveis
(`modelOptionOf`), nunca cabeçalhos ou configuração. `variant: "default"` = nenhum nível. Modelo sem níveis (o Big
Pickle) deixa o seletor de raciocínio desativado com o motivo. Nada de padrão é mexido.

## Arquivos

- `shared/types.ts`: `AgentEffort`, `ModelChoice`, `ControlState`, `ModelOption`; `AgentInfo.effort`, `modelChoice`,
  `replyAt`.
- `server/sources/transcript.ts`: `commandOutputOf`, `effortCmd`, `modelCmd`, `modelAt`; `/effort` virou comando local
  (não é mais "Nova tarefa").
- `server/sources/watcher.ts`: monta `effort`, `modelChoice` e `replyAt` no resumo; reaplica quando os padrões mudam.
- `server/sources/registry.ts`: lê o `jobId`.
- `server/claude-defaults/`: leitura e restauração (`defaults.ts`) e o serviço com o modo direto e o do auxiliar
  (`service.ts`).
- `server/controls/`: o registro das trocas e as rotas.
- `server/sources/opencode/`: `variant`, `model-switched`, `selectModel`, `models`.
- `client/src/ui/effort.ts`: `SessionControls` (a seção) e as peças puras; `drawer.ts` a coloca antes de "Mandar
  mensagem".

## Testes

`client/src/ui/effort.test.ts`, `server/sources/transcript-commands.test.ts`, `server/sources/watcher-effort.test.ts`,
`server/claude-defaults/*.test.ts`, `server/controls/controls.test.ts`, `server/sources/opencode/models.test.ts` e o
`claudeRound` em `server/test/codex-bridge.test.ts`.

Teste ao vivo (26/11/2026), num servidor de dev na porta 4795 com uma sessão de teste aberta com
`claude --bg --model haiku --effort low --settings '{"env":{"HABBLAUD_PORT":"4795"}}'` (o `--settings` faz o plugin
dela falar só com esse servidor): `low → medium/high` e `haiku → sonnet` confirmados pela conversa, a tela da sessão
mostrando "Sonnet 5.5 with high effort" e o hash do `settings.json` igual antes e depois; no modo Docker
(`HABBLAUD_IN_DOCKER=1`) sem o auxiliar a troca foi recusada com o motivo, e com o auxiliar ela confirmou e o padrão
foi devolvido por ele. No OpenCode, uma sessão vazia criada para o teste foi para `opencode/gpt-6.2-sol` com `high`
(conferido em `GET /api/session/<id>`) e depois apagada.

## Manutenção

- Uma versão nova do Claude Code pode mudar o texto das saídas: confira `commandOutputOf` e os testes com a saída real
  (`claude logs <id>` mostra a tela; a conversa fica em `<conta>/projects/<pasta>/<sessão>.jsonl`).
- Se o Claude Code ganhar `/effort` ou `/model` "só nesta sessão" por argumento, use-o e remova a restauração.
- Se o aviso de cache do `/model` mudar (ou ganhar como pular), revise `MODEL_SWITCH_LOCK_MS`.
