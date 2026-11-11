# -*- coding: utf-8 -*-
"""生成内置头像（23 张业余无线电主题 SVG）。

数量为什么是 23：加上「默认（首字母）」共 24 格，24 是 3/4/6/8 的最小公倍数，
于是一行 3 个（窄屏）、4 个（手机）、6 个（平板）、8 个（桌面）都能整排铺满，
不会出现最后一排被拉伸的参差。改数量时务必保住这个整除关系。

为什么手绘而不是 AI 生图：头像要并排陈列，风格必须绝对一致
（同一圆形底、同一线宽、同一几何语言），AI 逐张生成做不到这一点。

设计约束（针对 32px 顶栏尺寸做过一轮目视复核后收紧）：
  · 线宽 4.2，宁可粗
  · 每个图形不超过 5 笔，内部细节能省则省
  · 需要"体量"的地方直接填充白色块，而不是靠细线堆

输出：public/assets/avatar/<key>.svg
对应：src/lib/avatars.js（key / label 必须一致）
"""
import os

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "public", "assets", "avatar")

# 每个图形画在 0..48 的方框内，之后整体平移到画布中心
TMPL = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="{label}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{c1}"/>
      <stop offset="1" stop-color="{c2}"/>
    </linearGradient>
    <clipPath id="clip"><circle cx="48" cy="48" r="48"/></clipPath>
  </defs>
  <g clip-path="url(#clip)">
    <circle cx="48" cy="48" r="48" fill="url(#bg)"/>
    <g transform="translate(24,24)" fill="none" stroke="#fff" stroke-width="4.2"
       stroke-linecap="round" stroke-linejoin="round">
{body}
    </g>
  </g>
