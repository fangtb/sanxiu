import './env.js';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express, { type NextFunction, type RequestHandler, type Response } from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z, ZodError } from 'zod';
import { authRequired, signToken } from './auth.js';
import { db, initDb } from './db.js';
import { calculateNextReview } from './srs.js';
import { todayKey, toSqlDateTime } from './time.js';
import type { AuthedRequest, ConversationDemoRow, DailyTaskRow, ReviewResult, SemanticRelatedItemRow, StudyItemRow } from './types.js';

const port = Number(process.env.PORT ?? 3001);

function requiredEnv(name: string, options: { trim?: boolean } = {}) {
  const rawValue = process.env[name];
  const value = options.trim === false ? rawValue : rawValue?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const defaultDailyGoal = Number(process.env.DEFAULT_DAILY_GOAL ?? 30);
const defaultAccounts = [
  {
    email: requiredEnv('DEFAULT_USER1_EMAIL'),
    username: requiredEnv('DEFAULT_USER1_NAME'),
    password: requiredEnv('DEFAULT_USER1_PASSWORD', { trim: false }),
    dailyGoal: Number(process.env.DEFAULT_USER1_DAILY_GOAL ?? defaultDailyGoal)
  },
  {
    email: requiredEnv('DEFAULT_USER2_EMAIL'),
    username: requiredEnv('DEFAULT_USER2_NAME'),
    password: requiredEnv('DEFAULT_USER2_PASSWORD', { trim: false }),
    dailyGoal: Number(process.env.DEFAULT_USER2_DAILY_GOAL ?? defaultDailyGoal)
  }
];

initDb();

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const aiConfig = {
  apiKey: process.env.AI_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY,
  baseUrl: process.env.AI_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  model: process.env.AI_MODEL ?? process.env.DEEPSEEK_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
};
const publicConfig = {
  icpRecord: (process.env.ICP_RECORD ?? '').trim(),
  icpRecordUrl: (process.env.ICP_RECORD_URL ?? 'https://beian.miit.gov.cn/').trim() || 'https://beian.miit.gov.cn/'
};
const itemTypeSchema = z.enum(['word', 'sentence']);
const reviewResultSchema = z.enum(['remembered', 'forgotten']);

const loginSchema = z.object({
  account: z.string().trim().min(1).optional(),
  email: z.string().trim().min(1).optional(),
  password: z.string().min(1)
}).refine((value) => value.account || value.email, {
  message: '请输入账号',
  path: ['account']
});

const itemCreateSchema = z.object({
  type: itemTypeSchema,
  text: z.string().trim().min(1).max(1000),
  meaning: z.string().trim().max(2000).optional().nullable(),
  example: z.string().trim().max(2000).optional().nullable()
});

const itemUpdateSchema = itemCreateSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: '至少需要提供一个修改字段'
});

const settingsSchema = z.object({
  dailyGoal: z.number().int().min(1).max(200)
});

const reviewSchema = z.object({
  result: reviewResultSchema
});

const generateMeaningSchema = z.object({
  type: itemTypeSchema,
  text: z.string().trim().min(1).max(1000),
  example: z.string().trim().max(2000).optional().nullable()
});

const generateConversationDemoSchema = z.object({
  regenerate: z.boolean().optional()
});

const generateSimilarItemsSchema = z.object({
  count: z.number().int().min(1).max(10).optional().default(5),
  regenerate: z.boolean().optional()
});

const aiSimilarItemsSchema = z.object({
  items: z.array(z.object({
    text: z.string().trim().min(1).max(500),
    meaning: z.string().trim().max(500).optional().default(''),
    context: z.string().trim().max(500).optional().default(''),
    difference: z.string().trim().max(500).optional().default(''),
    formality: z.string().trim().max(80).optional().default(''),
    tags: z.array(z.string().trim().min(1).max(40)).max(6).optional().default([])
  })).min(1).max(10)
});

const aiConversationDemoSchema = z.object({
  title: z.string().trim().min(1).max(120),
  scenario: z.string().trim().min(1).max(500),
  dialogue: z.array(z.object({
    speaker: z.string().trim().min(1).max(40),
    text: z.string().trim().min(1).max(500)
  })).min(2).max(8),
  keyPoints: z.array(z.string().trim().min(1).max(200)).min(1).max(6)
});

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  daily_goal: number;
  created_at: string;
  updated_at: string;
}

