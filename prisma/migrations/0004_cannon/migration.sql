-- CreateTable
CREATE TABLE "CannonRound" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "betWei" TEXT NOT NULL,
    "userSalt" TEXT NOT NULL,
    "seedHash" TEXT NOT NULL,
    "seed" TEXT,
    "outcomeIndex" INTEGER,
    "eventSeq" JSONB,
    "totalMultiplierBps" INTEGER,
    "payoutWei" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "CannonRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CannonRound_address_createdAt_idx" ON "CannonRound"("address", "createdAt");
