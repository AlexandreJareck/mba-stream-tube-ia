# Especificação de execução — Fase 03: Upload e Processamento de Vídeos

## 1. Objetivo deste documento

Este documento transforma o enunciado do desafio em um contrato de trabalho verificável para o agente que irá planejar e implementar a Fase 03 do StreamTube.

Ele não substitui a pipeline de planejamento existente no repositório. As decisões técnicas finais, os contratos exatos e a divisão em Step Implementations (SIs) devem ser produzidos pelo workflow `research → plan-context → plan-validate ↔ plan-resolve → plan-build → implement`.

## 2. Resultado esperado

Entregar, neste fork público, a Fase 03 completa do backend do StreamTube:

- upload de vídeos de até 10 GB sem encaminhar o arquivo inteiro pela API;
- pré-cadastro automático do vídeo como rascunho ao iniciar o upload;
- armazenamento S3-compatible, com MinIO no ambiente local;
- fila de processamento e worker executado em container separado;
- extração automática de duração e metadados com `ffprobe`/FFmpeg;
- geração automática de thumbnail a partir de um frame;
- identificador público único por vídeo, sem colisões;
- reprodução com suporte a HTTP Range e resposta `206 Partial Content`;
- download do arquivo de vídeo;
- ciclo persistido de estados `draft → processing → ready | failed`;
- migration da tabela de vídeos ligada ao canal;
- infraestrutura completa subindo via Docker Compose;
- testes unitários, de integração e e2e nos níveis adequados;
- documentação da fase e instruções do agente coerentes com o código final.

O frontend existe, mas qualquer interface de vídeo está fora do escopo.

## 3. Fontes de verdade e ordem de precedência

O agente deve confrontar as fontes antes de decidir ou implementar:

1. critérios de aceite desta especificação e do enunciado do desafio;
2. `CLAUDE.md`, rules e skills do repositório;
3. `docs/project-plan.md`, seção da Fase 03;
4. arquitetura em `docs/diagrams/software-arch.mermaid`;
5. padrões implementados nas Fases 01 e 02;
6. documentação oficial das versões efetivamente instaladas, consultada via Context7;
7. documentos de decisão e planejamento produzidos para a Fase 03.

Conflitos ou lacunas devem ser registrados e resolvidos durante `plan-validate`/`plan-resolve`. Não inventar requisito, contrato ou comportamento sem registrar sua origem ou decisão.

## 4. Escopo funcional obrigatório

### 4.1 Início do upload

- Exigir usuário autenticado pelo guard JWT global já existente.
- Descobrir o canal do usuário autenticado e criar um vídeo pertencente a esse canal.
- Criar o registro inicialmente em `draft`.
- Receber os metadados mínimos definidos no planejamento, incluindo ao menos o título e os dados necessários para validar tipo/tamanho.
- Gerar a chave de storage e um identificador público único.
- Retornar ao cliente uma estratégia de upload direto ao object storage, preferencialmente multipart com URLs pré-assinadas, compatível com arquivo de até 10 GB.
- A API não pode manter o corpo binário completo do vídeo em memória nem atuar como proxy do arquivo de 10 GB.

### 4.2 Conclusão do upload

- Validar que o upload esperado existe e foi concluído no storage.
- Tornar a conclusão idempotente: repetição segura não deve criar jobs duplicados nem corromper estado.
- Mover o vídeo de `draft` para `processing` e publicar a mensagem de processamento.
- Definir no plano como lidar com upload abandonado, partes multipart órfãs e expiração das URLs.

### 4.3 Processamento assíncrono

- Executar em processo/container separado da API.
- Consumir uma fila real definida na etapa de research.
- Baixar ou acessar o objeto de entrada de forma controlada, sem carregá-lo integralmente em memória.
- Extrair duração e metadados com `ffprobe`/FFmpeg.
- Gerar uma thumbnail determinística e armazená-la no object storage.
- Persistir duração, metadados, chave da thumbnail e status final `ready`.
- Em falha, persistir `failed` e informação operacional suficiente, sem expor detalhes internos pela API.
- Definir retentativas, backoff, idempotência, deduplicação e destino de jobs definitivamente falhos.

