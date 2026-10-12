import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1791755538915 implements MigrationInterface {
  name = 'CreateVideos1791755538915';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('draft', 'processing', 'ready', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channel_id" uuid NOT NULL, "public_id" character varying(11) NOT NULL, "title" character varying(100) NOT NULL, "status" "public"."videos_status_enum" NOT NULL DEFAULT 'draft', "original_filename" character varying(255) NOT NULL, "content_type" character varying(100) NOT NULL, "size_bytes" bigint NOT NULL, "storage_key" character varying(255) NOT NULL, "upload_id" character varying(1024), "upload_part_size" integer NOT NULL, "upload_part_count" integer NOT NULL, "upload_expires_at" TIMESTAMP, "thumbnail_key" character varying(255), "duration_seconds" double precision, "metadata" jsonb, "processing_run" integer NOT NULL DEFAULT '0', "failure_reason" character varying(64), "processed_at" TIMESTAMP, "failed_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "CHK_videos_size_bytes" CHECK ("size_bytes" > 0 AND "size_bytes" <= 10737418240), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_videos_public_id" ON "videos" ("public_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_videos_storage_key" ON "videos" ("storage_key") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_status_upload_expires_at" ON "videos" ("status", "upload_expires_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_id" ON "videos" ("channel_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_channel_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_videos_status_upload_expires_at"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_videos_storage_key"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_videos_public_id"`);
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
  }
}
