-- CreateEnum
CREATE TYPE "WardrobeGapStatus" AS ENUM ('OPEN', 'PURCHASED', 'DISMISSED');

-- CreateTable
CREATE TABLE "wardrobe_gaps" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "WardrobeGapStatus" NOT NULL DEFAULT 'OPEN',
    "priority" INTEGER NOT NULL,
    "slot" "GarmentSlot" NOT NULL,
    "garment_type_id" UUID NOT NULL,
    "color_name" TEXT NOT NULL,
    "color_hex" TEXT NOT NULL,
    "formality" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "unlocked_outfits_estimate" INTEGER NOT NULL,
    "reference_brands" JSONB NOT NULL,
    "coverage_version" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "model_used" TEXT,
    "analysis_snapshot" JSONB NOT NULL,
    "job_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wardrobe_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wardrobe_gaps_user_id_status_idx" ON "wardrobe_gaps"("user_id", "status");

-- CreateIndex
CREATE INDEX "wardrobe_gaps_garment_type_id_idx" ON "wardrobe_gaps"("garment_type_id");

-- CreateIndex
CREATE INDEX "wardrobe_gaps_job_id_idx" ON "wardrobe_gaps"("job_id");

-- AddForeignKey
ALTER TABLE "wardrobe_gaps" ADD CONSTRAINT "wardrobe_gaps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wardrobe_gaps" ADD CONSTRAINT "wardrobe_gaps_garment_type_id_fkey" FOREIGN KEY ("garment_type_id") REFERENCES "garment_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wardrobe_gaps" ADD CONSTRAINT "wardrobe_gaps_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