interface TaskItemWithStudyRow {
  task_item_id: number;
  task_id: number;
  item_id: number;
  state: string;
  attempts: number;
  task_item_completed_at: string | null;
  type: string;
  text: string;
  meaning: string | null;
  example: string | null;
  status: string;
  review_stage: number;
  next_review_at: string;
  created_at: string;
  updated_at: string;
}

const asyncHandler = (
  handler: (req: AuthedRequest, res: Response) => Promise<void> | void
): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(handler(req as AuthedRequest, res)).catch(next);
  };
};

function currentUserId(req: AuthedRequest) {
  if (!req.user) {
    throw Object.assign(new Error('未登录或登录已过期'), { status: 401 });
  }
  return req.user.id;
}

function publicUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    dailyGoal: row.daily_goal,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicItem(row: StudyItemRow) {
  return {
    id: row.id,
    type: row.type,
    text: row.text,
    meaning: row.meaning ?? '',
    example: row.example ?? '',
    status: row.status,
    reviewStage: row.review_stage,
    nextReviewAt: row.next_review_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicConversationDemo(row: ConversationDemoRow) {
  let keyPoints: string[] = [];
  try {
    const parsed = JSON.parse(row.key_points ?? '[]');
    keyPoints = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    keyPoints = row.key_points ? [row.key_points] : [];
  }

  return {
    id: row.id,
    sourceItemId: row.source_item_id,
    title: row.title,
    scenario: row.scenario ?? '',
    dialogue: row.dialogue,
    keyPoints,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseStringArray(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
}

function publicSemanticRelatedItem(row: SemanticRelatedItemRow) {
  return {
    id: row.id,
    sourceItemId: row.source_item_id,
    text: row.text,
    meaning: row.meaning ?? '',
    context: row.context ?? '',
    difference: row.difference ?? '',
    formality: row.formality ?? '',
    tags: parseStringArray(row.tags),
    addedToLibraryItemId: row.added_to_library_item_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeAiBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}

async function generateChineseMeaning(input: z.infer<typeof generateMeaningSchema>) {
  if (!aiConfig.apiKey) {
    throw Object.assign(new Error('自动生成需要先配置 DEEPSEEK_API_KEY 或 AI_API_KEY'), { status: 503 });
  }

  const prompt = [
    '你是英语学习助手。请为用户录入的英语学习内容生成简洁准确的中文释义/备注。',
    '要求：',
    '1. 只输出中文释义/备注，不要输出 Markdown。',
    '2. 如果是单词，给出常见中文释义，可附 1 个简短用法提示。',
    '3. 如果是句子，给出自然中文翻译，可附必要的语法/表达提示。',
    '4. 输出控制在 120 个中文字符以内。',
    `类型：${input.type === 'word' ? '单词' : '句子'}`,
    `英文：${input.text}`,
    input.example ? `补充例句/说明：${input.example}` : ''
  ].filter(Boolean).join('\n');

  const response = await fetch(`${normalizeAiBaseUrl(aiConfig.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiConfig.apiKey}`
    },
    body: JSON.stringify({
      model: aiConfig.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: '你是一个专业、简洁的英语到中文学习释义助手。' },
        { role: 'user', content: prompt }
      ]
    })
  });

  const data = await response.json().catch(() => null) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw Object.assign(new Error(data?.error?.message ?? '自动生成失败，请检查 AI 配置'), { status: response.status });
  }

  const meaning = data?.choices?.[0]?.message?.content?.trim();
  if (!meaning) {
    throw Object.assign(new Error('自动生成结果为空'), { status: 502 });
  }

  return meaning.replace(/^```[\s\S]*?\n?/, '').replace(/```$/, '').trim();
}

function parseJsonContent(content: string) {
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(objectMatch ? objectMatch[0] : cleaned) as unknown;
}

