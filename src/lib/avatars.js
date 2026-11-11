/**
 * 内置头像（23 张业余无线电主题）+ 1 个「默认」= 24 格。
 * 与 tools/gen_avatars.py 一一对应，新增/改名请同步两边。
 *
 * 数量别乱改：24 是 3/4/6/8 的最小公倍数，保证一行 3 个（窄屏）、
 * 4 个（手机）、6 个（平板）、8 个（桌面）都能整排铺满。
 *
 * 第 0 项是「默认」：沿用首字母圆形图标，key 为空串。
 */
export const AVATARS = [
  { key: '', label: '默认', hint: '首字母' },
  { key: 'yagi', label: '八木天线' },
  { key: 'dish', label: '抛物面天线' },
  { key: 'tower', label: '天线铁塔' },
  { key: 'dipole', label: '偶极天线' },
  { key: 'loop', label: 'Quad 天线' },
  { key: 'ht', label: '手持对讲机' },
  { key: 'mobile', label: '车载电台' },
  { key: 'rig', label: '基地电台' },
  { key: 'key', label: '摩尔斯电键' },
  { key: 'mic', label: '麦克风' },
  { key: 'headset', label: '耳机' },
  { key: 'wave', label: '电波' },
  { key: 'scope', label: '示波器' },
  { key: 'spectrum', label: '频谱瀑布' },
  { key: 'sat', label: '卫星' },
  { key: 'globe', label: '电离层' },
  { key: 'qsl', label: 'QSL 卡片' },
  { key: 'battery', label: '电源' },
  { key: 'badge', label: '呼号牌 73' },
  { key: 'swr', label: '驻波表' },
  { key: 'coax', label: '馈线接头' },
  { key: 'solar', label: '太阳能板' },
  { key: 'moon', label: '月面反射' },
]

/** 预设头像的图片地址；key 为空表示无预设 */
export const avatarSrc = (key) => (key ? `/assets/avatar/${key}.svg` : '')

/** 取某个 key 的中文名，未知名返回空串 */
export const avatarLabel = (key) => AVATARS.find((a) => a.key === key)?.label || ''
