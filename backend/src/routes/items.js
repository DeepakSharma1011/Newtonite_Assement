const express = require('express');
const { getPrisma } = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { checkPermission, getUserTeamIds } = require('../middleware/permissions');
const { validateTransition } = require('../lib/workflow');

const router = express.Router();

// All items routes require authentication
router.use(authenticate);

// ─── GET /items ────────────────────────────────────────────────────────────────
// Server-side filtering, search, cursor pagination.
// Users only see items in their own teams.
router.get('/', async (req, res) => {
  try {
    const prisma = getPrisma();
    const userId = req.user.id;
    const teamIds = await getUserTeamIds(userId);

    if (teamIds.length === 0) {
      return res.json({ items: [], nextCursor: null, total: 0 });
    }

    const { status, priority, assignee, team, q, cursor, limit: rawLimit } = req.query;
    const limit = Math.min(Math.max(parseInt(rawLimit) || 20, 1), 100);

    // Build filter
    const where = {
      team_id: { in: team ? [team].filter(t => teamIds.includes(t)) : teamIds },
    };

    // If team filter is for a team the user isn't in, return empty
    if (team && !teamIds.includes(team)) {
      return res.json({ items: [], nextCursor: null, total: 0 });
    }

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (assignee) where.assignee_id = assignee;
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (cursor) {
      where.created_at = { lt: new Date(cursor) };
    }

    const [items, total] = await Promise.all([
      prisma.workItem.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit + 1, // fetch one extra for cursor
        include: {
          assignee: { select: { id: true, name: true, email: true } },
          creator: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true } },
        },
      }),
      prisma.workItem.count({ where: cursor ? { ...where, created_at: undefined } : where }),
    ]);

    const hasMore = items.length > limit;
    const result = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? result[result.length - 1].created_at.toISOString() : null;

    return res.json({ items: result, nextCursor, total });
  } catch (err) {
    console.error('GET /items error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /items ───────────────────────────────────────────────────────────────
// Create a new work item. Requires Idempotency-Key header.
router.post('/', async (req, res) => {
  try {
    const prisma = getPrisma();
    const userId = req.user.id;

    const idempotencyKey = req.headers['idempotency-key'];
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'Idempotency-Key header is required' });
    }

    // Check idempotency
    const existing = await prisma.idempotencyKey.findUnique({
      where: { key_user_id: { key: idempotencyKey, user_id: userId } },
    });

    if (existing) {
      return res.status(existing.response_status).json(JSON.parse(existing.response_body));
    }

    const { title, description, type, priority, team_id, assignee_id, due_date } = req.body;

    // Validate required fields
    if (!title || !type || !team_id) {
      return res.status(400).json({ error: 'title, type, and team_id are required' });
    }

    // Check permission: user must be at least member in the team
    const perm = await checkPermission(userId, team_id, 'member');
    if (!perm.allowed) {
      return res.status(403).json({ error: perm.error });
    }

    // Validate type
    const validTypes = ['incident', 'customer_issue', 'payment', 'compliance', 'task'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }

    // Create item + idempotency key + activity event in a single transaction
    const item = await prisma.$transaction(async (tx) => {
      const newItem = await tx.workItem.create({
        data: {
          title,
          description: description || null,
          type,
          priority: priority || 'medium',
          status: 'open',
          team_id,
          assignee_id: assignee_id || null,
          created_by: userId,
          due_date: due_date ? new Date(due_date) : null,
        },
        include: {
          assignee: { select: { id: true, name: true, email: true } },
          creator: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true } },
        },
      });

      // Activity event for creation
      await tx.activityEvent.create({
        data: {
          item_id: newItem.id,
          actor_id: userId,
          event_type: 'created',
          new_value: JSON.stringify({ title, type, priority: priority || 'medium' }),
        },
      });

      // Save idempotency key
      await tx.idempotencyKey.create({
        data: {
          key: idempotencyKey,
          user_id: userId,
          response_status: 201,
          response_body: JSON.stringify(newItem),
        },
      });

      return newItem;
    });

    return res.status(201).json(item);
  } catch (err) {
    console.error('POST /items error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /items/:id ────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const userId = req.user.id;

    const item = await prisma.workItem.findUnique({
      where: { id: req.params.id },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        creator: { select: { id: true, name: true, email: true } },
        team: { select: { id: true, name: true } },
      },
    });

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Resource-level auth
    const perm = await checkPermission(userId, item.team_id, 'viewer');
    if (!perm.allowed) {
      return res.status(403).json({ error: perm.error });
    }

    return res.json(item);
  } catch (err) {
    console.error('GET /items/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /items/:id ──────────────────────────────────────────────────────────
// Optimistic locking via version field. Requires { version } in body.
router.patch('/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const userId = req.user.id;
    const { version, title, description, priority, assignee_id, due_date } = req.body;

    if (version === undefined || version === null) {
      return res.status(400).json({ error: 'version field is required for updates' });
    }

    // Find item first
    const item = await prisma.workItem.findUnique({ where: { id: req.params.id } });
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Check permission: member+ to edit, lead+ to reassign
    const requiredRole = assignee_id !== undefined ? 'lead' : 'member';
    const perm = await checkPermission(userId, item.team_id, requiredRole);
    if (!perm.allowed) {
      return res.status(403).json({ error: perm.error });
    }

    // Build update data
    const updateData = {};
    const activityEvents = [];

    if (title !== undefined && title !== item.title) {
      activityEvents.push({ field: 'title', old_value: item.title, new_value: title });
      updateData.title = title;
    }
    if (description !== undefined && description !== item.description) {
      activityEvents.push({ field: 'description', old_value: item.description || '', new_value: description });
      updateData.description = description;
    }
    if (priority !== undefined && priority !== item.priority) {
      activityEvents.push({ field: 'priority', old_value: item.priority, new_value: priority });
      updateData.priority = priority;
    }
    if (assignee_id !== undefined && assignee_id !== item.assignee_id) {
      activityEvents.push({ field: 'assignee', old_value: item.assignee_id || '', new_value: assignee_id || '' });
      updateData.assignee_id = assignee_id || null;
    }
    if (due_date !== undefined) {
      const newDue = due_date ? new Date(due_date) : null;
      updateData.due_date = newDue;
    }

    if (Object.keys(updateData).length === 0) {
      return res.json(item); // nothing to update
    }

    // Optimistic locking: update only if version matches
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.$executeRaw`
        UPDATE work_items
        SET ${prisma.$queryRaw`version = version + 1`}
        WHERE id = ${req.params.id} AND version = ${version}
      `;

      // Use Prisma's updateMany with version check instead of raw SQL
      const { count } = await tx.workItem.updateMany({
        where: { id: req.params.id, version: version },
        data: { ...updateData, version: { increment: 1 } },
      });

      if (count === 0) {
        // Version mismatch - fetch latest and return 409
        const latest = await tx.workItem.findUnique({
          where: { id: req.params.id },
          include: {
            assignee: { select: { id: true, name: true, email: true } },
            creator: { select: { id: true, name: true, email: true } },
            team: { select: { id: true, name: true } },
          },
        });
        return { conflict: true, latest };
      }

      // Create activity events in the same transaction
      for (const evt of activityEvents) {
        await tx.activityEvent.create({
          data: {
            item_id: req.params.id,
            actor_id: userId,
            event_type: `${evt.field}_changed`,
            old_value: String(evt.old_value ?? ''),
            new_value: String(evt.new_value ?? ''),
          },
        });
      }

      // Fetch updated item
      const updatedItem = await tx.workItem.findUnique({
        where: { id: req.params.id },
        include: {
          assignee: { select: { id: true, name: true, email: true } },
          creator: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true } },
        },
      });

      return { conflict: false, item: updatedItem };
    });

    if (result.conflict) {
      return res.status(409).json({
        error: 'Version conflict: item has been modified. Reload and try again.',
        item: result.latest,
      });
    }

    return res.json(result.item);
  } catch (err) {
    console.error('PATCH /items/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /items/:id/claim ─────────────────────────────────────────────────────
// Atomic claim: UPDATE ... WHERE assignee_id IS NULL
router.post('/:id/claim', async (req, res) => {
  try {
    const prisma = getPrisma();
    const userId = req.user.id;

    const item = await prisma.workItem.findUnique({ where: { id: req.params.id } });
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const perm = await checkPermission(userId, item.team_id, 'member');
    if (!perm.allowed) {
      return res.status(403).json({ error: perm.error });
    }

    // Atomic claim using raw SQL for the WHERE assignee_id IS NULL guarantee
    const result = await prisma.$transaction(async (tx) => {
      const affected = await tx.$executeRawUnsafe(
        `UPDATE work_items SET assignee_id = $1, version = version + 1, updated_at = NOW() WHERE id = $2 AND assignee_id IS NULL`,
        userId,
        req.params.id
      );

      if (affected === 0) {
        const current = await tx.workItem.findUnique({
          where: { id: req.params.id },
          include: {
            assignee: { select: { id: true, name: true, email: true } },
          },
        });
        return { conflict: true, current };
      }

      // Activity event in same transaction
      await tx.activityEvent.create({
        data: {
          item_id: req.params.id,
          actor_id: userId,
          event_type: 'claimed',
          old_value: '',
          new_value: userId,
        },
      });

      const updated = await tx.workItem.findUnique({
        where: { id: req.params.id },
        include: {
          assignee: { select: { id: true, name: true, email: true } },
          creator: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true } },
        },
      });

      return { conflict: false, item: updated };
    });

    if (result.conflict) {
      return res.status(409).json({
        error: `Item already claimed by ${result.current?.assignee?.name || 'another user'}`,
        item: result.current,
      });
    }

    return res.json(result.item);
  } catch (err) {
    console.error('POST /items/:id/claim error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /items/:id/transition ────────────────────────────────────────────────
// Body: { to: "in_progress" }
router.post('/:id/transition', async (req, res) => {
  try {
    const prisma = getPrisma();
    const userId = req.user.id;
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({ error: '"to" status is required' });
    }

    const item = await prisma.workItem.findUnique({ where: { id: req.params.id } });
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Permission check: at least member
    const perm = await checkPermission(userId, item.team_id, 'member');
    if (!perm.allowed) {
      return res.status(403).json({ error: perm.error });
    }

    // Validate transition
    const transition = validateTransition(item.status, to);
    if (!transition.valid) {
      return res.status(422).json({ error: transition.error });
    }

    // If transition requires Lead, check
    if (transition.requiresLead) {
      const leadPerm = await checkPermission(userId, item.team_id, 'lead');
      if (!leadPerm.allowed) {
        return res.status(403).json({
          error: 'Only a Lead or Admin of this team can approve items (awaiting_approval → resolved)',
        });
      }
    }

    // Perform transition in transaction with activity event
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.workItem.update({
        where: { id: req.params.id },
        data: {
          status: to,
          version: { increment: 1 },
        },
        include: {
          assignee: { select: { id: true, name: true, email: true } },
          creator: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true } },
        },
      });

      await tx.activityEvent.create({
        data: {
          item_id: req.params.id,
          actor_id: userId,
          event_type: 'status_changed',
          old_value: item.status,
          new_value: to,
        },
      });

      return result;
    });

    return res.json(updated);
  } catch (err) {
    console.error('POST /items/:id/transition error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /items/:id/comments ──────────────────────────────────────────────────
router.post('/:id/comments', async (req, res) => {
  try {
    const prisma = getPrisma();
    const userId = req.user.id;
    const { body } = req.body;

    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'Comment body is required' });
    }

    const item = await prisma.workItem.findUnique({ where: { id: req.params.id } });
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const perm = await checkPermission(userId, item.team_id, 'member');
    if (!perm.allowed) {
      return res.status(403).json({ error: perm.error });
    }

    const comment = await prisma.$transaction(async (tx) => {
      const c = await tx.comment.create({
        data: {
          item_id: req.params.id,
          author_id: userId,
          body: body.trim(),
        },
        include: {
          author: { select: { id: true, name: true, email: true } },
        },
      });

      await tx.activityEvent.create({
        data: {
          item_id: req.params.id,
          actor_id: userId,
          event_type: 'comment_added',
          new_value: body.trim().substring(0, 200),
        },
      });

      return c;
    });

    return res.status(201).json(comment);
  } catch (err) {
    console.error('POST /items/:id/comments error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /items/:id/comments ───────────────────────────────────────────────────
router.get('/:id/comments', async (req, res) => {
  try {
    const prisma = getPrisma();
    const userId = req.user.id;

    const item = await prisma.workItem.findUnique({ where: { id: req.params.id } });
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const perm = await checkPermission(userId, item.team_id, 'viewer');
    if (!perm.allowed) {
      return res.status(403).json({ error: perm.error });
    }

    const comments = await prisma.comment.findMany({
      where: { item_id: req.params.id },
      orderBy: { created_at: 'asc' },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    });

    return res.json(comments);
  } catch (err) {
    console.error('GET /items/:id/comments error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /items/:id/activity ───────────────────────────────────────────────────
router.get('/:id/activity', async (req, res) => {
  try {
    const prisma = getPrisma();
    const userId = req.user.id;

    const item = await prisma.workItem.findUnique({ where: { id: req.params.id } });
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const perm = await checkPermission(userId, item.team_id, 'viewer');
    if (!perm.allowed) {
      return res.status(403).json({ error: perm.error });
    }

    const events = await prisma.activityEvent.findMany({
      where: { item_id: req.params.id },
      orderBy: { created_at: 'asc' },
      include: {
        actor: { select: { id: true, name: true, email: true } },
      },
    });

    return res.json(events);
  } catch (err) {
    console.error('GET /items/:id/activity error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
