import { addDays, addMinutes, toSqlDateTime } from './time.js';
import type { ReviewResult, StudyStatus } from './types.js';

const REVIEW_INTERVALS: Array<{ kind: 'minutes' | 'days'; value: number }> = [
  { kind: 'minutes', value: 10 },
  { kind: 'days', value: 1 },
  { kind: 'days', value: 2 },
  { kind: 'days', value: 4 },
  { kind: 'days', value: 7 },
  { kind: 'days', value: 15 },
  { kind: 'days', value: 30 },
  { kind: 'days', value: 60 }
];

export function calculateNextReview(previousStage: number, result: ReviewResult, now = new Date()) {
  const nextStage = result === 'remembered' ? previousStage + 1 : Math.max(0, previousStage - 1);
  const interval = result === 'forgotten'
    ? REVIEW_INTERVALS[0]
    : REVIEW_INTERVALS[Math.min(nextStage, REVIEW_INTERVALS.length - 1)];

  const nextReviewAt = interval.kind === 'minutes'
    ? addMinutes(now, interval.value)
    : addDays(now, interval.value);

  const status: StudyStatus = nextStage >= 6 ? 'mastered' : nextStage > 0 ? 'learning' : 'new';

  return {
    nextStage,
    nextReviewAt: toSqlDateTime(nextReviewAt),
    status
  };
}