async function generateConversationDemo(item: StudyItemRow) {
  if (!aiConfig.apiKey) {
    throw Object.assign(new Error('生成场景对话需要先配置 DEEPSEEK_API_KEY 或 AI_API_KEY'), { status: 503 });
  }

  const prompt = [
    '你是英语学习场景对话设计师。请围绕用户正在记忆的英语内容，生成一个适合初学者练习的短对话 Demo。',
    '要求：',
    '1. 只输出合法 JSON，不要 Markdown，不要解释。',
    '2. title 和 scenario 用中文，scenario 要说明真实使用场景。',
    '3. dialogue 是 4-6 轮英文短对话，每句自然、简单，必须包含用户原句或非常接近的自然表达。',
    '4. keyPoints 用中文列出 2-4 个记忆提示、替换表达或场景用法。',
    '5. JSON 格式固定为：{"title":"...","scenario":"...","dialogue":[{"speaker":"A","text":"..."}],"keyPoints":["..."]}',
    `类型：${item.type === 'word' ? '单词' : '句子'}`,
    `英文内容：${item.text}`,
    item.meaning ? `中文释义/备注：${item.meaning}` : '',
    item.example ? `补充例句/说明：${item.example}` : ''
  ].filter(Boolean).join('\n');

  const response = await fetch(`${normalizeAiBaseUrl(aiConfig.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiConfig.apiKey}`
    },
    body: JSON.stringify({
      model: aiConfig.model,
      temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你只输出符合要求的 JSON，用简单自然的英文对话帮助中文用户记忆英语。' },
        { role: 'user', content: prompt }
      ]
    })
  });

  const data = await response.json().catch(() => null) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw Object.assign(new Error(data?.error?.message ?? '场景对话生成失败，请检查 AI 配置'), { status: response.status });
  }

  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw Object.assign(new Error('场景对话生成结果为空'), { status: 502 });
  }

  let parsed: z.infer<typeof aiConversationDemoSchema>;
  try {
    parsed = aiConversationDemoSchema.parse(parseJsonContent(content));
  } catch {
    throw Object.assign(new Error('场景对话生成格式不正确，请重试'), { status: 502 });
  }
  return {
    title: parsed.title,
    scenario: parsed.scenario,
    dialogue: parsed.dialogue.map((line) => `${line.speaker}: ${line.text}`).join('\n'),
    keyPoints: parsed.keyPoints
  };
}

async function generateSemanticRelatedItems(item: StudyItemRow, count: number) {
  if (!aiConfig.apiKey) {
    throw Object.assign(new Error('生成相同语义需要先配置 DEEPSEEK_API_KEY 或 AI_API_KEY'), { status: 503 });
  }

  const prompt = [
    '你是英语学习助手。请围绕用户正在学习的内容，生成相同语义或相似表达，帮助用户理解不同说法。',
    '要求：',
    '1. 只输出合法 JSON，不要 Markdown，不要解释。',
    `2. 生成 ${count} 条，表达要自然、常用，难度适合英语学习者。`,
    '3. text 用英文；meaning/context/difference/tags 用中文；formality 可用“口语”“正式”“中性”等中文短标签。',
    '4. tags 必须是字符串数组；如果没有标签也返回空数组。',
    '5. JSON 格式固定为：{"items":[{"text":"...","meaning":"...","context":"...","difference":"...","formality":"...","tags":["..."]}]}',
    `类型：${item.type === 'word' ? '单词' : '句子'}`,
    `英文内容：${item.text}`,
    item.meaning ? `中文释义/备注：${item.meaning}` : '',
    item.example ? `补充例句/说明：${item.example}` : ''
  ].filter(Boolean).join('\n');

  const response = await fetch(`${normalizeAiBaseUrl(aiConfig.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiConfig.apiKey}`
    },
    body: JSON.stringify({
      model: aiConfig.model,
      temperature: 0.45,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你只输出符合要求的 JSON，用自然英语和简洁中文说明帮助中文用户学习英语。' },
        { role: 'user', content: prompt }
      ]
    })
  });

  const data = await response.json().catch(() => null) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw Object.assign(new Error(data?.error?.message ?? '相同语义生成失败，请检查 AI 配置'), { status: response.status });
  }

  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw Object.assign(new Error('相同语义生成结果为空'), { status: 502 });
  }

  try {
    return aiSimilarItemsSchema.parse(parseJsonContent(content)).items.slice(0, count);
  } catch {
    throw Object.assign(new Error('相同语义生成格式不正确，请重试'), { status: 502 });
  }
}

function getUserById(id: number) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

