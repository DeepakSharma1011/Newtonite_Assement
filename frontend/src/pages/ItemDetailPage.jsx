import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchItem, updateItem, claimItem, transitionItem,
  fetchActivity, fetchComments, addComment
} from '../api/client';
import { useAuth } from '../context/AuthContext';

const STATUS_LABELS = {
  open: 'Open', in_progress: 'In Progress', awaiting_approval: 'Awaiting Approval',
  resolved: 'Resolved', closed: 'Closed',
};
const TYPE_LABELS = {
  incident: 'Incident', customer_issue: 'Customer Issue', payment: 'Payment',
  compliance: 'Compliance', task: 'Task',
};
const TRANSITIONS = {
  open: ['in_progress'],
  in_progress: ['awaiting_approval'],
  awaiting_approval: ['resolved', 'in_progress'],
  resolved: ['closed', 'in_progress'],
  closed: ['open'],
};

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatRelative(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = Date.now() - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function eventIcon(type) {
  switch (type) {
    case 'created': return '✨';
    case 'status_changed': return '🔄';
    case 'claimed': return '🙋';
    case 'priority_changed': return '⚡';
    case 'assignee_changed': return '👤';
    case 'title_changed': return '✏️';
    case 'comment_added': return '💬';
    default: return '📝';
  }
}

function eventDescription(event) {
  const actor = event.actor?.name || 'Someone';
  switch (event.event_type) {
    case 'created':
      return <><strong>{actor}</strong> created this item</>;
    case 'status_changed':
      return <><strong>{actor}</strong> changed status from <span className={`badge-status ${event.old_value}`}>{STATUS_LABELS[event.old_value] || event.old_value}</span> to <span className={`badge-status ${event.new_value}`}>{STATUS_LABELS[event.new_value] || event.new_value}</span></>;
    case 'claimed':
      return <><strong>{actor}</strong> claimed this item</>;
    case 'priority_changed':
      return <><strong>{actor}</strong> changed priority from <span className={`badge-priority ${event.old_value}`}>{event.old_value}</span> to <span className={`badge-priority ${event.new_value}`}>{event.new_value}</span></>;
    case 'assignee_changed':
      return <><strong>{actor}</strong> reassigned this item</>;
    case 'title_changed':
      return <><strong>{actor}</strong> updated the title</>;
    case 'comment_added':
      return <><strong>{actor}</strong> added a comment</>;
    default:
      return <><strong>{actor}</strong> performed {event.event_type}</>;
  }
}

export default function ItemDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState('activity');
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [commentText, setCommentText] = useState('');

  const { data: item, isLoading, error: fetchError } = useQuery({
    queryKey: ['item', id],
    queryFn: () => fetchItem(id),
  });

  const { data: activity } = useQuery({
    queryKey: ['activity', id],
    queryFn: () => fetchActivity(id),
    enabled: activeTab === 'activity',
  });

  const { data: comments } = useQuery({
    queryKey: ['comments', id],
    queryFn: () => fetchComments(id),
    enabled: activeTab === 'comments',
  });

  const invalidateItem = () => {
    queryClient.invalidateQueries({ queryKey: ['item', id] });
    queryClient.invalidateQueries({ queryKey: ['activity', id] });
    queryClient.invalidateQueries({ queryKey: ['items'] });
  };

  const claimMutation = useMutation({
    mutationFn: () => claimItem(id),
    onSuccess: () => { setSuccess('Item claimed!'); setError(''); invalidateItem(); },
    onError: (err) => {
      if (err.status === 409) {
        setError('Item already claimed by someone else. Reloading…');
        invalidateItem();
      } else {
        setError(err.message);
      }
    },
  });

  const transitionMutation = useMutation({
    mutationFn: (to) => transitionItem(id, to),
    onSuccess: () => { setSuccess('Status updated!'); setError(''); invalidateItem(); },
    onError: (err) => setError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (data) => updateItem(id, data),
    onSuccess: () => {
      setSuccess('Item updated!');
      setError('');
      setEditMode(false);
      invalidateItem();
    },
    onError: (err) => {
      if (err.status === 409) {
        setError('Item has been changed by someone else. Please reload and try again.');
        invalidateItem();
      } else {
        setError(err.message);
      }
    },
  });

  const commentMutation = useMutation({
    mutationFn: (body) => addComment(id, body),
    onSuccess: () => {
      setCommentText('');
      queryClient.invalidateQueries({ queryKey: ['comments', id] });
      queryClient.invalidateQueries({ queryKey: ['activity', id] });
    },
    onError: (err) => setError(err.message),
  });

  if (isLoading) {
    return <div className="loading-center"><div className="spinner" /></div>;
  }

  if (fetchError) {
    return (
      <div>
        <button className="back-link" onClick={() => navigate('/items')}>← Back to items</button>
        <div className="alert alert-error">⚠ {fetchError.message}</div>
      </div>
    );
  }

  if (!item) return null;

  const canEdit = hasRole(item.team_id, 'member');
  const canApprove = hasRole(item.team_id, 'lead');
  const isUnassigned = !item.assignee_id;
  const possibleTransitions = TRANSITIONS[item.status] || [];

  const handleSaveEdit = () => {
    updateMutation.mutate({
      version: item.version,
      ...editForm,
    });
  };

  const startEdit = () => {
    setEditForm({
      title: item.title,
      description: item.description || '',
      priority: item.priority,
    });
    setEditMode(true);
    setError('');
    setSuccess('');
  };

  return (
    <div className="item-detail">
      <button className="back-link" onClick={() => navigate('/items')} id="back-to-items">← Back to items</button>

      {error && <div className="alert alert-error">⚠ {error}</div>}
      {success && <div className="alert alert-success">✓ {success}</div>}

      <div className="item-detail-header">
        {editMode ? (
          <input
            className="form-input"
            value={editForm.title}
            onChange={(e) => setEditForm(f => ({ ...f, title: e.target.value }))}
            style={{ fontSize: 'var(--font-size-xl)', fontWeight: 800, marginBottom: '8px' }}
          />
        ) : (
          <h1 className="item-detail-title" id="item-title">{item.title}</h1>
        )}
        <div className="item-detail-badges">
          <span className={`badge-type ${item.type}`}>{TYPE_LABELS[item.type]}</span>
          <span className={`badge-priority ${item.priority}`}>{item.priority}</span>
          <span className={`badge-status ${item.status}`}>{STATUS_LABELS[item.status]}</span>
          <span className="text-sm text-muted">v{item.version}</span>
        </div>
      </div>

      {/* Actions bar */}
      {canEdit && (
        <div className="actions-bar">
          {isUnassigned && item.status !== 'closed' && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => claimMutation.mutate()}
              disabled={claimMutation.isPending}
              id="claim-btn"
            >
              {claimMutation.isPending ? 'Claiming…' : '🙋 Claim'}
            </button>
          )}

          {possibleTransitions.map(to => {
            const needsLead = to === 'resolved' && item.status === 'awaiting_approval';
            if (needsLead && !canApprove) return null;
            return (
              <button
                key={to}
                className={`btn btn-sm ${to === 'resolved' ? 'btn-success' : 'btn-secondary'}`}
                onClick={() => transitionMutation.mutate(to)}
                disabled={transitionMutation.isPending}
                id={`transition-${to}`}
              >
                → {STATUS_LABELS[to]}
              </button>
            );
          })}

          {!editMode ? (
            <button className="btn btn-secondary btn-sm" onClick={startEdit} id="edit-btn">
              ✏️ Edit
            </button>
          ) : (
            <>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveEdit}
                disabled={updateMutation.isPending}
                id="save-edit-btn"
              >
                {updateMutation.isPending ? 'Saving…' : '💾 Save'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditMode(false)}>Cancel</button>
            </>
          )}
        </div>
      )}

      <div className="item-detail-body">
        <div className="item-detail-main">
          {/* Description */}
          <div className="card mb-lg">
            <div className="card-header">
              <span className="card-title">Description</span>
            </div>
            <div className="card-body">
              {editMode ? (
                <textarea
                  className="form-input"
                  value={editForm.description}
                  onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))}
                  rows={5}
                />
              ) : (
                <p className="description-text">
                  {item.description || 'No description provided.'}
                </p>
              )}
            </div>
          </div>

          {/* Edit priority */}
          {editMode && (
            <div className="card mb-lg">
              <div className="card-body">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Priority</label>
                  <select
                    className="form-input"
                    value={editForm.priority}
                    onChange={(e) => setEditForm(f => ({ ...f, priority: e.target.value }))}
                    style={{ maxWidth: '200px' }}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Tabs: Activity / Comments */}
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'activity' ? 'active' : ''}`}
              onClick={() => setActiveTab('activity')}
              id="tab-activity"
            >
              Activity
            </button>
            <button
              className={`tab ${activeTab === 'comments' ? 'active' : ''}`}
              onClick={() => setActiveTab('comments')}
              id="tab-comments"
            >
              Comments {comments?.length ? `(${comments.length})` : ''}
            </button>
          </div>

          {activeTab === 'activity' && (
            <div className="timeline">
              {!activity ? (
                <div className="loading-center"><div className="spinner" /></div>
              ) : activity.length === 0 ? (
                <div className="empty-state">
                  <p className="empty-state-text">No activity yet</p>
                </div>
              ) : (
                activity.map(event => (
                  <div key={event.id} className="timeline-item">
                    <div className="timeline-dot">{eventIcon(event.event_type)}</div>
                    <div className="timeline-content">
                      <div className="timeline-text">{eventDescription(event)}</div>
                      <div className="timeline-time">{formatRelative(event.created_at)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'comments' && (
            <div>
              <div className="card">
                {!comments ? (
                  <div className="loading-center"><div className="spinner" /></div>
                ) : comments.length === 0 ? (
                  <div className="empty-state">
                    <p className="empty-state-text">No comments yet</p>
                  </div>
                ) : (
                  comments.map(comment => (
                    <div key={comment.id} className="comment">
                      <div className="comment-header">
                        <div className="user-avatar" style={{ width: 26, height: 26, fontSize: '0.65rem' }}>
                          {comment.author?.name?.split(' ').map(n => n[0]).join('')}
                        </div>
                        <span className="comment-author">{comment.author?.name}</span>
                        <span className="comment-time">{formatRelative(comment.created_at)}</span>
                      </div>
                      <div className="comment-body">{comment.body}</div>
                    </div>
                  ))
                )}
              </div>

              {canEdit && (
                <form
                  className="comment-form mt-md"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (commentText.trim()) commentMutation.mutate(commentText);
                  }}
                >
                  <input
                    className="form-input"
                    placeholder="Add a comment..."
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    id="comment-input"
                  />
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={!commentText.trim() || commentMutation.isPending}
                    id="submit-comment"
                  >
                    {commentMutation.isPending ? '…' : 'Send'}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="item-detail-sidebar">
          <div className="card">
            <div className="card-body">
              <div className="sidebar-field">
                <div className="sidebar-field-label">Status</div>
                <div className="sidebar-field-value">
                  <span className={`badge-status ${item.status}`}>{STATUS_LABELS[item.status]}</span>
                </div>
              </div>
              <div className="sidebar-field">
                <div className="sidebar-field-label">Priority</div>
                <div className="sidebar-field-value">
                  <span className={`badge-priority ${item.priority}`}>{item.priority}</span>
                </div>
              </div>
              <div className="sidebar-field">
                <div className="sidebar-field-label">Type</div>
                <div className="sidebar-field-value">
                  <span className={`badge-type ${item.type}`}>{TYPE_LABELS[item.type]}</span>
                </div>
              </div>
              <div className="sidebar-field">
                <div className="sidebar-field-label">Team</div>
                <div className="sidebar-field-value">{item.team?.name}</div>
              </div>
              <div className="sidebar-field">
                <div className="sidebar-field-label">Assignee</div>
                <div className="sidebar-field-value">{item.assignee?.name || 'Unassigned'}</div>
              </div>
              <div className="sidebar-field">
                <div className="sidebar-field-label">Created by</div>
                <div className="sidebar-field-value">{item.creator?.name}</div>
              </div>
              <div className="sidebar-field">
                <div className="sidebar-field-label">Due Date</div>
                <div className="sidebar-field-value">{item.due_date ? formatDate(item.due_date) : 'None'}</div>
              </div>
              <div className="sidebar-field">
                <div className="sidebar-field-label">Created</div>
                <div className="sidebar-field-value">{formatDate(item.created_at)}</div>
              </div>
              <div className="sidebar-field">
                <div className="sidebar-field-label">Updated</div>
                <div className="sidebar-field-value">{formatDate(item.updated_at)}</div>
              </div>
              <div className="sidebar-field" style={{ borderBottom: 'none' }}>
                <div className="sidebar-field-label">Version</div>
                <div className="sidebar-field-value font-mono">{item.version}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
