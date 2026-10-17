const express = require('express');
const { getPrisma } = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissions');

const router = express.Router();
router.use(authenticate);

// ─── GET /teams ────────────────────────────────────────────────────────────────
// Returns teams the user is a member of
router.get('/', async (req, res) => {
  try {
    const prisma = getPrisma();
    const memberships = await prisma.membership.findMany({
      where: { user_id: req.user.id },
      include: {
        team: {
          include: {
            _count: { select: { work_items: true, memberships: true } },
          },
        },
      },
    });

    const teams = memberships.map(m => ({
      id: m.team.id,
      name: m.team.name,
      role: m.role,
      item_count: m.team._count.work_items,
      member_count: m.team._count.memberships,
    }));

    return res.json(teams);
  } catch (err) {
    console.error('GET /teams error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /teams/:id/members ────────────────────────────────────────────────────
router.get('/:id/members', async (req, res) => {
  try {
    const prisma = getPrisma();
    const perm = await checkPermission(req.user.id, req.params.id, 'viewer');
    if (!perm.allowed) {
      return res.status(403).json({ error: perm.error });
    }

    const memberships = await prisma.membership.findMany({
      where: { team_id: req.params.id },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    return res.json(memberships.map(m => ({
      user_id: m.user_id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    })));
  } catch (err) {
    console.error('GET /teams/:id/members error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /teams/:id/members ──────────────────────────────────────────────────
// Admin only: add a member to a team
router.post('/:id/members', async (req, res) => {
  try {
    const prisma = getPrisma();
    const perm = await checkPermission(req.user.id, req.params.id, 'admin');
    if (!perm.allowed) {
      return res.status(403).json({ error: perm.error });
    }

    const { user_id, role } = req.body;
    if (!user_id || !role) {
      return res.status(400).json({ error: 'user_id and role are required' });
    }

    const validRoles = ['viewer', 'member', 'lead', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    const membership = await prisma.membership.upsert({
      where: { user_id_team_id: { user_id, team_id: req.params.id } },
      update: { role },
      create: { user_id, team_id: req.params.id, role },
    });

    return res.status(201).json(membership);
  } catch (err) {
    console.error('POST /teams/:id/members error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
