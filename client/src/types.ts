export type ItemType = 'word' | 'sentence';
export type StudyStatus = 'new' | 'learning' | 'mastered';
export type TaskItemState = 'pending' | 'remembered' | 'forgotten';
export type ReviewResult = 'remembered' | 'forgotten';

export interface User {
  id: number;
  email: string;
  name: string;
  dailyGoal: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudyItem {
  id: number;
  type: ItemType;
  text: string;
  meaning: string;
  example: string;
  status: StudyStatus;
  reviewStage: number;
  nextReviewAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskItem {
  id: number;
  taskId: number;
  itemId: number;
  state: TaskItemState;
  attempts: number;
  completedAt: string | null;
  item: StudyItem;
}

export interface DailyTask {
  id: number;
  taskDate: string;
  targetCount: number;
  completedAt: string | null;
  totalCount: number;
  rememberedCount: number;
  pendingCount: number;
  newCount: number;
  reviewCount: number;
  isCompleted: boolean;
  items: TaskItem[];
}

export interface SemanticRelatedItem {
  id: number;
  sourceItemId: number;
  text: string;
  meaning: string;
  context: string;
  difference: string;
  formality: string;
  tags: string[];
  addedToLibraryItemId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDemo {
  id: number;
  sourceItemId: number;
  title: string;
  scenario: string;
  dialogue: string;
  keyPoints: string[];
  createdAt: string;
  updatedAt: string;
}

