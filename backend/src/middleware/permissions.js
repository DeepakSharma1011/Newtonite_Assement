/**
 * Centralized permission function.
 * Every endpoint should call this to check the user's access to a resource.
 *
 * checkPermission(userId, teamId, requiredRole) → { allowed, membership, error }
 *
 * Role hierarchy: viewer < member < lead < admin
 */
const { getPrisma } = require('../lib/prisma');

const ROLE_HIERARCHY = { viewer: 0, member: 1, lead: 2, admin: 3 };

/**
 * Check if a user has at least `requiredRole` in `teamId`.
 * @param {string} userId
 * @param {string} teamId
 * @param {string} requiredRole - minimum role needed ('viewer' | 'member' | 'lead' | 'admin')
 * @returns {Promise<{ allowed: boolean, membership?: object, error?: string }>}
 */
async function checkPermission(userId, teamId, requiredRole = 'viewer') {
  const prisma = getPrisma();

  const membership = await prisma.membership.findUnique({
    where: { user_id_team_id: { user_id: userId, team_id: teamId } },
  });

  if (!membership) {
    return { allowed: false, error: 'Not a member of this team' };
  }

  const userLevel = ROLE_HIERARCHY[membership.role] ?? -1;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 999;

  if (userLevel < requiredLevel) {
    return {
      allowed: false,
      membership,
      error: `Requires role '${requiredRole}' or higher; you have '${membership.role}'`,
    };
  }

  return { allowed: true, membership };
}

/**
 * Get all team IDs the user is a member of.
 */
async function getUserTeamIds(userId) {
  const prisma = getPrisma();
  const memberships = await prisma.membership.findMany({
    where: { user_id: userId },
    select: { team_id: true },
  });
  return memberships.map(m => m.team_id);
}

module.exports = { checkPermission, getUserTeamIds, ROLE_HIERARCHY };
