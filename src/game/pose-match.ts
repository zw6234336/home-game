import type { Landmark, Point } from '../types.ts';
import { validLandmark } from '../interaction/geometry.ts';

export type PoseId = 'airplane' | 'star' | 'cactus' | 'roof' | 'hug' | 'wave';
export type PoseChallenge = { readonly id: PoseId; readonly name: string; readonly instruction: string; readonly shortLabel: string };
export type PoseEvaluation = { matched: boolean; quality: number; hint: string };

const challenges: PoseChallenge[] = [
  { id: 'airplane', name: '小飞机', instruction: '双手向两边平平伸开，像飞机的翅膀', shortLabel: '双臂平伸' },
  { id: 'star', name: '小星星', instruction: '双手向斜上方伸开，变成亮亮的小星星', shortLabel: '斜上伸展' },
  { id: 'cactus', name: '大力士', instruction: '两边手肘打开，小手向上，摆出大力士的样子', shortLabel: '屈肘举手' },
  { id: 'roof', name: '小屋顶', instruction: '双手在头顶靠近，手肘打开，搭一个小屋顶', shortLabel: '合出屋顶' },
  { id: 'hug', name: '抱抱熊', instruction: '双手在胸前交叉，轻轻抱一抱自己，让手腕露出来', shortLabel: '交叉抱抱' },
  { id: 'wave', name: '招招手', instruction: '举起一只手打招呼，另一只手轻松放下', shortLabel: '单手招呼' },
];

export const POSE_CHALLENGES: readonly PoseChallenge[] = Object.freeze(challenges.map(challenge => Object.freeze(challenge)));

type Arm = { shoulder: Point; elbow: Point; wrist: Point; side: -1 | 1; angle: number };
type Check = { passed: boolean; hint: string };

function atLeast(value: number, minimum: number): boolean {
  return value + 1e-9 >= minimum;
}

function atMost(value: number, maximum: number): boolean {
  return value <= maximum + 1e-9;
}

function within(value: number, minimum: number, maximum: number): boolean {
  return atLeast(value, minimum) && atMost(value, maximum);
}

function length(first: Point, second: Point): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function armAngle(shoulder: Point, elbow: Point, wrist: Point): number | null {
  const upper = length(shoulder, elbow);
  const lower = length(wrist, elbow);
  if (!Number.isFinite(upper) || !Number.isFinite(lower) || upper <= 1e-4 || lower <= 1e-4) return null;
  const dot = ((shoulder.x - elbow.x) / upper) * ((wrist.x - elbow.x) / lower) + ((shoulder.y - elbow.y) / upper) * ((wrist.y - elbow.y) / lower);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
  return Number.isFinite(angle) ? angle : null;
}

