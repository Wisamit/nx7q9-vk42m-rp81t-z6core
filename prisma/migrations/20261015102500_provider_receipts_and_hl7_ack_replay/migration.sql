-- Stage 128: persist authenticated provider receipts and exact HL7 ACK replay evidence.
-- Additive; no historical result, report or billing rows are modified.
ALTER TABLE notification_deliveries
  MODIFY COLUMN status ENUM('PENDING','SENT','DELIVERED','FAILED','DEAD_LETTER','SKIPPED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN delivered_at DATETIME(3) NULL,
  ADD COLUMN receipt_fingerprint CHAR(64) NULL;
ALTER TABLE integration_messages ADD COLUMN ack_fingerprint CHAR(64) NULL;
