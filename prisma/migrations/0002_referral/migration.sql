-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrer" TEXT NOT NULL,
    "referred" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Referral_referred_key" ON "Referral"("referred");

-- CreateIndex
CREATE INDEX "Referral_referrer_idx" ON "Referral"("referrer");
