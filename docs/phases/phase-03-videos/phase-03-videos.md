---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-11T21:53:28-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-11T21:53:28-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-11T20:05:00-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-11T16:50:27-03:00"
---

# Fase 03 — Upload e Processamento de Vídeos

> _Execution note:_ gerado executando `plan-build/SKILL.md` + `phase-a.md` + `phase-b.md` manualmente (skills com `disable-model-invocation: true`). Gates 1–10 verificados (context/validation presentes e frescos, `status: clean`, `library-refs.md` presente, `## Decisions Detail` presente, UI `deferred`, fatia única, artefato inexistente → Phase A). Desvio de procedimento registrado: as SIs foram anexadas em poucos `Edit`s agrupados (não um por SI) — o conteúdo/ordem segue o template; nenhuma releitura das SIs já escritas foi necessária. A pausa A5 foi resolvida como "Continue now" (execução autônoma solicitada pelo prompt de execução).

## Objective

Entregar o backend da Fase 03: armazenamento S3/MinIO de vídeos e thumbnails, fila BullMQ com worker FFmpeg em contêiner separado, upload multipart direto de até 10 GiB com pré-cadastro do vídeo como `draft`, extração automática de duração/metadados e thumbnail, URL única por vídeo, reprodução via streaming com Range/`206` e download — com o ciclo `draft → processing → ready | failed` persistido, contratos OpenAPI atualizados e testes unit/integration/e2e contra infraestrutura real.

---

## Step Implementations

### SI-03.1 — Infra: corrigir `.env.example` herdado (DG-2)

**Description:** Pré-requisito de ambiente limpo — o `MAIL_FROM` com `<…>` herdado da Fase 02 impede o Docker Compose de ler `.env` copiado de `.env.example`, bloqueando subida da stack e migrations (validation DG-2).

**Technical actions:**

1. Substituir `MAIL_FROM="StreamTube" <noreply@streamtube.com>` por `MAIL_FROM=noreply@streamtube.com` em `nestjs-project/.env.example` (nome de exibição permanece composto pelo default de `mail.config.ts`, per `nestjs-project/CLAUDE.md` → Environment File Conventions)
2. Normalizar finais de linha de `.env.example` para LF (o `\r` também quebra o parser do Compose)

**Tests:** _(empty — Infra; verificado pelo AC de subida da stack)_

**Dependencies:** none

**Acceptance criteria:**

- `cp .env.example .env && docker compose config` termina com exit 0
- `docker compose up -d` sobe `db`, `mailpit` e `nestjs-api` a partir de um `.env` copiado do exemplo

---

### SI-03.2 — Infra: MinIO, inicialização do bucket, Redis e FFmpeg no Compose

**Description:** Provisiona a infraestrutura de armazenamento e fila exigida pela fase, com health checks e dependências de inicialização (`specification.md` §9).

**Technical actions:**

1. Adicionar serviço `minio` (imagem `minio/minio` com tag fixa, `server /data --console-address :9001`, portas 9000/9001, volume nomeado, `MINIO_API_STALE_UPLOADS_EXPIRY=24h`, healthcheck `mc ready local`) em `nestjs-project/compose.yaml` (per `phase-03-videos/TD-03`)
2. Adicionar serviço one-shot `minio-init` (`minio/mc`) que executa `mc alias set` + `mc mb --ignore-existing` do bucket privado, `depends_on: minio: service_healthy` (per `phase-03-videos/TD-03`)
3. Adicionar serviço `redis` (`redis:7-alpine`, `--appendonly yes`, volume, healthcheck `redis-cli ping`) (per `phase-03-videos/TD-01`)
4. Instalar `ffmpeg` em `Dockerfile.dev` (pacote Debian) e fazer `nestjs-api` depender de `minio`(healthy), `minio-init`(completed) e `redis`(healthy) (per `phase-03-videos/TD-04`)

**Tests:** _(empty — Infra; verificado pelos ACs)_

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `docker compose up -d` deixa `minio` e `redis` `healthy` e `minio-init` finaliza com exit 0
- `docker compose exec nestjs-api ffprobe -version` imprime a versão
- O bucket configurado existe e não possui política anônima (`mc anonymous get` retorna `private`)
- Todas as conexões entre contêineres usam nomes de serviço (`minio`, `redis`, `db`), nunca `localhost`

---

### SI-03.3 — Infra: dependências e namespaces de configuração (storage, queue, video)

**Description:** Instala as bibliotecas decididas e cria a configuração tipada/validada para storage, fila e regras de vídeo, seguindo o padrão `registerAs` + Joi.

**Technical actions:**

