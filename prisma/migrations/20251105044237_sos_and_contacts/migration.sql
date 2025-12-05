/*
  Warnings:

  - The primary key for the `Device` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `code` on the `Device` table. All the data in the column will be lost.
  - The primary key for the `Track` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[pairingCode]` on the table `Device` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `Device` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Device_code_key";

-- AlterTable
ALTER TABLE "Device" DROP CONSTRAINT "Device_pkey",
DROP COLUMN "code",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "model" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "pairingCode" TEXT,
ADD COLUMN     "pairingExpiresAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "batteryPct" SET DATA TYPE DOUBLE PRECISION,
ADD CONSTRAINT "Device_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Device_id_seq";

-- AlterTable
ALTER TABLE "Track" DROP CONSTRAINT "Track_pkey",
ADD COLUMN     "accuracy" DOUBLE PRECISION,
ADD COLUMN     "battery" DOUBLE PRECISION,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "Track_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Track_id_seq";

-- CreateTable
CREATE TABLE "EmergencyContact" (
    "id" TEXT NOT NULL,
    "patientId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SosEvent" (
    "id" TEXT NOT NULL,
    "patientId" INTEGER NOT NULL,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "battery" DOUBLE PRECISION,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "note" TEXT,

    CONSTRAINT "SosEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmergencyContact_patientId_active_priority_idx" ON "EmergencyContact"("patientId", "active", "priority");

-- CreateIndex
CREATE INDEX "SosEvent_patientId_createdAt_idx" ON "SosEvent"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "SosEvent_deviceId_createdAt_idx" ON "SosEvent"("deviceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Device_pairingCode_key" ON "Device"("pairingCode");

-- CreateIndex
CREATE INDEX "Device_patientId_idx" ON "Device"("patientId");

-- CreateIndex
CREATE INDEX "Track_patientId_timestamp_idx" ON "Track"("patientId", "timestamp");

-- AddForeignKey
ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosEvent" ADD CONSTRAINT "SosEvent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosEvent" ADD CONSTRAINT "SosEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
