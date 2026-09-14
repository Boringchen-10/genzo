# Genzo UI Design v1.1.2 — Asset Sources

版本：v1.1.2  
日期：2026-09-14  
结论：本版**已移除**全部来源不明 / 含第三方界面文字的素材，改用 Open Design 自制抽象占位图。

## 素材清单（逐项）

| 文件名 | 用途 | 实际来源 | 作者 | 许可证 | 可再分发 | 可正式发布 | 替代方案 |
|---|---|---|---|---|---|---|---|
| `assets/reference-primary.png` | 首页氛围层、封面大图、详情封面 | **Open Design 自制**（程序化生成的抽象几何构图：深色渐变 + 半透明圆 + 细斜线 + 薄荷色圆环），**无任何文字、Logo、动漫画面** | Open Design | 自制素材，随 Genzo 项目交付 | 是 | **是** | 已被本版替换；后续可由设计团队替换为品牌插画 |
| `assets/reference-secondary.png` | 精选导航缩略图、详情背景、弹窗配图 | **Open Design 自制**（同上，另一组渐变与构图） | Open Design | 同上 | 是 | **是** | 同上 |
| `assets/characters/character-1..6.png` | 详情页「制作人员与角色」头像占位 | **Open Design 自制**（512×512 中性几何头像剪影：圆 + 肩部椭圆 + 强调色描边） | Open Design | 同上 | 是 | **是** | 接入真实元数据后替换为授权角色图，并记录来源与授权 |

## 已移除（禁止继续使用）

- 含其他软件界面文字 / 动漫截图的参考图（原 `reference-primary.png` / `reference-secondary.png` 内容已替换）。
- 从参考截图裁切的角色图（原 `character-1..6.png` 内容已替换）。
- 在线动漫截图、Seanime / Animeko / Bangumi 等项目的 Logo、截图与品牌资产。

## 图标与字体

- 图标：内联 SVG 线性图标（1.8px），无外部图标包，无授权约束。
- 字体：`Bahnschrift` / `Segoe UI Variable Text` / `Microsoft YaHei UI`，Windows 系统字体；无 Web Font 与 CDN。

## 使用边界

- 本目录不含从网络抓取的媒体资源，不提供盗版内容搜索或分发。
- 原型运行时使用的封面为**自制几何占位图**，不是真实作品封面，也不冒充已授权素材。
- 正式产品接入真实封面 / 角色图前，必须重新获取并逐项记录来源、许可证、缓存与再分发策略。
