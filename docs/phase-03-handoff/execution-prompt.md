# Prompt de execução — Fase 03 do StreamTube

Você é o agente responsável por planejar e implementar integralmente a Fase 03 — Upload e Processamento de Vídeos — deste repositório.

Leia primeiro, por inteiro:

- `docs/phase-03-handoff/specification.md`;
- `CLAUDE.md`;
- `docs/project-plan.md`;
- `docs/diagrams/software-arch.mermaid`;
- os artefatos de `docs/phases/phase-02-auth/`;
- os documentos de decisão existentes;
- as skills e rules em `.claude/`.

Sua execução deve seguir rigorosamente as instruções abaixo.

## Regras de trabalho

1. Não implemente diretamente em `main`. Atualize `dev` e crie uma branch `feature/phase-03-videos` a partir dela.
2. Preserve alterações preexistentes do usuário. Antes de editar, verifique branch, remotes e working tree.
3. Se estiver usando OpenAI Codex, antes do planejamento porte a fundação de IA do projeto:
   - traduza as instruções relevantes de `CLAUDE.md` para um `AGENTS.md` compatível, sem remover `CLAUDE.md`;
   - mapeie as skills/rules do workflow para skills ou instruções equivalentes do Codex; quando não houver equivalente, execute o mesmo estágio manualmente;
   - configure ou documente os MCPs equivalentes para PostgreSQL e Context7;
   - registre claramente o mapeamento realizado. Não alegue que uma skill foi executada se o mecanismo não existia; produza manualmente o artefato contratado.
4. Use IA como ferramenta principal e mantenha sua participação observável nos artefatos de decisões, planejamento e progresso.
5. Toda decisão, contrato ou comportamento deve ser rastreável ao enunciado, ao código existente, a documentação oficial ou a uma decisão registrada.
6. Antes de usar bibliotecas novas, identifique as versões compatíveis e consulte a documentação oficial via Context7. Registre as referências em `library-refs.md`.
7. Reuse padrões das Fases 01 e 02. Não reescreva auth, users ou channels.
8. Toda comunicação entre containers usa o nome do serviço Compose; nunca use `localhost` internamente.

## Ordem obrigatória

### Etapa 0 — Baseline

- Inspecione o repositório e as instruções locais.
- Suba o backend atual com Docker Compose, instale dependências e rode migrations.
- Execute a suíte existente, typecheck e lint.
- Registre falhas preexistentes separadamente; não as esconda e não misture correções fora do escopo.

### Etapa 1 — Research

Pesquise as decisões abertas exigidas em `docs/phase-03-handoff/specification.md`, especialmente fila, multipart presigned upload, worker/FFmpeg, mensagens/idempotência, streaming Range/206, URL única e ciclo de status.

Produza `docs/decisions/technical-decisions-phase-03-videos.md` no formato já usado pelo projeto. Para cada decisão, mostre opções, trade-offs, recomendação, consequências, bibliotecas e fontes oficiais.

MinIO/S3-compatible é uma restrição dada, não uma decisão aberta.

Pare e revise criticamente o documento antes de avançar. Não implemente nesta etapa.

### Etapa 2 — Pipeline de planejamento

Execute na ordem:

1. `plan-context` → `docs/phases/phase-03-videos/context.md`;
2. `plan-validate` → `validation.md`;
3. `plan-resolve` → resolva todas as pendências, atualize decisões/contexto e produza `library-refs.md`;
4. repita `plan-validate ↔ plan-resolve` até `validation.md` terminar com `status: clean` e zero issues;
5. `plan-build` → `phase-03-videos.md`;
6. gere specs de teste se a skill estiver disponível.

O plano final deve conter SIs `SI-03.x`, Data Model, API Contracts, Authorization Matrix, Error Catalog, Events/Messages, Dependency Map, Deliverables, testes e critérios de aceite. Valide rastreabilidade contra cada requisito da especificação.

É proibido iniciar a implementação com `validation.md` dirty, decisão aberta ou contrato ambíguo.

### Etapa 3 — Implementação SI a SI

- Siga a ordem do Dependency Map.
- Antes de cada SI, confirme dependências e critérios de aceite.
- Implemente apenas o escopo daquela SI.
- Rode testes relevantes, typecheck e lint proporcionais à alteração.
- Corrija a causa de qualquer falha antes de avançar.
- Atualize `docs/phases/phase-03-videos/progress.md` com status, arquivos, testes e evidências reais.
- Faça commits pequenos e descritivos, seguindo Git Flow.

Implemente obrigatoriamente o módulo de vídeos, migration, integração S3/MinIO, upload direto multipart/presigned, conclusão idempotente, fila real, worker separado com FFmpeg/ffprobe, thumbnail, metadados, URL única, streaming Range/206, download, máquina de estados, infraestrutura Compose e testes.

Não passe o arquivo de até 10 GB pela API e não carregue o vídeo completo em memória.

### Etapa 4 — Fechamento

- Suba a stack completa em ambiente limpo e rode migrations.
- Execute `npm test`, `npm run test:e2e`, `npx tsc --noEmit` e `npm run lint`.
- Exercite MinIO, fila e worker reais com fixture pequena.
- Revise todos os critérios de `docs/phase-03-handoff/specification.md` um a um.
- Atualize `CLAUDE.md` e `AGENTS.md` apenas com endpoints, eventos, serviços e comportamentos que realmente existam.
- Verifique que documentação, plano, progresso, código e testes são coerentes.

## Política de bloqueio

Se encontrar uma decisão que altere materialmente o produto e não possa ser resolvida pelas fontes ou pelo research, registre a questão e peça orientação. Não escolha silenciosamente.

Se Docker, documentação oficial ou infraestrutura externa estiver indisponível, esgote diagnósticos seguros, registre a evidência e informe a limitação. Não marque a fase como concluída enquanto a Definition of Done não passar.

## Formato do relatório final

Informe de forma objetiva:

1. branch e commits;
2. decisões técnicas principais;
3. artefatos criados/atualizados;
4. SIs concluídas;
5. endpoints, eventos e serviços adicionados;
6. migration e modelo de dados;
7. resultados exatos de testes, e2e, typecheck e lint;
8. como reproduzir o fluxo de upload/processamento/streaming/download;
9. limitações ou pendências reais.

Não declare conclusão parcial como sucesso total.
