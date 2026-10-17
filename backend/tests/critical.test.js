/**
 * Critical Behaviors Test Suite
 * ─────────────────────────────
 * Covers the 5 critical behaviors specified in the requirements:
 * 1. Concurrent claim: two parallel claims → exactly one wins, other gets 409.
 * 2. Optimistic locking: stale version update rejected with 409, data unchanged.
 * 3. Idempotency: same Idempotency-Key twice → one item created, same response.
 * 4. Workflow rules: invalid transition and non-Lead approval both rejected.
 * 5. Resource-level auth: user outside the team gets 403 on read and write.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import app from '../src/index.js';

const prisma = new PrismaClient();

// Test data IDs
const TEAM_A_ID = 'c0000000-0000-0000-0000-000000000001';
const TEAM_B_ID = 'c0000000-0000-0000-0000-000000000002';
const LEAD_USER_ID = 'c0000000-0000-0000-0000-000000000010';
const MEMBER1_ID = 'c0000000-0000-0000-0000-000000000011';
const MEMBER2_ID = 'c0000000-0000-0000-0000-000000000012';
const OUTSIDER_ID = 'c0000000-0000-0000-0000-000000000013';
const VIEWER_ID = 'c0000000-0000-0000-0000-000000000014';

let leadToken, member1Token, member2Token, outsiderToken, viewerToken;

async function login(email) {
  const res = await request(app)
    .post('/auth/login')
    .send({ email, password: 'testpass' });
  return res.body.token;
}

beforeAll(async () => {
  const hash = await bcrypt.hash('testpass', 10);

  // Clean up any previous test data
  await prisma.idempotencyKey.deleteMany({});
  await prisma.comment.deleteMany({});
  await prisma.activityEvent.deleteMany({});
  await prisma.workItem.deleteMany({});
  await prisma.membership.deleteMany({
    where: {
      team_id: { in: [TEAM_A_ID, TEAM_B_ID] },
    },
  });
  await prisma.team.deleteMany({
    where: { id: { in: [TEAM_A_ID, TEAM_B_ID] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [LEAD_USER_ID, MEMBER1_ID, MEMBER2_ID, OUTSIDER_ID, VIEWER_ID] } },
  });

  // Create test users
  await prisma.user.createMany({
    data: [
      { id: LEAD_USER_ID, name: 'Test Lead', email: 'lead@test.io', password_hash: hash },
      { id: MEMBER1_ID, name: 'Test Member 1', email: 'member1@test.io', password_hash: hash },
      { id: MEMBER2_ID, name: 'Test Member 2', email: 'member2@test.io', password_hash: hash },
      { id: OUTSIDER_ID, name: 'Test Outsider', email: 'outsider@test.io', password_hash: hash },
      { id: VIEWER_ID, name: 'Test Viewer', email: 'viewer@test.io', password_hash: hash },
    ],
  });

  // Create test teams
  await prisma.team.createMany({
    data: [
      { id: TEAM_A_ID, name: 'Test Team A' },
      { id: TEAM_B_ID, name: 'Test Team B' },
    ],
  });

  // Memberships: Lead, Member1, Member2, Viewer → Team A. Outsider → Team B only.
  await prisma.membership.createMany({
    data: [
      { user_id: LEAD_USER_ID, team_id: TEAM_A_ID, role: 'lead' },
      { user_id: MEMBER1_ID, team_id: TEAM_A_ID, role: 'member' },
      { user_id: MEMBER2_ID, team_id: TEAM_A_ID, role: 'member' },
      { user_id: VIEWER_ID, team_id: TEAM_A_ID, role: 'viewer' },
      { user_id: OUTSIDER_ID, team_id: TEAM_B_ID, role: 'member' },
    ],
  });

  // Login all users
  leadToken = await login('lead@test.io');
  member1Token = await login('member1@test.io');
  member2Token = await login('member2@test.io');
  outsiderToken = await login('outsider@test.io');
  viewerToken = await login('viewer@test.io');
});

afterAll(async () => {
  // Clean up test data
  await prisma.idempotencyKey.deleteMany({});
  await prisma.comment.deleteMany({});
  await prisma.activityEvent.deleteMany({});
  await prisma.workItem.deleteMany({});
  await prisma.membership.deleteMany({
    where: { team_id: { in: [TEAM_A_ID, TEAM_B_ID] } },
  });
  await prisma.team.deleteMany({
    where: { id: { in: [TEAM_A_ID, TEAM_B_ID] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [LEAD_USER_ID, MEMBER1_ID, MEMBER2_ID, OUTSIDER_ID, VIEWER_ID] } },
  });
  await prisma.$disconnect();
});

// ─── Helper: create a work item ────────────────────────────────────────────────
async function createItem(token, overrides = {}) {
  const key = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post('/items')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send({
      title: overrides.title || 'Test Item',
      type: overrides.type || 'task',
      team_id: overrides.team_id || TEAM_A_ID,
      priority: overrides.priority || 'medium',
      description: overrides.description || 'Test description',
      ...overrides,
    });
  return res;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CONCURRENT CLAIM
// ═══════════════════════════════════════════════════════════════════════════════
describe('1. Concurrent Claim', () => {
  it('exactly one of two parallel claims wins, the other gets 409', async () => {
    // Create an unassigned item
    const createRes = await createItem(leadToken, { title: 'Race Condition Item' });
    expect(createRes.status).toBe(201);
    const itemId = createRes.body.id;

    // Two parallel claims
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/items/${itemId}/claim`)
        .set('Authorization', `Bearer ${member1Token}`),
      request(app)
        .post(`/items/${itemId}/claim`)
        .set('Authorization', `Bearer ${member2Token}`),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    // Verify exactly one assignee
    const item = await prisma.workItem.findUnique({ where: { id: itemId } });
    expect(item.assignee_id).toBeTruthy();
    expect([MEMBER1_ID, MEMBER2_ID]).toContain(item.assignee_id);
  });

  it('claiming an already-assigned item returns 409', async () => {
    const createRes = await createItem(leadToken, { title: 'Already Claimed Item' });
    const itemId = createRes.body.id;

    // First claim succeeds
    const claim1 = await request(app)
      .post(`/items/${itemId}/claim`)
      .set('Authorization', `Bearer ${member1Token}`);
    expect(claim1.status).toBe(200);

    // Second claim fails
    const claim2 = await request(app)
      .post(`/items/${itemId}/claim`)
      .set('Authorization', `Bearer ${member2Token}`);
    expect(claim2.status).toBe(409);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. OPTIMISTIC LOCKING
// ═══════════════════════════════════════════════════════════════════════════════
describe('2. Optimistic Locking', () => {
  it('update with stale version returns 409 with latest item', async () => {
    const createRes = await createItem(member1Token, { title: 'Locking Test' });
    expect(createRes.status).toBe(201);
    const itemId = createRes.body.id;
    const initialVersion = createRes.body.version;

    // First update succeeds
    const update1 = await request(app)
      .patch(`/items/${itemId}`)
      .set('Authorization', `Bearer ${member1Token}`)
      .send({ version: initialVersion, title: 'Updated Title v1' });
    expect(update1.status).toBe(200);
    expect(update1.body.version).toBe(initialVersion + 1);

    // Second update with stale version → 409
    const update2 = await request(app)
      .patch(`/items/${itemId}`)
      .set('Authorization', `Bearer ${member1Token}`)
      .send({ version: initialVersion, title: 'Stale Update' });
    expect(update2.status).toBe(409);
    expect(update2.body.error).toContain('conflict');
    expect(update2.body.item).toBeDefined();
    expect(update2.body.item.version).toBe(initialVersion + 1);

    // Data unchanged - the stale update didn't go through
    const check = await prisma.workItem.findUnique({ where: { id: itemId } });
    expect(check.title).toBe('Updated Title v1');
    expect(check.version).toBe(initialVersion + 1);
  });

  it('update with correct version succeeds and increments version', async () => {
    const createRes = await createItem(member1Token, { title: 'Version Test' });
    const itemId = createRes.body.id;
    const v = createRes.body.version;

    const update = await request(app)
      .patch(`/items/${itemId}`)
      .set('Authorization', `Bearer ${member1Token}`)
      .send({ version: v, priority: 'high' });
    expect(update.status).toBe(200);
    expect(update.body.version).toBe(v + 1);
    expect(update.body.priority).toBe('high');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. IDEMPOTENCY
// ═══════════════════════════════════════════════════════════════════════════════
describe('3. Idempotency', () => {
  it('same Idempotency-Key creates only one item and returns same response', async () => {
    const idempotencyKey = `idem-${Date.now()}-unique`;
    const payload = {
      title: 'Idempotent Item',
      type: 'task',
      team_id: TEAM_A_ID,
      priority: 'high',
    };

    const res1 = await request(app)
      .post('/items')
      .set('Authorization', `Bearer ${member1Token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post('/items')
      .set('Authorization', `Bearer ${member1Token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);
    // Should return same status and same item
    expect(res2.status).toBe(201);
    expect(res2.body.id).toBe(res1.body.id);
    expect(res2.body.title).toBe(res1.body.title);

    // Only one item with that title should exist from this key
    const count = await prisma.workItem.count({ where: { id: res1.body.id } });
    expect(count).toBe(1);
  });

  it('different Idempotency-Key creates a new item', async () => {
    const payload = { title: 'Different Key Item', type: 'task', team_id: TEAM_A_ID };

    const res1 = await request(app)
      .post('/items')
      .set('Authorization', `Bearer ${member1Token}`)
      .set('Idempotency-Key', `key-a-${Date.now()}`)
      .send(payload);
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post('/items')
      .set('Authorization', `Bearer ${member1Token}`)
      .set('Idempotency-Key', `key-b-${Date.now()}`)
      .send(payload);
    expect(res2.status).toBe(201);

    expect(res1.body.id).not.toBe(res2.body.id);
  });

  it('missing Idempotency-Key header returns 400', async () => {
    const res = await request(app)
      .post('/items')
      .set('Authorization', `Bearer ${member1Token}`)
      .send({ title: 'No Key', type: 'task', team_id: TEAM_A_ID });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Idempotency-Key');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. WORKFLOW RULES
// ═══════════════════════════════════════════════════════════════════════════════
describe('4. Workflow Rules', () => {
  it('rejects invalid status transition (open → resolved)', async () => {
    const createRes = await createItem(member1Token);
    const itemId = createRes.body.id;

    const res = await request(app)
      .post(`/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${member1Token}`)
      .send({ to: 'resolved' });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('Invalid transition');
  });

  it('rejects invalid transition (open → closed)', async () => {
    const createRes = await createItem(member1Token);
    const itemId = createRes.body.id;

    const res = await request(app)
      .post(`/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${member1Token}`)
      .send({ to: 'closed' });
    expect(res.status).toBe(422);
  });

  it('allows valid transition: open → in_progress → awaiting_approval', async () => {
    const createRes = await createItem(member1Token);
    const itemId = createRes.body.id;

    const t1 = await request(app)
      .post(`/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${member1Token}`)
      .send({ to: 'in_progress' });
    expect(t1.status).toBe(200);
    expect(t1.body.status).toBe('in_progress');

    const t2 = await request(app)
      .post(`/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${member1Token}`)
      .send({ to: 'awaiting_approval' });
    expect(t2.status).toBe(200);
    expect(t2.body.status).toBe('awaiting_approval');
  });

  it('non-Lead cannot approve (awaiting_approval → resolved)', async () => {
    const createRes = await createItem(member1Token);
    const itemId = createRes.body.id;

    // Move to awaiting_approval
    await request(app)
      .post(`/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${member1Token}`)
      .send({ to: 'in_progress' });
    await request(app)
      .post(`/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${member1Token}`)
      .send({ to: 'awaiting_approval' });

    // Member tries to approve → 403
    const res = await request(app)
      .post(`/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${member1Token}`)
      .send({ to: 'resolved' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Lead');
  });

  it('Lead can approve (awaiting_approval → resolved)', async () => {
    const createRes = await createItem(member1Token);
    const itemId = createRes.body.id;

    // Move to awaiting_approval
    await request(app)
      .post(`/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${member1Token}`)
      .send({ to: 'in_progress' });
    await request(app)
      .post(`/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${member1Token}`)
      .send({ to: 'awaiting_approval' });

    // Lead approves → 200
    const res = await request(app)
      .post(`/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${leadToken}`)
      .send({ to: 'resolved' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolved');
  });

  it('activity event is created for each transition', async () => {
    const createRes = await createItem(member1Token, { title: 'Activity Transition' });
    const itemId = createRes.body.id;

    await request(app)
      .post(`/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${member1Token}`)
      .send({ to: 'in_progress' });

    const activityRes = await request(app)
      .get(`/items/${itemId}/activity`)
      .set('Authorization', `Bearer ${member1Token}`);
    expect(activityRes.status).toBe(200);

    const statusEvents = activityRes.body.filter(e => e.event_type === 'status_changed');
    expect(statusEvents.length).toBeGreaterThanOrEqual(1);
    expect(statusEvents[statusEvents.length - 1].old_value).toBe('open');
    expect(statusEvents[statusEvents.length - 1].new_value).toBe('in_progress');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. RESOURCE-LEVEL AUTH
// ═══════════════════════════════════════════════════════════════════════════════
describe('5. Resource-Level Auth', () => {
  let teamAItemId;

  beforeAll(async () => {
    const res = await createItem(member1Token, { title: 'Team A Private Item' });
    teamAItemId = res.body.id;
  });

  it('outsider cannot read item in Team A', async () => {
    const res = await request(app)
      .get(`/items/${teamAItemId}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });

  it('outsider cannot edit item in Team A', async () => {
    const res = await request(app)
      .patch(`/items/${teamAItemId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ version: 1, title: 'Hacked' });
    expect(res.status).toBe(403);
  });

  it('outsider cannot transition item in Team A', async () => {
    const res = await request(app)
      .post(`/items/${teamAItemId}/transition`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ to: 'in_progress' });
    expect(res.status).toBe(403);
  });

  it('outsider cannot claim item in Team A', async () => {
    const res = await request(app)
      .post(`/items/${teamAItemId}/claim`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });

  it('outsider cannot comment on item in Team A', async () => {
    const res = await request(app)
      .post(`/items/${teamAItemId}/comments`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ body: 'Unauthorized comment' });
    expect(res.status).toBe(403);
  });

  it('outsider cannot view activity for item in Team A', async () => {
    const res = await request(app)
      .get(`/items/${teamAItemId}/activity`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });

  it('team member CAN read item in Team A', async () => {
    const res = await request(app)
      .get(`/items/${teamAItemId}`)
      .set('Authorization', `Bearer ${member1Token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(teamAItemId);
  });

  it('viewer can read but cannot create items', async () => {
    // Viewer can read
    const readRes = await request(app)
      .get(`/items/${teamAItemId}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(readRes.status).toBe(200);

    // Viewer cannot create
    const createRes = await request(app)
      .post('/items')
      .set('Authorization', `Bearer ${viewerToken}`)
      .set('Idempotency-Key', `viewer-${Date.now()}`)
      .send({ title: 'Viewer Item', type: 'task', team_id: TEAM_A_ID });
    expect(createRes.status).toBe(403);
  });

  it('items list only returns items from user teams', async () => {
    const res = await request(app)
      .get('/items')
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(200);
    // Outsider should not see any Team A items
    const teamAItems = res.body.items.filter(i => i.team_id === TEAM_A_ID);
    expect(teamAItems.length).toBe(0);
  });

  it('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/items');
    expect(res.status).toBe(401);
  });
});
