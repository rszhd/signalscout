-- US-155. Billing left this application for the private cloud repository,
-- and the subscriptions table goes with it. On a self-hosted instance the
-- table has never held a row: BILLING_MODE was off on every one, and nothing
-- wrote here while it was off. The cloud's own stream keeps the table, on
-- the cloud's own database, which this migration never runs against.
DROP TABLE IF EXISTS "subscriptions" CASCADE;