### 4.4 Acesso ao vídeo

- Disponibilizar consulta por identificador público único.
- Streaming deve respeitar `Range`, validar ranges e responder com cabeçalhos e códigos HTTP corretos, incluindo `206`.
- Download deve usar semântica de anexo e estar disponível conforme a matriz de autorização definida no plano.
- Definir explicitamente se a API redireciona/assina URLs ou faz proxy de streams; justificar impacto em segurança, desempenho e compatibilidade S3/MinIO.
- Vídeos que ainda não estejam `ready` não podem ser servidos como prontos.

## 5. Requisitos de persistência

O modelo exato será fechado pelo plano, mas a entidade/tabela `videos` deve conter, no mínimo:

- UUID de identificação interna;
- FK para `channels` e relação de domínio correspondente;
- título;
- status persistido (`draft`, `processing`, `ready`, `failed` ou nomes equivalentes justificados);
- identificador público único com constraint/índice de unicidade;
- chave do objeto de vídeo;
- chave da thumbnail, anulável antes do processamento;
- duração, anulável antes do processamento;
- metadados técnicos estruturados, anuláveis antes do processamento;
- timestamps;
- informação de falha/reprocessamento que o plano considerar necessária.

A migration deve criar constraints, índices e FK, e possuir caminho de rollback seguro.

## 6. Decisões obrigatórias da etapa de research

Criar `docs/decisions/technical-decisions-phase-03-videos.md` no formato dos documentos existentes, comparando opções, trade-offs, recomendação e consequências para cada item:

1. tecnologia de fila e integração com NestJS;
2. upload direto de até 10 GB: multipart, URLs pré-assinadas, expiração, tamanho de partes e finalização;
3. buckets, chaves, lifecycle e política de acesso no MinIO/S3;
4. execução do worker e uso de FFmpeg/ffprobe;
5. formato/versionamento da mensagem e garantias de entrega;
6. idempotência, retries, backoff e jobs definitivamente falhos;
7. identificador público único;
8. streaming e download, incluindo Range/206;
9. máquina de estados e recuperação após falha;
10. limites, validações e segurança do upload.

S3-compatible é uma restrição dada: MinIO em desenvolvimento e S3 em produção. Não reabrir a escolha do tipo de object storage.

## 7. Artefatos obrigatórios da pipeline

- `docs/decisions/technical-decisions-phase-03-videos.md`;
- `docs/phases/phase-03-videos/context.md`;
- `docs/phases/phase-03-videos/validation.md`, terminando com `status: clean` e zero pendências;
- `docs/phases/phase-03-videos/library-refs.md`, com versões instaladas e referências oficiais consultadas;
- `docs/phases/phase-03-videos/phase-03-videos.md`;
- `docs/phases/phase-03-videos/progress.md`, atualizado a cada SI;
- specs de teste, caso a skill correspondente seja usada;
- `AGENTS.md` e demais adaptações necessárias caso a execução seja feita com Codex;
- `CLAUDE.md` e/ou equivalente atualizado somente com comportamento realmente implementado.

O plano final precisa conter:

- SIs nomeadas `SI-03.1`, `SI-03.2`, ...;
- Data Model;
- API Contracts completos;
- Authorization Matrix;
- Error Catalog;
- Events/Messages da fila, incluindo payload, versão, produtor, consumidor, idempotência e falhas;
- Dependency Map entre SIs;
- Deliverables e critérios de aceite por SI;
- estratégia de testes por SI;
- rastreabilidade entre requisitos, decisões, SIs, código e testes.

## 8. Contratos que o planejamento deve fechar

