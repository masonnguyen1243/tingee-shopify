-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyShopDomain" TEXT NOT NULL,
    "shopifyAccessToken" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TingeeConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "secretToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TingeeConfig_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TingeeAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tingeeConfigId" TEXT NOT NULL,
    "vaAccountNumber" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "bankBin" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "notifyRegistered" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "TingeeAccount_tingeeConfigId_fkey" FOREIGN KEY ("tingeeConfigId") REFERENCES "TingeeConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "reconcileCode" TEXT NOT NULL,
    "qrCodeImage" TEXT,
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tingeeTransactionCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" DATETIME,
    CONSTRAINT "Payment_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionCode" TEXT NOT NULL,
    "rawHeaders" TEXT NOT NULL,
    "rawBody" TEXT NOT NULL,
    "matchedPaymentId" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookEvent_matchedPaymentId_fkey" FOREIGN KEY ("matchedPaymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_shopifyShopDomain_key" ON "Merchant"("shopifyShopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reconcileCode_key" ON "Payment"("reconcileCode");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_transactionCode_key" ON "WebhookEvent"("transactionCode");
