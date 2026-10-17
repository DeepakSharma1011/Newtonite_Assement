const express = require('express');
const bcrypt = require('bcryptjs');
const { getPrisma } = require('../lib/prisma');
const { createToken } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /auth/login
 * Body: { email, password }
 * Returns: { token, user: { id, name, email, memberships } }
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const prisma = getPrisma();
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: { team: { select: { id: true, name: true } } },
        },
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = createToken(user);

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        memberships: user.memberships.map(m => ({
          team_id: m.team_id,
          team_name: m.team.name,
          role: m.role,
        })),
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
