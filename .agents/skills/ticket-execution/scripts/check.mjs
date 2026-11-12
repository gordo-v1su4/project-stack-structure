import { readFile } from 'node:fs/promises';
const text = v => typeof v === 'string' && v.trim().length > 0;
const state = i => typeof i?.status === 'string' ? i.status : i?.status?.name;
const criteria = i => [...(i.description ?? '').matchAll(/^\s*[-*]\s+\[[ xX]\]\s+(.+)$/gm)].map(m => m[1].trim());

export function check(plan, snapshot, now = Date.now()) {
  const errors = [];
  const need = (ok, message) => { if (!ok) errors.push(message); };
  for (const key of ['tracker', 'project', 'authorization', 'readinessMessage']) need(text(plan[key]), `Plan missing ${key}`);
  need(['sequential', 'parallel'].includes(plan.mode), 'Choose sequential or parallel mode');
  need(Number.isInteger(plan.maxActive) && plan.maxActive >= 1, 'Set positive maxActive');
  if (plan.mode === 'sequential') need(plan.maxActive === 1, 'Sequential mode permits one active primary');
  if (plan.mode === 'parallel') need(text(plan.parallelReason), 'Parallel mode needs independent-scope justification');
  const order = Array.isArray(plan.order) ? plan.order : [];
  need(order.length > 0 && order.every(text) && new Set(order).size === order.length, 'Order needs unique ticket IDs');
  const age = now - Date.parse(snapshot.fetchedAt);
  need(Number.isFinite(age) && age >= -60000 && age <= 600000, 'Tracker snapshot missing, future-dated or older than ten minutes');
  const rows = Array.isArray(snapshot.issues) ? snapshot.issues : [];
  const byId = new Map(rows.map(i => [i.id, i]));
  need(byId.size === rows.length, 'Duplicate snapshot ticket IDs');
  for (const id of order) need(byId.has(id), `Snapshot missing ${id}`);
  const selected = order.map(id => byId.get(id)).filter(Boolean);
  const active = selected.filter(i => state(i) === 'In Progress');
  const next = selected.find(i => state(i) !== 'Done');
  need(active.length <= plan.maxActive, `Too many active tickets: ${active.map(i => i.id).join(', ')}`);
  if (plan.mode === 'sequential' && active.length) need(active.length === 1 && active[0].id === next?.id, `Finish ${next?.id} before starting later tickets`);
  const contexts = new Map();
  for (const issue of selected) {
    const status = state(issue);
    need(['Todo', 'In Progress', 'Done', 'Blocked', 'Backlog'].includes(status), `${issue.id}: reconcile unsupported state ${status}`);
    need(text(issue.title), `${issue.id}: missing title`);
    const checks = criteria(issue);
    need(checks.length > 0, `${issue.id}: no checklist acceptance`);
    need(Array.isArray(issue.relations?.blockedBy), `${issue.id}: fetch native blockers`);
    if (status === 'In Progress' || status === 'Done') {
      const context = plan.contextByIssue?.[issue.id];
      need(text(context), `${issue.id}: missing implementation context`);
      if (text(context)) {
        need(!contexts.has(context), `${issue.id}: reused context from ${contexts.get(context)}`);
        contexts.set(context, issue.id);
      }
      for (const blocker of issue.relations?.blockedBy ?? []) {
        const id = typeof blocker === 'string' ? blocker : blocker.id;
        need(state(byId.get(id)) === 'Done', `${issue.id}: blocker ${id} is not verified Done`);
      }
    }
    if (status === 'In Progress' && plan.mode === 'parallel') {
      need(text(plan.scopes?.[issue.id]), `${issue.id}: missing independent scope`);
      need(text(plan.workspaces?.[issue.id]), `${issue.id}: missing isolated workspace`);
    }
    if (status === 'Done') {
      const proof = plan.completion?.[issue.id];
      need(text(proof?.commit), `${issue.id}: Done without commit`);
      need(text(proof?.trackerReceipt), `${issue.id}: Done without tracker read-back receipt`);
      for (const criterion of checks) need(text(proof?.criteria?.[criterion]), `${issue.id}: missing evidence for ${criterion}`);
    }
  }
  if (plan.mode === 'parallel') need(new Set(active.map(i => plan.workspaces?.[i.id])).size === active.length, 'Parallel writers share a workspace');
  for (const c of plan.coupledWork ?? []) {
    need(order.includes(c.primary) && order.includes(c.related) && c.primary !== c.related, 'Coupling needs distinct batch tickets');
    need(text(c.reason) && text(c.stopWhen), 'Coupling needs reason and stopping condition');
  }
  return { ok: errors.length === 0, errors, active: active.map(i => i.id), next: next?.id ?? null };
}
if (import.meta.main) {
  try {
    const [planPath, snapshotPath] = process.argv.slice(2);
    if (!planPath || !snapshotPath) throw new Error('Usage: bun check.mjs <plan.json> <fresh-tracker-snapshot.json>');
    const result = check(JSON.parse(await readFile(planPath, 'utf8')), JSON.parse(await readFile(snapshotPath, 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
