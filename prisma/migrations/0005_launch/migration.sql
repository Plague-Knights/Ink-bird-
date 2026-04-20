-- CreateTable
CREATE TABLE "LaunchRound" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "betWei" TEXT NOT NULL,
    "userSalt" TEXT NOT NULL,
    "seedHash" TEXT NOT NULL,
    "seed" TEXT,
    "simSeed" BIGINT,
    "score" INTEGER,
    "framesRun" INTEGER,
    "payoutWei" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "LaunchRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LaunchRound_address_createdAt_idx" ON "LaunchRound"("address", "createdAt");
