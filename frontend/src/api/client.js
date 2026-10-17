const API_BASE = import.meta.env.VITE_API_URL || '';

function getToken() {
  return localStorage.getItem('newtonite_token');
}

function getHeaders(extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function handleResponse(res) {
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error || `Request failed (${res.status})`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

// Auth
export async function login(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return handleResponse(res);
}

// Items
export async function fetchItems(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query.set(k, v);
  });
  const res = await fetch(`${API_BASE}/items?${query}`, { headers: getHeaders() });
  return handleResponse(res);
}

export async function fetchItem(id) {
  const res = await fetch(`${API_BASE}/items/${id}`, { headers: getHeaders() });
  return handleResponse(res);
}

export async function createItem(data) {
  const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await fetch(`${API_BASE}/items`, {
    method: 'POST',
    headers: getHeaders({ 'Idempotency-Key': idempotencyKey }),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function updateItem(id, data) {
  const res = await fetch(`${API_BASE}/items/${id}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function claimItem(id) {
  const res = await fetch(`${API_BASE}/items/${id}/claim`, {
    method: 'POST',
    headers: getHeaders(),
  });
  return handleResponse(res);
}

export async function transitionItem(id, to) {
  const res = await fetch(`${API_BASE}/items/${id}/transition`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ to }),
  });
  return handleResponse(res);
}

// Comments
export async function fetchComments(itemId) {
  const res = await fetch(`${API_BASE}/items/${itemId}/comments`, { headers: getHeaders() });
  return handleResponse(res);
}

export async function addComment(itemId, body) {
  const res = await fetch(`${API_BASE}/items/${itemId}/comments`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ body }),
  });
  return handleResponse(res);
}

// Activity
export async function fetchActivity(itemId) {
  const res = await fetch(`${API_BASE}/items/${itemId}/activity`, { headers: getHeaders() });
  return handleResponse(res);
}

// Teams
export async function fetchTeams() {
  const res = await fetch(`${API_BASE}/teams`, { headers: getHeaders() });
  return handleResponse(res);
}

export async function fetchTeamMembers(teamId) {
  const res = await fetch(`${API_BASE}/teams/${teamId}/members`, { headers: getHeaders() });
  return handleResponse(res);
}
