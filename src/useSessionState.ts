import { useEffect, useState } from "react";

/**
 * 会话级状态：用法同 `useState`，但把值存进 `sessionStorage`。
 *
 * 解决的是「导航记忆」问题 —— 从列表进入作品详情再返回时，页面会重新挂载，
 * 筛选 / 排序 / 搜索会全部清零。这里把它们保留到本次会话结束（关闭应用即清空），
 * 既不会每次回来都从头再选一遍，也不会像长期设置那样越积越乱。
 *
 * 只承载**前端展示偏好**，不涉及任何后端数据或持久化契约。
 */
export function useSessionState<T>(key: string, initial: T) {
  const storageKey = `genzo.session.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      /* 存储不可用或内容损坏时退回初始值 */
    }
    return initial;
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* 忽略配额或隐私模式下的写入失败 */
    }
  }, [storageKey, value]);
  return [value, setValue] as const;
}