Antes de implementar, o plano deve definir sem ambiguidades:

- rotas, métodos, DTOs, códigos HTTP e exemplos de resposta;
- identidade do usuário/canal extraída do JWT;
- quem pode iniciar, concluir, consultar, transmitir, baixar e reprocessar um vídeo;
- comportamento para vídeo inexistente, acesso indevido, status inválido, upload expirado, objeto ausente, range inválido e falha de fila/storage;
- transições válidas e inválidas da máquina de estados;
- fronteira transacional entre banco, storage e fila;
- estratégia contra dupla conclusão, mensagens duplicadas e worker reiniciado;
- configuração e health checks dos novos serviços;
- limites de tamanho/MIME e validação pelo storage, API e worker;
- cleanup de artefatos temporários e uploads abandonados;
- observabilidade mínima, com logs correlacionáveis por vídeo/job e sem dados sensíveis.

## 9. Infraestrutura esperada

O `nestjs-project/compose.yaml` deve subir, além dos serviços atuais:

- object storage MinIO e sua inicialização de buckets, quando necessária;
- tecnologia de fila escolhida e suas dependências;
- worker de vídeo com FFmpeg/ffprobe;
- health checks e dependências de inicialização coerentes.

Toda comunicação entre containers deve usar nomes dos serviços Compose, nunca `localhost`.

Segredos e configurações devem ser documentados em `.env.example`; nenhum segredo real deve ser commitado.

## 10. Estratégia de testes mínima

- Unitários: regras de transição de status, geração de identificador/chaves, validações, parsing de Range, idempotência e tratamento de falhas.
- Integração: repositories/migration com PostgreSQL real; storage com MinIO real; fila real e publicação/consumo; processamento de um fixture pequeno com FFmpeg real.
- E2E: autenticação, início e conclusão do upload, processamento até `ready`, thumbnail, consulta por URL única, streaming parcial e download; cenários principais de autorização e erro.
- Não usar um arquivo de 10 GB na suíte. Demonstrar suporte arquitetural ao limite por configuração, validação e multipart; usar fixtures pequenas para manter a suíte reproduzível.
- Não mockar banco, fila, storage ou FFmpeg onde o requisito pede integração real e a infraestrutura Compose os disponibiliza.

Convenções: `*.spec.ts`, `*.integration-spec.ts` e `*.e2e-spec.ts`.

## 11. Definition of Done

A implementação só pode ser declarada concluída quando houver evidência de:

- todos os critérios funcionais atendidos;
- `validation.md` limpo antes do início da implementação;
- cada SI implementada e registrada em `progress.md`;
- testes relevantes por SI verdes;
- suíte completa verde (`npm test` e `npm run test:e2e`);
- `npx tsc --noEmit` com código 0;
- `npm run lint` verde;
- stack Compose saudável com API, PostgreSQL, Mailpit, storage, fila e worker;
- migrations executáveis em ambiente limpo;
- documentação e arquivos de instrução coerentes com o código;
- branch `feature/*` criada a partir de `dev`, sem commit direto em `main`;
- revisão final item a item desta especificação e do enunciado.

## 12. Fora de escopo

- interface frontend de upload, player ou gerenciamento de vídeos;
- recursos sociais, busca, comentários, likes e inscrições;
- transcodificação adaptativa/HLS, salvo se uma decisão técnica demonstrar que é indispensável (não é exigência original);
- implantação em cloud ou uso de S3 real;
- reescrita dos módulos de autenticação, usuários ou canais.

## 13. Evidências de entrega

O handoff final do agente executor deve listar:

- branch e commits produzidos;
- decisões tomadas e links para os artefatos;
- SIs concluídas;
- rotas e eventos implementados;
- serviços Compose adicionados;
- migrations criadas;
- comandos de validação executados e seus resultados;
- eventuais limitações explícitas, sem declarar sucesso se algum item da Definition of Done falhar.
