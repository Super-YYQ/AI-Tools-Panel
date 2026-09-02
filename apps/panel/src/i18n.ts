/**
 * P2-UI-07: i18n foundation — UI strings live in key/value dictionaries so a
 * second locale can be added without touching component code (DECISIONS:
 * 中文先行，保留 i18n 结构). Language is fixed to zh-CN in v0.1.1.
 */
export type Locale = 'zh-CN';

const STRINGS: Record<Locale, Record<string, string>> = {
  'zh-CN': {
    'app.title': 'AI Tools Panel',
    'nav.overview': '总览',
    'nav.installed': '已安装',
    'nav.catalog': '目录库',
    'nav.rules': '规则',
    'nav.changes': '变更',
    'nav.settings': '设置',
    'common.loading': '加载中…',
    'common.empty': '没有匹配当前筛选条件的资产。请调整筛选条件。',
    'common.retry': '重试',
    'scan.start': '开始扫描',
    'scan.running': '扫描中…',
    'scan.cancel': '取消扫描',
    'scan.cancelling': '正在取消…',
    'scan.never': '尚未扫描或历史已清除——点击“开始扫描”查看本机与当前仓库的配置资产。',
    'repo.recognized': '仓库已识别',
    'repo.notGit': '非 Git 仓库',
    'repo.connecting': '连接中…',
    // APP-002: an actionable diagnosis, not just a bare label.
    'repo.notGit.title': '当前目录不是 Git 仓库',
    'repo.notGit.diagnosis': 'AI Tools Panel 以 Git 根识别项目。扫描仍可运行，但“目录库/变更”等基于仓库的功能将不可用。',
    'repo.notGit.fix': '修复方式：在当前目录执行 git init，或切换到已有的 Git 仓库目录后重新启动本服务。',
    'offline.banner': '无法连接本机服务（离线或服务未运行）：{message}',
    'overview.heading': '总览',
    'overview.providers': 'Provider',
    'overview.assets': '发现资产',
    'overview.diagnostics': '诊断',
    'overview.statusDist': '状态分布',
    'settings.heading': '设置与来源',
    'settings.gitAvailable': 'Git 可用',
    'settings.yes': '是',
    'settings.no': '否',
    'settings.repoState': '仓库状态',
    'settings.aiOff': 'AI 校准：默认关闭（未配置 Provider 时禁用）',
    'settings.loopback': '服务仅绑定本机 loopback 地址；所有 API 需要会话',
    'settings.privacy': '数据与隐私',
    'settings.dbPath': '本机数据库（gitignored）：{path}',
    'settings.retention': '保留的扫描运行数：{runs}（默认最多 10 次成功/部分成功，30 天）',
    'settings.aiEnabled': 'AI 是否开启',
    'settings.clearHistory': '清除扫描历史',
    'settings.clearProposals': '清除 AI Proposal',
    'settings.sourcedLock': 'sources.lock',
    'settings.lockNote': '锁文件由确定性 resolver 更新；AI 不写锁文件。',
    'changes.heading': '变更',
    'changes.branch': '分支',
    'changes.none': '工作树无变更。面板只展示文件，commit/push 需要你自己执行（GIT-004）。',
    'changes.diffHeading': '完整 diff（仅本应用目标文件：catalog/、sources.lock.yaml、snapshots/）',
    'changes.noDiff': '没有可显示的 diff。',
  },
};

let current: Locale = 'zh-CN';

export function t(key: string, params?: Record<string, string | number>): string {
  const template = STRINGS[current][key] ?? key;
  if (!params) return template;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), template);
}
