# clean-node-modules — 设计文档

日期:2026-08-13
状态:已确认(含评审修正)

## 1. 定位

Node.js CLI 工具:递归扫描指定目录下的所有 `node_modules`,用 `ink` 全屏 TUI 展示每项的大小、闲置时间、路径(带柱状条),用户勾选后执行删除。

核心原则:**扫描准确 + 呈现清晰 + 执行可靠;删哪些由用户拍板,工具不自动删。**

## 2. CLI 接口

```
clean-node-modules [scan-root] [options]
  scan-root        扫描根目录,默认当前目录 .
  --trash          删除时移到系统废纸篓(默认硬删)
  --min-days <n>   预筛选:只显示闲置 ≥ n 天的项(默认 0,不筛选)
  --help, -h
```

不提供任何"按规则自动删除"的开关——所有删除都必须经 TUI 勾选确认。

## 3. 扫描逻辑

### 3.1 目录遍历规则

- 从 scan-root 深度优先递归,匹配名为 `node_modules` 的目录。
- **scan-root 本身豁免于忽略列表**:即使 scan-root 是隐藏目录(如 `~/.config`),也照常进入扫描。
- scan-root 不存在或不是目录:立即以明确报错退出(exit code 非 0)。
- **遇到 `node_modules` 即停止下钻**:整个目录视为一个条目,不进入其内部递归,不把其中嵌套的 `node_modules`(如 `node_modules/x/node_modules`)计为独立条目——它们的大小计入所属条目。
- 扫描与计大小阶段支持 Ctrl+C 中断:立即终止并退出,不进入 TUI、不执行任何删除。
- **默认忽略列表**(不进入):
  - `.git/`、`.Trash/`、其余隐藏目录(`.*`)
  - `*.app/` 应用包(Electron 应用内嵌 node_modules,删除会破坏应用)
  - `Library/`(macOS 系统位置)
- scan-root 为 `$HOME` 或 `/` 时,打印明确警告并要求确认后才继续。
- 权限不足的目录:跳过并计数,扫描结束提示"X 个目录因权限跳过"。

### 3.2 条目元数据

每个 `node_modules` 条目采集:

| 字段 | 说明 |
|------|------|
| 绝对路径 | 删除时使用 |
| 相对路径 | 相对 scan-root,TUI 展示用 |
| 大小 | 见 3.3 |
| 闲置时间 | 见 3.4 |
| 项目根 | 从该 node_modules 向上找最近的含 `package.json` 的父目录 |

### 3.3 大小计算

- **主路径**:对每个 `node_modules` 执行 `du -sk`(子进程,取 KB 数换算)。理由:C 实现快、正确处理硬链接(pnpm 全局 store 场景不重复计数)、不跟随符号链接。
- **条目本身是符号链接的情况**(shared-store / workspace 把 `node_modules` 做成 symlink):`du -sk` 只会计到链接自身大小,结果严重失真。处理:检测到条目为 symlink 时,在 TUI 中标记 `⤳`、跳过大小计算(仅统计链接本身大小),且**硬性禁止勾选删除、无解除途径**(删除 symlink 目标会破坏共享 store)。
- **回退路径**(du 不可用时):JS 递归遍历,但必须 (a) 不跟随 symlink,(b) 按 `(dev, ino)` 对硬链接 inode 去重,避免重复计数。
- 扫描与计大小期间显示进度(已发现条目数 / 正在处理的路径),避免长时间无反馈像卡死。进度在 TUI 启动前以普通 stdout 行输出(`Scanning... found N` / `Sizing k/N`),不内嵌 ink。

### 3.4 闲置时间(项目活跃度信号)

**不使用** `node_modules` 目录自身 mtime——它只反映最后一次 install 的时间,与项目活跃度无关(活跃项目可能几个月没重装依赖;刚 install 过的归档项目反而显得"活跃")。

按以下优先级取项目根的活跃时间(为兼容 monorepo,`.git` 与 `package.json` 均从项目根**逐级向上**查找,最多向上 10 层或到文件系统根为止):

1. 向上找到最近的 `.git` 且仓库非空 → `git -C <dir> log -1 --format=%ct`(最后提交时间)。仓库存在但零提交时视为"无 git 信号",降级到下一级。
2. 否则向上找到最近的 `package.json`,取其 mtime(与 3.2 的"项目根"是同一次向上查找,不重复实现)。
3. 兜底:`node_modules` 目录 mtime。

UI 展示换算为"N 天前"。

## 4. TUI(ink + React)

### 4.1 布局

- **每行一条目**:`[✓] ████░░  128MB  45d前  projects/foo`
  - 勾选框、大小柱状条(相对当前列表最大项的比例)、人类可读大小、闲置天数、相对路径
- **底部汇总面板**(随勾选实时更新):
  - 扫描总数 / 总大小
  - 已选数量 / 已选大小 / 预计释放空间
  - 已选占比进度条

### 4.2 交互

