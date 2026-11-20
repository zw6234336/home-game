import type { PoseId } from '../game/pose-match.ts';
import type { Landmark, TrackedPlayer } from '../types.ts';
import type { SpaceMode } from '../game/space.ts';

type Shape = [number, number][];
export type IllustratedPose = PoseId | 'rest';
const shapes: Record<IllustratedPose, Shape> = {
  airplane: [[-1.05, 0], [1.05, 0], [-1.7, 0], [1.7, 0]],
  star: [[-.95, -.5], [.95, -.5], [-1.4, -1.05], [1.4, -1.05]],
  cactus: [[-1, 0], [1, 0], [-1, -.7], [1, -.7]],
  roof: [[-.8, -.7], [.8, -.7], [-.1, -1.4], [.1, -1.4]],
  hug: [[-.65, .55], [.65, .55], [.3, .25], [-.3, .25]],
  wave: [[-.85, -.2], [.75, .45], [-.95, -.9], [.8, 1]],
  rest: [[-.6, .55], [.6, .55], [-.65, 1.05], [.65, 1.05]]
};

const compactShapes: Record<IllustratedPose, Shape> = {
  airplane: [[-.55, .45], [.55, .45], [-.85, 0], [.85, 0]],
  star: [[-.6, .2], [.6, .2], [-.7, -.45], [.7, -.45]],
  cactus: [[-.85, .08], [.85, .08], [-.85, -.35], [.85, -.35]],
  roof: [[-.6, .35], [.6, .35], [-.1, -.12], [.1, -.12]],
  hug: shapes.hug,
  wave: [[-.6, .2], [.6, .4], [-.7, -.35], [.6, .6]],
  rest: shapes.rest,
};

function figure(id: IllustratedPose, child = false, mode: SpaceMode = 'standard') {
  const [leftElbow, rightElbow, leftWrist, rightWrist] = (mode === 'compact' ? compactShapes : shapes)[id];
  const xy = ([x, y]: number[]) => `${120 + x * 44} ${90 + y * 44}`;
  const shirt = child ? '#73bfa9' : '#f47d5b';
  const pants = child ? '#4a7774' : '#61517e';
  const arms = [[[-.5, 0], leftElbow, leftWrist], [[.5, 0], rightElbow, rightWrist]];
  return '<g>' +
    '<ellipse cx="120" cy="243" rx="57" ry="10" fill="#302744" opacity=".09"/>' +
    '<path d="M106 153 102 197 93 231M134 153 139 196 147 231" fill="none" stroke="' + pants + '" stroke-width="19" stroke-linecap="round"/>' +
    '<path d="M91 232 82 238h23m41-6 12 6h-24" fill="none" stroke="#fff9ef" stroke-width="12" stroke-linecap="round"/>' +
    '<path d="M98 86Q120 78 142 86L147 157Q120 168 93 157Z" fill="' + shirt + '"/>' +
    (child ? '<path d="m120 108 5 10 11 2-8 8 2 11-10-5-10 5 2-11-8-8 11-2z" fill="#eaf4da"/>' : '<path d="M107 116h26m-26 12h26" stroke="#ffc7a9" stroke-width="5" stroke-linecap="round"/>') +
    arms.map(arm => '<path d="M' + arm.map(xy).join(' ') + '" fill="none" stroke="' + shirt + '" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>').join('') +
    '<rect x="112" y="71" width="16" height="19" rx="7" fill="#edb996"/><ellipse cx="120" cy="57" rx="24" ry="27" fill="#f8d6bb"/>' +
    '<path d="M96 57Q87 26 114 28Q146 18 144 52Q130 51 122 39Q112 56 96 57" fill="' + (child ? '#725346' : '#463650') + '"/>' +
    '<path d="M112 58v3m16-3v3" stroke="#463650" stroke-width="2.8" stroke-linecap="round"/><path d="M115 70q5 5 10 0" fill="none" stroke="#b86b63" stroke-width="2.5" stroke-linecap="round"/>' +
    '<circle cx="103" cy="67" r="4" fill="#edac9d" opacity=".65"/><circle cx="137" cy="67" r="4" fill="#edac9d" opacity=".65"/>' +
    [leftWrist, rightWrist].map(point => '<circle cx="' + (120 + point[0] * 44) + '" cy="' + (90 + point[1] * 44) + '" r="9" fill="#f4c6a5" stroke="#fff9ef" stroke-width="1.5"/>').join('') + '</g>';
}

export function poseIllustration(id: IllustratedPose, child = true, mode: SpaceMode = 'standard') {
  return '<svg xmlns="http://www.w3.org/2000/svg" class="pose-figure" viewBox="0 0 240 260" role="img" aria-label="双脚站稳的上半身动作示范">' + figure(id, child, mode) + '</svg>';
}

export function poseScene(poses: IllustratedPose[] = ['airplane', 'airplane'], mode: SpaceMode = 'standard') {
  return '<svg xmlns="http://www.w3.org/2000/svg" class="scene-art pose-scene-art" viewBox="0 0 680 430" role="img" aria-label="大朋友和小朋友一起模仿动作的插画">' +
    '<ellipse cx="340" cy="364" rx="260" ry="30" fill="#a2c4b5" opacity=".25"/>' +
    '<path d="M65 116V80h36m478 0h36v36M65 292v36h36m478 0h36v-36" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none" opacity=".75"/>' +
    (poses.length === 1 ? '<g transform="translate(172 10) scale(1.4)">' + figure(poses[0], true, mode) + '</g>' : '<g transform="translate(35 8) scale(1.45)">' + figure(poses[0], false, mode) + '</g><g transform="translate(360 83) scale(1.15)">' + figure(poses[1], true, mode) + '</g>') +
    '<g fill="#f5dc81"><path d="m350 73 5 15 15 5-15 5-5 15-5-15-15-5 15-5z"/><circle cx="594" cy="248" r="6"/><circle cx="89" cy="186" r="4"/></g></svg>';
}

export function demoPosePlayers(ids: number[], target: PoseId, active: boolean[], mode: SpaceMode = 'standard'): TrackedPlayer[] {
  return ids.map((id, index) => {
    const center = { x: ids.length === 1 ? .5 : .27 + index * .46, y: .4 };
    const width = index ? .09 : .11;
    const points = [[-.5, 0], [.5, 0], ...(mode === 'compact' ? compactShapes : shapes)[active[index] ? target : 'rest']];
    const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: center.x, y: center.y, visibility: 0 }));
    points.forEach(([x, y], n) => { landmarks[11 + n] = { x: center.x + x * width, y: center.y + y * width, visibility: 1 }; });
    return { id, center, shoulderWidth: width, landmarks, wrists: [landmarks[15], landmarks[16]], raised: false, bothRaised: false };
  });
}
