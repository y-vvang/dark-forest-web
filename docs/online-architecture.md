# 在线模式架构（模式 b）

2026-10-13/14 实施轮。规格源头：`C:\Users\wangy\.claude\plans\shiny-seeking-horizon.md`
（实施计划，副本存 `.superpowers/sdd/shiny-seeking-horizon/plan.md`）；UX 规格 =
DESIGN.md §10.11/§10.11a/§13。本文是**在线模式的机制文档**——单机栈
（engine/opponents/solo）零改动复用，`src/lib/solo/` 详见 game-mechanics.md。

## 0. 总览

- **无账号**：服务端签发 128-bit 随机 token（`localStorage["df.online.token"]`，
  重连恢复）。Sybil 多席为无账号设计的固有接受面，不设防。
- **单例共享世界**：全局指针键 `df:online:idx` → 当前世界。无世界时首位排队者
  播种；t≥250 或热寂 → `ended`；下一位 join 者 / 仍在队的 token 轮询 → 滚动
  播种新世界（旧队列未入座者携入，旧记录删除）。
- **四臂轮替**：初始 4 席 = a/b/c/d 各一；此后未被玩家占据的内生出生按
  a→b→c→d 循环（ε=0.05 stage_b 口径，与单人对手同流约定 seedOf(S,"model:"+arm)）。
- **槽复用（对实验的明示偏离，用户 2026-10-14"取消 36 上限"）**：36 未生槽耗尽后取
  最靠前已死槽重生（`cfg.slotReuse`——仅 `ONLINE_ENV_CONFIG` 开启；缺省世界保 env2_v24
  硬上限，金标准轨迹实证暴力世界会耗尽 36 槽，缺省开启即破坏奇偶）。复用 = 恒星位置
  不动 + 零额外 RNG + 该槽认知态全清（含 pending_reveal/counter 引用条目）；感知层
  ⑥ 死者缓存随弃（复用后重探测产生全新 contact）。
- **玩家占位**：排队 FIFO——每次内生出生弹队首；未弹出的留在队。

## 1. 时序模型（tick-in-flight；DESIGN.md §13 的实现语义）

人类重选需要真实时间跨度 ⇒ beginTick 与 resolve 横跨整个窗口：

```
窗口 k = [T(k-1), T(k))，刻 k 在飞行中：
  T(k-1) 边界：resolve 刻 k-1 → S(k-1)（玩家即刻可见）；
               beginTick(a_k)——a_k = 上一窗口人类提交（缺=SILENT）∪ AI 暂存；
               本刻入侵受害者即刻收到警报（模态 + CSS 倒计时条 = 窗口剩余）。
  窗口内：受害者重选（5|6|-1，截止 T(k)）；所有人提交 a(k+1)（后写覆盖）。
  T(k) 边界：resolve(re_k ∘ a_k) → S(k)；循环。
```

- **AI 决策平价（本架构的关键裁定）**：AI 第 k+1 刻的一选动作在 T(k-1) 边界
  （resolve k-1 之后、本刻警报并入的快照上）计算并暂存一窗——**与人类提交
  窗口所见同一基线**。实验的"全体同状态行动"前提在在线化后以"人人 info→effect
  都隔两窗"保形；AI 无 +1 刻情报优势。AI 受害者重选在 beginTick 后立即算
  （同 SoloMatch.runTick 的 stage_b 口径）。
- **无快进**（用户 2026-10-14：AI 一等公民，每刻恒满 20s——原"全员提前提交则提前
  结算"条款被推翻；sprintDue 仅剩"零存活人类且队列空"的无观察者清场分支）。
- **追赶**：无流量时世界静止；任一请求发现 `now ≥ 截止` → 结算锚**原截止**
  （窗口墙钟链不漂移）。**先剪除后结算**：陈旧排队者在出生竞速前出局。
- **无人存活**：队列非空 → 20s 节奏（等出生）；队列空 → 惰性冲刺至终局。

## 2. 持久化 = 确定性重演

存储只存**人类输入**；AI 动作/引擎态/视图/日志永不落盘——每次载入全量重演
（`src/lib/online/driver.ts: replay`，AI 走种子化流 ⇒ 决定性成立，与金标准
回放同构）。重演是记录的纯函数（无墙钟）。

