import { useQuery } from '@tanstack/react-query';
import { fetchItems, fetchTeams } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In Progress',
  awaiting_approval: 'Awaiting Approval',
  resolved: 'Resolved',
  closed: 'Closed',
};

const TYPE_LABELS = {
  incident: 'Incident',
  customer_issue: 'Customer Issue',
  payment: 'Payment',
  compliance: 'Compliance',
  task: 'Task',
};

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function DashboardCard({ title, icon, items, emptyText }) {
  const navigate = useNavigate();
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{icon} {title}</span>
        <span className="text-sm text-muted">{items.length} items</span>
      </div>
      <div className="dashboard-section">
        {items.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px' }}>
            <p className="empty-state-text">{emptyText}</p>
          </div>
        ) : (
          items.slice(0, 5).map(item => (
            <div
              key={item.id}
              className="item-row"
              onClick={() => navigate(`/items/${item.id}`)}
            >
              <div>
                <div className="item-title">{item.title}</div>
                <div className="item-meta">
                  <span className={`badge-type ${item.type}`}>{TYPE_LABELS[item.type]}</span>
                  {' · '}
                  {formatDate(item.created_at)}
                </div>
              </div>
              <span className={`badge-priority ${item.priority}`}>{item.priority}</span>
              <span className={`badge-status ${item.status}`}>{STATUS_LABELS[item.status]}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();

  const { data: teamsData } = useQuery({
    queryKey: ['teams'],
    queryFn: fetchTeams,
  });

  // Assigned to me
  const { data: assignedData } = useQuery({
    queryKey: ['items', 'assigned-to-me'],
    queryFn: () => fetchItems({ assignee: user.id, limit: 10 }),
  });

  // Unassigned urgent
  const { data: urgentData } = useQuery({
    queryKey: ['items', 'unassigned-urgent'],
    queryFn: () => fetchItems({ priority: 'urgent', limit: 20 }),
  });

  // Awaiting approval (for leads)
  const { data: awaitingData } = useQuery({
    queryKey: ['items', 'awaiting-approval'],
    queryFn: () => fetchItems({ status: 'awaiting_approval', limit: 20 }),
  });

  const assignedItems = assignedData?.items || [];
  const urgentUnassigned = (urgentData?.items || []).filter(i => !i.assignee_id);
  const awaitingItems = awaitingData?.items || [];

  const leadTeams = user?.memberships?.filter(m => m.role === 'lead' || m.role === 'admin') || [];
  const awaitingMyApproval = awaitingItems.filter(item =>
    leadTeams.some(m => m.team_id === item.team_id)
  );

  const totalAssigned = assignedItems.filter(i => i.status !== 'closed' && i.status !== 'resolved').length;
  const inProgress = assignedItems.filter(i => i.status === 'in_progress').length;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Welcome back, {user?.name}</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Assigned to you</div>
          <div className="stat-value accent">{totalAssigned}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">In Progress</div>
          <div className="stat-value warning">{inProgress}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Urgent Unassigned</div>
          <div className="stat-value danger">{urgentUnassigned.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Awaiting Your Approval</div>
          <div className="stat-value" style={{ color: 'var(--color-awaiting)' }}>{awaitingMyApproval.length}</div>
        </div>
      </div>

      <div className="dashboard-grid">
        <DashboardCard
          title="Assigned to Me"
          icon="📋"
          items={assignedItems.filter(i => i.status !== 'closed')}
          emptyText="No items assigned to you"
        />
        <DashboardCard
          title="Unassigned Urgent"
          icon="🔴"
          items={urgentUnassigned}
          emptyText="No urgent unassigned items — great!"
        />
        {leadTeams.length > 0 && (
          <DashboardCard
            title="Awaiting My Approval"
            icon="⏳"
            items={awaitingMyApproval}
            emptyText="No items waiting for your approval"
          />
        )}
      </div>

      {teamsData && (
        <div style={{ marginTop: 'var(--space-xl)' }}>
          <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, marginBottom: 'var(--space-md)' }}>Your Teams</h2>
          <div className="stats-grid">
            {teamsData.map(team => (
              <div key={team.id} className="stat-card">
                <div className="stat-label">{team.name}</div>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'baseline' }}>
                  <div className="stat-value">{team.item_count}</div>
                  <span className="text-sm text-muted">items · {team.member_count} members</span>
                </div>
                <span className={`badge-status ${team.role}`} style={{ marginTop: '8px' }}>{team.role}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
