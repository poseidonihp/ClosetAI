-- CreateEnum
CREATE TYPE "OutfitRenderKind" AS ENUM ('AI_MODEL');

-- CreateTable
CREATE TABLE "outfit_renders" (
    "id" UUID NOT NULL,
    "outfit_id" UUID NOT NULL,
    "kind" "OutfitRenderKind" NOT NULL DEFAULT 'AI_MODEL',
    "image_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "model_used" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "prompt_used" TEXT NOT NULL,
    "job_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outfit_renders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outfit_renders_outfit_id_idx" ON "outfit_renders"("outfit_id");

-- CreateIndex
CREATE INDEX "outfit_renders_job_id_idx" ON "outfit_renders"("job_id");

-- AddForeignKey
ALTER TABLE "outfit_renders" ADD CONSTRAINT "outfit_renders_outfit_id_fkey" FOREIGN KEY ("outfit_id") REFERENCES "outfits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_renders" ADD CONSTRAINT "outfit_renders_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