```ts
interface WorldRecord {
    v: number;                       // CAS 版本（写入方置 expected+1）
    worldId, seed, status, tickSeconds, createdAtMs, endedAtMs;
    ticks: TickEntry[];               // ticks[i] 覆盖窗口 i+1
    queue: string[];                 // 加入序花名册（已入座者永留——剪除跳过）
    joinedAt: Record<string, number>; // token → 加入时刻（当时的出生数）——出生序 n
                                     // 只配 joinedAt < n 的队首：加入时刻入档使全量重演
                                     // 与活期 FIFO 同构（防中途加入者幻影配对到早期席位）
    seats: Record<string, number>;   // token → 出生槽位（配对档案；活性由重演推导）
}
interface TickEntry {                // 窗口条目
    beganAtMs; endedAtMs | null;     // null = 开窗中
    nextActions: Record<string, [action, target]>; // 本窗收集的下一刻人类提交
    rechoices: Record<string, number>;             // 本刻受害者重选（-1 = 保持原动作）
}
```

- **花名册 + 配对档案 + 加入时刻**：重演按（加入时刻受限的）花名册顺序弹出复现
  token↔出生配对（出生序 n 只配 joinedAt < n 的队首）；`seats`
  供心跳剪除跳过已入座者（服务端每次推进把新配对写入档案；漂移即抛）。
- 记录目标 ≤64KB（超限 console.warn；36 人类 × 250 刻最坏 ~108KB 不现实）。

## 3. 存储（Upstash Redis，键布局）

| 键 | 内容 | 读写 |
|---|---|---|
| `df:online:idx` | 指针 + 版本（~40B） | **轮询仅此一次微型 GET**（带宽预算核心） |
| `df:online:rec:<id>` | 世界记录单 JSON | 版本变更/冷实例才全量读 |
| `df:online:lock:world` | 推进锁（SET NX PX 5s；EVAL compare-and-del 释放） | 全局一把锁覆盖 spawn/advance/rollover |
| `df:online:hb:<token>` | 排队心跳（EX 120s 防孤儿键） | 未入座者轮询时写；入座者只读 |

- **心跳独立键**：入记录则每次轮询写全记录 + 撞版本 + 缓存风暴（计划级裁定）。
- **实例缓存**（`hub.ts`）：`{worldId → (版本, 记录, 重演态)}`，idx 版本命中即零
  记录读；多实例靠确定性重演 + idx 版本收敛。
- **CAS**（`upstash-store.ts`）：EVAL 单命令原子（REST 无原生 compare-and-set）；
  锁为主干序列化，版本校验为锁过期纵深。写入失败（陈旧写者）即抛。
- **env**：`UPSTASH_REDIS_REST_URL/TOKEN`（`.env.local` 与 Vercel 均已配）；
  dev 无 env → 内存预览；产线缺 env → 显式抛错。
- **残留键**：锁/心跳自过期；`idx`/`rec` 无 TTL 为**设计内**（serverless 世界
  跨实例/跨部署持久——重启后重演+墙钟追赶自洽，旧世界跑到 t=250 即滚动换新）。
  dev 卫生命令：`bun run purge:online`（清 df:online:*——用户 2026-10-28 裁定
  以手动 npm script 实现，不做运行时清理，生产永不清）。

## 4. 服务编排（`service.ts`）

每个变更操作 = 持锁 → 载入（缓存或全量读+重演）→ 变更 → advance（剪除 →
快进/追赶环 → 新配对入档）→ CAS 写回 → 响应。轮询 getState 锁忙（waitMs=0）
即服务当前缓存态（最终一致，下次追上）。变更类等锁 ≤2.5s（提交须赶在刻截止前）。

**线协议**（`types.ts`；4 个 route 均动态 + no-store）：

- `POST /api/online/queue {token?}` → 发 token + 当前态（幂等重入；终局世界的
  join = 滚动播种携入）。
- `DELETE /api/online/queue?token=` → 离队（仅产前；已入座 no-op）。
- `GET /api/online/state?token=&since=` → `lobby-public`（无 token）| `lobby`
  （位次+世界读数+worldEnded）| `console`（过滤视图 + **日志增量** + submission +
  `Timing{serverNowMs, tickEndsAtMs, remainingSeconds, tick, worldVersion}`）。
- `POST /api/online/action {token, tick, action, target}` / `POST …/rechoice
  {token, tick, action: 5|6|-1}`——`tick` = 防陈旧窗口号（错 ⇒ 409 stale-tick）；
  校验尽力而为（动作/目标/BD 门），**env stageSanitize 为最终权威**；提交响应
  不带日志增量（事件由下一次轮询送达）。

