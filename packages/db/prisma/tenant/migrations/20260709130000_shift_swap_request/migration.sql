-- Shift-swap requests (M2 #3): worker-initiated swap workflow with peer pre-agreement and
-- manager approval. Additive only — one new enum + one new table, no changes to existing
-- objects. `Shift`/`Employee` are only referenced by new FKs. No data backfill required.

-- CreateEnum
CREATE TYPE "SwapState" AS ENUM ('DRAFT', 'PENDING_PEER', 'PEER_AGREED', 'PENDING_MANAGER', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "shift_swap_requests" (
    "id" TEXT NOT NULL,
    "requester_employee_id" TEXT NOT NULL,
    "requester_shift_id" TEXT NOT NULL,
    "target_employee_id" TEXT,
    "target_shift_id" TEXT,
    "state" "SwapState" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "decided_by_manager_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_swap_requests_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_requester_employee_id_fkey" FOREIGN KEY ("requester_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_requester_shift_id_fkey" FOREIGN KEY ("requester_shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_target_employee_id_fkey" FOREIGN KEY ("target_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_target_shift_id_fkey" FOREIGN KEY ("target_shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
