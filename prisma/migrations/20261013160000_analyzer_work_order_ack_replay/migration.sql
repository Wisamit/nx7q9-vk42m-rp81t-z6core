-- Preserve evidence of the last accepted lease acknowledgement so identical retries
-- can be confirmed without re-sending a physical instrument command.
ALTER TABLE `analyzer_work_orders`
  ADD COLUMN `last_ack_token_hash` CHAR(64) NULL,
  ADD COLUMN `last_ack_fingerprint` CHAR(64) NULL;
