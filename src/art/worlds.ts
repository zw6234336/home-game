export const adventureWorlds = {
  bubbles: {
    name: '泡泡派对', subtitle: '挥挥手，拍出快乐', invitation: '把快乐，轻轻拍开。',
    duration: '60 秒', action: '伸出小手，拍亮泡泡', accent: '#9279bf', ground: '#e9e0f2',
    tags: ['原地挥手', '一起得分', '漏掉也没关系'],
    description: '暖暖的客厅里，大朋友与小朋友一起伸手拍泡泡',
  },
  poses: {
    name: '默契模仿秀', subtitle: '摆个姿势，一起过关', invitation: '你一摆，我就懂。',
    duration: '6 张动作卡', action: '看一看示范，摆出同样的动作', accent: '#56856d', ground: '#dfede3',
    tags: ['照着卡片做', '各自完成', '一起过关'],
    description: '花园小剧场里，亲子伙伴一起张开双臂模仿小飞机',
  },
  hearts: {
    name: '爱心雨', subtitle: '接住爱心与童话宝物', invitation: '接住满天的小惊喜。',
    duration: '60 秒', action: '移动小篮接宝物，留心小炸弹', accent: '#ad617e', ground: '#f6e4ee',
    tags: ['接住童话宝物', '躲开小炸弹', '一起搞怪变身'],
    description: '童话城堡前，亲子伙伴用小篮接住爱心、皇冠与公主裙',
  },
  gates: {
    name: '太空穿越门', subtitle: '下蹲滑步，并肩穿星门', invitation: '和你，一起穿过星海。',
    duration: '60 秒', action: '跟着安全区移动，拍亮护盾星', accent: '#617fb0', ground: '#e2e9f5',
    tags: ['下蹲与滑步', '前后跨步', '护盾守护同伴'],
    description: '柔软的星球上，亲子宇航员并肩跨过发光星门、拍亮护盾星',
  },
  bridge: {
    name: '彩虹能量桥', subtitle: '伸出双臂，送精灵回家', invitation: '我们的默契，会发光。',
    duration: '60 秒', action: '伸展双臂连成桥，送精灵去城堡', accent: '#9772ba', ground: '#eee2f5',
    tags: ['双臂连成桥', '合作护送', '雷云来了一起蹲'],
    description: '云朵山谷里，亲子伙伴伸手连起彩虹桥，护送星光精灵回城堡',
  },
} as const;

export type AdventureWorld = keyof typeof adventureWorlds;
export const adventureKeys = Object.keys(adventureWorlds) as AdventureWorld[];

export function adventureUrl(game: AdventureWorld, thumbnail = false): string {
  return '/art/adventures-v1/' + game + (thumbnail ? '-thumb' : '') + '.webp';
}