function seedDefaultUsers() {
  const findExisting = db.prepare('SELECT * FROM users WHERE lower(email) = ? OR lower(name) = ? ORDER BY id ASC LIMIT 1');
  const insertUser = db.prepare(`
    INSERT INTO users (email, password_hash, name, daily_goal)
    VALUES (?, ?, ?, ?)
  `);

  const primaryAccount = defaultAccounts[0];
  const primaryEmail = primaryAccount.email.trim().toLowerCase();
  const primaryUsername = primaryAccount.username.trim();
  const legacyAdmin = findExisting.get('admin@example.com', 'admin') as UserRow | undefined;
  const primaryExisting = findExisting.get(primaryEmail, primaryUsername.toLowerCase()) as UserRow | undefined;

  if (legacyAdmin && !primaryExisting) {
    db.prepare(`
      UPDATE users
      SET email = ?, password_hash = ?, name = ?, daily_goal = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(primaryEmail, bcrypt.hashSync(primaryAccount.password, 10), primaryUsername, primaryAccount.dailyGoal, legacyAdmin.id);
  } else if (legacyAdmin && primaryExisting && legacyAdmin.id !== primaryExisting.id) {
    db.prepare(`
      UPDATE users
      SET email = ?, password_hash = ?, name = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      `legacy-admin-${legacyAdmin.id}@disabled.local`,
      bcrypt.hashSync(crypto.randomUUID(), 10),
      `legacy-admin-${legacyAdmin.id}`,
      legacyAdmin.id
    );
  }

  for (const account of defaultAccounts) {
    const email = account.email.trim().toLowerCase();
    const username = account.username.trim();
    const existing = findExisting.get(email, username.toLowerCase()) as UserRow | undefined;
    if (existing) {
      continue;
    }

    const passwordHash = bcrypt.hashSync(account.password, 10);
    insertUser.run(email, passwordHash, username, account.dailyGoal);
  }
}

seedDefaultUsers();

