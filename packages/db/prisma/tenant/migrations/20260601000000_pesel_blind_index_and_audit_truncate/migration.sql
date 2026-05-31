-- Blind index for employees.pesel. AES-GCM uses a random IV, so the encrypted `pesel`
-- column cannot be uniquely-indexed or equality-searched. This deterministic HMAC sibling
-- column enforces per-tenant PESEL uniqueness and enables lookup-by-PESEL without scanning +
-- decrypting every row. Set via @hrobot/db encryptEmployeePesel(). New column; pre-launch
-- there are no rows, so the transient DEFAULT '' (dropped immediately) is safe.
ALTER TABLE "employees" ADD COLUMN "pesel_hash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "employees" ALTER COLUMN "pesel_hash" DROP DEFAULT;
CREATE UNIQUE INDEX "employees_pesel_hash_key" ON "employees"("pesel_hash");

-- audit_log immutability, part 2: also block TRUNCATE. A row-level BEFORE UPDATE/DELETE
-- trigger does NOT fire on TRUNCATE, so without this a privileged session could wipe the
-- audit trail. Reuses prevent_audit_log_mutation() created in the init migration.
CREATE TRIGGER audit_log_no_truncate
BEFORE TRUNCATE ON audit_log
FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_log_mutation();
