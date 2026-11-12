import { test, expect } from 'bun:test';
import { check } from './check.mjs';
const now = Date.parse('2026-11-12T04:30:00Z');
const fixture = () => ({ plan: { tracker: 'Linear', project: 'example', mode: 'sequential', maxActive: 1, order: ['A', 'B'], authorization: 'User said implement', readinessMessage: 'Starting A', contextByIssue: { A: 'worker-a', B: 'worker-b' } }, snapshot: { fetchedAt: new Date(now).toISOString(), issues: ['A', 'B'].map((id, n) => ({ id, title: id, status: n ? 'Todo' : 'In Progress', description: '- [ ] Behavior works', relations: { blockedBy: [] } })) } });
test('one primary permits bounded coupled work', () => {
  const { plan, snapshot } = fixture();
  plan.coupledWork = [{ primary: 'A', related: 'B', reason: 'Required shared seam', stopWhen: 'Seam connected' }];
  expect(check(plan, snapshot, now).ok).toBe(true);
});
test('rejects batch opened together or started out of order', () => {
  const { plan, snapshot } = fixture();
  snapshot.issues[1].status = 'In Progress';
  expect(check(plan, snapshot, now).ok).toBe(false);
  snapshot.issues[0].status = 'Todo';
  expect(check(plan, snapshot, now).errors).toContain('Finish A before starting later tickets');
});
test('requires fresh complete tracker records', () => {
  const { plan, snapshot } = fixture();
  expect(check(plan, snapshot, now + 600001).ok).toBe(false);
  snapshot.issues.pop();
  expect(check(plan, snapshot, now).errors).toContain('Snapshot missing B');
});
test('Done requires criterion evidence and next worker needs fresh context', () => {
  const { plan, snapshot } = fixture();
  snapshot.issues[0].status = 'Done';
  expect(check(plan, snapshot, now).ok).toBe(false);
  plan.completion = { A: { commit: 'abcdef0', trackerReceipt: 'Read-back Done', criteria: { 'Behavior works': 'Browser evidence' } } };
  snapshot.issues[1].status = 'In Progress';
  expect(check(plan, snapshot, now).ok).toBe(true);
  plan.contextByIssue.B = 'worker-a';
  expect(check(plan, snapshot, now).ok).toBe(false);
});
test('external blocker must be read back Done', () => {
  const { plan, snapshot } = fixture();
  snapshot.issues[0].relations.blockedBy = [{ id: 'EXTERNAL' }];
  expect(check(plan, snapshot, now).ok).toBe(false);
  snapshot.issues.push({ id: 'EXTERNAL', status: 'Done' });
  expect(check(plan, snapshot, now).ok).toBe(true);
});
test('parallel work requires independent scopes and workspaces', () => {
  const { plan, snapshot } = fixture();
  Object.assign(plan, { mode: 'parallel', maxActive: 2, parallelReason: 'Independent paths', scopes: { A: 'UI', B: 'Docs' }, workspaces: { A: 'tree-a', B: 'tree-b' } });
  snapshot.issues[1].status = 'In Progress';
  expect(check(plan, snapshot, now).ok).toBe(true);
  plan.workspaces.B = 'tree-a';
  expect(check(plan, snapshot, now).ok).toBe(false);
});
test('authorization and visible readiness are required', () => {
  const { plan, snapshot } = fixture();
  delete plan.authorization; delete plan.readinessMessage;
  expect(check(plan, snapshot, now).ok).toBe(false);
});
