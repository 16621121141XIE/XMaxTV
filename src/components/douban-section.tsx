'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { DoubanItem } from '@/lib/types';
import { DoubanCard } from './video-card';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/**
 * 主页一级模块：电影 / 剧集 / 动漫 / 儿童。
 * 二级标签（sub）可自带 type 覆盖模块默认 type：豆瓣 tv 接口词表很窄，
 * 国漫（剑来、斗破苍穹这类 3D 番剧）只能从 movie/国产动画 取，故动漫模块混合 tv 日番 + movie 国漫。
 */
type Sub = { label: string; type?: 'movie' | 'tv'; tag: string };
type ModuleId = 'movie' | 'tv' | 'anime' | 'kids';
type Module = {
  id: ModuleId;
  label: string;
  doubanType: 'movie' | 'tv';
  subs: Sub[];
};
const MODULES: Module[] = [
  {
    id: 'movie',
    label: '电影',
    doubanType: 'movie',
    subs: [
      { label: '热门', tag: '热门' },
      { label: '最新', tag: '最新' },
      { label: '经典', tag: '经典' },
      { label: '豆瓣高分', tag: '豆瓣高分' },
      { label: '冷门佳片', tag: '冷门佳片' },
      { label: '华语', tag: '华语' },
      { label: '欧美', tag: '欧美' },
      { label: '韩国', tag: '韩国' },
      { label: '日本', tag: '日本' },
      { label: '动画电影', type: 'movie', tag: '动画' },
    ],
  },
  {
    id: 'tv',
    label: '剧集',
    doubanType: 'tv',
    subs: [
      { label: '热门', tag: '热门' },
      { label: '美剧', tag: '美剧' },
      { label: '英剧', tag: '英剧' },
      { label: '韩剧', tag: '韩剧' },
      { label: '日剧', tag: '日剧' },
      { label: '国产剧', tag: '国产剧' },
      { label: '港剧', tag: '港剧' },
      { label: '综艺', tag: '综艺' },
      { label: '纪录片', tag: '纪录片' },
    ],
  },
  {
    id: 'anime',
    label: '动漫',
    doubanType: 'tv',
    subs: [
      { label: '日本动画', type: 'tv', tag: '日本动画' },
      { label: '国产动画', type: 'movie', tag: '国产动画' },
      { label: '动画电影', type: 'movie', tag: '动画' },
    ],
  },
  {
    id: 'kids',
    label: '儿童',
    doubanType: 'movie',
    subs: [
      { label: '动画', type: 'movie', tag: '动画' },
      { label: '家庭', tag: '家庭' },
      { label: '儿童', tag: '儿童' },
      { label: '温情', tag: '温情' },
      { label: '治愈', tag: '治愈' },
    ],
  },
];

/** 首页推荐区：数据源由设置决定（豆瓣热门 / Bangumi 新番放送 / 影视热榜），二选一展示 */
export function RecommendSection({ onPick }: { onPick: (title: string) => void }) {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const recommendSource = useAppStore((s) => s.recommendSource);

  if (!doubanEnabled) return null;
  if (recommendSource === 'bangumi') return <BangumiView onPick={onPick} />;
  if (recommendSource === 'hot-list') return <HotListView onPick={onPick} />;
  return <DoubanView onPick={onPick} />;
}

/**
 * 豆瓣推荐：影视切换 + 标签筛选。
 * 一次性渲染全部条目：数据本就一次拉全（50 条），卡片图片又是 lazy 加载，
 * 视口外的图不会请求，因此不需要「加载更多」这类本地切片分页来打断浏览。
 */
