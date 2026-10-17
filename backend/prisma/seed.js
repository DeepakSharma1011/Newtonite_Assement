const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Deterministic UUIDs for seed data (so we can reference them in tests/docs)
const USERS = {
  alice:   { id: 'a0000000-0000-0000-0000-000000000001', name: 'Alice Chen',     email: 'alice@newtonite.io',   password: 'password123', role: 'admin' },
  bob:     { id: 'a0000000-0000-0000-0000-000000000002', name: 'Bob Martinez',    email: 'bob@newtonite.io',     password: 'password123', role: 'lead' },
  carol:   { id: 'a0000000-0000-0000-0000-000000000003', name: 'Carol Williams',  email: 'carol@newtonite.io',   password: 'password123', role: 'member' },
  dave:    { id: 'a0000000-0000-0000-0000-000000000004', name: 'Dave Johnson',    email: 'dave@newtonite.io',    password: 'password123', role: 'viewer' },
  eve:     { id: 'a0000000-0000-0000-0000-000000000005', name: 'Eve Brown',       email: 'eve@newtonite.io',     password: 'password123', role: 'lead' },
  frank:   { id: 'a0000000-0000-0000-0000-000000000006', name: 'Frank Davis',     email: 'frank@newtonite.io',   password: 'password123', role: 'member' },
  grace:   { id: 'a0000000-0000-0000-0000-000000000007', name: 'Grace Lee',       email: 'grace@newtonite.io',   password: 'password123', role: 'member' },
  henry:   { id: 'a0000000-0000-0000-0000-000000000008', name: 'Henry Wilson',    email: 'henry@newtonite.io',   password: 'password123', role: 'lead' },
  iris:    { id: 'a0000000-0000-0000-0000-000000000009', name: 'Iris Taylor',     email: 'iris@newtonite.io',    password: 'password123', role: 'member' },
  jack:    { id: 'a0000000-0000-0000-0000-00000000000a', name: 'Jack Anderson',   email: 'jack@newtonite.io',    password: 'password123', role: 'viewer' },
};

const TEAMS = {
  platform:   { id: 'b0000000-0000-0000-0000-000000000001', name: 'Platform Engineering' },
  payments:   { id: 'b0000000-0000-0000-0000-000000000002', name: 'Payments' },
  support:    { id: 'b0000000-0000-0000-0000-000000000003', name: 'Customer Support' },
  compliance: { id: 'b0000000-0000-0000-0000-000000000004', name: 'Compliance & Risk' },
};

// Team membership assignments
const MEMBERSHIPS = [
  // Platform Engineering
  { userId: USERS.alice.id,  teamId: TEAMS.platform.id,   role: 'admin' },
  { userId: USERS.bob.id,    teamId: TEAMS.platform.id,   role: 'lead' },
  { userId: USERS.carol.id,  teamId: TEAMS.platform.id,   role: 'member' },
  { userId: USERS.dave.id,   teamId: TEAMS.platform.id,   role: 'viewer' },
  // Payments
  { userId: USERS.alice.id,  teamId: TEAMS.payments.id,   role: 'admin' },
  { userId: USERS.eve.id,    teamId: TEAMS.payments.id,   role: 'lead' },
  { userId: USERS.frank.id,  teamId: TEAMS.payments.id,   role: 'member' },
  // Customer Support
  { userId: USERS.henry.id,  teamId: TEAMS.support.id,    role: 'lead' },
  { userId: USERS.grace.id,  teamId: TEAMS.support.id,    role: 'member' },
  { userId: USERS.jack.id,   teamId: TEAMS.support.id,    role: 'viewer' },
  // Compliance & Risk
  { userId: USERS.alice.id,  teamId: TEAMS.compliance.id, role: 'admin' },
  { userId: USERS.henry.id,  teamId: TEAMS.compliance.id, role: 'lead' },
  { userId: USERS.iris.id,   teamId: TEAMS.compliance.id, role: 'member' },
];

