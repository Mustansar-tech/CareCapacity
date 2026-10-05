import { test, before, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import express from "express";
import request from "supertest";
import { recordAuditDetails, parseAuditDetails, safeAuditSnapshot, auditChanges, csvCell } from "../../shared/audit";

// Test-only connections: all database methods used below are mocked.
process.env.DATABASE_URL = "postgresql://audit_test:audit_test@127.0.0.1:9/audit_test";
process.env.SUPABASE_URL = "https://audit-tests.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "audit-test-only-key";
process.env.SUPABASE_ANON_KEY = "audit-test-only-key";
let db: typeof import("../infrastructure/db").db;
let pool: typeof import("../infrastructure/db").pool;
let capacity: typeof import("../repositories/capacity-outlook.repository");
let audit: typeof import("../repositories/audit.repository");
let auditRequests: typeof import("../middleware/audit-requests").auditRequests;
let registerAuditRoutes: typeof import("../routes/audit.routes").registerAuditRoutes;
let auditRequestContext: typeof import("../infrastructure/audit-context").auditRequestContext;
before(async () => {
  ({ db, pool } = await import("../infrastructure/db"));
  capacity = await import("../repositories/capacity-outlook.repository");
  audit = await import("../repositories/audit.repository");
  ({ auditRequests } = await import("../middleware/audit-requests"));
  ({ registerAuditRoutes } = await import("../routes/audit.routes"));
  ({ auditRequestContext } = await import("../infrastructure/audit-context"));
});
const dialect = new PgDialect();
const actor = { userId: "test-actor", userEmail: "audit@example.invalid" };
const leaver = {
  id: "test-leaver", branchId: "test-branch", employeeName: "Audit Example Person",
  lastWorkingDay: "2026-10-05", weeklyHours: 28, status: "active" as const, isLic: false, employmentType: "driver" as const,
  notes: "Private care information must not be copied",
};
afterEach(() => mock.restoreAll());

function fakeDatabase(initial: Record<string, any[]> = {}) {
  let state = structuredClone({ audit_logs: [], ...initial }) as Record<string, any[]>;
  let failAudit = false;
  let role = "admin";
  const executor = (data: Record<string, any[]>) => ({
    select(selection?: Record<string, unknown>) {
      let table = ""; let condition: any; let limit = Infinity; let offset = 0;
      const rows = () => {
        if (table === "users") return selection?.name
          ? [{ name: "Audit Administrator" }] : [{ id: actor.userId, role, isActive: 1 }];
        if (table === "branches") return [{ name: "Audit Branch" }];
        let result = data[table] ?? [];
        if (condition && ["leavers", "joiners", "availability_changes"].includes(table)) {
          const { params } = dialect.sqlToQuery(condition);
          if (params.length === 2) result = result.filter(row => row.id === params[0] && row.branchId === params[1]);
        }
        if (selection?.total) return [{ total: result.length }];
        if (selection?.log) return result.slice(offset, offset + limit).map(log => ({ log, actorName: "Current Actor", branchName: "Current Branch" }));
        if (selection?.action) return [...new Set(result.map(row => row.action))].map(action => ({ action }));
        return result.slice(offset, offset + limit);
      };
      const builder: any = {
        from(t: any) { table = getTableName(t); return builder; },
        where(c: any) { condition = c; return builder; },
        for() { return builder; }, leftJoin() { return builder; }, orderBy() { return builder; },
        limit(n: number) { limit = n; return builder; }, offset(n: number) { offset = n; return builder; },
        then(resolve: any, reject: any) { return Promise.resolve(structuredClone(rows())).then(resolve, reject); },
      };
      return builder;
    },
    insert(table: any) {
      return { values(values: any) {
        if (getTableName(table) === "audit_logs" && failAudit) throw new Error("Simulated audit insert failure");
        const row = { id: "generated-record", timestamp: new Date("2026-10-05T12:00:00Z"), ...values };
        (data[getTableName(table)] ??= []).push(row);
        const builder: any = { returning: async () => [row], onConflictDoUpdate: () => builder };
        return builder;
      }};
    },
    update(table: any) {
      return { set(values: any) { return { where(condition: any) {
        const { params } = dialect.sqlToQuery(condition);
        const rows = data[getTableName(table)] ?? [];
        const changed = rows.filter(row => row.id === params[0] && row.branchId === params[1]);
        changed.forEach(row => Object.assign(row, values));
        return { returning: async () => changed };
      }}; }};
    },
    delete(table: any) {
      return { where(condition: any) {
        const { params } = dialect.sqlToQuery(condition);
        data[getTableName(table)] = (data[getTableName(table)] ?? []).filter(row => !(row.id === params[0] && row.branchId === params[1]));
        return Promise.resolve({ rowCount: 1 });
      }};
    },
  });
  mock.method(db, "transaction", async (callback: any) => {
    const staged = structuredClone(state);
    const result = await callback(executor(staged));
    state = staged;
    return result;
  });
  mock.method(db, "select", (selection: any) => executor(state).select(selection));
  mock.method(db, "selectDistinct", (selection: any) => executor(state).select(selection));
  mock.method(db, "insert", (table: any) => executor(state).insert(table));
  return {
    get state() { return state; },
    failAudit() { failAudit = true; },
    setRole(value: string) { role = value; },
  };
}

test("permanent deletion retains the person's name, dates and record reference", () => {
  const details = recordAuditDetails("leaver", "delete", leaver, null);
  assert.match(details.summary, /permanently deleted: Audit Example Person/);
  assert.match(details.summary, /2026-10-05/);
  assert.equal(details.entityId, "test-leaver");
  assert.equal(details.before?.weeklyHours, 28);
  assert.equal(details.after, null);
});
test("snapshots never retain private notes, PVG details or credentials", () => {
  const before = { ...leaver, passwordHash: "old secret", pvgDetails: "old disclosure", accessToken: "old token" };
  const after = { ...before, notes: "new private note", pvgDetails: "new disclosure", passwordHash: "new secret" };
  const encoded = JSON.stringify(recordAuditDetails("leaver", "update", before, after));
  for (const secret of ["Private care", "new private", "old secret", "new secret", "old disclosure", "new disclosure", "old token"]) assert.ok(!encoded.includes(secret));
  assert.ok(auditChanges(before, after).some(change => change.field === "notes" && change.redacted));
  assert.ok(!auditChanges(before, after).some(change => change.field === "passwordHash"));
  assert.equal(safeAuditSnapshot(null), null);
});
test("edits show exact operational changes and ignore bookkeeping timestamps", () => {
  const changes = auditChanges({ ...leaver, updatedAt: "old" }, { ...leaver, weeklyHours: 30.5, updatedAt: "new" });
  assert.deepEqual(changes, [{ field: "weeklyHours", label: "Weekly hours", before: 28, after: 30.5 }]);
  assert.equal(auditChanges({ passwordReset: false }, { passwordReset: true })[0].after, true);
});
test("legacy and malformed details are not misinterpreted or backfilled", () => {
  assert.equal(parseAuditDetails("Leaver permanently deleted: unknown-id"), null);
  assert.equal(parseAuditDetails("{not json"), null);
  assert.equal(parseAuditDetails('{"summary":"not an audit envelope"}'), null);
  const modern = recordAuditDetails("leaver", "delete", leaver, null);
  assert.deepEqual(parseAuditDetails(JSON.stringify(modern)), modern);
});
test("CSV escapes quotes, line breaks and formula injection including leading whitespace", () => {
  assert.equal(csvCell('Name "Example", Person\nSecond line'), '"Name ""Example"", Person\nSecond line"');
  for (const text of ["=1+1", "+SUM(A1)", "-1+1", "@SUM(A1)", "  =1+1", "\tName"]) assert.ok(csvCell(text).startsWith("\"'"));
});
test("inclusive London date ranges handle daylight saving boundaries", () => {
  const spring = dialect.sqlToQuery(audit.auditFilterConditions({ page: 1, pageSize: 50, from: "2026-03-29", to: "2026-03-29" })!);
  assert.deepEqual(spring.params.map(v => new Date(v as string).toISOString()), ["2026-03-29T00:00:00.000Z", "2026-03-29T23:00:00.000Z"]);
  const autumn = dialect.sqlToQuery(audit.auditFilterConditions({ page: 1, pageSize: 50, from: "2026-10-25", to: "2026-10-25" })!);
  assert.deepEqual(autumn.params.map(v => new Date(v as string).toISOString()), ["2026-10-24T23:00:00.000Z", "2026-10-26T00:00:00.000Z"]);
});
test("search escapes SQL wildcard characters and applies branch/action restrictions", () => {
  const query = dialect.sqlToQuery(audit.auditFilterConditions({ page: 1, pageSize: 50, search: "A%_B", branchId: "test-branch", action: "LEAVER_DELETED" })!);
  assert.ok(query.params.includes("%A\\%\\_B%"));
  assert.ok(query.params.includes("test-branch"));
  assert.ok(query.params.includes("LEAVER_DELETED"));
});
test("leaver creation commits exactly one named audit entry", async () => {
  const fake = fakeDatabase();
  await capacity.createLeaver(leaver, actor);
  assert.equal(fake.state.leavers.length, 1);
  assert.equal(fake.state.audit_logs.length, 1);
  const entry = parseAuditDetails(fake.state.audit_logs[0].detail)!;
  assert.equal(entry.entityName, leaver.employeeName);
  assert.equal(entry.actorName, "Audit Administrator");
  assert.equal(entry.branchName, "Audit Branch");
});
test("leaver editing records before and after in the transaction", async () => {
  const fake = fakeDatabase({ leavers: [leaver] });
  await capacity.updateLeaver(leaver.id, leaver.branchId, { weeklyHours: 40 }, actor);
  const entry = parseAuditDetails(fake.state.audit_logs[0].detail)!;
  assert.equal(entry.before?.weeklyHours, 28);
  assert.equal(entry.after?.weeklyHours, 40);
});
test("soft removal is labelled as archiving rather than permanent deletion", async () => {
  const fake = fakeDatabase({ leavers: [leaver] });
  assert.equal(await capacity.deleteLeaver(leaver.id, leaver.branchId, actor), true);
  assert.equal(fake.state.leavers[0].status, "processed");
  assert.equal(parseAuditDetails(fake.state.audit_logs[0].detail)?.operation, "archive");
});
test("permanent leaver deletion retains the named snapshot after the row is gone", async () => {
  const fake = fakeDatabase({ leavers: [leaver] });
  assert.equal(await capacity.hardDeleteLeaver(leaver.id, leaver.branchId, actor), true);
  assert.equal(fake.state.leavers.length, 0);
  assert.equal(parseAuditDetails(fake.state.audit_logs[0].detail)?.before?.employeeName, leaver.employeeName);
});
test("an audit insert failure rolls back the deletion and does not mark success", async () => {
  const fake = fakeDatabase({ leavers: [leaver] });
  fake.failAudit();
  const context = { actor, request: { id: "request", method: "DELETE", path: "/api/test", ip: null, userAgent: null }, recorded: false };
  await auditRequestContext.run(context, async () => {
    await assert.rejects(capacity.hardDeleteLeaver(leaver.id, leaver.branchId, actor), /Simulated audit insert failure/);
  });
  assert.equal(fake.state.leavers.length, 1);
  assert.equal(fake.state.audit_logs.length, 0);
  assert.equal(context.recorded, false);
});
test("missing and cross-branch records never generate successful deletion events", async () => {
  const fake = fakeDatabase({ leavers: [leaver] });
  assert.equal(await capacity.hardDeleteLeaver("missing", leaver.branchId, actor), false);
  assert.equal(await capacity.hardDeleteLeaver(leaver.id, "other-branch", actor), false);
  assert.equal(fake.state.audit_logs.length, 0);
  assert.equal(fake.state.leavers.length, 1);
});
test("joiner deletion preserves the candidate name", async () => {
  const { employeeName: _name, ...record } = leaver;
  const fake = fakeDatabase({ joiners: [{ ...record, candidateName: "Audit Example Candidate" }] });
  await capacity.hardDeleteJoiner(leaver.id, leaver.branchId, actor);
  assert.equal(fake.state.joiners.length, 0);
  assert.equal(parseAuditDetails(fake.state.audit_logs[0].detail)?.entityName, "Audit Example Candidate");
});
test("availability deletion preserves the employee and hours", async () => {
  const fake = fakeDatabase({ availability_changes: [{ ...leaver, currentHours: 28, newHours: 20 }] });
  await capacity.deleteAvailabilityChange(leaver.id, leaver.branchId, actor);
  assert.equal(fake.state.availability_changes.length, 0);
  assert.equal(parseAuditDetails(fake.state.audit_logs[0].detail)?.before?.newHours, 20);
});

function appWithSession(authenticated = true) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = authenticated ? { ...actor, userRole: "admin" } : {};
    next();
  });
  app.use(auditRequests);
  return app;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