function getTaskItems(taskId: number) {
  const rows = db.prepare(`
    SELECT
      dti.id AS task_item_id,
      dti.task_id,
      dti.item_id,
      dti.state,
      dti.attempts,
      dti.completed_at AS task_item_completed_at,
      si.type,
      si.text,
      si.meaning,
      si.example,
      si.status,
      si.review_stage,
      si.next_review_at,
      si.created_at,
      si.updated_at
    FROM daily_task_items dti
    JOIN study_items si ON si.id = dti.item_id
    WHERE dti.task_id = ?
    ORDER BY
      CASE dti.state WHEN 'pending' THEN 0 WHEN 'forgotten' THEN 1 ELSE 2 END,
      dti.id ASC
  `).all(taskId) as TaskItemWithStudyRow[];

  return rows.map((row) => ({
    id: row.task_item_id,
    taskId: row.task_id,
    itemId: row.item_id,
    state: row.state,
    attempts: row.attempts,
    completedAt: row.task_item_completed_at,
    item: {
      id: row.item_id,
      type: row.type,
      text: row.text,
      meaning: row.meaning ?? '',
      example: row.example ?? '',
      status: row.status,
      reviewStage: row.review_stage,
      nextReviewAt: row.next_review_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }));
}

function getTaskSummary(task: DailyTaskRow) {
  const items = getTaskItems(task.id);
  const rememberedCount = items.filter((item) => item.state === 'remembered').length;
  const pendingCount = items.length - rememberedCount;
  const newCount = items.filter((item) => item.item.status === 'new').length;
  const reviewCount = items.length - newCount;

  return {
    id: task.id,
    taskDate: task.task_date,
    targetCount: task.target_count,
    completedAt: task.completed_at,
    totalCount: items.length,
    rememberedCount,
    pendingCount,
    newCount,
    reviewCount,
    isCompleted: Boolean(task.completed_at),
    items
  };
}

function fillTaskItems(taskId: number, userId: number, targetCount: number, now: string) {
  const existingCount = (db.prepare(`
    SELECT COUNT(*) AS count
    FROM daily_task_items
    WHERE task_id = ?
  `).get(taskId) as { count: number }).count;

  let remaining = Math.max(0, targetCount - existingCount);
  if (remaining === 0) {
    return;
  }

  const dueItems = db.prepare(`
    SELECT * FROM study_items si
    WHERE si.user_id = ?
      AND si.status != 'new'
      AND si.next_review_at <= ?
      AND NOT EXISTS (
        SELECT 1 FROM daily_task_items dti
        WHERE dti.task_id = ? AND dti.item_id = si.id
      )
    ORDER BY si.next_review_at ASC, si.review_stage DESC, si.id ASC
    LIMIT ?
  `).all(userId, now, taskId, remaining) as StudyItemRow[];

  remaining -= dueItems.length;

  const newItems = remaining > 0
    ? db.prepare(`
        SELECT * FROM study_items si
        WHERE si.user_id = ?
          AND si.status = 'new'
          AND NOT EXISTS (
            SELECT 1 FROM daily_task_items dti
            WHERE dti.task_id = ? AND dti.item_id = si.id
          )
        ORDER BY si.created_at ASC, si.id ASC
        LIMIT ?
      `).all(userId, taskId, remaining) as StudyItemRow[]
    : [];

  const insertTaskItem = db.prepare(`
    INSERT OR IGNORE INTO daily_task_items (task_id, item_id)
    VALUES (?, ?)
  `);

  for (const item of [...dueItems, ...newItems]) {
    insertTaskItem.run(taskId, item.id);
  }
}

function createTodayTask(userId: number) {
  const user = getUserById(userId);
  if (!user) {
    throw Object.assign(new Error('用户不存在'), { status: 404 });
  }

  const date = todayKey();
  const now = toSqlDateTime(new Date());

  const existing = db.prepare('SELECT * FROM daily_tasks WHERE user_id = ? AND task_date = ?')
    .get(userId, date) as DailyTaskRow | undefined;
  if (existing) {
    if (!existing.completed_at) {
      const transaction = db.transaction(() => {
        fillTaskItems(existing.id, userId, existing.target_count, now);
        return db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(existing.id) as DailyTaskRow;
      });
      return transaction();
    }
    return existing;
  }

  const transaction = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO daily_tasks (user_id, task_date, target_count)
      VALUES (?, ?, ?)
    `).run(userId, date, user.daily_goal);

    const taskId = Number(result.lastInsertRowid);
    fillTaskItems(taskId, userId, user.daily_goal, now);

    return db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(taskId) as DailyTaskRow;
  });

  return transaction();
}

function updateTaskCompletion(taskId: number) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN state = 'remembered' THEN 1 ELSE 0 END) AS remembered
    FROM daily_task_items
    WHERE task_id = ?
  `).get(taskId) as { total: number; remembered: number | null };

  const isCompleted = stats.total > 0 && stats.remembered === stats.total;
  db.prepare(`
    UPDATE daily_tasks
    SET completed_at = CASE WHEN ? THEN COALESCE(completed_at, datetime('now')) ELSE NULL END,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(isCompleted ? 1 : 0, taskId);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/config', ((_req, res) => {
  res.json(publicConfig);
}) as RequestHandler);

app.post('/api/auth/register', (_req, res) => {
  res.status(403).json({ message: '注册暂未开放' });
});

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const account = (input.account ?? input.email ?? '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = ? OR lower(name) = ? ORDER BY id ASC LIMIT 1')
    .get(account, account) as UserRow | undefined;

  if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
    res.status(401).json({ message: '账号或密码错误' });
    return;
  }

  const token = signToken({ id: user.id, email: user.email });
  res.json({ token, user: publicUser(user) });
}));

app.get('/api/auth/me', authRequired as RequestHandler, asyncHandler((req, res) => {
  const user = getUserById(currentUserId(req));
  if (!user) {
    res.status(404).json({ message: '用户不存在' });
    return;
  }
  res.json({ user: publicUser(user) });
}));

app.get('/api/settings', authRequired as RequestHandler, asyncHandler((req, res) => {
  const user = getUserById(currentUserId(req));
  if (!user) {
    res.status(404).json({ message: '用户不存在' });
    return;
  }
  res.json({ dailyGoal: user.daily_goal });
}));

app.put('/api/settings', authRequired as RequestHandler, asyncHandler((req, res) => {
  const userId = currentUserId(req);
  const input = settingsSchema.parse(req.body);
  db.prepare(`
    UPDATE users
    SET daily_goal = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(input.dailyGoal, userId);
  res.json({ dailyGoal: input.dailyGoal });
}));

app.post('/api/ai/meaning', authRequired as RequestHandler, asyncHandler(async (req, res) => {
  currentUserId(req);
  const input = generateMeaningSchema.parse(req.body);
  const meaning = await generateChineseMeaning(input);
  res.json({ meaning });
}));

