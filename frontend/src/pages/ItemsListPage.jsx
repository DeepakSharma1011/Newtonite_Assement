import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchItems, createItem, fetchTeams } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const STATUS_LABELS = {
  open: 'Open', in_progress: 'In Progress', awaiting_approval: 'Awaiting Approval',
  resolved: 'Resolved', closed: 'Closed',
};
const TYPE_LABELS = {
  incident: 'Incident', customer_issue: 'Customer Issue', payment: 'Payment',
  compliance: 'Compliance', task: 'Task',
};

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ItemsListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState({
    status: '', priority: '', team: '', assignee: '', q: '',
  });
  const [cursor, setCursor] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data: teamsData } = useQuery({
    queryKey: ['teams'],
    queryFn: fetchTeams,
  });

  const queryParams = { ...filters, cursor, limit: 25 };
  const { data, isLoading, error } = useQuery({
    queryKey: ['items', queryParams],
    queryFn: () => fetchItems(queryParams),
    keepPreviousData: true,
  });

  const items = data?.items || [];
  const nextCursor = data?.nextCursor;
  const total = data?.total || 0;

  const updateFilter = useCallback((key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setCursor(null); // Reset pagination on filter change
  }, []);

  return (
    <div>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Work Items</h1>
          <p className="page-subtitle">{total} total items</p>
        </div>
        {user?.memberships?.some(m => m.role !== 'viewer') && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)} id="create-item-btn">
            + New Item
          </button>
        )}
      </div>

      {/* Filters toolbar */}
      <div className="items-toolbar">
        <div className="search-input-wrapper">
          <span className="search-icon">🔍</span>
          <input
            className="form-input"
            placeholder="Search items..."
            value={filters.q}
            onChange={(e) => updateFilter('q', e.target.value)}
            id="search-input"
          />
        </div>
        <select
          className="form-input"
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          id="filter-status"
        >
          <option value="">All Statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          className="form-input"
          value={filters.priority}
          onChange={(e) => updateFilter('priority', e.target.value)}
          id="filter-priority"
        >
          <option value="">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          className="form-input"
          value={filters.team}
          onChange={(e) => updateFilter('team', e.target.value)}
          id="filter-team"
        >
          <option value="">All Teams</option>
          {teamsData?.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={filters.assignee === user?.id}
            onChange={(e) => updateFilter('assignee', e.target.checked ? user?.id : '')}
          />
          Assigned to me
        </label>
      </div>

      {/* Items table */}
      <div className="card">
        <div className="items-header">
          <span>Title</span>
          <span>Type</span>
          <span>Priority</span>
          <span>Status</span>
          <span>Assignee</span>
          <span>Created</span>
        </div>

        {isLoading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : error ? (
          <div className="alert alert-error" style={{ margin: '16px' }}>⚠ {error.message}</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <p className="empty-state-text">No items found matching your filters</p>
          </div>
        ) : (
          items.map(item => (
            <div
              key={item.id}
              className="item-row"
              onClick={() => navigate(`/items/${item.id}`)}
              id={`item-row-${item.id}`}
            >
              <div>
                <div className="item-title">{item.title}</div>
                <div className="item-meta">{item.team?.name}</div>
              </div>
              <span className={`badge-type ${item.type}`}>{TYPE_LABELS[item.type]}</span>
              <span className={`badge-priority ${item.priority}`}>{item.priority}</span>
              <span className={`badge-status ${item.status}`}>{STATUS_LABELS[item.status]}</span>
              <span className="item-assignee">{item.assignee?.name || '—'}</span>
              <span className="item-date">{formatDate(item.created_at)}</span>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      <div className="pagination">
        {cursor && (
          <button className="btn btn-secondary btn-sm" onClick={() => setCursor(null)}>
            ← First page
          </button>
        )}
        <span className="pagination-info">
          Showing {items.length} of {total} items
        </span>
        {nextCursor && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setCursor(nextCursor)}
            id="load-more-btn"
          >
            Next page →
          </button>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateItemModal
          teams={teamsData || []}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['items'] });
          }}
        />
      )}
    </div>
  );
}

function CreateItemModal({ teams, onClose, onCreated }) {
  const [form, setForm] = useState({
    title: '', description: '', type: 'task', priority: 'medium',
    team_id: teams[0]?.id || '', due_date: '',
  });
  const [error, setError] = useState('');

  const memberTeams = teams.filter(t => t.role !== 'viewer');

  const mutation = useMutation({
    mutationFn: createItem,
    onSuccess: onCreated,
    onError: (err) => setError(err.message),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    mutation.mutate({
      ...form,
      due_date: form.due_date || undefined,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Create Work Item</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">⚠ {error}</div>}

            <div className="form-group">
              <label className="form-label" htmlFor="create-title">Title</label>
              <input
                id="create-title"
                className="form-input"
                value={form.title}
                onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Brief description of the work item"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="create-description">Description</label>
              <textarea
                id="create-description"
                className="form-input"
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Details, context, reproduction steps..."
                rows={3}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="create-type">Type</label>
                <select
                  id="create-type"
                  className="form-input"
                  value={form.type}
                  onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}
                >
                  <option value="task">Task</option>
                  <option value="incident">Incident</option>
                  <option value="customer_issue">Customer Issue</option>
                  <option value="payment">Payment</option>
                  <option value="compliance">Compliance</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="create-priority">Priority</label>
                <select
                  id="create-priority"
                  className="form-input"
                  value={form.priority}
                  onChange={(e) => setForm(f => ({ ...f, priority: e.target.value }))}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="create-team">Team</label>
                <select
                  id="create-team"
                  className="form-input"
                  value={form.team_id}
                  onChange={(e) => setForm(f => ({ ...f, team_id: e.target.value }))}
                  required
                >
                  {memberTeams.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="create-due">Due Date</label>
                <input
                  id="create-due"
                  className="form-input"
                  type="date"
                  value={form.due_date}
                  onChange={(e) => setForm(f => ({ ...f, due_date: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={mutation.isPending} id="create-submit">
              {mutation.isPending ? 'Creating…' : 'Create Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