| 按键 | 行为 |
|------|------|
| ↑ / ↓ | 移动光标 |
| 空格 | 勾选 / 取消当前项 |
| `a` | 全选 / 全不选切换 |
| `s` | 循环切换排序:大小↓ → 闲置时间↓ → 路径↑(默认大小↓) |
| 回车 | 发起删除 |
| `q` / Ctrl+C | 安全退出,未确认的删除不执行 |

回车后进入**二次确认界面**:显示"将删除 N 项,共释放 X MB,硬删/废纸篓",回车执行、Esc 返回列表。

删除执行时逐条显示进度(当前删哪条、成功/失败),完成后回到列表,已删条目消失、汇总面板更新。

### 4.3 非 TTY 降级

stdout 不是 TTY 时(CI、管道):不进入 TUI,输出纯文本表格后退出,不允许删除。此模式下若 scan-root 为 `$HOME` 或 `/`,警告照常打印、扫描照常进行(反正不可删除,无风险)。

## 5. 删除执行

- **硬删**(默认):递归删除目录。
- **废纸篓**(`--trash`):用 `trash` npm 包移到系统废纸篓(跨平台)。
- **路径安全断言**:删除任何路径前,硬性校验 `basename(path) === 'node_modules'`,不满足则拒绝并计入失败——杜绝 bug 导致误删其他目录。
- 单条删除失败不中断:标记失败,全部执行完后汇总报告(成功 N 条释放 X MB,失败 M 条及原因)。

## 6. 架构与组件

```
src/
  cli.ts          # 入口 + commander 参数解析,编排扫描→TUI
  scanner.ts      # 目录遍历 + 忽略规则 + 权限跳过计数,产出 Entry[](不含大小)
  size.ts         # du -sk 主路径 + JS 去重回退
  activity.ts     # 闲置时间信号(git 提交 → package.json mtime → node_modules mtime)
  format.ts       # 字节→人类可读、时间→相对文案、大小→柱状条比例
  delete.ts       # 硬删 / 废纸篓 + 路径断言 + 失败收集
  ui/
    App.tsx       # 主界面,管理状态(条目、选中集合、排序、光标、删除确认)
    Row.tsx       # 单行渲染
    SummaryBar.tsx# 底部汇总面板
    Confirm.tsx   # 二次确认界面
```

各单元职责单一、接口清晰:scanner/size/activity/format/delete 均为纯逻辑、不依赖 ink,可独立单测;ui/ 只负责渲染与按键。

**数据流**:CLI 解析 → scanner 发现条目 → size/activity 填充元数据(显示进度) → --min-days 预筛 + 默认大小降序 → TUI → 勾选 → 回车二次确认 → delete 逐条执行(进度) → 刷新列表。

## 7. 错误处理

| 场景 | 行为 |
|------|------|
| scan-root 不存在/非目录 | 明确报错,非 0 退出 |
| scan-root 为 `$HOME` 或 `/` | 警告并要求确认后继续 |
| 扫描目录权限不足 | 跳过、计数,结束时提示 |
| 扫描阶段 Ctrl+C | 立即终止退出,不进入 TUI |
| `du` 不可用 | 自动回退 JS 计算 |
| 条目为 symlink | 标记 `⤳`,跳过计大小,禁止勾选删除 |
| git 不可用/非 git 项目/零提交仓库 | activity 降级到下一信号 |
| 删除路径断言失败 | 拒绝删除,计入失败汇总 |
| 单条删除失败(权限/占用) | 不中断,结束汇总报告 |
| Ctrl+C / q(TUI 内) | 安全退出,未确认删除不执行 |

## 8. 测试(vitest)

- **scanner**:fixture 目录树——嵌套 node_modules 不产生独立条目、`.git`/隐藏目录/`.app` 被跳过、scan-root 为隐藏目录时豁免忽略规则、权限不足目录计数、scan-root 不存在时非 0 退出。
- **size**:回退路径的硬链接去重(两个硬链接文件只计一次)、symlink 不跟随;条目本身是 symlink 时跳过计大小并标记。
- **activity**:git 项目取提交时间、零提交仓库降级、无 git 取 package.json mtime、monorepo 向上找 `.git`、兜底 node_modules mtime。
- **format**:边界值——0 字节、GB 级、刚安装(0 天)、1 年前。
- **delete**:硬删后目录不存在;路径断言拒绝非 node_modules 路径;单条失败不中断后续。
- **TUI**:`ink-testing-library` 测渲染、勾选/全选/排序按键、确认流。

## 9. 技术栈

TypeScript + Node 22 / `commander` / `ink` + `react` / `trash` / `vitest` + `ink-testing-library`

## 10. 明确不做(YAGNI)

- 自动规则删除(无 --auto、无定时清理)
- node_modules 内部瘦身(删文档/测试/未引用依赖)——后续版本另行设计
- 缓存清理(npm/pnpm 全局 store、cache)
- 配置文件 / 项目根列表记忆
- Windows 专属优化(du 不可用时走 JS 回退即可)