app.get('/api/items', authRequired as RequestHandler, asyncHandler((req, res) => {
  const userId = currentUserId(req);
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : '';

  const where: string[] = ['user_id = ?'];
  const params: Array<string | number> = [userId];

  if (type === 'word' || type === 'sentence') {
    where.push('type = ?');
    params.push(type);
  }

  if (keyword) {
    where.push('(text LIKE ? OR meaning LIKE ? OR example LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const rows = db.prepare(`
    SELECT * FROM study_items
    WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC, id DESC
  `).all(...params) as StudyItemRow[];

  res.json({ items: rows.map(publicItem) });
}));

app.post('/api/items', authRequired as RequestHandler, asyncHandler((req, res) => {
  const userId = currentUserId(req);
  const input = itemCreateSchema.parse(req.body);

  try {
    const result = db.prepare(`
      INSERT INTO study_items (user_id, type, text, meaning, example)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, input.type, input.text, input.meaning ?? null, input.example ?? null);

    const item = db.prepare('SELECT * FROM study_items WHERE id = ? AND user_id = ?')
      .get(Number(result.lastInsertRowid), userId) as StudyItemRow;
    res.status(201).json({ item: publicItem(item) });
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      res.status(409).json({ message: '该内容已存在' });
      return;
    }
    throw error;
  }
}));

app.get('/api/items/:id', authRequired as RequestHandler, asyncHandler((req, res) => {
  const userId = currentUserId(req);
  const itemId = Number(req.params.id);
  const item = db.prepare('SELECT * FROM study_items WHERE id = ? AND user_id = ?')
    .get(itemId, userId) as StudyItemRow | undefined;

  if (!item) {
    res.status(404).json({ message: '内容不存在' });
    return;
  }

  res.json({ item: publicItem(item) });
}));

app.get('/api/items/:id/similar', authRequired as RequestHandler, asyncHandler((req, res) => {
  const userId = currentUserId(req);
  const itemId = Number(req.params.id);
  const item = db.prepare('SELECT * FROM study_items WHERE id = ? AND user_id = ?')
    .get(itemId, userId) as StudyItemRow | undefined;

  if (!item) {
    res.status(404).json({ message: '内容不存在' });
    return;
  }

  const rows = db.prepare(`
    SELECT * FROM semantic_related_items
    WHERE source_item_id = ? AND user_id = ?
    ORDER BY id ASC
  `).all(itemId, userId) as SemanticRelatedItemRow[];

  res.json({ items: rows.map(publicSemanticRelatedItem) });
}));

