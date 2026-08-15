-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'NON_BINARY', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "PresentationPreference" AS ENUM ('MASCULINE', 'FEMININE', 'ANDROGYNOUS', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "BodyShape" AS ENUM ('RECTANGLE', 'TRIANGLE', 'INVERTED_TRIANGLE', 'HOURGLASS', 'OVAL');

-- CreateEnum
CREATE TYPE "FitPreference" AS ENUM ('RELAXED', 'REGULAR', 'SLIM', 'OVERSIZED');

-- CreateEnum
CREATE TYPE "StyleArchetype" AS ENUM ('MINIMALIST', 'SMART_CASUAL', 'CLASSIC', 'STREETWEAR', 'BOHO', 'ROMANTIC', 'ANDROGYNOUS', 'SPORTY');

-- CreateEnum
CREATE TYPE "BudgetTier" AS ENUM ('BUDGET', 'MID', 'PREMIUM', 'LUXURY');

-- CreateEnum
CREATE TYPE "Climate" AS ENUM ('HOT', 'WARM', 'TEMPERATE', 'COOL', 'COLD', 'VARIABLE');

-- CreateEnum
CREATE TYPE "GarmentSlot" AS ENUM ('TOP', 'MID_LAYER', 'OUTERWEAR', 'BOTTOM', 'FULL_BODY', 'FOOTWEAR', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "AppliesTo" AS ENUM ('MALE', 'FEMALE', 'BOTH');

-- CreateEnum
CREATE TYPE "Season" AS ENUM ('SPRING', 'SUMMER', 'AUTUMN', 'WINTER');

-- CreateEnum
CREATE TYPE "GarmentPattern" AS ENUM ('SOLID', 'STRIPED', 'CHECKED', 'FLORAL', 'GRAPHIC', 'ANIMAL', 'GEOMETRIC', 'OTHER');

-- CreateEnum
CREATE TYPE "PatternScale" AS ENUM ('NONE', 'SMALL', 'MEDIUM', 'LARGE');

-- CreateEnum
CREATE TYPE "GarmentMaterial" AS ENUM ('COTTON', 'DENIM', 'WOOL', 'LINEN', 'LEATHER', 'SYNTHETIC', 'SILK', 'KNIT', 'BLEND', 'OTHER');

-- CreateEnum
CREATE TYPE "GarmentStatus" AS ENUM ('ACTIVE', 'LAUNDRY', 'STORED', 'DONATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TaggingStatus" AS ENUM ('PENDING', 'SUGGESTED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "GarmentImageKind" AS ENUM ('ORIGINAL', 'THUMB', 'DETAIL');

-- CreateTable
CREATE TABLE "style_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "gender" "Gender",
    "height_cm" INTEGER,
    "weight_kg" INTEGER,
    "body_shape" "BodyShape",
    "shoe_size" TEXT,
    "skin_tone" TEXT,
    "hair_color" TEXT,
    "measurements" JSONB,
    "presentation_preferences" "PresentationPreference"[],
    "style_archetypes" "StyleArchetype"[],
    "preferred_fits" "FitPreference"[],
    "avoided_colors" TEXT[],
    "budget_tier" "BudgetTier",
    "country" TEXT,
    "currency" TEXT,
    "city" TEXT,
    "climate" "Climate",
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "style_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garment_types" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slot" "GarmentSlot" NOT NULL,
    "applies_to" "AppliesTo" NOT NULL DEFAULT 'BOTH',
    "default_formality" INTEGER NOT NULL DEFAULT 3,
    "typical_seasons" "Season"[],
    "default_weather_min_c" INTEGER,
    "default_weather_max_c" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "garment_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slot" "GarmentSlot" NOT NULL,
    "garment_type_id" UUID NOT NULL,
    "primary_color_hex" TEXT NOT NULL,
    "primary_color_name" TEXT NOT NULL,
    "secondary_color_hex" TEXT,
    "pattern" "GarmentPattern" NOT NULL DEFAULT 'SOLID',
    "pattern_scale" "PatternScale" NOT NULL DEFAULT 'NONE',
    "material" "GarmentMaterial" NOT NULL DEFAULT 'OTHER',
    "fit" "FitPreference" NOT NULL DEFAULT 'REGULAR',
    "formality" INTEGER NOT NULL DEFAULT 3,
    "seasons" "Season"[],
    "weather_min_c" INTEGER,
    "weather_max_c" INTEGER,
    "brand" TEXT,
    "brand_guess" TEXT,
    "size" TEXT,
    "ai_attributes" JSONB,
    "attribute_confidence" JSONB,
    "tagging_version" TEXT,
    "tagged_at" TIMESTAMPTZ(3),
    "tagging_status" "TaggingStatus" NOT NULL DEFAULT 'PENDING',
    "status" "GarmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "wear_count" INTEGER NOT NULL DEFAULT 0,
    "last_worn_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "garments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garment_images" (
    "id" UUID NOT NULL,
    "garment_id" UUID NOT NULL,
    "kind" "GarmentImageKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garment_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AvoidedGarmentTypes" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_AvoidedGarmentTypes_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "style_profiles_user_id_key" ON "style_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "garment_types_slug_key" ON "garment_types"("slug");

-- CreateIndex
CREATE INDEX "garment_types_slot_idx" ON "garment_types"("slot");

-- CreateIndex
CREATE INDEX "garments_user_id_status_idx" ON "garments"("user_id", "status");

-- CreateIndex
CREATE INDEX "garments_user_id_slot_idx" ON "garments"("user_id", "slot");

-- CreateIndex
CREATE INDEX "garments_garment_type_id_idx" ON "garments"("garment_type_id");

-- CreateIndex
CREATE INDEX "garment_images_garment_id_idx" ON "garment_images"("garment_id");

-- CreateIndex
CREATE UNIQUE INDEX "garment_images_garment_id_kind_sort_order_key" ON "garment_images"("garment_id", "kind", "sort_order");

-- CreateIndex
CREATE INDEX "_AvoidedGarmentTypes_B_index" ON "_AvoidedGarmentTypes"("B");

-- AddForeignKey
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garments" ADD CONSTRAINT "garments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garments" ADD CONSTRAINT "garments_garment_type_id_fkey" FOREIGN KEY ("garment_type_id") REFERENCES "garment_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_images" ADD CONSTRAINT "garment_images_garment_id_fkey" FOREIGN KEY ("garment_id") REFERENCES "garments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AvoidedGarmentTypes" ADD CONSTRAINT "_AvoidedGarmentTypes_A_fkey" FOREIGN KEY ("A") REFERENCES "garment_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AvoidedGarmentTypes" ADD CONSTRAINT "_AvoidedGarmentTypes_B_fkey" FOREIGN KEY ("B") REFERENCES "style_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