</svg>
"""

# key, 中文名, 渐变起止色, 图形（0..48 坐标）
ICONS = [
    ("yagi", "八木天线", "#2563eb", "#1d4ed8", """
      <path d="M6 26h36" stroke-width="5.6"/>
      <path d="M14 16v20M24 10v32M34 18v16"/>
      <path d="M24 42v4"/>"""),

    ("dish", "抛物面天线", "#0891b2", "#0e7490", """
      <path d="M17 8C31 15 31 33 17 40"/>
      <path d="M17 8v32"/>
      <path d="M27 24h11"/>
      <circle cx="41" cy="24" r="2.6"/>
      <path d="M24 40v5M18 45h12"/>"""),

    ("tower", "天线铁塔", "#64748b", "#334155", """
      <path d="M18 42 23 10M30 42 25 10"/>
      <path d="M20 34h8M21.5 24h5"/>
      <path d="M13 43h22"/>
      <path d="M24 10V4M20 6h8"/>"""),

    ("dipole", "偶极天线", "#059669", "#047857", """
      <path d="M6 20h14M28 20h14"/>
      <circle cx="24" cy="20" r="3"/>
      <path d="M24 23v9"/>
      <rect x="15" y="32" width="18" height="12" rx="2"/>"""),

    ("loop", "Quad 天线", "#7c3aed", "#6d28d9", """
      <path d="M24 8 40 24 24 40 8 24Z"/>
      <path d="M24 40v2"/>
      <rect x="14" y="42" width="20" height="4" rx="1.6"/>"""),

    ("ht", "手持对讲机", "#ea580c", "#c2410c", """
      <rect x="13" y="10" width="22" height="31" rx="3.5"/>
      <path d="M24 10V3"/>
      <rect x="17" y="15" width="14" height="9" rx="1.5" fill="#fff" stroke="none"/>"""),

    ("mobile", "车载电台", "#dc2626", "#b91c1c", """
      <rect x="7" y="13" width="34" height="21" rx="2.5"/>
      <rect x="10" y="16" width="13" height="8" rx="1" fill="#fff" stroke="none"/>
      <circle cx="31" cy="22" r="3.6"/>
      <rect x="10" y="36" width="8" height="9" rx="2"/>
      <path d="M18 40C22 40 25 37 25 34"/>"""),

    ("rig", "基地电台", "#2563eb", "#1e3a8a", """
      <rect x="6" y="12" width="36" height="24" rx="2.5"/>
      <circle cx="15" cy="24" r="6"/>
      <path d="M15 24v-5"/>
      <rect x="24" y="16" width="15" height="7" rx="1" fill="#fff" stroke="none"/>
      <rect x="24" y="26" width="15" height="7" rx="1"/>"""),

    ("key", "摩尔斯电键", "#b45309", "#92400e", """
      <rect x="10" y="37" width="28" height="7" rx="2.5"/>
      <path d="M18 37V27"/>
      <path d="M11 25h21"/>
      <circle cx="35" cy="24" r="4.6"/>
      <path d="M13 30v4"/>"""),

    ("mic", "麦克风", "#db2777", "#be185d", """
      <rect x="17" y="5" width="14" height="21" rx="7"/>
      <path d="M21 10v10M27 10v10"/>
      <path d="M14 18a10 10 0 0 0 20 0"/>
      <path d="M24 28v8M16 39h16"/>"""),

    ("headset", "耳机", "#0d9488", "#0f766e", """
      <path d="M10 29a14 14 0 0 1 28 0"/>
      <rect x="5" y="26" width="8" height="13" rx="3" fill="#fff" stroke="none"/>
      <rect x="35" y="26" width="8" height="13" rx="3" fill="#fff" stroke="none"/>
      <path d="M13 39c0 5 5 6 8 4"/>
      <circle cx="23" cy="42" r="2.4"/>"""),

    ("wave", "电波", "#4f46e5", "#4338ca", """
      <circle cx="11" cy="24" r="3.4"/>
      <path d="M17 15a11 11 0 0 1 0 18"/>
      <path d="M22 10a16 16 0 0 1 0 28"/>
      <path d="M27 5a21 21 0 0 1 0 38"/>"""),

    ("scope", "示波器", "#0891b2", "#155e75", """
      <rect x="6" y="10" width="36" height="28" rx="3"/>
      <path d="M10 24c3-6 6-6 9 0s6 6 9 0 6-6 9 0"/>
      <circle cx="13" cy="42" r="2.2"/>
      <circle cx="21" cy="42" r="2.2"/>"""),

    ("spectrum", "频谱瀑布", "#16a34a", "#15803d", """
      <path d="M6 41h36"/>
      <rect x="9" y="27" width="6" height="14" rx="1.5" fill="#fff" stroke="none"/>
      <rect x="18" y="17" width="6" height="24" rx="1.5" fill="#fff" stroke="none"/>
      <rect x="27" y="23" width="6" height="18" rx="1.5" fill="#fff" stroke="none"/>
      <rect x="36" y="32" width="6" height="9" rx="1.5" fill="#fff" stroke="none"/>"""),

    ("sat", "卫星", "#1d4ed8", "#312e81", """
      <rect x="16" y="16" width="16" height="16" rx="3"/>
      <rect x="4" y="19" width="7" height="10" rx="1"/>
      <rect x="37" y="19" width="7" height="10" rx="1"/>
      <path d="M11 24h5M32 24h5"/>"""),

    ("globe", "电离层", "#0284c7", "#0369a1", """
      <circle cx="24" cy="29" r="12"/>
      <path d="M24 17a6 12 0 0 0 0 24M24 17a6 12 0 0 1 0 24"/>
      <path d="M12 29h24"/>
      <path d="M14 8c4-5 16-5 20 0"/>
      <path d="M18 13c3-3 9-3 12 0"/>"""),

    ("qsl", "QSL 卡片", "#a16207", "#854d0e", """
      <g transform="rotate(-9 24 24)">
        <rect x="8" y="12" width="28" height="24" rx="2.5"/>
        <path d="M12 20h14M12 26h10M12 32h16"/>
        <rect x="28" y="15" width="6" height="6" rx="1"/>
      </g>"""),

    ("battery", "电源", "#65a30d", "#4d7c0f", """
      <rect x="11" y="15" width="26" height="20" rx="3"/>
      <path d="M20 11h8v4h-8z" fill="#fff" stroke="none"/>
      <path d="M26 19l-7 10h5l-2 6 8-11h-4z" fill="#fff" stroke="none"/>"""),

    ("badge", "呼号牌 73", "#9333ea", "#7e22ce", """
      <rect x="10" y="11" width="28" height="27" rx="4"/>
      <rect x="20" y="5" width="8" height="7" rx="2"/>
      <text x="24" y="33" font-family="Helvetica,Arial,sans-serif" font-size="19"
            font-weight="700" text-anchor="middle" fill="#fff" stroke="none">73</text>"""),

    ("swr", "驻波表", "#e11d48", "#9f1239", """
      <circle cx="24" cy="24" r="16"/>
      <path d="M24 24 33 17"/>
      <circle cx="24" cy="24" r="2.4"/>
      <path d="M13 43h7M28 43h7"/>"""),

    # —— 以下 3 张为凑齐 24 格新增，排在末尾，色相刻意避开相邻的玫红 —— #
    # 注意别画成「矩形 + 两侧引线」—— 那是直插电阻的符号，会被误读。
    # 改成插头造型：左边一根软缆，右边两根插脚，一眼是接头不是元件。
    ("coax", "馈线接头", "#78350f", "#451a03", """
      <path d="M5 24h10" stroke-width="5.6"/>
      <rect x="15" y="13" width="19" height="22" rx="3.5"/>
      <path d="M34 19h9M34 29h9"/>"""),

    # 分格只留 2×2：32px 下 3 格竖条会糊成一片，宁可少一笔保住可辨性
    ("solar", "太阳能板", "#0f766e", "#134e4a", """
      <rect x="7" y="7" width="34" height="20" rx="2"/>
      <path d="M24 7v20"/>
      <path d="M7 17h34"/>
      <path d="M24 27v9M17 38h14"/>"""),

    ("moon", "月面反射", "#3730a3", "#1e1b4b", """
      <path d="M20 5A19 19 0 0 0 20 43A21 21 0 0 1 20 5Z" fill="#fff" stroke="none"/>
      <path d="M27 15a10 10 0 0 1 0 18"/>
      <path d="M32 10a15 15 0 0 1 0 28"/>"""),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    for key, label, c1, c2, body in ICONS:
        svg = TMPL.format(label=label, c1=c1, c2=c2, body=body.strip("\n"))
        with open(os.path.join(OUT, f"{key}.svg"), "w", encoding="utf-8") as f:
            f.write(svg)
    print(f"✓ 已生成 {len(ICONS)} 张头像 → {OUT}")


if __name__ == "__main__":
    main()
