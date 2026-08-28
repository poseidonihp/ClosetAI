-- AlterTable
ALTER TABLE "purchase_advices" ADD COLUMN     "baseline_best_score" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "best_outfit_scenario_label" TEXT,
ADD COLUMN     "best_outfit_score" INTEGER NOT NULL DEFAULT 0;
