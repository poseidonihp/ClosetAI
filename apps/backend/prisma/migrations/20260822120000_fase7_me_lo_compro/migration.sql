-- CreateEnum
CREATE TYPE "GarmentOwnership" AS ENUM ('OWNED', 'CONSIDERED');

-- CreateEnum
CREATE TYPE "PurchaseAdviceStatus" AS ENUM ('OPEN', 'PURCHASED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "PurchaseVerdict" AS ENUM ('RECOMMENDED', 'CONDITIONAL', 'NOT_RECOMMENDED');

-- CreateEnum
CREATE TYPE "PurchaseVerdictReason" AS ENUM ('AVOIDED_COLOR', 'AVOIDED_TYPE', 'MATCHES_GAP', 'COVERS_SCENARIO', 'UNLOCKS_OUTFITS', 'IMPROVES_SCORE', 'DUPLICATE', 'NO_IMPACT', 'UNUSABLE_IMAGE', 'NO_CONFIRMED_WARDROBE', 'PENDING_ATTRIBUTES');

-- AlterEnum
ALTER TYPE "AiJobKind" ADD VALUE 'PURCHASE_ADVICE';

-- AlterTable
ALTER TABLE "garments" ADD COLUMN     "ownership" "GarmentOwnership" NOT NULL DEFAULT 'OWNED';

-- CreateTable
CREATE TABLE "purchase_advices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "garment_id" UUID NOT NULL,
    "status" "PurchaseAdviceStatus" NOT NULL DEFAULT 'OPEN',
    "verdict" "PurchaseVerdict" NOT NULL,
    "verdict_reason" "PurchaseVerdictReason" NOT NULL,
    "headline" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "styling_notes" TEXT[],
    "unlocked_outfits_estimate" INTEGER NOT NULL,
    "outfits_using_it_estimate" INTEGER NOT NULL,
    "score_gain_points" INTEGER NOT NULL,
    "paired_garment_ids" UUID[],
    "duplicate_garment_ids" UUID[],
    "matched_gap_id" UUID,
    "measure_version" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "model_used" TEXT,
    "analysis_snapshot" JSONB NOT NULL,
    "job_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_advices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_advices_garment_id_key" ON "purchase_advices"("garment_id");

-- CreateIndex
CREATE INDEX "purchase_advices_user_id_status_idx" ON "purchase_advices"("user_id", "status");

-- CreateIndex
CREATE INDEX "purchase_advices_job_id_idx" ON "purchase_advices"("job_id");

-- CreateIndex
CREATE INDEX "garments_user_id_ownership_idx" ON "garments"("user_id", "ownership");

-- AddForeignKey
ALTER TABLE "purchase_advices" ADD CONSTRAINT "purchase_advices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_advices" ADD CONSTRAINT "purchase_advices_garment_id_fkey" FOREIGN KEY ("garment_id") REFERENCES "garments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_advices" ADD CONSTRAINT "purchase_advices_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
