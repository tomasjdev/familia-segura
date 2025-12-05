/*
  Warnings:

  - A unique constraint covering the columns `[apiKey]` on the table `Device` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "apiKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Device_apiKey_key" ON "Device"("apiKey");
