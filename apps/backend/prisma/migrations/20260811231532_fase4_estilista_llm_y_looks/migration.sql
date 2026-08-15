-- CreateEnum
CREATE TYPE "OutfitItemRole" AS ENUM ('BASE', 'LAYER', 'FOOTWEAR', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "LookOccasion" AS ENUM ('DAILY', 'WORK', 'CASUAL_OUTING', 'DINNER', 'EVENT', 'TRAVEL', 'SPORT');

-- CreateEnum
CREATE TYPE "OutfitSource" AS ENUM ('AI', 'MANUAL');

-- CreateEnum
CREATE TYPE "OutfitFeedbackKind" AS ENUM ('RATING', 'FAVORITE', 'REJECTED', 'WORN');

-- CreateEnum
CREATE TYPE "OutfitRejectedReason" AS ENUM ('COLOR', 'TOO_FORMAL', 'TOO_CASUAL', 'UNCOMFORTABLE', 'NOT_MY_STYLE', 'GARMENT_UNAVAILABLE');

-- CreateTable
CREATE TABLE "outfits" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "style_tag" "StyleArchetype" NOT NULL,
    "one_liner" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "occasions" "LookOccasion"[],
    "style_notes" TEXT[],
    "fit_notes" TEXT[],
    "color_palette" TEXT[],
    "reference_brands" JSONB NOT NULL,
    "quality_note" TEXT,
    "weather_min_c" INTEGER,
    "weather_max_c" INTEGER,
    "engine_score" INTEGER NOT NULL,
    "source" "OutfitSource" NOT NULL DEFAULT 'AI',
    "engine_version" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "model_used" TEXT,
    "candidate_set_hash" TEXT NOT NULL,
    "generation_snapshot" JSONB NOT NULL,
    "job_id" UUID,
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "rating" INTEGER,
    "rejected_reason" "OutfitRejectedReason",
    "worn_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outfits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outfit_items" (
    "id" UUID NOT NULL,
    "outfit_id" UUID NOT NULL,
    "garment_id" UUID NOT NULL,
    "slot" "GarmentSlot" NOT NULL,
    "role" "OutfitItemRole" NOT NULL,
    "why" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outfit_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outfit_feedback" (
    "id" UUID NOT NULL,
    "outfit_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "OutfitFeedbackKind" NOT NULL,
    "rating" INTEGER,
    "reason" "OutfitRejectedReason",
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outfit_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outfits_user_id_created_at_idx" ON "outfits"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "outfits_user_id_is_favorite_idx" ON "outfits"("user_id", "is_favorite");

-- CreateIndex
CREATE INDEX "outfits_job_id_idx" ON "outfits"("job_id");

-- CreateIndex
CREATE INDEX "outfit_items_garment_id_idx" ON "outfit_items"("garment_id");

-- CreateIndex
CREATE UNIQUE INDEX "outfit_items_outfit_id_garment_id_key" ON "outfit_items"("outfit_id", "garment_id");

-- CreateIndex
CREATE INDEX "outfit_feedback_outfit_id_idx" ON "outfit_feedback"("outfit_id");

-- CreateIndex
CREATE INDEX "outfit_feedback_user_id_created_at_idx" ON "outfit_feedback"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "outfits" ADD CONSTRAINT "outfits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfits" ADD CONSTRAINT "outfits_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_items" ADD CONSTRAINT "outfit_items_outfit_id_fkey" FOREIGN KEY ("outfit_id") REFERENCES "outfits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_items" ADD CONSTRAINT "outfit_items_garment_id_fkey" FOREIGN KEY ("garment_id") REFERENCES "garments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_feedback" ADD CONSTRAINT "outfit_feedback_outfit_id_fkey" FOREIGN KEY ("outfit_id") REFERENCES "outfits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_feedback" ADD CONSTRAINT "outfit_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