**感知过滤服务端化**：`solo/view.ts`（纯 TS）经 `tracker-host.ts` 单点适配
（as unknown as SoloMatch 收口一处，solo 层零改动）在服务端为每席跑
ViewTracker——客户端只拿各自过滤视图（防作弊）。每 resolve 恰一次 update()
（契约）；**日志条数游标**（`since` = 客户端持有数；log.invaded 与同刻结算
事件共享刻号，按刻切片会丢事件）；**出生锚定**（首次投递从 birthSelf 起，
预产 waitBirth/born 噪声不进控制台）；死亡席视图冻结（无旁观）。

## 5. 客户端（`use-online-world.ts` + `/online`）

- **自动入队**：挂载即带 token 调 POST /queue（"排队即入场"）。
- 轮询 = 递归 setTimeout：控制台 2s / 大厅 5s / 入侵模态 1.5s / 终局期 5s；
  `document.hidden` 暂停（隐藏 = AFK：排队者被剪、出生席 SILENT——生存压力真实）。
- 404 unknown-token：缓存态有终局 → 保留终局遮罩等手动"再排一次"；否则自动重排。
- **无执行钮（2026-10-14 裁定）：选择即提交 + 刻末安全网**——姿态/无目标一次性
  点击即 POST；目标动作选中即 POST；deadline−2s 安全网自动续交非静默姿态（silent 不
  发包——服务端缺省即静默）。回车 = 显式重复上刻（一键重申）。
  **每刻恰一次**（刻号闸，走查回归 2026-10-28）：安全网决策走纯函数
  `safetyNetDelay`（`firedTick` 闸 + 稳定 effect deps）——无闸时 effect 每渲染
  重排 × `setTimeout(0)` × fire-and-forget POST 成无界请求风暴（dev HTTP/1.1 下
  连接池耗尽 ERR_INSUFFICIENT_RESOURCES、服务端 lock busy 503 刷屏；本地产线
  皆中招）。失败不重试：刻照常到点结算（未提交=静默），下一窗重新武装。
  服务端锁竞争超限语义化为 **503 `server-busy`**（裸 500 与真缺陷不可辨）。
- **每命一新 token**：死席 join 由服务端换发新 token 再排队（旧 token 留在旧世界档案，
  重演安全）；多次进出世界 = 每次重新排队（用户 2026-10-14）。
- 入侵倒计时按 `(tick, invader)` 键冻结——防 1.5s 轮询重启 CSS 倒计时条；
  模态"取消" = 本地关闭（截止保原即环境语义；-1 协议保留兼容）。

## 6. 已接受的边界（明示取舍）

无旁观（死亡即冻结）；隐藏标签页 = AFK；Sybil 多席不设防；滚动删旧记录后
刷新丢终局遮罩（客户端缓存兜底，unknown-token 自动重排）；bot 灌队可搅动记录
（免费档接受）；追赶期 AI 战争尸体回池使出生永不枯竭——排队者可能在追赶中
被出生（FIFO 正确行为）；"仍在队的活跃 token 由其轮询触发滚动"路径与 join 共用
spawn(carried)，服务级确定性构造不可得，以 join 路径覆盖；E2E 必须从干净世界
起跑并模拟真实心跳（两轮"失败"皆为正确语义：剪除与全员谓词）。

## 7. 模块地图与测试

`src/lib/online/`：config / types / record（纯记录操作）/ ai（服务端权重单例，
构建期内联 public/models/*.json）/ tracker-host / driver（重演+窗口机器：
settleCurrent、fastForwardDue、ensureRuntime）/ hub（实例缓存+锁）/ store
（接口+getStore）/ memory-store / upstash-store / http（解析+错误映射）/
service（编排）/ server（单例装配）/ use-online-world（客户端 hook）；
`src/app/api/online/{queue,state,action,rechoice}/route.ts`（薄处理器）。

测试（bun，共 53 用例：record 8 + memory-store 8 + http 5 + ai 1 +
tracker-host 2 + driver 11 + window 6 + service 12）——伪时钟 + ScriptedRng +
MemoryStore 注入，零网络零墙钟；UpstashStore 与路由按计划走真实实例手动
走查（M4 门 + M5 双人 E2E 已记录于台账）。契约：MemoryStore 单测钉住接口语义。