const ITEM_TYPES = ['incident', 'customer_issue', 'payment', 'compliance', 'task'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['open', 'in_progress', 'awaiting_approval', 'resolved', 'closed'];

const TITLES_BY_TYPE = {
  incident: [
    'Database connection pool exhaustion', 'CDN cache miss spike', 'API gateway 502 errors',
    'Memory leak in worker service', 'SSL certificate expiring', 'Disk usage critical on prod-3',
    'Redis cluster failover detected', 'DNS resolution intermittent', 'Load balancer health check failures',
    'Container OOM kills in staging',
  ],
  customer_issue: [
    'Unable to export CSV report', 'Login loop on Safari', 'Dashboard loading slowly',
    'Missing invoice in account', 'Wrong timezone on events', 'Search returns stale results',
    'Email notifications not arriving', 'Profile picture upload fails', '2FA recovery code not working',
    'API rate limit too aggressive for enterprise',
  ],
  payment: [
    'Double charge on subscription renewal', 'Refund not processed after 7 days',
    'Currency conversion error EUR→USD', 'Stripe webhook signature mismatch',
    'Invoice generation failing for annual plans', 'Tax calculation wrong for UK customers',
    'Payment method update clearing credits', 'Pro-rated upgrade calculation off',
    'Free trial not converting correctly', 'Payout delay to merchant accounts',
  ],
  compliance: [
    'GDPR data deletion request backlog', 'SOC 2 evidence collection due',
    'PCI DSS scan findings remediation', 'Privacy policy update required',
    'Audit log retention policy review', 'Vendor security assessment overdue',
    'Data processing agreement renewal', 'Incident response plan annual review',
    'Access control review for Q4', 'Penetration test remediation items',
  ],
  task: [
    'Upgrade Node.js to v22 LTS', 'Migrate CI/CD to GitHub Actions',
    'Set up Datadog APM dashboards', 'Document API versioning strategy',
    'Rotate production secrets', 'Archive old deployment artifacts',
    'Update dependency lockfile', 'Configure branch protection rules',
    'Set up error budget alerting', 'Write runbook for database failover',
  ],
};

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(daysBack, daysForward) {
  const now = Date.now();
  const start = now - daysBack * 86400000;
  const end = now + daysForward * 86400000;
  return new Date(start + Math.random() * (end - start));
}

async function main() {
  console.log('🌱 Seeding database...');

  // Check if data already exists
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0) {
    console.log('Database already seeded, skipping.');
    return;
  }

  // Create users
  const hashedPassword = await bcrypt.hash('password123', 10);
  for (const u of Object.values(USERS)) {
    await prisma.user.create({
      data: { id: u.id, name: u.name, email: u.email, password_hash: hashedPassword },
    });
  }
  console.log(`  ✓ Created ${Object.keys(USERS).length} users`);

  // Create teams
  for (const t of Object.values(TEAMS)) {
    await prisma.team.create({
      data: { id: t.id, name: t.name },
    });
  }
  console.log(`  ✓ Created ${Object.keys(TEAMS).length} teams`);

  // Create memberships
  for (const m of MEMBERSHIPS) {
    await prisma.membership.create({
      data: { user_id: m.userId, team_id: m.teamId, role: m.role },
    });
  }
  console.log(`  ✓ Created ${MEMBERSHIPS.length} memberships`);

  // Create work items - ~2500 to prove pagination
  const teamIds = Object.values(TEAMS).map(t => t.id);
  const teamMembers = {};
  for (const t of Object.values(TEAMS)) {
    const members = MEMBERSHIPS.filter(m => m.teamId === t.id);
    teamMembers[t.id] = members.map(m => m.userId);
  }

  const BATCH_SIZE = 100;
  const TOTAL_ITEMS = 2500;
  let itemCount = 0;

  for (let batch = 0; batch < Math.ceil(TOTAL_ITEMS / BATCH_SIZE); batch++) {
    const items = [];
    const batchEnd = Math.min((batch + 1) * BATCH_SIZE, TOTAL_ITEMS);
    for (let i = batch * BATCH_SIZE; i < batchEnd; i++) {
      const teamId = randomElement(teamIds);
      const members = teamMembers[teamId];
      const type = randomElement(ITEM_TYPES);
      const priority = randomElement(PRIORITIES);
      const status = randomElement(STATUSES);
      const createdBy = randomElement(members);
      const assigneeId = Math.random() > 0.3 ? randomElement(members) : null;
      const titles = TITLES_BY_TYPE[type];
      const titleBase = randomElement(titles);
      const title = `${titleBase} #${i + 1}`;
      const createdAt = randomDate(90, 0);
      const dueDate = Math.random() > 0.4 ? randomDate(-5, 30) : null;

      items.push({
        title,
        description: `Auto-generated work item for ${type}. Priority: ${priority}. This item requires attention from the ${Object.values(TEAMS).find(t => t.id === teamId)?.name} team.`,
        type,
        priority,
        status,
        team_id: teamId,
        assignee_id: assigneeId,
        created_by: createdBy,
        due_date: dueDate,
        version: status === 'open' ? 1 : Math.floor(Math.random() * 5) + 1,
        created_at: createdAt,
        updated_at: createdAt,
      });
    }

    await prisma.workItem.createMany({ data: items });
    itemCount += items.length;
  }
  console.log(`  ✓ Created ${itemCount} work items`);

  console.log('✅ Seed complete!');
  console.log('\n📋 Login credentials (all passwords: password123):');
  for (const [key, u] of Object.entries(USERS)) {
    console.log(`   ${u.email.padEnd(28)} ${u.name.padEnd(18)} (${u.role})`);
  }
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
