-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('CASH', 'ACCOUNTS_RECEIVABLE', 'CLIENT_REVENUE', 'TRAINER_PAYABLE', 'TRAINER_COST');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "number" TEXT;

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "projectId" TEXT,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "actorId" TEXT,
    "userId" TEXT,
    "organizationId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_lines" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "ledger_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_line_items_invoiceId_idx" ON "invoice_line_items"("invoiceId");

-- CreateIndex
CREATE INDEX "ledger_transactions_occurredAt_idx" ON "ledger_transactions"("occurredAt");

-- CreateIndex
CREATE INDEX "ledger_transactions_userId_idx" ON "ledger_transactions"("userId");

-- CreateIndex
CREATE INDEX "ledger_transactions_organizationId_idx" ON "ledger_transactions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_sourceType_sourceId_kind_key" ON "ledger_transactions"("sourceType", "sourceId", "kind");

-- CreateIndex
CREATE INDEX "ledger_lines_account_idx" ON "ledger_lines"("account");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ledger_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

