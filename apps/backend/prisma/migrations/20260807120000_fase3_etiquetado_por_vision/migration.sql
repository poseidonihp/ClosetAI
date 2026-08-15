-- Fase 3 — etiquetado automático por visión.
-- Añade el estado FAILED al ciclo de etiquetado, enlaza la prenda con su último
-- job de visión (para que la UI muestre progreso, reintento y costo) y guarda
-- qué atributos tocó el usuario a mano, que un reprocesamiento no debe pisar.

ALTER TYPE "TaggingStatus" ADD VALUE 'FAILED';

ALTER TABLE "garments" ADD COLUMN "tagging_job_id" UUID;
ALTER TABLE "garments" ADD COLUMN "manual_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "garments_tagging_job_id_idx" ON "garments"("tagging_job_id");

ALTER TABLE "garments"
  ADD CONSTRAINT "garments_tagging_job_id_fkey"
  FOREIGN KEY ("tagging_job_id") REFERENCES "ai_jobs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
