-- Sale return: defer cash refund to PATCH (seller-admin style complete modal).
ALTER TABLE `sale_returns`
  ADD COLUMN `status` VARCHAR(32) NOT NULL DEFAULT 'completed',
  ADD COLUMN `pendingCashRefund` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `cashRefundPaid` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `refundAccountId` INTEGER NULL;

ALTER TABLE `sale_returns`
  ADD CONSTRAINT `sale_returns_refundAccountId_fkey`
  FOREIGN KEY (`refundAccountId`) REFERENCES `accounts`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