function DoubanView({ onPick }: { onPick: (title: string) => void }) {
  const [mod, setMod] = useState<ModuleId>('movie');
  const active = MODULES.find((m) => m.id === mod) ?? MODULES[0];

  // 当前二级标签（可自带 type 覆盖模块默认 type）
  const [sub, setSub] = useState<Sub>(MODULES[0].subs[0]);

  const queryType = sub.type ?? active.doubanType;
  const query = useQuery({
    queryKey: ['douban', active.id, queryType, sub.tag],
    queryFn: ({ signal }) => api.douban(queryType, sub.tag, 0, 50, signal),
  });

  const items = query.data?.items ?? [];

  const switchMod = (id: ModuleId) => {
    if (id === mod) return;
    const m = MODULES.find((x) => x.id === id);
    setMod(id);
    setSub(m?.subs[0] ?? MODULES[0].subs[0]);
  };

  const switchSub = (s: Sub) => setSub(s);

  return (
    <section aria-label="影视推荐">
      <div className="flex items-center justify-between mb-3">
        <div className="flex flex-wrap gap-1.5 bg-chip rounded-lg p-1">
          {MODULES.map((m) => (
            <TypeButton key={m.id} active={mod === m.id} onClick={() => switchMod(m.id)}>
              {m.label}
            </TypeButton>
          ))}
        </div>
      </div>

      {active.subs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {active.subs.map((s) => (
            <button
              key={s.label}
              className={cn(
                'px-3.5 py-1.5 rounded-full text-sm transition-colors',
                s.label === sub.label && s.tag === sub.tag
                  ? 'bg-accent text-on-accent'
                  : 'bg-chip text-muted hover:text-content hover:bg-hover'
              )}
              onClick={() => switchSub(s)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <p className="text-center text-sm text-faint py-8">该分类暂无推荐内容</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
          {items.map((item) => (
            <DoubanCard key={item.id} item={item} onClick={() => onPick(item.title)} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Bangumi 每日放送：星期筛选，一次拉全量无分页 */
function BangumiView({ onPick }: { onPick: (title: string) => void }) {
  const [weekday, setWeekday] = useState<number | 'all'>('all');

  const query = useQuery({
    queryKey: ['bangumi-calendar'],
    queryFn: ({ signal }) => api.bangumiCalendar(signal),
  });

  let items: DoubanItem[] = [];
  if (query.data) {
    items = weekday === 'all'
      ? query.data.days.flatMap((d) => d.items)
      : (query.data.days.find((d) => d.weekday === weekday)?.items ?? []);
  }

  return (
    <section aria-label="新番放送推荐">
      <div className="flex flex-wrap gap-1.5 mb-4">
        <ChipButton active={weekday === 'all'} onClick={() => setWeekday('all')}>
          全部
        </ChipButton>
        {WEEKDAYS.map((name, i) => (
          <ChipButton key={name} active={weekday === i + 1} onClick={() => setWeekday(i + 1)}>
            {name}
          </ChipButton>
        ))}
      </div>

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
          {items.map((item) => (
            <DoubanCard key={item.id} item={item} onClick={() => onPick(item.title)} />
          ))}
        </div>
      )}
    </section>
  );
}

const HOT_LISTS = [
  { id: 'douban_movie_weekly', label: '电影周榜' },
  { id: 'douban_tv_chinese', label: '国产剧周榜' },
  { id: 'douban_tv_global', label: '海外剧周榜' },
  { id: 'douban_show_chinese', label: '国内综艺' },
  { id: 'douban_show_global', label: '海外综艺' },
  { id: 'baidu_teleplay', label: '百度热播剧' },
];

/** 影视热榜（60s API）：豆瓣五个周榜 + 百度热播剧，chips 切换 */
function HotListView({ onPick }: { onPick: (title: string) => void }) {
  const [listId, setListId] = useState(HOT_LISTS[0].id);

  const query = useQuery({
    queryKey: ['hot-list', listId],
    queryFn: ({ signal }) => api.hotList(listId, signal),
  });

  const items = query.data?.items ?? [];

  return (
    <section aria-label="影视榜单推荐">
      {/* 移动端每行最多 3 个标签，桌面端 flex 自适应换行 */}
      <div className="grid grid-cols-3 gap-2 mb-4 md:flex md:flex-wrap md:gap-1.5">
        {HOT_LISTS.map((l) => (
          <ChipButton key={l.id} active={listId === l.id} onClick={() => setListId(l.id)}>
            {l.label}
          </ChipButton>
        ))}
      </div>

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
          {items.map((item) => (
            <DoubanCard key={item.id} item={item} onClick={() => onPick(item.title)} />
          ))}
        </div>
      )}
    </section>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
      {Array.from({ length: 16 }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />
          <div className="h-3 mt-2 rounded bg-chip animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function ChipButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn(
        'px-3.5 py-1.5 rounded-full text-sm transition-colors',
        active ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:text-content hover:bg-hover'
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TypeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn('px-3.5 py-1.5 rounded-md text-sm transition-colors', active ? 'bg-accent text-on-accent' : 'text-muted hover:text-content')}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