function bodyArms(landmarks: readonly Landmark[], aspectRatio: number): [Arm, Arm] | null {
  if (!Array.isArray(landmarks) || !Number.isFinite(aspectRatio) || aspectRatio <= 0 || ![11, 12, 13, 14, 15, 16].every(index => validLandmark(landmarks[index]))) return null;
  const left = { x: landmarks[11].x * aspectRatio, y: landmarks[11].y };
  const right = { x: landmarks[12].x * aspectRatio, y: landmarks[12].y };
  const width = length(left, right);
  if (!Number.isFinite(width) || width <= 1e-4) return null;
  const axis = { x: (right.x - left.x) / width, y: (right.y - left.y) / width };
  const sign = axis.x < 0 ? -1 : 1;
  const down = { x: -axis.y * sign, y: axis.x * sign };
  const center = { x: left.x + (right.x - left.x) / 2, y: left.y + (right.y - left.y) / 2 };
  const local = (index: number): Point => {
    const dx = landmarks[index].x * aspectRatio - center.x;
    const dy = landmarks[index].y - center.y;
    return { x: (dx * axis.x + dy * axis.y) / width, y: (dx * down.x + dy * down.y) / width };
  };
  const arms: Arm[] = [];
  for (let index = 0; index < 2; index += 1) {
    const shoulder = local(11 + index);
    const elbow = local(13 + index);
    const wrist = local(15 + index);
    if (![shoulder, elbow, wrist].every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
    const angle = armAngle(shoulder, elbow, wrist);
    if (angle === null) return null;
    arms.push({ shoulder, elbow, wrist, side: index === 0 ? -1 : 1, angle });
  }
  return arms as [Arm, Arm];
}

function outward(arm: Arm, point: Point): number {
  return (point.x - arm.shoulder.x) * arm.side;
}

function check(passed: boolean, hint: string): Check {
  return { passed, hint };
}

function evaluateChecks(id: PoseId, arms: [Arm, Arm], gentle: boolean): Check[] {
  const both = (predicate: (arm: Arm) => boolean): boolean => arms.every(predicate);
  if (id === 'airplane') return [
    check(both(arm => atLeast(outward(arm, arm.wrist), gentle ? 0.3 : 0.45)), '双手再向两边打开一点'),
    check(both(arm => atMost(Math.abs(arm.wrist.y - arm.shoulder.y), gentle ? 0.4 : 0.35)), '把小手放到肩膀的高度'),
    check(both(arm => atLeast(arm.angle, gentle ? 125 : 145)), '手臂再轻轻伸直一点'),
  ];
  if (id === 'star') return [
    check(both(arm => atLeast(outward(arm, arm.wrist), gentle ? 0.3 : 0.45)), '双手向两边展开，留一点空间'),
    check(both(arm => atLeast(arm.shoulder.y - arm.wrist.y, gentle ? 0.45 : 0.65)), '双手再向斜上方举一点'),
    check(both(arm => atLeast(arm.angle, gentle ? 125 : 145)), '把两条手臂轻轻伸长'),
  ];
  if (id === 'cactus') return [
    check(both(arm => atLeast(outward(arm, arm.elbow), gentle ? 0.2 : 0.35)), '两边手肘再打开一点'),
    check(both(arm => atMost(Math.abs(arm.elbow.y - arm.shoulder.y), gentle ? 0.55 : 0.4)), '把手肘放在肩膀附近'),
    check(both(arm => atLeast(arm.elbow.y - arm.wrist.y, gentle ? 0.3 : 0.45)), '小手向上，手肘留在下面'),
    check(both(arm => atMost(Math.abs(arm.wrist.x - arm.elbow.x), gentle ? 0.5 : 0.35)), '把小手放在手肘上方'),
    check(both(arm => within(arm.angle, gentle ? 50 : 65, gentle ? 120 : 115)), '弯一弯手肘，像两扇小门'),
    check(both(arm => atLeast(outward(arm, arm.wrist), 0) && atLeast(arm.shoulder.y - arm.wrist.y, 0.1)), '双手留在肩膀两边，轻轻举高'),
  ];
  if (id === 'roof') return [
    check(both(arm => atMost(arm.wrist.y, gentle ? -0.4 : -0.6)), '把双手举到头顶上方'),
    check(atMost(length(arms[0].wrist, arms[1].wrist), gentle ? 0.9 : 0.6), '让头顶上的两只手再靠近一点'),
    check(both(arm => atLeast(outward(arm, arm.elbow), gentle ? 0.15 : 0.25)), '手肘向两边打开，搭起屋顶'),
    check(both(arm => atMost((arm.wrist.x - arm.elbow.x) * arm.side, 0)), '小手向中间靠，手肘留在外面'),
  ];
  if (id === 'hug') return [
    check(both(arm => atMost(arm.wrist.x * arm.side, gentle ? 0 : -0.05)), '双手在胸前轻轻交叉'),
    check(arms.every((arm, index) => atMost(length(arm.wrist, arms[1 - index].shoulder), gentle ? 0.9 : 0.7)), '让双手靠近另一边肩膀'),
    check(both(arm => within(arm.wrist.y, -0.3, 0.65)), '把小手留在胸前，露出手腕'),
    check(both(arm => atLeast(arm.elbow.y, gentle ? -0.1 : 0.1) && atMost(arm.angle, gentle ? 140 : 120)), '手肘放松向下，抱一抱自己'),
  ];
  const wave = (arm: Arm, other: Arm): Check[] => [
    check(atLeast(arm.shoulder.y - arm.wrist.y, gentle ? 0.45 : 0.65), '举起一只小手，向大家打招呼'),
    check(atLeast(outward(arm, arm.wrist), gentle ? 0.05 : 0.15), '举起的小手再向旁边打开一点'),
    check(within(arm.angle, gentle ? 25 : 40, gentle ? 150 : 130), '举起的手轻轻弯一下手肘'),
    check(atLeast(other.wrist.y - other.shoulder.y, gentle ? 0.15 : 0.3), '另一只手轻松放下来'),
  ];
  const left = wave(arms[0], arms[1]);
  const right = wave(arms[1], arms[0]);
  return left.filter(item => item.passed).length >= right.filter(item => item.passed).length ? left : right;
}

export function evaluatePose(id: PoseId | string, landmarks: readonly Landmark[], gentle: boolean, aspectRatio = 1): PoseEvaluation {
  const challenge = POSE_CHALLENGES.find(item => item.id === id);
  if (!challenge || typeof gentle !== 'boolean') return { matched: false, quality: 0, hint: '请选择一个动作，再和同伴一起试试' };
  const arms = bodyArms(landmarks, aspectRatio);
  if (!arms) return { matched: false, quality: 0, hint: '让肩膀、手肘和手腕都回到画面里' };
  const checks = evaluateChecks(challenge.id, arms, gentle);
  const failed = checks.find(item => !item.passed);
  return { matched: !failed, quality: checks.filter(item => item.passed).length / checks.length, hint: failed?.hint ?? '就是这样，轻松保持一下' };
}