test("request safety net captures subject and outcome without request secrets", async () => {
  const fake = fakeDatabase();
  const app = appWithSession();
  app.post("/api/example", (_req, res) => res.status(201).json({ id: "example", employeeName: "Audit Person" }));
  await request(app).post("/api/example").send({ employeeName: "Audit Person", password: "test-password", notes: "private-note" }).expect(201);
  await settle();
  const entry = parseAuditDetails(fake.state.audit_logs[0].detail)!;
  assert.equal(entry.entityName, "Audit Person");
  assert.equal(entry.request?.statusCode, 201);
  assert.ok(!JSON.stringify(entry).includes("test-password"));
  assert.ok(!JSON.stringify(entry).includes("private-note"));
});
test("domain-specific entries suppress duplicate generic events", async () => {
  const fake = fakeDatabase();
  const app = appWithSession();
  app.post("/api/example", async (_req, res) => {
    await audit.writeAuditEntry({ ...actor, branchId: null, action: "EXAMPLE_ADDED", detail: "Example added" });
    res.json({ success: true });
  });
  await request(app).post("/api/example").send({}).expect(200);
  await settle();
  assert.equal(fake.state.audit_logs.length, 1);
  assert.equal(fake.state.audit_logs[0].action, "EXAMPLE_ADDED");
});
test("failed authenticated changes are logged as failures, not successes", async () => {
  const fake = fakeDatabase();
  const app = appWithSession();
  app.delete("/api/example/:id", (_req, res) => res.status(404).json({ message: "Not found" }));
  await request(app).delete("/api/example/missing").expect(404);
  await settle();
  assert.equal(fake.state.audit_logs[0].action, "REQUEST_FAILED");
  assert.equal(parseAuditDetails(fake.state.audit_logs[0].detail)?.outcome, "failure");
});
test("audit endpoints reject anonymous and non-admin access", async () => {
  const fake = fakeDatabase();
  const anonymous = appWithSession(false);
  registerAuditRoutes(anonymous);
  await request(anonymous).get("/api/admin/audit-events").expect(401);
  await request(anonymous).get("/api/admin/audit-events/export").expect(401);
  fake.setRole("scheduler");
  const scheduler = appWithSession();
  registerAuditRoutes(scheduler);
  await request(scheduler).get("/api/admin/audit-events").expect(403);
  await request(scheduler).get("/api/admin/audit-events/export").expect(403);
  await settle();
});
test("admin endpoints return structured events, validate dates and export all matched rows", async () => {
  const fake = fakeDatabase({ audit_logs: [{
    id: "audit-event", ...actor, branchId: leaver.branchId, action: "LEAVER_DELETED",
    timestamp: new Date("2026-10-05T12:00:00Z"),
    detail: JSON.stringify(recordAuditDetails("leaver", "delete", leaver, null)),
  }] });
  const app = appWithSession();
  registerAuditRoutes(app);
  const result = await request(app).get("/api/admin/audit-events").expect(200);
  assert.equal(result.body.events[0].metadata.entityName, leaver.employeeName);
  assert.equal(result.body.total, 1);
  await request(app).get("/api/admin/audit-events?from=2026-02-30").expect(400);
  await request(app).get("/api/admin/audit-events?from=2026-10-10&to=2026-10-01").expect(400);
  const exported = await request(app).get("/api/admin/audit-events/export").expect(200);
  assert.match(exported.headers["content-type"], /text\/csv/);
  assert.ok(exported.text.includes(leaver.employeeName));
  assert.equal(fake.state.audit_logs.at(-1)?.action, "AUDIT_EXPORTED");
});
test("CSV export is blocked when its audit event cannot be saved", async () => {
  const fake = fakeDatabase();
  fake.failAudit();
  const app = appWithSession();
  registerAuditRoutes(app);
  const result = await request(app).get("/api/admin/audit-events/export").expect(500);
  assert.match(result.headers["content-type"], /application\/json/);
});

test("close unused test pool", async () => { await pool.end(); });
