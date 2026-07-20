import type { AppConfig, ConversationDemo, DailyTask, ItemType, ReviewResult, SemanticRelatedItem, StudyItem, User } from './types';

const tokenKey = 'sanxiu-token';

export function getToken() {
  return localStorage.getItem(tokenKey);
}

export function setToken(token: string | null) {
  if (token) {
    localStorage.setItem(tokenKey, token);
  } else {
    localStorage.removeItem(tokenKey);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');

  const token = getToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(path, { ...options, headers });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message ?? '请求失败');
  }
  return data as T;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ItemInput {
  type: ItemType;
  text: string;
  meaning?: string;
  example?: string;
}

export const api = {
  getConfig() {
    return request<AppConfig>('/api/config');
  },
  login(input: { account: string; password: string }) {
    return request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },
  me() {
    return request<{ user: User }>('/api/auth/me');
  },
  getSettings() {
    return request<{ dailyGoal: number }>('/api/settings');
  },
  updateSettings(input: { dailyGoal: number }) {
    return request<{ dailyGoal: number }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(input)
    });
  },
  generateMeaning(input: Pick<ItemInput, 'type' | 'text' | 'example'>) {
    return request<{ meaning: string }>('/api/ai/meaning', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },
  listItems(params: { type?: ItemType | 'all'; keyword?: string } = {}) {
    const search = new URLSearchParams();
    if (params.type && params.type !== 'all') {
      search.set('type', params.type);
    }
    if (params.keyword) {
      search.set('keyword', params.keyword);
    }
    const query = search.toString();
    return request<{ items: StudyItem[] }>(`/api/items${query ? `?${query}` : ''}`);
  },
  createItem(input: ItemInput) {
    return request<{ item: StudyItem }>('/api/items', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },
  updateItem(id: number, input: Partial<ItemInput>) {
    return request<{ item: StudyItem }>(`/api/items/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input)
    });
  },
  deleteItem(id: number) {
    return request<void>(`/api/items/${id}`, { method: 'DELETE' });
  },
  listSimilarItems(itemId: number) {
    return request<{ items: SemanticRelatedItem[] }>(`/api/items/${itemId}/similar`);
  },
  generateSimilarItems(itemId: number, count = 5) {
    return request<{ items: SemanticRelatedItem[]; cached: boolean }>(`/api/items/${itemId}/similar/generate`, {
      method: 'POST',
      body: JSON.stringify({ count })
    });
  },
  addSimilarToLibrary(itemId: number, relatedId: number) {
    return request<{ item: StudyItem; related: SemanticRelatedItem }>(`/api/items/${itemId}/similar/${relatedId}/add-to-library`, {
      method: 'POST',
      body: JSON.stringify({})
    });
  },
  getConversationDemo(itemId: number) {
    return request<{ demo: ConversationDemo | null }>(`/api/items/${itemId}/conversation-demo`);
  },
  generateConversationDemo(itemId: number, regenerate = false) {
    return request<{ demo: ConversationDemo; cached: boolean }>(`/api/items/${itemId}/conversation-demo/generate`, {
      method: 'POST',
      body: JSON.stringify({ regenerate })
    });
  },
  todayTask() {
    return request<{ task: DailyTask }>('/api/tasks/today');
  },
  reviewTaskItem(taskItemId: number, result: ReviewResult) {
    return request<{ task: DailyTask; item: StudyItem }>(`/api/tasks/items/${taskItemId}/review`, {
      method: 'POST',
      body: JSON.stringify({ result })
    });
  }
};

