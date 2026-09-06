import type { TabType } from './TabBar';

const TABS_WITH_HEADER_RIGHT = new Set<TabType>(['sessions', 'inbox', 'dootask', 'settings']);

export function shouldProvideMainHeaderRight(activeTab: TabType): boolean {
    return TABS_WITH_HEADER_RIGHT.has(activeTab);
}
