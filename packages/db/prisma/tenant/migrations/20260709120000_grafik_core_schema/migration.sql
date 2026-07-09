-- Grafik core (Rdzeń Grafiku) skeleton: Lokalizacja + ShiftTemplate/ShiftDemand/Shift and the
-- Employee grafik columns. Migration-safe on existing rows: every new employees column is either
-- nullable (home_address/home_lat/home_lng) or defaulted (etat=1.0, qualifications=[]); all other
-- objects are new tables/enums. No data backfill required.

-- CreateEnum
CREATE TYPE "DemandSource" AS ENUM ('TEMPLATE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ShiftSource" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "etat" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
ADD COLUMN     "home_address" TEXT,
ADD COLUMN     "home_lat" DOUBLE PRECISION,
ADD COLUMN     "home_lng" DOUBLE PRECISION,
ADD COLUMN     "qualifications" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "lokalizacje" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "typ" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,

    CONSTRAINT "lokalizacje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_templates" (
    "id" TEXT NOT NULL,
    "lokalizacja_typ" TEXT NOT NULL,
    "nazwa" TEXT NOT NULL,
    "dni" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "okna" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_demands" (
    "id" TEXT NOT NULL,
    "lokalizacja_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "required_role" TEXT NOT NULL,
    "required_count" INTEGER NOT NULL,
    "source" "DemandSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_demands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "lokalizacja_id" TEXT NOT NULL,
    "demand_id" TEXT,
    "date" DATE NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "source" "ShiftSource" NOT NULL DEFAULT 'AUTO',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "shift_demands" ADD CONSTRAINT "shift_demands_lokalizacja_id_fkey" FOREIGN KEY ("lokalizacja_id") REFERENCES "lokalizacje"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_lokalizacja_id_fkey" FOREIGN KEY ("lokalizacja_id") REFERENCES "lokalizacje"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_demand_id_fkey" FOREIGN KEY ("demand_id") REFERENCES "shift_demands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

