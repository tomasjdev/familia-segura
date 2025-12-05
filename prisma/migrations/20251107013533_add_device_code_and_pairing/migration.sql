/*
  Warnings:

  - A unique constraint covering the columns `[code]` on the table `Device` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Device_code_key" ON "Device"("code");
