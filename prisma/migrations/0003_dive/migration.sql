-- CreateTable
CREATE TABLE "DiveRound" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "betWei" TEXT NOT NULL,
    "userSalt" TEXT NOT NULL,
    "seedHash" TEXT NOT NULL,
    "seed" TEXT,
    "outcomeIndex" INTEGER,
    "distance" INTEGER,
    "payoutWei" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "DiveRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiveBalance" (
    "address" TEXT NOT NULL,
    "wei" TEXT NOT NULL DEFAULT '0',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiveBalance_pkey" PRIMARY KEY ("address")
);

-- CreateIndex
CREATE INDEX "DiveRound_address_createdAt_idx" ON "DiveRound"("address", "createdAt");
