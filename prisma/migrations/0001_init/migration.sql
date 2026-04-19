-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "weekId" INTEGER NOT NULL,
    "seed" TEXT NOT NULL,
    "inputs" JSONB,
    "claimedScore" INTEGER,
    "score" INTEGER,
    "valid" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "weekId" INTEGER NOT NULL,
    "root" TEXT NOT NULL,
    "totalPayout" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "txHash" TEXT,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("weekId")
);

-- CreateTable
CREATE TABLE "ClaimProof" (
    "id" TEXT NOT NULL,
    "weekId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "proof" JSONB NOT NULL,

    CONSTRAINT "ClaimProof_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attempt_address_weekId_idx" ON "Attempt"("address", "weekId");

-- CreateIndex
CREATE INDEX "Attempt_weekId_score_idx" ON "Attempt"("weekId", "score" DESC);

-- CreateIndex
CREATE INDEX "ClaimProof_address_idx" ON "ClaimProof"("address");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimProof_weekId_address_key" ON "ClaimProof"("weekId", "address");

-- AddForeignKey
ALTER TABLE "ClaimProof" ADD CONSTRAINT "ClaimProof_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Settlement"("weekId") ON DELETE CASCADE ON UPDATE CASCADE;