1. Instalar `bullmq`, `@nestjs/bullmq`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (versões em `library-refs.md`) (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`)
2. Criar `src/config/storage.config.ts` (`S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`), `src/config/queue.config.ts` (`REDIS_HOST`, `REDIS_PORT`) e `src/config/video.config.ts` (`VIDEO_MAX_SIZE_BYTES`, `VIDEO_UPLOAD_PART_SIZE_BYTES`, `VIDEO_UPLOAD_URL_TTL_SECONDS`, `VIDEO_UPLOAD_SESSION_TTL_HOURS`, `VIDEO_PROCESSING_ATTEMPTS`, `VIDEO_PROCESSING_BACKOFF_MS`, `WORKER_CONCURRENCY`, `UPLOAD_SWEEP_INTERVAL_MS`) (per `phase-01-configuracao-base/TD-03`)
3. Estender `src/config/env.validation.ts` (part size ≥ 5 MiB, max size ≤ 10737418240, defaults) e registrar os namespaces em `AppModule` (per `phase-01-configuracao-base/TD-02`)
4. Documentar as chaves em `.env.example` com hosts de serviço (`minio`, `redis`) e segredos de desenvolvimento não reais

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `envValidationSchema` | Integration: defaults e rejeição de part size < 5 MiB / max > 10 GiB | `src/config/env.validation.integration-spec.ts` |

**Dependencies:** SI-03.2

**Acceptance criteria:**

- Aplicação inicia com o `.env` derivado do exemplo sem erros de validação
- `VIDEO_UPLOAD_PART_SIZE_BYTES=1048576` faz a validação de env falhar na inicialização
- `VIDEO_MAX_SIZE_BYTES=10737418241` faz a validação de env falhar na inicialização

---

### SI-03.4 — Entidade `Video`, migration e relação com `Channel`

**Description:** Persiste o modelo de vídeo vinculado ao canal com constraints, índices e rollback seguro (`specification.md` §5).

**Technical actions:**

1. Criar `src/videos/entities/video.entity.ts` e `src/videos/video-status.enum.ts` conforme `### Data Model` (transformer `bigint → number` em `size_bytes`) (per `phase-03-videos/TD-09`, `phase-03-videos/TD-07`)
2. Adicionar `@OneToMany(() => Video, (v) => v.channel) videos` em `Channel` (lado inverso; sem mudança de schema)
3. Gerar a migration `CreateVideos` via TypeORM CLI e completar com `CHECK` de `size_bytes` e nomes de índices; `down` reverte tudo inclusive o enum
4. Atualizar `src/database/migrations.integration-spec.ts` para incluir a nova migration e limpar também os tipos enum antes de rodar (corrige a falha pré-existente "type … already exists")
5. Incluir `videos` em `cleanAllTables` (`src/test/create-test-data-source.ts`) antes de `channels`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: unique `public_id`/`storage_key`, default `draft`, FK canal, CHECK de tamanho, `size_bytes` como number | `src/videos/entities/video.entity.integration-spec.ts` |
| Migrations | Integration: up cria `videos`; revert remove tabela e enum | `src/database/migrations.integration-spec.ts` |

**Dependencies:** SI-03.3

**Acceptance criteria:**

- `npm run migration:run` em banco limpo cria a tabela `videos` com FK para `channels`
- Inserir dois vídeos com o mesmo `public_id` viola `UQ` (erro PG `23505`)
- Inserir `size_bytes = 10737418241` viola o `CHECK`
- `npm run migration:revert` remove `videos` e `videos_status_enum` sem afetar tabelas anteriores

---

### SI-03.5 — Consulta do canal do usuário (DG-1)

**Description:** Extensão somente-leitura do `ChannelsService` para resolver o canal do usuário autenticado (não reescreve canais).

**Technical actions:**

1. Adicionar `findByUserId(userId): Promise<Channel | null>` em `src/channels/channels.service.ts` (per `phase-02-auth/TD-10` — módulo dono da entidade)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `ChannelsService.findByUserId` | Integration: encontra canal do usuário; `null` para usuário sem canal | `src/channels/channels.service.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Para um usuário registrado, `findByUserId` retorna o canal cujo `user_id` é o do usuário
- Para um UUID sem canal, retorna `null`

---

### SI-03.6 — Primitivas de domínio: transições de status, identificador público, Range e exceções

**Description:** Lógica pura e testável que governa estado, identificadores e intervalos HTTP, mais as exceções de domínio do catálogo.

**Technical actions:**

1. Criar `src/videos/video-status.transitions.ts` — tabela de transições permitidas + `assertTransition(from, to)` (per `phase-03-videos/TD-09`)
2. Criar `src/videos/public-id.util.ts` — `generatePublicId()` (base64url de `randomBytes(8)`, 11 chars) e `isValidPublicId()` (per `phase-03-videos/TD-07`)
3. Criar `src/videos/range.util.ts` — `parseRange(header, size)` retornando `none | partial(start,end) | unsatisfiable` conforme RFC 9110 (múltiplos/inválidos ⇒ `none`) (per `phase-03-videos/TD-08`)
4. Criar `src/videos/upload-plan.util.ts` — `planParts(size, partSize)` (contagem ≤ 10000, tamanho esperado por parte) e `buildStorageKeys(videoId)` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03`)
5. Adicionar ao `src/common/exceptions/domain.exception.ts` as exceções do `### Error Catalog` (per `phase-02-auth/TD-07`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| transições | Unit: todas as transições válidas/ inválidas | `src/videos/video-status.transitions.spec.ts` |
| public id | Unit: formato, alfabeto, unicidade estatística | `src/videos/public-id.util.spec.ts` |
| `parseRange` | Unit: `a-b`, `a-`, `-n`, clamp, `416`, inválido, múltiplo | `src/videos/range.util.spec.ts` |
| plano de partes | Unit: 10 GiB/64 MiB = 160 partes, última parte menor, limite 10000 | `src/videos/upload-plan.util.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `assertTransition('draft','ready')` lança `InvalidVideoStatusException`; `draft→processing`, `processing→ready|failed`, `draft→failed`, `failed→processing` são aceitas
- `generatePublicId()` retorna 11 caracteres de `[A-Za-z0-9_-]`
- `parseRange('bytes=0-99', 1000)` ⇒ parcial 0–99; `parseRange('bytes=1000-', 1000)` ⇒ insatisfazível; `parseRange('bytes=-200', 1000)` ⇒ 800–999
- `planParts(10737418240, 67108864)` ⇒ 160 partes de 64 MiB

---

### SI-03.7 — StorageModule: adaptador S3/MinIO

**Description:** Serviço único de acesso ao object storage (multipart, URLs pré-assinadas, verificação, leitura em stream, escrita de thumbnail), compartilhado por API e worker.

**Technical actions:**

1. Criar `src/storage/storage.module.ts` + `storage.service.ts` com dois `S3Client` (endpoint interno e endpoint público só para assinar URLs de cliente; `forcePathStyle`) (per `phase-03-videos/TD-03`)
2. Implementar multipart: `createMultipartUpload`, `presignUploadPart`, `listParts` (paginado), `completeMultipartUpload`, `abortMultipartUpload` (ignora `NoSuchUpload`) (per `phase-03-videos/TD-02`)
3. Implementar `headObject` (null em `NotFound`), `getObjectStream(key, range?)`, `putObject(key, body, contentType)` e `presignInternalGet(key)` (per `phase-03-videos/TD-04`, `phase-03-videos/TD-08`)
4. Mapear falhas de rede/SDK para `StorageUnavailableException` (503) sem engolir erros (per `phase-02-auth/TD-07`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration (MinIO real): multipart de 2 partes (5 MiB + resto) via URL pré-assinada com `fetch`, list/complete/head, leitura com Range, abort | `src/storage/storage.service.integration-spec.ts` |
| `StorageModule` | Unit: compilação do módulo | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.3

**Acceptance criteria:**

- Um `PUT` HTTP na URL pré-assinada de `UploadPart` grava a parte sem passar pela API
- Após `completeMultipartUpload`, `headObject` retorna `ContentLength` igual à soma das partes
- `getObjectStream(key, {start:0,end:9})` entrega exatamente 10 bytes
- `abortMultipartUpload` remove o upload pendente (subsequente `listParts` falha com `NoSuchUpload`)

---

### SI-03.8 — VideosRepository: persistência com compare-and-set e identificador sem colisão

**Description:** Repositório do domínio de vídeos encapsulando inserção com retry de `public_id` e transições atômicas de status.

**Technical actions:**

1. Criar `src/videos/videos.repository.ts` (injeta `Repository<Video>`): `insertDraft(data)` com retry ao detectar `23505` em `public_id` (máx. 5) (per `phase-03-videos/TD-07`, `phase-02-auth/TD-10`)
2. Implementar `transition(id, from, to, patch)` — `UPDATE … WHERE id AND status = from` retornando se aplicou; incremento atômico de `processing_run` nas entradas em `processing` (per `phase-03-videos/TD-09`, `phase-03-videos/TD-06`)
3. Implementar consultas `findOwned(id, channelId)`, `findReadyByPublicId(publicId)`, `findExpiredDrafts(now, limit)`
4. Criar `src/videos/videos.module.ts` (imports `TypeOrmModule.forFeature([Video])`, `ChannelsModule`, `StorageModule`) e registrá-lo em `AppModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosRepository` | Integration: retry de colisão (gerador forçado), CAS aceito/rejeitado, CAS concorrente (só um vence), `findExpiredDrafts` | `src/videos/videos.repository.integration-spec.ts` |
| `VideosModule` | Unit: compilação | `src/videos/videos.module.spec.ts` |

**Dependencies:** SI-03.4, SI-03.5, SI-03.6, SI-03.7

**Acceptance criteria:**

- Duas inserções cujo gerador colide na primeira tentativa resultam em dois vídeos com `public_id` distintos
- Duas transições concorrentes `draft → processing` sobre o mesmo vídeo: exatamente uma aplica, `processing_run` termina em 1
- Transição a partir de status divergente não altera a linha

---

### SI-03.9 — Endpoint: iniciar upload com pré-cadastro em `draft`

**Route:** POST /channels/me/videos
**Test Specs:** see `nestjs-project/specs/videos-create.plan.md`
**Authorization:** Authenticated (canal do usuário)

**Description:** Cria o vídeo em `draft` no canal do usuário e devolve a estratégia de upload multipart direto ao storage (`specification.md` §4.1).

**Technical actions:**

1. Criar `src/videos/dto/create-video.dto.ts` e DTOs de resposta (`video-upload-response.dto.ts`) conforme `### API Contracts` (per `phase-02-auth/TD-06`, `phase-03-videos/TD-10`)
2. Implementar `VideosService.startUpload(userId, dto)`: resolve canal (`CHANNEL_NOT_FOUND`), gera id/chaves, `createMultipartUpload`, `insertDraft` com `upload_expires_at = now + 24h`, compensação `abortMultipartUpload` se a inserção falhar, assina URLs das partes (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03`)
3. Criar `src/videos/channel-videos.controller.ts` (`@Controller('channels/me/videos')`, `@ApiTags('videos')`, `@ApiBearerAuth('access-token')`, `@ApiResponse` 201/400/401/404/503) (per `openapi-docs-nestjs/TD-01`)
4. Logar `videoId`, `channelId`, `size_bytes` (sem URLs assinadas) no início do upload

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.startUpload` | Unit: canal ausente, compensação ao falhar inserção, cálculo de partes | `src/videos/videos.service.spec.ts` |

**Dependencies:** SI-03.8

**Acceptance criteria:**

- `POST /channels/me/videos` com payload válido retorna `201` com `status: "draft"`, `public_id` de 11 chars e `upload.parts` de tamanho `part_count`
- `size_bytes = 10737418240` é aceito; `10737418241` retorna `400` com `error: "VALIDATION_ERROR"`
- `content_type: "image/png"` retorna `400`
- Sem token retorna `401`
- A linha criada em `videos` tem `status = 'draft'`, `upload_id` preenchido e pertence ao canal do usuário

---

### SI-03.10 — Endpoints: sessão de upload (retomada) e conclusão idempotente com publicação do job

**Route:** GET /channels/me/videos/{id}/upload; POST /channels/me/videos/{id}/upload/complete
**Test Specs:** see `nestjs-project/specs/videos-upload.plan.md`
**Authorization:** Owner

**Description:** Permite retomar/renovar URLs de partes e concluir o upload verificando o storage, movendo para `processing` e publicando `video.process` sem duplicação (`specification.md` §4.2).

**Technical actions:**

1. Criar `src/videos/video-processing.queue.ts`: `BullModule.forRootAsync({ connection })` + `registerQueue('video-processing')` em `VideosModule` e `enqueueProcessing(videoId, run)` com `jobId = video-process-{videoId}-{run}`, attempts/backoff/remoção do `### Events/Messages`; falha ⇒ `QueueUnavailableException` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-05`, `phase-03-videos/TD-06`)
2. Implementar `VideosService.getUploadSession(userId, id)` (status `draft`, sessão válida, `listParts`, URLs só das partes faltantes) (per `phase-03-videos/TD-02`)
3. Implementar `VideosService.completeUpload(userId, id)`: se `processing` ⇒ re-publica run atual e retorna; se `ready` ⇒ retorna; se `draft` ⇒ valida partes (`UPLOAD_INCOMPLETE`), `completeMultipartUpload` (tolera `NoSuchUpload` quando o objeto já existe), `headObject` (`UPLOAD_SIZE_MISMATCH`), CAS `draft → processing` (`upload_id = null`, `processing_run + 1`), publica job (per `phase-03-videos/TD-06`, `phase-03-videos/TD-09`)
4. Adicionar as duas rotas ao `ChannelVideosController` com `ParseUUIDPipe` e `@ApiResponse` 200/400/401/404/409/410/422/503

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.completeUpload` / `getUploadSession` | Unit: ramos draft/processing/ready/failed, expirado, partes faltantes, tamanho divergente | `src/videos/videos.service.spec.ts` |
| `VideoProcessingQueue` | Integration (Redis real): job publicado com payload v1; segunda publicação do mesmo run não duplica | `src/videos/video-processing.queue.integration-spec.ts` |
| `VideosService` | Integration (DB + MinIO + Redis reais): upload real via URLs, complete duas vezes ⇒ 1 job, status `processing` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.9

**Acceptance criteria:**

- Após `PUT` de todas as partes, `POST …/upload/complete` retorna `200` com `status: "processing"` e existe exatamente um job `video-process-{id}-1`
- Repetir `POST …/upload/complete` retorna `200` com o mesmo estado e não cria um segundo job
- Completar com partes faltantes retorna `409` `UPLOAD_INCOMPLETE` e o vídeo permanece `draft`
- `GET …/upload` após enviar a parte 1 de 2 lista a parte 1 em `uploaded_parts` e devolve URL apenas para a parte 2
- Operar sobre vídeo de outro usuário retorna `404` `VIDEO_NOT_FOUND`
- Sessão vencida retorna `410` `UPLOAD_EXPIRED`

---

### SI-03.11 — MediaProbeService: ffprobe/ffmpeg sem carregar o vídeo em memória

**Description:** Encapsula a execução segura de `ffprobe` (metadados) e `ffmpeg` (thumbnail determinística) sobre uma URL de entrada.

**Technical actions:**

1. Criar `src/videos/processing/media-probe.service.ts` com `probe(inputUrl)` — `spawn('ffprobe', [...args])` sem shell, timeout, parse do JSON para `{ durationSeconds, metadata }`; ausência de stream de vídeo ou duração ≤ 0 ⇒ `InvalidMediaError` (per `phase-03-videos/TD-04`, `phase-03-videos/TD-10`)
2. Implementar `extractThumbnail(inputUrl, durationSeconds, outputPath)` — instante determinístico `t = duration ≥ 2 ? 1 : duration / 2`, `-frames:v 1`, `scale=640:-2` (per `phase-03-videos/TD-04`)
3. Gerar e versionar a fixture `test/fixtures/sample.mp4` (≈3 s, 320x240, `testsrc` + `sine`) e documentar o comando de geração em `test/fixtures/README.md`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `MediaProbeService` | Integration (FFmpeg real): probe da fixture (duração ≈3 s, codec h264, 320x240), thumbnail JPEG gerada, arquivo não-vídeo ⇒ `InvalidMediaError` | `src/videos/processing/media-probe.service.integration-spec.ts` |
| parse do ffprobe | Unit: JSON sem stream de vídeo / duração ausente | `src/videos/processing/media-probe.service.spec.ts` |

**Dependencies:** SI-03.2

**Acceptance criteria:**

- `probe` da fixture retorna `durationSeconds` entre 2.9 e 3.1 e `metadata.width = 320`
- `extractThumbnail` produz um JPEG válido (assinatura `FF D8 FF`) com largura 640
- Um arquivo de texto renomeado para `.mp4` gera `InvalidMediaError`

---

### SI-03.12 — Worker FFmpeg em contêiner separado

**Description:** Consumidor real da fila que processa o vídeo até `ready`/`failed`, rodando como aplicação Nest standalone em contêiner próprio (`specification.md` §4.3).

**Technical actions:**

1. Criar `src/videos/processing/video-processing.service.ts`: carrega vídeo; ignora se `status != processing` ou run divergente; `presignInternalGet`; `probe`; thumbnail em diretório temporário (removido em `finally`); `putObject` em `videos/{id}/thumbnail.jpg`; CAS `processing → ready` com `duration_seconds`, `metadata`, `thumbnail_key`, `processed_at` (per `phase-03-videos/TD-04`, `phase-03-videos/TD-06`)
2. Criar `src/videos/processing/video-processing.processor.ts` (`@Processor('video-processing', { concurrency })` + `WorkerHost`): valida `version` (desconhecida ⇒ `UnrecoverableError`), converte `InvalidMediaError` em `UnrecoverableError`, e no evento `failed` final faz CAS `processing → failed` (`INVALID_MEDIA`/`PROCESSING_FAILED`, `failed_at`); logs com `videoId`/`jobId` (per `phase-03-videos/TD-05`, `phase-03-videos/TD-06`)
3. Criar `src/worker/worker.module.ts` (Config, TypeORM via fábrica compartilhada extraída de `AppModule` para `src/database/typeorm-options.ts`, BullMQ, Storage, processor) e `src/worker.ts` (`createApplicationContext`, `enableShutdownHooks`, heartbeat em `/tmp/worker-heartbeat` após checar DB/Redis) (per `phase-03-videos/TD-04`)
4. Adicionar scripts `start:worker` / `start:worker:prod` e serviço `worker` no Compose (mesma imagem, aguarda `node_modules`, healthcheck pelo heartbeat, `depends_on` db/redis/minio healthy)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingService` | Unit: ignora status/run divergente, falha de probe propaga, limpeza do temp | `src/videos/processing/video-processing.service.spec.ts` |
| Worker end-to-end | Integration (DB + MinIO + Redis + FFmpeg reais): fixture enviada, job publicado, `WorkerModule` processa até `ready` com thumbnail no bucket; arquivo inválido ⇒ `failed/INVALID_MEDIA` sem retries | `src/videos/processing/video-processing.integration-spec.ts` |
| `WorkerModule` | Unit: compilação | `src/worker/worker.module.spec.ts` |

**Dependencies:** SI-03.10, SI-03.11

**Acceptance criteria:**

- Publicar `video.process` para um vídeo `processing` com a fixture resulta em `status = 'ready'`, `duration_seconds ≈ 3`, `metadata.width = 320` e objeto `videos/{id}/thumbnail.jpg` no bucket
- Mídia inválida resulta em `status = 'failed'`, `failure_reason = 'INVALID_MEDIA'` e o job no failed set com `attemptsMade = 1`
- Reentregar o mesmo job após `ready` não altera a linha (idempotente)
- `docker compose ps` mostra `worker` `healthy`; o processo da API não registra processor (não consome jobs)

---

### SI-03.13 — Endpoints do dono: consultar vídeo e reprocessar

**Route:** GET /channels/me/videos/{id}; POST /channels/me/videos/{id}/reprocess
**Test Specs:** see `nestjs-project/specs/videos-owner.plan.md`
**Authorization:** Owner

**Description:** Permite ao dono acompanhar o status (polling) e recuperar vídeos `failed` (`phase-03-videos/TD-09`).

**Technical actions:**

1. Criar `src/videos/dto/video-response.dto.ts` (`@ApiProperty` em todos os campos, `failure_reason` apenas código) (per `openapi-docs-nestjs/TD-01`)
2. Implementar `VideosService.findOwned(userId, id)` e `VideosService.reprocess(userId, id)` (`failed` + `headObject` existente ⇒ CAS `failed → processing` com `processing_run + 1` ⇒ publica job; senão `INVALID_VIDEO_STATUS`/`VIDEO_SOURCE_MISSING`) (per `phase-03-videos/TD-09`, `phase-03-videos/TD-06`)
3. Adicionar as rotas ao `ChannelVideosController` com `@ApiResponse` 200/400/401/404/409/503

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.reprocess` | Unit: não-failed, fonte ausente, sucesso incrementa run | `src/videos/videos.service.spec.ts` |

**Dependencies:** SI-03.10

**Acceptance criteria:**

- `GET /channels/me/videos/{id}` do dono retorna `200` com o status atual (inclusive `draft`/`processing`)
- O mesmo `GET` por outro usuário retorna `404` `VIDEO_NOT_FOUND`
- `POST …/reprocess` em vídeo `failed` com fonte presente retorna `200` `status: "processing"` e `processing_run` incrementado, publicando `video-process-{id}-{run}`
- `POST …/reprocess` em vídeo `ready` retorna `409` `INVALID_VIDEO_STATUS`

---

### SI-03.14 — Endpoints públicos: busca por URL única e thumbnail

**Route:** GET /videos/{publicId}; GET /videos/{publicId}/thumbnail
**Test Specs:** see `nestjs-project/specs/videos-public.plan.md`
**Authorization:** Anonymous (somente `ready`)

**Description:** Expõe o vídeo pelo identificador público único e serve a thumbnail a partir do bucket privado (`phase-03-videos/TD-07`, `phase-03-videos/TD-11`).

**Technical actions:**

1. Criar `src/videos/dto/public-video-response.dto.ts` e `VideoPlaybackService.findReady(publicId)` (formato inválido ou não `ready` ⇒ `VIDEO_NOT_FOUND`) (per `phase-03-videos/TD-11`)
2. Implementar `VideoPlaybackService.openThumbnail(publicId)` com `getObjectStream` (per `phase-03-videos/TD-03`)
3. Criar `src/videos/videos.controller.ts` (`@Controller('videos')`, `@Public()`, `@SkipThrottle()`, `@ApiTags('videos')`) com as duas rotas retornando `StreamableFile` para a imagem (per `phase-03-videos/TD-10` — ICC-1)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoPlaybackService` | Unit: formato inválido, não-ready, ready | `src/videos/video-playback.service.spec.ts` |

**Dependencies:** SI-03.8

**Acceptance criteria:**

- `GET /videos/{publicId}` de vídeo `ready`, sem token, retorna `200` com `title`, `duration_seconds` e `stream_url`
- O mesmo para vídeo `draft`/`processing`/`failed` retorna `404` `VIDEO_NOT_FOUND`
- `GET /videos/{publicId}/thumbnail` retorna `200` `image/jpeg` com corpo começando em `FF D8 FF`
- `GET /videos/abc` retorna `404`

---

### SI-03.15 — Endpoints públicos: streaming com Range/206 e download

**Route:** GET /videos/{publicId}/stream; GET /videos/{publicId}/download
**Test Specs:** see `nestjs-project/specs/videos-stream.plan.md`
**Authorization:** Anonymous (somente `ready`)

**Description:** Reprodução sem download completo e download do arquivo, com o proxy em stream da API validando Range (`phase-03-videos/TD-08`).

**Technical actions:**

1. Implementar `VideoPlaybackService.openStream(publicId, rangeHeader)` — `parseRange` contra `size_bytes`; `416` via `RangeNotSatisfiableException` (com tamanho para `Content-Range: bytes */size`); `getObjectStream(key, range)`; `NoSuchKey` ⇒ `VIDEO_SOURCE_MISSING` (per `phase-03-videos/TD-08`)
2. Adicionar `/stream` e `/download` ao `VideosController` usando `@Res({ passthrough: true })` para status `200/206` e headers (`Accept-Ranges`, `Content-Range`, `Content-Length`, `Content-Type`, `Content-Disposition` com `filename`/`filename*` sanitizados) retornando `StreamableFile` (sem buffer)
3. Fazer o `DomainExceptionFilter` acrescentar `Content-Range: bytes */size` quando a exceção for `RangeNotSatisfiableException`; documentar 200/206/404/416 no Swagger

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoPlaybackService.openStream` | Unit: sem range, parcial, insatisfazível, objeto ausente | `src/videos/video-playback.service.spec.ts` |
| `DomainExceptionFilter` | Unit: header `Content-Range` para 416 | `src/common/filters/domain-exception.filter.spec.ts` |

**Dependencies:** SI-03.14

**Acceptance criteria:**

- `GET /videos/{publicId}/stream` com `Range: bytes=0-1023` retorna `206`, `Content-Range: bytes 0-1023/{size}` e 1024 bytes idênticos ao início do arquivo
- Sem `Range` retorna `200`, `Accept-Ranges: bytes` e `Content-Length = size_bytes`
- `Range: bytes={size}-` retorna `416` com `Content-Range: bytes */{size}`
- `GET /videos/{publicId}/download` retorna `Content-Disposition: attachment` e o arquivo íntegro (mesmo SHA-256 do enviado)
- Vídeo não `ready` retorna `404` em ambas as rotas

---

### SI-03.16 — Limpeza de uploads abandonados

**Description:** Fecha o ciclo de sessões expiradas: aborta multipart órfão e marca o rascunho como `failed/UPLOAD_EXPIRED` (`specification.md` §4.2).

**Technical actions:**

1. Criar `src/videos/processing/upload-sweeper.service.ts` — `sweep(now)` em lotes: `abortMultipartUpload` + CAS `draft → failed` (`UPLOAD_EXPIRED`, `upload_id = null`, `failed_at`) (per `phase-03-videos/TD-03`, `phase-03-videos/TD-09`)
2. Agendar `uploads.sweep` no bootstrap do worker via `upsertJobScheduler` e despachar pelo `name` no `VideoProcessingProcessor` (per `phase-03-videos/TD-01`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `UploadSweeperService` | Integration (DB + MinIO reais): draft expirado ⇒ `failed/UPLOAD_EXPIRED` e multipart abortado; draft válido intocado; segunda execução é no-op | `src/videos/processing/upload-sweeper.service.integration-spec.ts` |

**Dependencies:** SI-03.12

**Acceptance criteria:**

- Um `draft` com `upload_expires_at` no passado termina `failed` com `failure_reason = 'UPLOAD_EXPIRED'` e `listParts` do seu `upload_id` falha com `NoSuchUpload`
- Um `draft` com sessão válida permanece `draft`
- O job agendado `uploads-sweep` existe na fila após o worker iniciar

---

### SI-03.17 — Fluxo completo e2e, contrato OpenAPI e procedimento de aceitação de 10 GiB

**Description:** Prova o fluxo ponta a ponta contra a stack real, atualiza o `openapi.json` e registra o procedimento reproduzível do limite de 10 GiB (`specification.md` §10, §11).

**Technical actions:**

1. Criar `test/videos.e2e-spec.ts`: registro/login → `POST /channels/me/videos` → `PUT` das partes nas URLs pré-assinadas → complete (2x) → worker in-process até `ready` → lookup, thumbnail, stream parcial `206`, download, casos de autorização/erro (fluxo integral; os cenários por endpoint vivem nos specs de `nestjs-project/specs/videos-*.plan.md`)
2. Regenerar `nestjs-project/openapi.json` (`npm run openapi:export`) e estender `test/swagger.e2e-spec.ts` para conferir as rotas de vídeo (per `openapi-docs-nestjs/TD-02`)
3. Criar `scripts/acceptance/ten-gib-boundary.ts` (executado no contêiner): via API real cria upload de exatamente 10737418240 bytes (160 partes), envia uma parte de 64 MiB pela URL pré-assinada, preenche as demais com `UploadPartCopy` server-side no mesmo `UploadId`, chama `…/upload/complete` e verifica `HeadObject = 10737418240`; confirma `400` para 10737418241; limpa o objeto
4. Registrar o procedimento e a evidência em `docs/phases/phase-03-videos/acceptance-10gib.md`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Swagger | E2E: documento contém as rotas `/channels/me/videos*` e `/videos/{publicId}*` | `test/swagger.e2e-spec.ts` |

**Dependencies:** SI-03.13, SI-03.15, SI-03.16

**Acceptance criteria:**

- `npm run test:e2e` executa o fluxo upload → `ready` → streaming/download com sucesso contra Postgres, MinIO, Redis e FFmpeg reais
- `openapi.json` contém as 9 operações de vídeo com os schemas dos DTOs
- O script de aceitação termina com um objeto de 10737418240 bytes montado no MinIO, com a API tendo trafegado apenas JSON (nenhum corpo binário em rotas da API)

---

### SI-03.18 — Documentação e instruções de agente

**Description:** Alinha documentação e instruções com o que existe de fato após a implementação (`specification.md` §11).

**Technical actions:**

1. Atualizar `CLAUDE.md` (raiz): fila = BullMQ/Redis, worker, MinIO
2. Atualizar `nestjs-project/CLAUDE.md`: novos serviços Compose e verificações (`minio`, `redis`, `worker`), endpoints/eventos de vídeo, comandos do worker e do teste de aceitação
3. Atualizar `docs/diagrams/software-arch.mermaid` (fila `BullMQ (Redis)`; streaming via API conforme `phase-03-videos/TD-08`) e `README.md` do backend se aplicável

**Tests:** _(empty — documentação)_

**Dependencies:** SI-03.17

**Acceptance criteria:**

- Toda rota, evento, serviço e comando citado nos arquivos de instrução existe no código/Compose
- O diagrama não contém mais `Message Queue "TBD"`

---

## Technical Specifications

### Data Model

#### Video (`videos`)

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, `uuid_generate_v4()` |
| channel_id | uuid | not null, FK → `channels(id)` ON DELETE NO ACTION |
| public_id | varchar(11) | not null, **unique** (`UQ_videos_public_id`) — base64url de 8 bytes aleatórios (`phase-03-videos/TD-07`) |
| title | varchar(100) | not null |
| status | enum `videos_status_enum` (`draft`, `processing`, `ready`, `failed`) | not null, default `draft` (`phase-03-videos/TD-09`) |
| original_filename | varchar(255) | not null — informativo; nunca usado em chaves de storage (`phase-03-videos/TD-03`) |
| content_type | varchar(100) | not null — allowlist `video/mp4`, `video/quicktime`, `video/webm`, `video/x-matroska` (`phase-03-videos/TD-10`) |
| size_bytes | bigint | not null, `CHECK (size_bytes > 0 AND size_bytes <= 10737418240)` — mapeado para `number` via transformer |
| storage_key | varchar(255) | not null, unique — `videos/{id}/source` (`phase-03-videos/TD-03`) |
| upload_id | varchar(1024) | null — UploadId do multipart; `null` após completar/abortar |
| upload_part_size | integer | not null — tamanho de parte fixado no início (64 MiB por padrão) |
| upload_part_count | integer | not null — `ceil(size_bytes / upload_part_size)` (1..10000) |
| upload_expires_at | timestamp | null — fim da sessão de upload (início + 24 h) |
| thumbnail_key | varchar(255) | null até `ready` — `videos/{id}/thumbnail.jpg` |
| duration_seconds | double precision | null até `ready` |
| metadata | jsonb | null até `ready` — `{ format_name, bit_rate, width, height, video_codec, audio_codec, frame_rate }` |
| processing_run | integer | not null, default 0 — incrementado a cada transição para `processing` (`phase-03-videos/TD-06` revisão) |
| failure_reason | varchar(64) | null — código interno (`INVALID_MEDIA`, `PROCESSING_FAILED`, `UPLOAD_EXPIRED`) |
| processed_at | timestamp | null |
| failed_at | timestamp | null |
| created_at | timestamp | default now() |
| updated_at | timestamp | default now() |

**Relations:** `Channel` has many `Video` (one-to-many; `Video.channel` `@ManyToOne` + `Channel.videos` `@OneToMany`).
**Indexes:** unique `public_id`; unique `storage_key`; `IDX_videos_channel_id` em `channel_id`; `IDX_videos_status_upload_expires_at` em (`status`, `upload_expires_at`) para o sweeper de uploads abandonados.
**Migration:** `CreateVideos{timestamp}` cria enum, tabela, constraints, índices e FK; `down` remove FK, índices, tabela e enum (rollback seguro). `synchronize` permanece `false`.

#### Storage objects (bucket privado `S3_BUCKET`, `phase-03-videos/TD-03`)

| Key | Writer | Content |
|-----|--------|---------|
| `videos/{id}/source` | cliente via URLs pré-assinadas de `UploadPart` | binário original (≤ 10 GiB) |
| `videos/{id}/thumbnail.jpg` | worker (`PutObject`, sobrescrita idempotente) | JPEG 640px de largura |

#### State machine (`phase-03-videos/TD-09`)

| From | To | Trigger | Guard |
|------|----|---------|-------|
| — | `draft` | `POST /channels/me/videos` | multipart criado |
| `draft` | `processing` | `POST /channels/me/videos/{id}/upload/complete` | partes completas + `HeadObject.ContentLength == size_bytes`; `processing_run += 1` |
| `draft` | `failed` | sweeper (sessão expirada) | `upload_expires_at < now()`; `failure_reason = UPLOAD_EXPIRED` |
| `processing` | `ready` | worker sucesso | `processing_run` do job == run atual |
| `processing` | `failed` | worker falha final (`attempts` esgotados ou `UnrecoverableError`) | `processing_run` do job == run atual |
| `failed` | `processing` | `POST /channels/me/videos/{id}/reprocess` | objeto fonte existe (`HeadObject`); `processing_run += 1` |

Toda transição é um `UPDATE … WHERE id = :id AND status = :from` (compare-and-set); 0 linhas afetadas ⇒ transição rejeitada (`INVALID_VIDEO_STATUS`) ou no-op idempotente conforme o caso.

### API Contracts

Convenções herdadas: envelope de erro `{ statusCode, error, message }` (`phase-02-auth/TD-07`), `ValidationPipe` global, rotas protegidas por padrão (`phase-02-auth/TD-02`). Rotas de dono ficam sob `/channels/me/videos` e rotas públicas sob `/videos/{publicId}` (`phase-03-videos/TD-11` revisão). Todas documentadas com `@ApiTags`/`@ApiOperation`/`@ApiResponse`/`@ApiBearerAuth('access-token')` e refletidas em `nestjs-project/openapi.json` (`openapi-docs-nestjs/TD-01`, `TD-02`).

#### POST /channels/me/videos (SI-03.9)

**Request headers:**
- Authorization: Bearer {access_token}
- Content-Type: application/json

**Request body:**
- title: string, required — 1..100 caracteres (trim)
- filename: string, required — 1..255 caracteres
- content_type: string, required — um de `video/mp4`, `video/quicktime`, `video/webm`, `video/x-matroska`
- size_bytes: integer, required — 1..10737418240

**Response 201:** `VideoUploadResponseDto`
- id: string (uuid)
- public_id: string (11 chars)
- status: `"draft"`
- upload: `{ part_size: number, part_count: number, expires_at: ISO-8601, url_expires_at: ISO-8601, parts: [{ part_number: number, url: string }] }` — URLs pré-assinadas de `UploadPart` (1 h) para todas as partes; o cliente faz `PUT` de cada fatia `[(n-1)*part_size, min(n*part_size, size_bytes))` diretamente no storage

**Error responses:**
- 400 VALIDATION_ERROR: corpo inválido (inclui `size_bytes` > 10737418240 e `content_type` fora da allowlist)
- 401: token ausente/inválido
- 404 CHANNEL_NOT_FOUND: usuário autenticado sem canal
- 413 VIDEO_TOO_LARGE: acima de `VIDEO_MAX_SIZE_BYTES` (quando configurado abaixo de 10 GiB)
- 503 STORAGE_UNAVAILABLE: falha ao criar o multipart upload

---

#### GET /channels/me/videos/{id}/upload (SI-03.10)

**Request headers:**
- Authorization: Bearer {access_token}

**Path parameters:**
- id: uuid

**Response 200:** `UploadSessionResponseDto`
- part_size, part_count, expires_at, url_expires_at
- uploaded_parts: `[{ part_number, size }]` — partes já presentes (`ListParts`)
- parts: `[{ part_number, url }]` — novas URLs apenas para partes faltantes (retomada / renovação de URLs expiradas)

**Error responses:**
- 400 VALIDATION_ERROR: `id` não é UUID
- 401
- 404 VIDEO_NOT_FOUND: inexistente ou de outro canal
- 409 INVALID_VIDEO_STATUS: vídeo não está em `draft`
- 410 UPLOAD_EXPIRED: `upload_expires_at` vencido

---

#### POST /channels/me/videos/{id}/upload/complete (SI-03.10)

**Request headers:**
- Authorization: Bearer {access_token}

**Request body:** nenhum (partes lidas do storage via `ListParts` — `phase-03-videos/TD-02` revisão)

**Response 200:** `VideoResponseDto` com `status: "processing"` (ou o estado atual quando já `processing`/`ready` — idempotente; nesse caso o job do run atual é re-publicado com o mesmo `jobId`)

**Error responses:**
- 401
- 404 VIDEO_NOT_FOUND
- 409 INVALID_VIDEO_STATUS: vídeo `failed`
- 409 UPLOAD_INCOMPLETE: partes faltantes ou com tamanho inesperado
- 410 UPLOAD_EXPIRED
- 422 UPLOAD_SIZE_MISMATCH: `HeadObject.ContentLength` ≠ `size_bytes`
- 503 STORAGE_UNAVAILABLE / QUEUE_UNAVAILABLE: falha de infraestrutura (estado permanece consistente; repetir a chamada é seguro)

---

#### GET /channels/me/videos/{id} (SI-03.13)

**Request headers:** Authorization: Bearer {access_token}

**Response 200:** `VideoResponseDto`
- id, public_id, title, status, content_type, size_bytes, duration_seconds (nullable), metadata (nullable), has_thumbnail: boolean, failure_reason (nullable — somente código), processing_run, created_at, updated_at

**Error responses:** 400 VALIDATION_ERROR (id não-UUID), 401, 404 VIDEO_NOT_FOUND

---

#### POST /channels/me/videos/{id}/reprocess (SI-03.13)

**Request headers:** Authorization: Bearer {access_token}

**Response 200:** `VideoResponseDto` com `status: "processing"` e `processing_run` incrementado

**Error responses:** 401, 404 VIDEO_NOT_FOUND, 409 INVALID_VIDEO_STATUS (não está `failed`), 409 VIDEO_SOURCE_MISSING (objeto fonte ausente), 503 QUEUE_UNAVAILABLE

---

#### GET /videos/{publicId} (SI-03.14) — público

**Response 200:** `PublicVideoResponseDto` — public_id, title, duration_seconds, content_type, size_bytes, metadata, created_at, `stream_url` (`/videos/{publicId}/stream`), `download_url`, `thumbnail_url`

**Error responses:** 404 VIDEO_NOT_FOUND (inexistente **ou** não `ready`)

---

#### GET /videos/{publicId}/thumbnail (SI-03.14) — público

**Response 200:** `image/jpeg` (stream), `Content-Length`, `Cache-Control: public, max-age=300`

**Error responses:** 404 VIDEO_NOT_FOUND

---

#### GET /videos/{publicId}/stream (SI-03.15) — público

**Request headers:**
- Range: opcional, `bytes=start-end` | `bytes=start-` | `bytes=-suffix` (RFC 9110 §14)

**Response 200:** sem `Range` (ou `Range` sintaticamente inválido/múltiplo — ignorado conforme RFC 9110 §14.2): corpo completo, `Accept-Ranges: bytes`, `Content-Length`, `Content-Type` do vídeo

**Response 206:** intervalo válido: `Content-Range: bytes start-end/size`, `Content-Length = end-start+1`, `Accept-Ranges: bytes`, `Content-Type`

**Error responses:**
- 404 VIDEO_NOT_FOUND
- 404 VIDEO_SOURCE_MISSING: vídeo `ready` cujo objeto sumiu do storage
- 416 RANGE_NOT_SATISFIABLE: intervalo fora do arquivo; header `Content-Range: bytes */size`

---

#### GET /videos/{publicId}/download (SI-03.15) — público

Mesmo comportamento de `/stream` (inclusive Range/206 para downloads retomáveis) acrescido de `Content-Disposition: attachment; filename="{nome ASCII}"; filename*=UTF-8''{nome codificado}` derivado de `original_filename`.

---

#### Validation Rules — videos

- `title`: string, trim, 1..100
- `filename`: string, 1..255
- `content_type`: `IsIn([...])` allowlist
- `size_bytes`: inteiro, `Min(1)`, `Max(10737418240)` (`phase-03-videos/TD-10` — AMB-1)
- `id` em rotas de dono: `ParseUUIDPipe`
- `publicId`: `^[A-Za-z0-9_-]{11}$`; formato inválido ⇒ 404 VIDEO_NOT_FOUND (sem vazar existência)

### Authorization Matrix

| Endpoint | Anonymous | Authenticated (não dono) | Owner |
|----------|-----------|--------------------------|-------|
| POST /channels/me/videos | ✗ 401 | ✓ (cria no próprio canal) | ✓ |
| GET /channels/me/videos/{id} | ✗ 401 | ✗ 404 | ✓ |
| GET /channels/me/videos/{id}/upload | ✗ 401 | ✗ 404 | ✓ |
| POST /channels/me/videos/{id}/upload/complete | ✗ 401 | ✗ 404 | ✓ |
| POST /channels/me/videos/{id}/reprocess | ✗ 401 | ✗ 404 | ✓ |
| GET /videos/{publicId} | ✓ se `ready` | ✓ se `ready` | ✓ se `ready` |
| GET /videos/{publicId}/thumbnail | ✓ se `ready` | ✓ se `ready` | ✓ se `ready` |
| GET /videos/{publicId}/stream | ✓ se `ready` | ✓ se `ready` | ✓ se `ready` |
| GET /videos/{publicId}/download | ✓ se `ready` | ✓ se `ready` | ✓ se `ready` |

Identidade: `@CurrentUser().sub` → `ChannelsService.findByUserId` → `channel.id`; vídeos de outro canal respondem `404` (`phase-03-videos/TD-11`). Throttling: rotas públicas `@SkipThrottle()`; rotas de dono mantêm o `ThrottlerGuard` global (`phase-03-videos/TD-10` — ICC-1).

### Error Catalog

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| CHANNEL_NOT_FOUND | 404 | Usuário autenticado sem canal ao iniciar upload |
| VIDEO_NOT_FOUND | 404 | Vídeo inexistente, de outro canal (rotas de dono) ou não `ready` (rotas públicas) |
| INVALID_VIDEO_STATUS | 409 | Operação não permitida no status atual (transição inválida) |
| UPLOAD_EXPIRED | 410 | Sessão de upload (`upload_expires_at`) vencida |
| VIDEO_TOO_LARGE | 413 | `size_bytes` acima de `VIDEO_MAX_SIZE_BYTES` quando configurado abaixo do limite rígido de 10 GiB (adicionado na implementação do SI-03.9) |
| UPLOAD_INCOMPLETE | 409 | Partes faltantes ou com tamanho divergente ao completar |
| UPLOAD_SIZE_MISMATCH | 422 | Objeto montado com tamanho ≠ `size_bytes` declarado |
| VIDEO_SOURCE_MISSING | 404 / 409 | Objeto fonte ausente (404 em streaming/download; 409 em reprocess) |
| RANGE_NOT_SATISFIABLE | 416 | `Range` fora dos limites do arquivo |
| STORAGE_UNAVAILABLE | 503 | Falha de comunicação com S3/MinIO |
| QUEUE_UNAVAILABLE | 503 | Falha ao publicar job no Redis/BullMQ |
| VALIDATION_ERROR | 400 | Herdado — `ValidationPipe` |

Códigos internos de falha persistidos em `videos.failure_reason` (não são respostas HTTP): `INVALID_MEDIA` (ffprobe sem stream de vídeo/duração), `PROCESSING_FAILED` (erro transitório após esgotar tentativas), `UPLOAD_EXPIRED` (sweeper). Detalhes técnicos (stderr do ffmpeg, erros do SDK) vão apenas para logs correlacionados por `videoId`/`jobId`.

### Events/Messages

#### video.process (fila `video-processing`)

**Payload (v1):**

```json
{ "version": 1, "videoId": "uuid", "processingRun": 1 }
```

**Producer:** `VideoProcessingQueue` (API — `VideosService.completeUpload` e `reprocess`) (per `phase-03-videos/TD-01`, `phase-03-videos/TD-05`)
**Consumer:** `VideoProcessingProcessor` → `VideoProcessingService` no contêiner `worker` (per `phase-03-videos/TD-04`)
**Trigger:** transição `draft → processing` (completar upload) ou `failed → processing` (reprocess); re-publicado quando completar é chamado de novo para um vídeo já `processing`
**Job options:** `jobId = video-process-{videoId}-{processingRun}` (deduplicação), `attempts: 3`, `backoff: { type: 'exponential', delay: 10000 }`, `removeOnComplete: { age: 86400 }`, `removeOnFail: { age: 604800 }` (failed set = DLQ por 7 dias) (per `phase-03-videos/TD-06`)
**Idempotency:** consumidor recarrega o vídeo; ignora (completa sem efeito) se `status != processing` ou `processing_run != processingRun`; thumbnail com chave determinística; transição final por compare-and-set
**Failure:** `version` desconhecida ou mídia inválida ⇒ `UnrecoverableError` (sem retry) ⇒ `failed/INVALID_MEDIA`; erro transitório ⇒ retry com backoff; última tentativa falha ⇒ `failed/PROCESSING_FAILED`
**Delivery semantics:** at-least-once (per `phase-03-videos/TD-05`)

#### uploads.sweep (fila `video-processing`, job agendado)

**Payload:** `{ "version": 1 }`
**Producer:** `UploadSweeperScheduler` no worker (`queue.upsertJobScheduler('uploads-sweep', { every: UPLOAD_SWEEP_INTERVAL_MS })`)
**Consumer:** `VideoProcessingProcessor` → `UploadSweeperService`
**Trigger:** periódico (padrão 15 min)
**Effect:** para cada vídeo `draft` com `upload_expires_at < now()` (lote de 100): `AbortMultipartUpload` (ignora `NoSuchUpload`) + CAS `draft → failed/UPLOAD_EXPIRED` (per `phase-03-videos/TD-03`)
**Delivery semantics:** at-least-once; operação idempotente

---

## Dependency Map

```
SI-03.1 (root)
└── SI-03.2 — depends on SI-03.1 (stack must start from .env.example)
    ├── SI-03.3 — depends on SI-03.2 (config points at minio/redis services)
    │   ├── SI-03.4 — depends on SI-03.3 (entity/migration in configured app)
    │   └── SI-03.7 — depends on SI-03.3 (storage config)
    └── SI-03.11 — depends on SI-03.2 (ffmpeg binary in the image)
SI-03.5 (root, independent)
SI-03.6 (root, independent)
SI-03.8 — depends on SI-03.4 + SI-03.5 + SI-03.6 + SI-03.7
├── SI-03.9 — depends on SI-03.8 (repository + storage)
│   └── SI-03.10 — depends on SI-03.9 (draft + multipart exist)
│       ├── SI-03.12 — depends on SI-03.10 + SI-03.11 (jobs published; media probe)
│       │   └── SI-03.16 — depends on SI-03.12 (worker hosts the scheduler)
│       └── SI-03.13 — depends on SI-03.10 (queue producer for reprocess)
└── SI-03.14 — depends on SI-03.8 (ready lookup)
    └── SI-03.15 — depends on SI-03.14 (public controller)
SI-03.17 — depends on SI-03.13 + SI-03.15 + SI-03.16 (full flow)
└── SI-03.18 — depends on SI-03.17 (docs reflect final code)
```

Ordem de execução: SI-03.1 → 03.2 → 03.3 → 03.4 → 03.5 → 03.6 → 03.7 → 03.8 → 03.9 → 03.10 → 03.11 → 03.12 → 03.13 → 03.14 → 03.15 → 03.16 → 03.17 → 03.18.

---

## Deliverables

- [ ] SI-03.1 — Infra: corrigir `.env.example` herdado (DG-2)
- [ ] SI-03.2 — Infra: MinIO, inicialização do bucket, Redis e FFmpeg no Compose
- [ ] SI-03.3 — Infra: dependências e namespaces de configuração
- [ ] SI-03.4 — Entidade `Video`, migration e relação com `Channel`
- [ ] SI-03.5 — Consulta do canal do usuário
- [ ] SI-03.6 — Primitivas de domínio
- [ ] SI-03.7 — StorageModule
- [ ] SI-03.8 — VideosRepository
- [ ] SI-03.9 — Endpoint: iniciar upload
- [ ] SI-03.10 — Endpoints: sessão de upload e conclusão idempotente
- [ ] SI-03.11 — MediaProbeService
- [ ] SI-03.12 — Worker FFmpeg em contêiner separado
- [ ] SI-03.13 — Endpoints do dono: consultar e reprocessar
- [ ] SI-03.14 — Endpoints públicos: busca e thumbnail
- [ ] SI-03.15 — Endpoints públicos: streaming Range/206 e download
- [ ] SI-03.16 — Limpeza de uploads abandonados
- [ ] SI-03.17 — Fluxo e2e, OpenAPI e aceitação de 10 GiB
- [ ] SI-03.18 — Documentação e instruções de agente

**Full test suites:**

- [ ] Backend tests pass (`cd nestjs-project && docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`cd nestjs-project && docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`cd nestjs-project && docker compose exec nestjs-api npm run lint`)
- [ ] Stack healthy (`docker compose ps`: db, mailpit, minio, redis, worker healthy; minio-init exited 0)

**Requirement traceability** (`specification.md` → TD → SI → tests):

| Requirement (specification.md) | TDs | SIs | Evidence (tests) |
|---|---|---|---|
| §4.1 auth + canal + `draft` + chaves/ID + estratégia multipart; API não proxia o binário | TD-02, TD-03, TD-07, TD-11 | 03.5, 03.6, 03.8, 03.9 | `videos.service.spec`, `videos.repository.integration-spec`, `videos.e2e-spec` |
| §4.2 completar verificando storage; idempotente; `draft→processing`; job; abandono/órfãos/URLs expiradas | TD-02, TD-03, TD-06, TD-09 | 03.10, 03.16 | `videos.service.integration-spec`, `video-processing.queue.integration-spec`, `upload-sweeper.service.integration-spec` |
| §4.3 worker separado, fila real, sem carregar em memória, ffprobe, thumbnail, `ready`/`failed`, retries/DLQ | TD-01, TD-04, TD-05, TD-06 | 03.11, 03.12 | `media-probe.service.integration-spec`, `video-processing.integration-spec` |
| §4.4 lookup público, Range/206, download attachment, decisão proxy vs redirect, não servir não-`ready` | TD-08, TD-11 | 03.14, 03.15 | `range.util.spec`, `video-playback.service.spec`, `videos.e2e-spec` |
| §5 tabela `videos` + FK + constraints + rollback | TD-07, TD-09 | 03.4 | `video.entity.integration-spec`, `migrations.integration-spec` |
| §8 limites/MIME, transições, transações, throttling, observabilidade | TD-09, TD-10 | 03.6, 03.9, 03.12 | `video-status.transitions.spec`, `upload-plan.util.spec`, e2e de validação |
| §9 Compose MinIO/fila/worker com health checks; `.env.example` | TD-01, TD-03, TD-04 | 03.1, 03.2, 03.3, 03.12 | `docker compose ps` (evidência em `progress.md`) |
| §10 10 GiB sem proxy (procedimento reproduzível) | TD-02, TD-10 | 03.17 | `scripts/acceptance/ten-gib-boundary.ts` + `acceptance-10gib.md` |
| §7/§11 OpenAPI, docs e instruções coerentes | openapi-docs-nestjs/TD-01..02 | 03.9, 03.10, 03.13–03.15, 03.17, 03.18 | `swagger.e2e-spec`, `openapi.json` |
