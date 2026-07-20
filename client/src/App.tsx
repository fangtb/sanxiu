import { createContext, FormEvent, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Outlet, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { api, getToken, setToken, type ItemInput } from './api';
import type { AppConfig, ConversationDemo, DailyTask, ItemType, SemanticRelatedItem, StudyItem, TaskItem, User } from './types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (account: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const refreshUser = async () => {
    const data = await api.me();
    setUser(data.user);
  };

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }

    refreshUser()
      .catch(() => {
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    login: async (account, password) => {
      const data = await api.login({ account, password });
      setToken(data.token);
      setUser(data.user);
    },
    logout: () => {
      setToken(null);
      setUser(null);
    },
    refreshUser
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function speakEnglish(text: string, rate = 0.9) {
  if (!('speechSynthesis' in window)) {
    alert('当前浏览器暂不支持朗读功能');
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = rate;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function AppFooter() {
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    let mounted = true;
    api.getConfig()
      .then((data) => {
        if (mounted) {
          setConfig(data);
        }
      })
      .catch(() => {
        if (mounted) {
          setConfig(null);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (!config?.icpRecord) {
    return null;
  }

  return (
    <footer className="app-footer">
      <a href={config.icpRecordUrl} target="_blank" rel="noreferrer">
        {config.icpRecord}
      </a>
    </footer>
  );
}

function ProtectedLayout() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <div className="center-screen">正在检查登录状态...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="返回散修网首页">
          <span className="brand-mark">散修网</span>
          <span>
            <small>{user.name}</small>
          </span>
        </Link>
        <button className="ghost-button" onClick={logout}>退出</button>
      </header>

      <main className="main-content">
        <Outlet />
      </main>

      <AppFooter />

      <nav className="bottom-nav">
        <NavLink to="/" end>今日</NavLink>
        <NavLink to="/study">学习</NavLink>
        <NavLink to="/library">内容库</NavLink>
        <NavLink to="/settings">设置</NavLink>
      </nav>
    </div>
  );
}

function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await login(account, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-card">
        <div className="hero-badge">散修 · 单词 · 句子 · 间隔重复</div>
        <h1>散修英语，稳稳积累</h1>
        <p>录入你自己的单词和句子，每天按计划学习，到期自动复习，遇到不会读的内容可以一键朗读。</p>

        <form className="stack" onSubmit={handleSubmit}>
          <label>
            账号
            <input value={account} onChange={(event) => setAccount(event.target.value)} placeholder="请输入账号" required />
          </label>
          <label>
            密码
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 6 位" required minLength={6} />
          </label>
          {error && <div className="error-box">{error}</div>}
          <button className="primary-button" disabled={submitting}>{submitting ? '登录中...' : '登录'}</button>
        </form>
      </section>
      <AppFooter />
    </div>
  );
}

function HomePage() {
  const { user } = useAuth();
  const [task, setTask] = useState<DailyTask | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadTask = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.todayTask();
      setTask(data.task);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTask();
  }, []);

  const progress = task && task.totalCount > 0 ? Math.round((task.rememberedCount / task.totalCount) * 100) : 0;

  return (
    <section className="page stack-lg">
      <div className="welcome-card">
        <div>
          <p className="muted">今天也继续积累吧</p>
          <h1>{user?.name}，今日任务</h1>
          <p>{task?.isCompleted ? '今天的任务已完成，记得明天继续。' : `今天还有 ${task?.pendingCount ?? 0} 个内容需要记住。`}</p>
        </div>
        <Link className="primary-link" to="/study">开始学习</Link>
      </div>

      {loading && <div className="panel">正在生成今日任务...</div>}
      {error && <div className="error-box">{error}</div>}
      {task && (
        <>
          <div className="stats-grid">
            <StatCard title="目标" value={task.targetCount} suffix="个" />
            <StatCard title="已记住" value={task.rememberedCount} suffix={`/${task.totalCount}`} to="/study?scope=remembered" hint="再次学习" />
            <StatCard title="新学" value={task.newCount} suffix="个" to="/study?scope=new" hint="进入新学" />
            <StatCard title="复习" value={task.reviewCount} suffix="个" to="/study?scope=review" hint="进入复习" />
          </div>

          <div className="panel">
            <div className="progress-head">
              <strong>完成进度</strong>
              <span>{progress}%</span>
            </div>
            <div className="progress-bar"><span style={{ width: `${progress}%` }} /></div>
            {task.totalCount === 0 && (
              <p className="empty-text">内容库还没有可学习内容，先去录入一些单词或句子吧。</p>
            )}
            {task.isCompleted && <p className="success-text">🎉 今日全部记住，任务完成！</p>}
          </div>
        </>
      )}
    </section>
  );
}

function StatCard({ title, value, suffix, to, hint }: { title: string; value: number; suffix?: string; to?: string; hint?: string }) {
  const content = (
    <>
      <span>{title}</span>
      <strong>{value}<small>{suffix}</small></strong>
      {hint && <em>{hint}</em>}
    </>
  );

  return to ? (
    <Link className="stat-card clickable-stat-card" to={to}>{content}</Link>
  ) : (
    <div className="stat-card">{content}</div>
  );
}

type StudyScope = 'pending' | 'remembered' | 'new' | 'review';

const studyScopeLabels: Record<StudyScope, { title: string; description: string; empty: string }> = {
  pending: {
    title: '学习卡片',
    description: '必须全部点“记住了”才算完成',
    empty: '今天所有任务都已记住。明天会根据间隔重复继续安排复习。'
  },
  remembered: {
    title: '已记住 · 再次学习',
    description: '复看今天已经记住的内容，巩固一遍也可以继续提交记忆结果。',
    empty: '今天还没有已记住的内容，先完成一些学习任务吧。'
  },
  new: {
    title: '新学内容',
    description: '查看今天安排的新内容，已学过的也可以再过一遍。',
    empty: '今天没有新学内容。'
  },
  review: {
    title: '复习内容',
    description: '查看今天安排的到期复习内容，支持再次学习。',
    empty: '今天没有到期复习内容。'
  }
};

function parseStudyScope(value: string | null): StudyScope {
  return value === 'remembered' || value === 'new' || value === 'review' ? value : 'pending';
}

function StudyPage() {
  const [searchParams] = useSearchParams();
  const scope = parseStudyScope(searchParams.get('scope'));
  const scopeInfo = studyScopeLabels[scope];
  const [task, setTask] = useState<DailyTask | null>(null);
  const [showMeaning, setShowMeaning] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [completedInSessionIds, setCompletedInSessionIds] = useState<number[]>([]);
  const [similarOpen, setSimilarOpen] = useState(false);
  const [similarItems, setSimilarItems] = useState<SemanticRelatedItem[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarError, setSimilarError] = useState('');
  const [addingSimilarId, setAddingSimilarId] = useState<number | null>(null);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [conversationDemo, setConversationDemo] = useState<ConversationDemo | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState('');

  const loadTask = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.todayTask();
      setTask(data.task);
      setCompletedInSessionIds([]);
      setShowMeaning(false);
      setSimilarOpen(false);
      setSimilarItems([]);
      setSimilarError('');
      setConversationOpen(false);
      setConversationDemo(null);
      setConversationError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTask();
  }, [scope]);

  const scopedItems = task?.items.filter((item) => {
    if (scope === 'remembered') return item.state === 'remembered';
    if (scope === 'new') return item.item.status === 'new';
    if (scope === 'review') return item.item.status !== 'new';
    return item.state !== 'remembered';
  }) ?? [];
  const studyQueue = scope === 'pending'
    ? scopedItems
    : scopedItems.filter((item) => !completedInSessionIds.includes(item.id));
  const current = studyQueue[0];

  useEffect(() => {
    setSimilarOpen(false);
    setSimilarItems([]);
    setSimilarError('');
    setShowMeaning(false);
    setConversationOpen(false);
    setConversationDemo(null);
    setConversationError('');
  }, [current?.item.id]);

  const review = async (taskItem: TaskItem, result: 'remembered' | 'forgotten') => {
    setReviewing(true);
    setError('');
    try {
      const data = await api.reviewTaskItem(taskItem.id, result);
      setTask(data.task);
      setShowMeaning(false);
      if (scope !== 'pending') {
        setCompletedInSessionIds((ids) => ids.includes(taskItem.id) ? ids : [...ids, taskItem.id]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setReviewing(false);
    }
  };

  const loadSimilarItems = async () => {
    if (!current) return;

    setSimilarOpen(true);
    setSimilarLoading(true);
    setSimilarError('');
    try {
      const cached = await api.listSimilarItems(current.item.id);
      const cachedItems = Array.isArray(cached.items) ? cached.items : [];
      if (cachedItems.length > 0) {
        setSimilarItems(cachedItems);
        return;
      }

      const generated = await api.generateSimilarItems(current.item.id, 5);
      setSimilarItems(Array.isArray(generated.items) ? generated.items : []);
    } catch (err) {
      setSimilarError(err instanceof Error ? err.message : '相同语义生成失败');
    } finally {
      setSimilarLoading(false);
    }
  };

  const addSimilarToLibrary = async (related: SemanticRelatedItem) => {
    if (!current) return;

    setAddingSimilarId(related.id);
    setSimilarError('');
    try {
      const data = await api.addSimilarToLibrary(current.item.id, related.id);
      setSimilarItems((items) => items.map((item) => item.id === related.id ? data.related : item));
    } catch (err) {
      setSimilarError(err instanceof Error ? err.message : '加入学习库失败');
    } finally {
      setAddingSimilarId(null);
    }
  };

  const loadConversationDemo = async (regenerate = false) => {
    if (!current) return;

    setConversationOpen(true);
    setConversationLoading(true);
    setConversationError('');
    try {
      if (!regenerate) {
        const cached = await api.getConversationDemo(current.item.id);
        if (cached.demo) {
          setConversationDemo(cached.demo);
          return;
        }
      }

      const data = await api.generateConversationDemo(current.item.id, regenerate);
      setConversationDemo(data.demo);
    } catch (err) {
      setConversationError(err instanceof Error ? err.message : '场景对话生成失败');
    } finally {
      setConversationLoading(false);
    }
  };

  return (
    <section className="page stack-lg">
      <div className="page-title-row">
        <div>
          <p className="muted">{scopeInfo.description}</p>
          <h1>{scopeInfo.title}</h1>
        </div>
        <button className="ghost-button" onClick={loadTask}>刷新</button>
      </div>

      {task && scope !== 'pending' && (
        <div className="scope-tabs">
          <Link to="/study?scope=remembered" className={scope === 'remembered' ? 'active' : ''}>已记住</Link>
          <Link to="/study?scope=new" className={scope === 'new' ? 'active' : ''}>新学</Link>
          <Link to="/study?scope=review" className={scope === 'review' ? 'active' : ''}>复习</Link>
          <Link to="/study">未完成</Link>
        </div>
      )}

      {loading && <div className="panel">正在加载学习任务...</div>}
      {error && <div className="error-box">{error}</div>}
      {!loading && task && task.totalCount === 0 && (
        <div className="panel empty-panel">
          <h2>还没有学习内容</h2>
          <p>先去内容库录入单词或句子，再回来开始学习。</p>
          <Link className="primary-link" to="/library">去录入</Link>
        </div>
      )}
      {!loading && task && task.totalCount > 0 && !current && (
        <div className="panel empty-panel success-panel">
          <h2>{scope === 'pending' ? '🎉 今日任务完成' : '这一组已经学完'}</h2>
          <p>{scopeInfo.empty}</p>
          <Link className="primary-link" to="/">查看进度</Link>
        </div>
      )}
      {current && (
        <article className="study-card">
          <div className="card-meta">
            <span>{current.item.type === 'word' ? '单词' : '句子'}</span>
            <span>阶段 {current.item.reviewStage}</span>
            <span>尝试 {current.attempts} 次</span>
          </div>
          <h2>{current.item.text}</h2>
          {showMeaning ? (
            <div className="meaning-box">
              <strong>释义/备注</strong>
              <p>{current.item.meaning || '暂无释义'}</p>
              {current.item.example && <p className="example-text">{current.item.example}</p>}
            </div>
          ) : (
            <button className="secondary-button" onClick={() => setShowMeaning(true)}>显示中文释义</button>
          )}

          <div className="action-row">
            <button className="secondary-button" onClick={() => speakEnglish(current.item.text)}>朗读</button>
            <button className="secondary-button" disabled={similarLoading} onClick={similarOpen ? () => setSimilarOpen(false) : loadSimilarItems}>
              {similarLoading ? '生成中...' : similarOpen ? '收起相同语义' : '相同语义'}
            </button>
            <button className="secondary-button" disabled={conversationLoading} onClick={conversationOpen ? () => setConversationOpen(false) : () => loadConversationDemo(false)}>
              {conversationLoading ? '生成对话中...' : conversationOpen ? '收起对话' : conversationDemo ? '查看对话' : '生成对话'}
            </button>
            <button className="danger-button" disabled={reviewing} onClick={() => review(current, 'forgotten')}>还没记住</button>
            <button className="primary-button" disabled={reviewing} onClick={() => review(current, 'remembered')}>记住了</button>
          </div>

          {similarOpen && (
            <div className="similar-panel">
              <div className="similar-head">
                <strong>相同语义 / 相似表达</strong>
                <small>DeepSeek 按需生成，结果会缓存</small>
              </div>
              {similarLoading && <p className="muted">正在生成相似表达...</p>}
              {similarError && <div className="error-box">{similarError}</div>}
              {!similarLoading && similarItems.length === 0 && !similarError && <p className="empty-text">暂无相似表达。</p>}
              <div className="similar-list">
                {similarItems.map((item) => (
                  <article className="similar-item" key={item.id}>
                    <div>
                      <h3>{item.text}</h3>
                      <p>{item.meaning}</p>
                      {item.context && <p><strong>语境：</strong>{item.context}</p>}
                      {item.difference && <p><strong>区别：</strong>{item.difference}</p>}
                      <div className="similar-tags">
                        {item.formality && <span>{item.formality}</span>}
                        {(Array.isArray(item.tags) ? item.tags : []).map((tag) => <span key={tag}>{tag}</span>)}
                      </div>
                    </div>
                    <div className="similar-actions">
                      <button className="ghost-button" onClick={() => speakEnglish(item.text)}>朗读</button>
                      <button className="ghost-button" disabled={Boolean(item.addedToLibraryItemId) || addingSimilarId === item.id} onClick={() => addSimilarToLibrary(item)}>
                        {item.addedToLibraryItemId ? '已加入' : addingSimilarId === item.id ? '加入中...' : '加入学习库'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}

          {conversationOpen && (
            <div className="conversation-panel">
              <div className="similar-head">
                <strong>场景对话 Demo</strong>
                <small>首次 AI 生成，之后自动读取已保存内容</small>
              </div>
              {conversationLoading && <p className="muted">正在生成适合练习的场景对话...</p>}
              {conversationError && <div className="error-box">{conversationError}</div>}
              {!conversationLoading && conversationDemo && (
                <ConversationDemoCard demo={conversationDemo} onRegenerate={() => loadConversationDemo(true)} regenerating={conversationLoading} />
              )}
              {!conversationLoading && !conversationDemo && !conversationError && <p className="empty-text">暂无对话 Demo。</p>}
            </div>
          )}
        </article>
      )}
    </section>
  );
}

function ConversationDemoCard({ demo, onRegenerate, regenerating }: { demo: ConversationDemo; onRegenerate: () => void; regenerating: boolean }) {
  const lines = demo.dialogue.split('\n').map((line) => {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      return { speaker: '', text: line.trim() };
    }
    return {
      speaker: line.slice(0, separatorIndex).trim(),
      text: line.slice(separatorIndex + 1).trim()
    };
  }).filter((line) => line.text);

  return (
    <div className="conversation-demo">
      <div className="conversation-title-row">
        <div>
          <h3>{demo.title}</h3>
          <p><strong>场景：</strong>{demo.scenario}</p>
        </div>
        <div className="similar-actions">
          <button className="ghost-button" onClick={() => speakEnglish(lines.map((line) => line.text).join(' '))}>朗读整段</button>
          <button className="ghost-button" disabled={regenerating} onClick={onRegenerate}>{regenerating ? '生成中...' : '重新生成'}</button>
        </div>
      </div>
      <div className="dialogue-list">
        {lines.map((line, index) => (
          <div className="dialogue-line" key={`${line.speaker}-${index}`}>
            {line.speaker && <span>{line.speaker}</span>}
            <p>{line.text}</p>
            <button className="ghost-button small-button" onClick={() => speakEnglish(line.text)}>朗读</button>
          </div>
        ))}
      </div>
      {demo.keyPoints.length > 0 && (
        <div className="key-points">
          <strong>记忆提示</strong>
          <ul>
            {demo.keyPoints.map((point) => <li key={point}>{point}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function LibraryPage() {
  const [items, setItems] = useState<StudyItem[]>([]);
  const [type, setType] = useState<ItemType | 'all'>('all');
  const [keyword, setKeyword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ItemInput>({ type: 'word', text: '', meaning: '', example: '' });

  const loadItems = async () => {
    setError('');
    try {
      const data = await api.listItems({ type, keyword });
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  };

  useEffect(() => {
    loadItems();
  }, [type]);

  const resetForm = () => {
    setEditingId(null);
    setForm({ type: 'word', text: '', meaning: '', example: '' });
    setNotice('');
  };

  const generateMeaning = async () => {
    setError('');
    setNotice('');

    if (!form.text.trim()) {
      setError('请先填写英文内容，再自动生成中文释义。');
      return null;
    }

    setGenerating(true);
    try {
      const data = await api.generateMeaning({
        type: form.type,
        text: form.text,
        example: form.example
      });
      setForm((current) => ({ ...current, meaning: data.meaning }));
      setNotice('已使用 DeepSeek 自动生成中文释义。');
      return data.meaning;
    } catch (err) {
      const message = err instanceof Error ? err.message : '自动生成失败';
      setError(message);
      return null;
    } finally {
      setGenerating(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setSaving(true);
    try {
      let input = form;
      if (!input.meaning?.trim()) {
        const generatedMeaning = await generateMeaning();
        if (generatedMeaning) {
          input = { ...input, meaning: generatedMeaning };
        }
      }

      if (editingId) {
        await api.updateItem(editingId, input);
      } else {
        await api.createItem(input);
      }
      resetForm();
      await loadItems();
      setNotice(input.meaning?.trim() ? '内容已保存。' : '内容已保存；中文释义未生成，可稍后手动补充。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const edit = (item: StudyItem) => {
    setEditingId(item.id);
    setForm({ type: item.type, text: item.text, meaning: item.meaning, example: item.example });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async (item: StudyItem) => {
    if (!confirm(`确认删除「${item.text}」吗？`)) {
      return;
    }
    setError('');
    try {
      await api.deleteItem(item.id);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <section className="page stack-lg">
      <div className="page-title-row">
        <div>
          <p className="muted">录入自己的学习材料</p>
          <h1>内容库</h1>
        </div>
      </div>

      <form className="panel form-grid" onSubmit={submit}>
        <h2>{editingId ? '编辑内容' : '新增内容'}</h2>
        <label>
          类型
          <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as ItemType })}>
            <option value="word">单词</option>
            <option value="sentence">句子</option>
          </select>
        </label>
        <label className="wide-field">
          英文内容
          <textarea value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} rows={3} required placeholder="apple / I want to improve my English every day." />
        </label>
        <label className="wide-field">
          <span className="label-with-action">
            中文释义/备注
            <button type="button" className="ghost-button small-button" disabled={generating || saving || !form.text.trim()} onClick={generateMeaning}>
              {generating ? '生成中...' : 'DeepSeek 自动生成'}
            </button>
          </span>
          <textarea value={form.meaning} onChange={(event) => setForm({ ...form, meaning: event.target.value })} rows={3} placeholder="苹果 / 我想每天提升英语。" />
        </label>
        <label className="wide-field">
          例句/补充说明
          <textarea value={form.example} onChange={(event) => setForm({ ...form, example: event.target.value })} rows={2} />
        </label>
        <div className="action-row wide-field">
          <button className="primary-button" disabled={saving || generating}>{saving ? '保存中...' : editingId ? '保存修改' : '添加到内容库'}</button>
          {editingId && <button type="button" className="secondary-button" onClick={resetForm}>取消编辑</button>}
        </div>
        {notice && <div className="success-box wide-field">{notice}</div>}
        {error && <div className="error-box wide-field">{error}</div>}
      </form>

      <div className="panel stack">
        <div className="filter-row">
          <select value={type} onChange={(event) => setType(event.target.value as ItemType | 'all')}>
            <option value="all">全部</option>
            <option value="word">单词</option>
            <option value="sentence">句子</option>
          </select>
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索英文/中文" onKeyDown={(event) => {
            if (event.key === 'Enter') loadItems();
          }} />
          <button className="secondary-button" onClick={loadItems}>搜索</button>
        </div>
        {items.length === 0 ? (
          <p className="empty-text">暂无内容，先添加一个单词或句子吧。</p>
        ) : (
          <div className="item-list">
            {items.map((item) => (
              <article className="item-row" key={item.id}>
                <div>
                  <div className="item-title"><span>{item.type === 'word' ? '单词' : '句子'}</span>{item.text}</div>
                  <p>{item.meaning || '暂无释义'}</p>
                  <small>{item.status} · stage {item.reviewStage} · 下次 {item.nextReviewAt}</small>
                </div>
                <div className="item-actions">
                  <button className="ghost-button" onClick={() => speakEnglish(item.text)}>朗读</button>
                  <button className="ghost-button" onClick={() => edit(item)}>编辑</button>
                  <button className="ghost-button danger-text" onClick={() => remove(item)}>删除</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const [dailyGoal, setDailyGoal] = useState(user?.dailyGoal ?? 30);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setDailyGoal(user?.dailyGoal ?? 30);
  }, [user?.dailyGoal]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      await api.updateSettings({ dailyGoal });
      await refreshUser();
      setMessage('设置已保存。明天新生成的任务会按新的数量执行；今天已生成的任务保持不变。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
  };

  return (
    <section className="page stack-lg">
      <div className="page-title-row">
        <div>
          <p className="muted">调整你的学习节奏</p>
          <h1>设置</h1>
        </div>
      </div>

      <form className="panel stack" onSubmit={submit}>
        <label>
          每日任务数量
          <input type="number" min={1} max={200} value={dailyGoal} onChange={(event) => setDailyGoal(Number(event.target.value))} />
        </label>
        <p className="muted">建议从每天 20-30 个开始，保证每天能全部记住。</p>
        {message && <div className="success-box">{message}</div>}
        {error && <div className="error-box">{error}</div>}
        <button className="primary-button">保存设置</button>
      </form>
    </section>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedLayout />}>
            <Route index element={<HomePage />} />
            <Route path="study" element={<StudyPage />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

