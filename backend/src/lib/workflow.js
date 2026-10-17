/**
 * Workflow engine: defines valid status transitions and enforces rules.
 *
 * Valid transitions:
 *   open → in_progress
 *   in_progress → awaiting_approval
 *   awaiting_approval → resolved   (Lead+ only)
 *   resolved → closed
 *
 * Additional rules:
 *   - Re-open: resolved → in_progress, closed → open (for rework)
 */

const VALID_TRANSITIONS = {
  open:               ['in_progress'],
  in_progress:        ['awaiting_approval'],
  awaiting_approval:  ['resolved', 'in_progress'],   // resolved requires Lead
  resolved:           ['closed', 'in_progress'],       // re-open for rework
  closed:             ['open'],                         // re-open
};

// Transitions that require the actor to be a Lead (or Admin) on the item's team
const LEAD_REQUIRED_TRANSITIONS = new Set([
  'awaiting_approval→resolved',
]);

/**
 * Check if a status transition is valid.
 * @returns {{ valid: boolean, error?: string, requiresLead?: boolean }}
 */
function validateTransition(fromStatus, toStatus) {
  const allowed = VALID_TRANSITIONS[fromStatus];
  if (!allowed || !allowed.includes(toStatus)) {
    return {
      valid: false,
      error: `Invalid transition: ${fromStatus} → ${toStatus}. Allowed: ${(allowed || []).join(', ') || 'none'}`,
    };
  }

  const key = `${fromStatus}→${toStatus}`;
  return {
    valid: true,
    requiresLead: LEAD_REQUIRED_TRANSITIONS.has(key),
  };
}

module.exports = { validateTransition, VALID_TRANSITIONS };
