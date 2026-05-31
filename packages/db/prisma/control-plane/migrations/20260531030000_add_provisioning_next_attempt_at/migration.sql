-- C1: durable provisioning retry schedule.
-- ProvisioningService stamps next_attempt_at on a failed step; RetryRelay re-enqueues jobs
-- whose time is due (FOR UPDATE SKIP LOCKED). Replaces the lost-on-restart in-process setTimeout.
ALTER TABLE "provisioning_jobs" ADD COLUMN "next_attempt_at" TIMESTAMP(3);

CREATE INDEX "provisioning_jobs_next_attempt_at_idx" ON "provisioning_jobs"("next_attempt_at");