app.post('/api/items/:id/similar/generate', authRequired as RequestHandler, asyncHandler(async (req, res) => {
  const userId = currentUserId(req);
  const itemId = Number(req.params.id);
  const input = generateSimilarItemsSchema.parse(req.body ?? {});
  const item = db.prepare('SELECT * FROM study_items WHERE id = ? AND user_id = ?')
    .get(itemId, userId) as StudyItemRow | undefined;

  if (!item) {
    res.status(404).json({ message: '内容不存在' });
    return;
  }

  const existingRows = db.prepare(`
    SELECT * FROM semantic_related_items
    WHERE source_item_id = ? AND user_id = ?
    ORDER BY id ASC
  `).all(itemId, userId) as SemanticRelatedItemRow[];
  if (existingRows.length > 0 && !input.regenerate) {
    res.json({ items: existingRows.map(publicSemanticRelatedItem), cached: true });
    return;
  }

  const generated = await generateSemanticRelatedItems(item, input.count);

  const transaction = db.transaction(() => {
    if (input.regenerate) {
      db.prepare('DELETE FROM semantic_related_items WHERE source_item_id = ? AND user_id = ? AND added_to_library_item_id IS NULL')
        .run(itemId, userId);
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO semantic_related_items
        (user_id, source_item_id, text, meaning, context, difference, formality, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const related of generated) {
      insert.run(
        userId,
        itemId,
        related.text,
        related.meaning || null,
        related.context || null,
        related.difference || null,
        related.formality || null,
        JSON.stringify(related.tags ?? [])
      );
    }
  });

  transaction();

  const rows = db.prepare(`
    SELECT * FROM semantic_related_items
    WHERE source_item_id = ? AND user_id = ?
    ORDER BY id ASC
  `).all(itemId, userId) as SemanticRelatedItemRow[];

  res.status(201).json({ items: rows.map(publicSemanticRelatedItem), cached: false });
}));

app.post('/api/items/:id/similar/:relatedId/add-to-library', authRequired as RequestHandler, asyncHandler((req, res) => {
  const userId = currentUserId(req);
  const itemId = Number(req.params.id);
  const relatedId = Number(req.params.relatedId);
  const item = db.prepare('SELECT * FROM study_items WHERE id = ? AND user_id = ?')
    .get(itemId, userId) as StudyItemRow | undefined;

  if (!item) {
    res.status(404).json({ message: '内容不存在' });
    return;
  }

  const related = db.prepare('SELECT * FROM semantic_related_items WHERE id = ? AND source_item_id = ? AND user_id = ?')
    .get(relatedId, itemId, userId) as SemanticRelatedItemRow | undefined;

  if (!related) {
    res.status(404).json({ message: '相似表达不存在' });
    return;
  }

  const transaction = db.transaction(() => {
    if (related.added_to_library_item_id) {
      const existingItem = db.prepare('SELECT * FROM study_items WHERE id = ? AND user_id = ?')
        .get(related.added_to_library_item_id, userId) as StudyItemRow | undefined;
      if (existingItem) {
        return existingItem.id;
      }
    }

    const duplicated = db.prepare('SELECT * FROM study_items WHERE user_id = ? AND type = ? AND text = ?')
      .get(userId, item.type, related.text) as StudyItemRow | undefined;
    const libraryItemId = duplicated?.id ?? Number(db.prepare(`
      INSERT INTO study_items (user_id, type, text, meaning, example)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      userId,
      item.type,
      related.text,
      related.meaning ?? null,
      [related.context, related.difference].filter(Boolean).join('\n') || null
    ).lastInsertRowid);

    db.prepare(`
      UPDATE semantic_related_items
      SET added_to_library_item_id = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(libraryItemId, relatedId, userId);

    return libraryItemId;
  });

  const libraryItemId = transaction();
  const libraryItem = db.prepare('SELECT * FROM study_items WHERE id = ? AND user_id = ?')
    .get(libraryItemId, userId) as StudyItemRow;
  const updatedRelated = db.prepare('SELECT * FROM semantic_related_items WHERE id = ? AND user_id = ?')
    .get(relatedId, userId) as SemanticRelatedItemRow;

  res.json({ item: publicItem(libraryItem), related: publicSemanticRelatedItem(updatedRelated) });
}));

app.get('/api/items/:id/conversation-demo', authRequired as RequestHandler, asyncHandler((req, res) => {
  const userId = currentUserId(req);
  const itemId = Number(req.params.id);
  const item = db.prepare('SELECT * FROM study_items WHERE id = ? AND user_id = ?')
    .get(itemId, userId) as StudyItemRow | undefined;

  if (!item) {
    res.status(404).json({ message: '内容不存在' });
    return;
  }

  const demo = db.prepare('SELECT * FROM conversation_demos WHERE source_item_id = ? AND user_id = ?')
    .get(itemId, userId) as ConversationDemoRow | undefined;

  res.json({ demo: demo ? publicConversationDemo(demo) : null });
}));

app.post('/api/items/:id/conversation-demo/generate', authRequired as RequestHandler, asyncHandler(async (req, res) => {
  const userId = currentUserId(req);
  const itemId = Number(req.params.id);
  const input = generateConversationDemoSchema.parse(req.body ?? {});
  const item = db.prepare('SELECT * FROM study_items WHERE id = ? AND user_id = ?')
    .get(itemId, userId) as StudyItemRow | undefined;

  if (!item) {
    res.status(404).json({ message: '内容不存在' });
    return;
  }

  const existing = db.prepare('SELECT * FROM conversation_demos WHERE source_item_id = ? AND user_id = ?')
    .get(itemId, userId) as ConversationDemoRow | undefined;
  if (existing && !input.regenerate) {
    res.json({ demo: publicConversationDemo(existing), cached: true });
    return;
  }

  const generated = await generateConversationDemo(item);
  const keyPoints = JSON.stringify(generated.keyPoints);

  const transaction = db.transaction(() => {
    if (existing) {
      db.prepare(`
        UPDATE conversation_demos
        SET title = ?, scenario = ?, dialogue = ?, key_points = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `).run(generated.title, generated.scenario, generated.dialogue, keyPoints, existing.id, userId);
      return existing.id;
    }

    const result = db.prepare(`
      INSERT INTO conversation_demos (user_id, source_item_id, title, scenario, dialogue, key_points)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, itemId, generated.title, generated.scenario, generated.dialogue, keyPoints);
    return Number(result.lastInsertRowid);
  });

  const demoId = transaction();
  const demo = db.prepare('SELECT * FROM conversation_demos WHERE id = ? AND user_id = ?')
    .get(demoId, userId) as ConversationDemoRow;

  res.status(existing ? 200 : 201).json({ demo: publicConversationDemo(demo), cached: false });
}));

app.put('/api/items/:id', authRequired as RequestHandler, asyncHandler((req, res) => {
  const userId = currentUserId(req);
  const itemId = Number(req.params.id);
  const input = itemUpdateSchema.parse(req.body);

  const existing = db.prepare('SELECT * FROM study_items WHERE id = ? AND user_id = ?')
    .get(itemId, userId) as StudyItemRow | undefined;
  if (!existing) {
    res.status(404).json({ message: '内容不存在' });
    return;
  }

  const next = {
    type: input.type ?? existing.type,
    text: input.text ?? existing.text,
    meaning: input.meaning === undefined ? existing.meaning : input.meaning,
    example: input.example === undefined ? existing.example : input.example
  };

  try {
    db.prepare(`
      UPDATE study_items
      SET type = ?, text = ?, meaning = ?, example = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(next.type, next.text, next.meaning ?? null, next.example ?? null, itemId, userId);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      res.status(409).json({ message: '该内容已存在' });
      return;
    }
    throw error;
  }

  const item = db.prepare('SELECT * FROM study_items WHERE id = ? AND user_id = ?')
    .get(itemId, userId) as StudyItemRow;
  res.json({ item: publicItem(item) });
}));

app.delete('/api/items/:id', authRequired as RequestHandler, asyncHandler((req, res) => {
  const userId = currentUserId(req);
  const itemId = Number(req.params.id);
  const result = db.prepare('DELETE FROM study_items WHERE id = ? AND user_id = ?').run(itemId, userId);

  if (result.changes === 0) {
    res.status(404).json({ message: '内容不存在' });
    return;
  }

  res.status(204).send();
}));

app.get('/api/tasks/today', authRequired as RequestHandler, asyncHandler((req, res) => {
  const task = createTodayTask(currentUserId(req));
  res.json({ task: getTaskSummary(task) });
}));

app.post('/api/tasks/today/generate', authRequired as RequestHandler, asyncHandler((req, res) => {
  const task = createTodayTask(currentUserId(req));
  res.status(201).json({ task: getTaskSummary(task) });
}));

app.post('/api/tasks/items/:taskItemId/review', authRequired as RequestHandler, asyncHandler((req, res) => {
  const userId = currentUserId(req);
  const taskItemId = Number(req.params.taskItemId);
  const input = reviewSchema.parse(req.body);

  const row = db.prepare(`
    SELECT
      dti.id AS task_item_id,
      dti.task_id,
      dti.state,
      dti.attempts,
      si.*
    FROM daily_task_items dti
    JOIN daily_tasks dt ON dt.id = dti.task_id
    JOIN study_items si ON si.id = dti.item_id
    WHERE dti.id = ? AND dt.user_id = ? AND si.user_id = ?
  `).get(taskItemId, userId, userId) as (StudyItemRow & {
    task_item_id: number;
    task_id: number;
    state: string;
    attempts: number;
  }) | undefined;

  if (!row) {
    res.status(404).json({ message: '任务项不存在' });
    return;
  }

  const reviewResult = input.result as ReviewResult;
  const next = calculateNextReview(row.review_stage, reviewResult);
  const nextTaskState = reviewResult === 'remembered' ? 'remembered' : 'forgotten';

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE study_items
      SET review_stage = ?, next_review_at = ?, status = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(next.nextStage, next.nextReviewAt, next.status, row.id, userId);

    db.prepare(`
      UPDATE daily_task_items
      SET state = ?, attempts = attempts + 1,
          completed_at = CASE WHEN ? = 'remembered' THEN datetime('now') ELSE NULL END,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(nextTaskState, nextTaskState, taskItemId);

    db.prepare(`
      INSERT INTO reviews (user_id, item_id, task_item_id, result, previous_stage, next_stage, next_review_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, row.id, taskItemId, reviewResult, row.review_stage, next.nextStage, next.nextReviewAt);

    updateTaskCompletion(row.task_id);
  });

  transaction();

  const task = db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(row.task_id) as DailyTaskRow;
  const item = db.prepare('SELECT * FROM study_items WHERE id = ?').get(row.id) as StudyItemRow;

  res.json({ item: publicItem(item), task: getTaskSummary(task) });
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((error: unknown, _req: AuthedRequest, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    res.status(400).json({ message: '请求参数不正确', issues: error.flatten() });
    return;
  }

  if (error instanceof Error && 'status' in error && typeof error.status === 'number') {
    res.status(error.status).json({ message: error.message });
    return;
  }

  console.error(error);
  res.status(500).json({ message: '服务器内部错误' });
});

app.listen(port, () => {
  console.log(`Sanxiu（散修）server listening on http://localhost:${port}`);
});

