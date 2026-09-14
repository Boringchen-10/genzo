import { CalendarDays, Compass, RefreshCw, Search } from "lucide-react";
import { IconButton } from "../components/common";

const samples = [
  ["星海邮差", "编辑推荐", "/design/reference-primary.png"],
  ["雨声与机械城", "热度 #2", "/design/reference-secondary.png"],
  ["第七码头的夏天", "热度 #3", "/design/reference-primary.png"],
  ["群青观测站", "本季更新", "/design/reference-secondary.png"],
  ["玻璃庭院", "漫画推荐", "/design/reference-primary.png"],
] as const;

export function ExplorePage() {
  return (
    <div className="page workspace-page gnz-explore-page">
      <header className="gnz-compact-header">
        <div><strong>探索</strong><span>下一阶段后端</span></div>
        <div className="gnz-disabled-search" title="Future：需要接入 Bangumi 探索后端">
          <Search size={17} /><input disabled placeholder="搜索动漫、漫画或作品名" aria-label="搜索探索内容（尚未开放）" />
        </div>
        <IconButton tooltip="刷新" title="Future：刷新探索数据尚未开放" disabled><RefreshCw size={18} /></IconButton>
      </header>

      <section className="gnz-explore-intro">
        <div><span className="future-badge">Prototype · Future</span><h1>探索</h1><p>发现本季动画与漫画。这里保留正式界面结构，网络内容接入后才会开放操作。</p></div>
        <div className="gnz-explore-season"><strong>2026 秋季 · Prototype</strong><span>数据源待开发 Agent 确认</span></div>
      </section>

      <div className="gnz-primary-tabs" aria-label="探索分类">
        <button className="active" type="button">推荐</button>
        <button type="button" disabled title="Future">本季</button>
        <button type="button" disabled title="Future">动画</button>
        <button type="button" disabled title="Future">漫画</button>
      </div>

      <section className="gnz-explore-trending">
        <div className="section-heading"><div><h2>最高热度</h2><span>预览数据，不写入本地媒体库</span></div><button className="button ghost icon-text" type="button" disabled title="Future：番组日历尚未开放"><CalendarDays size={16} />新番时间表</button></div>
        <div className="gnz-trending-grid">
          {samples.map(([title, meta, image], index) => (
            <article className="gnz-trending-card" key={title} style={{ "--sample-image": `url(${image})`, "--sample-position": `${index * 14}%` } as React.CSSProperties}>
              <div><strong>{title}</strong><span>{meta} · Prototype</span></div>
            </article>
          ))}
        </div>
      </section>

      <section className="gnz-filter-preview" aria-disabled="true">
        <div className="section-heading"><div><h2>筛选 <span className="quiet-inline">共 14 部预览作品</span></h2></div><button className="button secondary compact" type="button" disabled>重置</button></div>
        <label>动漫标签</label><div className="gnz-filter-chips"><button disabled>科幻</button><button disabled>冒险</button><button disabled>悬疑</button><button disabled>日常</button><button disabled>治愈</button><button disabled>奇幻</button></div>
        <div className="gnz-filter-selects"><select disabled><option>全部年份</option></select><select disabled><option>全部月份</option></select></div>
      </section>
    </div>
  );
}
