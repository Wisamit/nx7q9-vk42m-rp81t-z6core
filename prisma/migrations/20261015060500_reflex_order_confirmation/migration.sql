-- Stage 127: a reviewed Reflex recommendation may be linked to an already
-- authorized, invoiced order item. No automatic test or invoice is created.
ALTER TABLE reflex_rule_events
  ADD COLUMN confirmed_order_item_id CHAR(36) NULL,
  ADD COLUMN billing_evidence_snapshot JSON NULL;
CREATE INDEX reflex_rule_events_confirmed_order_item_id_idx
  ON reflex_rule_events(confirmed_order_item_id);
ALTER TABLE reflex_rule_events
  ADD CONSTRAINT reflex_rule_events_confirmed_order_item_id_fkey
  FOREIGN KEY (confirmed_order_item_id) REFERENCES order_items(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
