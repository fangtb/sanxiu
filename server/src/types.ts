import type { Request } from 'express';

export type ItemType = 'word' | 'sentence';
export type StudyStatus = 'new' | 'learning' | 'mastered';
export type TaskItemState = 'pending' | 'remembered' | 'forgotten';
export type ReviewResult = 'remembered' | 'forgotten';

export interface AuthUser {
  id: number;
  email: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export interface StudyItemRow {
  id: number;
  user_id: number;
  type: ItemType;
  text: string;
  meaning: string | null;
  example: string | null;
  status: StudyStatus;
  review_stage: number;
  next_review_at: string;
  created_at: string;
  updated_at: string;
}

export interface DailyTaskRow {
  id: number;
  user_id: number;
  task_date: string;
  target_count: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyTaskItemRow {
  id: number;
  task_id: number;
  item_id: number;
  state: TaskItemState;
  attempts: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SemanticRelatedItemRow {
  id: number;
  user_id: number;
  source_item_id: number;
  text: string;
  meaning: string | null;
  context: string | null;
  difference: string | null;
  formality: string | null;
  tags: string | null;
  added_to_library_item_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationDemoRow {
  id: number;
  user_id: number;
  source_item_id: number;
  title: string;
  scenario: string | null;
  dialogue: string;
  key_points: string | null;
  created_at: string;
  updated_at: string;
}

