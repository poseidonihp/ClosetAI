-- AlterTable
ALTER TABLE "purchase_advices" ADD COLUMN     "alternative_gap_id" UUID,
ADD COLUMN     "alternative_label" TEXT,
ADD COLUMN     "alternative_note" TEXT;
