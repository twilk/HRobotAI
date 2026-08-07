-- G-1: per-step claim (lease) for the provisioning pipeline.
-- RabbitMQ delivers `tenant.provision` at-least-once, so the same message can arrive twice
-- (redelivery after a consumer crash, an outbox re-publish, or a RetryRelay re-enqueue racing
-- the pipeline's own emit). ProvisioningService compare-and-sets claimed_at together with `step`
-- before executing a handler: `UPDATE ... WHERE id = $1 AND step = $2 AND (claimed_at IS NULL OR
-- claimed_at < now() - lease)`. Exactly one consumer wins, so no step body runs twice
-- concurrently. The value is a LEASE, not a lock: it expires after CLAIM_LEASE_MS so a consumer
-- that died mid-step does not strand the job forever.
ALTER TABLE "provisioning_jobs" ADD COLUMN "claimed_at" TIMESTAMP(3);
