# dsh-shot 设计记录（DESIGN）

> 这份文件是**实现与决策记录**：为什么这么做、踩过哪些坑、验证脚本怎么跑。
> 面向使用者的安装与用法在 [README.md](./README.md)。

---

# dsh-shot — 输入框截图控件（框选 + 标注 / 可隐藏本窗口）

给 DeepSeek Harness 桌面端输入框加一个相机按钮：点开有两项

| 菜单项 | 行为 |
|---|---|
| **直接截图** | 立刻抓整个虚拟屏幕（本窗口保持可见，挡住的就挡着） |
| **隐藏本窗口截图** | 先把 DSH 窗口藏起来 → 抓屏 → 把窗口**原样**（含"原本是最小化"）恢复 |

两种情况抓完都会弹出**窗口内**的框选 + 标注浮层（**不申请全屏**，窗口保持原样）：
拖框选区 → 选区外整片压暗、**只有框选区是亮的** → 在框内标注 → 回车或「完成」→
图片以**图片附件**形式进入当前会话的输入框草稿（可预览、可加文字、回车才发送）。

标注工具：

| 工具 | 用法 |
|---|---|
| **红框**（矩形） | 在框内拖一个矩形 |
| **箭头** | 在框内拖一条箭头，头翼自动按方向画 |
| **文字 T** | 在框内点一下落点 → 出现内联输入框 → 输入后**回车**确认（Esc 取消）。文字带半透明暗色衬底 + 你选的颜色，任何底色上都看得清。**双击已有文字可改**（原文字带进输入框并全选） |
| **8 色** | 红橙黄绿青蓝紫白，逐条标注独立着色 |
| 撤销 / 重选 | 撤销上一条标注 / 回到只框选的状态 |

**框选之后还能改选区**（框选的刚需，别退化成一次性操作）：

| 操作 | 效果 |
|---|---|
| 拖**八个手柄**（四角 + 四边中点，白色小方块） | 按那个方向缩放；光标变成对应的缩放箭头 |
| 在**框内拖动** | 整体平移（光标 `move`），大小不变 |
| **方向键** | 逐像素微调位置；按住 **Shift** 每次 10 像素 |
| 「重选」/ 右键 | 退回「没有选区」的初始状态，重新框 |

缩放与移动都夹在画面范围内，最小边 16 px——拖不出图外，也拖不没。

Esc / 右键 = 逐级回退（撤标注 → 重选 → 退出）。

> **为什么不做全屏**：用户明确要求窗口不要动。代价是浮层只能用窗口那块地方——所以它把**整个截图放大到
> 铺满窗口**显示（截图像素仍是全屏原生分辨率，导出的是**你框选的那块原始像素**）。

---

## 装了哪些东西（全部在 `C:\Users\north\.dsh\plugins\dsh-shot\`）

```
package.json          插件清单：dsh.bundle.patch + dsh.client（platform web, inject ui-slots/ui-conversation）
cordis.patch.yml      bundle 层：insert 一行 id/name = dsh-shot
lib/index.js          宿主半：/api/dsh-shot/{status,pending,image,wait,capture} 五条精确路由
lib/client.js         浏览器半：输入框按钮 + 菜单 + 框选/标注浮层 + 附件草稿投递（无构建步骤，手写 lazy-CJS）
scripts/capture.ps1   截图器：Win32 找窗口 → 可选隐藏 → CopyFromScreen → 恢复 → 输出 JSON
```

profile 侧接线（`C:\Users\north\.dsh\profiles\desktop\`）：

- `package.json` → `dependencies.dsh-shot = file:C:/Users/north/.dsh/plugins/dsh-shot`，并追加进 `dsh.profile.bundles`
- `node_modules/dsh-shot` → **junction** 指回上面那个目录（本 profile 的 `nodeLinker: hoisted`，pnpm 默认会**复制**一份；改成 junction 才不会出现两份源码不同步）。**每次 `pnpm install` 后建议复查这个 junction 还在不在。**

## 为什么这么实现（抄了谁、补了什么）

| 部分 | 来源 | 说明 |
|---|---|---|
| 输入框控件怎么加 | `dsh-appshots`、`dsh-plugin-appshot` 实测代码 | `ctx.slots.inject('conversation.input.left')` + `ctx.slots.register({name,id,order,label}, 组件)` |
| 图片怎么进草稿 | 同上 | `conversation.createDrafts(sessionId,[file])` → `conversation.input.shell(sessionId).addAttachments(ids)`；失败调 `releaseDraftAttachments` |
| 宿主路由怎么写 | `@max-null/dsh-capture` | `ctx.connection.fetch.register({path,methods,requestBody,fetch})`，路径必须 `/api/<单段>`，**参数只能走 query**（路径按 pathname 精确匹配） |
| 截图怎么做 | `@paicat1/dsh-screenshot` 的思路（PowerShell `CopyFromScreen`、`SetProcessDPIAware`） | 自己重写：单进程内完成 隐藏→抓屏→恢复 |
| **隐藏本窗口** | 四家都没有（`dsh-capture` 只在它自家 Electron 壳里有） | 本项目新增：`ShowWindow(SW_HIDE)` + `GetWindowPlacement`/`SetWindowPlacement` 原样还原 |
| 框选 + 标注 | `dsh-capture` 纯 DSH 引擎的思路（抓帧→画布浮层） | 自己重写：单画布重绘，`compose()` 同时用于屏幕预览与导出合成 |

## 关键设计决定（别改坏）

1. **截图在「选区域」之前发生。** 隐藏窗口时必须先抓屏（窗口藏起来才能露出背后的内容），所以顺序是
   抓帧 → 浏览器里框选/标注 → 导出裁剪后的 PNG。想成"先框选再抓屏"就必须自己写原生浮层（老 desktop-shot
   那套 PowerShell+C# 浮层），复杂度高一个量级，且纯手机远程用不了。
2. **隐藏→抓屏→恢复全在一个 PowerShell 子进程里**（`capture.ps1`），恢复在 `finally` 里；宿主侧另有
   25 秒看门狗，超时会杀掉子进程再跑一次 `-Mode restore`。任何一条路径失败都不会把窗口留在隐藏状态。
3. **`SetWindowPlacement` 而不是 `ShowWindow(SW_SHOW)`**：后者对**最小化**窗口只等于"取消隐藏"，窗口仍是最小化的。
   这个坑在开发中真踩到过（把用户的 DSH 窗口搞成最小化）。
4. **窗口识别两条独立证据**：进程可执行名（`DeepSeek Harness`）**或**窗口标题含 `DeepSeek Harness`。
   因为跨进程读 `MainModule` 可能被拒（那就只剩裸进程名，可能对不上）。识别不出来时**拒绝隐藏并报错**，
   绝不猜一个窗口去动它。
5. **按父进程链找窗口时必须加「进程名就是 DSH」这道闸**（`IsShellPid`）。开发中实测：只按"这个进程有没有大窗口"
   判断时，锚点链会走到启动应用的终端/编辑器，于是**把 PowerShell 控制台窗口当成了 DSH 窗口**。现在只有
   可执行名属于 shell 的那个进程才能提供待隐藏的窗口，否则继续往上走。
6. **不申请全屏**（用户要求）。浮层铺满窗口，遮罩由一层**缓存画布**提供：整块压暗后用
   `destination-out` 把选区抠回全亮（`destination-over` 再补原图），所以「只有选区是亮的」是一条绘制规则。
   缓存只在「帧或选区变了」时重建——否则每次移动/缩放都要重绘 2560×1440 两遍，拖起来会闪。
7. **浮层的键盘监听挂在冒泡阶段，文字输入框在捕获阶段拦事件。** 最初把浮层的 `keydown` 挂在
   window **捕获**阶段，结果在文字框里按回车会**先把整个浮层「完成」掉**（window 在最上层，捕获阶段永远先跑，
   子元素再 `stopImmediatePropagation` 也来不及）。现在：浮层用冒泡、输入框用捕获。
8. **「当前会话」不能读 `sessions.list.getSnapshot().current`**——那个字段在这版里**永远是 `null`**（实测：
   开着对话也是 null）。曾经因此**每张截图都新建一个对话**。正确来源在 UI 层，三个地方一致：
   `uiSession.mainRetainId` → `uiWorkspace.selection.getSnapshot().sessionId` → `uiWorkspace.mainReference.sessionId`
   （`uiSession.current` 是「绑定源」，拿不到纯 id）。代码里是 `currentSessionIdOf()`，三条依次读、容错。
9. **窗口查找分「要不要必须可见」**：捕获目标必须可见（最小化的 107×19 图标不该被当成"这个窗口"），
   但**隐藏**一个最小化窗口既安全又必要——所以 `ForPid(pid, visibleOnly)`，隐藏路径不要求可见。
   实测：窗口最小化时隐藏路径照样工作，并把它**还原成最小化之前的大小**（`SetWindowPlacement`）。
10. **绝不用输入框的 info 通知条报告成功。** `shell.notify('info', …)` 那条消息在 DSH 里是**常驻**的：
    `InputBar` 只把 `notice.level === 'error'` 转成会自己消失的 toast，`info` 直接渲染成一条
    `role="status"` 条，**没有关闭按钮、没有超时**，而且整个客户端**没有任何一处 `notices.set(null)`**
    ——只有下一条 notice 才会覆盖它。开发中真的踩了：截图后那条「截图已放入输入框」会一直挂在输入框上方。
    现在成功提示走插件自己的 `toast()`（3.6 秒后自删、`pointer-events:none`、不占输入框位置），
    **真正的确认是那张附件缩略图**。`notify('error', …)` 仍然保留——那条会变成自动消失的 toast，是对的通道。
11. **亮斑的真因：画布上出现了「透明区」，而透明区露出的是真实窗口——不是黑色。** 症状是「浮层里多出
    一块和选区一样的图（没有手柄）」，位置还会随改动漂移。定案的证据是：选区画好后**遍历整块画布检查
    alpha**，采样里有非 255 的像素，而那块区域显示的正是 **DSH 自己的侧边栏**（新会话/插件/工作区…）。
    「画布没画到」不等于黑，而是**看穿到下面的真窗口**，所以它长得像"又画了一遍选区"。
    修法：可见层**先铺满整块画布**（用压暗的缓冲区按 cover 拉满，保证每个像素都被写到），
    再在选区裁剪里补回原亮度；同时显式重置 globalAlpha / globalCompositeOperation，结尾复位 transform。
    验证只需要一条：**画完整幅统计 alpha，必须全为 255**（实测 0/9427 透明）。
    ——以上是最终定案。下面两条是过程中查到的**真 bug**，修复都保留：
    ① `compose()` 不能继承缩放变换。 症状是「浮层左上角多出一块亮斑，大小跟我框选大小同步，
    而且没有那圈调整手柄」。定位过程（值得复用）：
    - 先用**最小化窗口**判定归属：「跟着窗口消失」→ 是我的浮层；
    - 再让探针**导出预览画布本身**（`canvas.toDataURL()`），并与页面截图逐点对比——两者完全一致，
      说明「我画的」就是「屏幕显示的」，问题在 `paint()` 里；
    - 最后把绘制**拆成带记号的步骤**（`paintTrace` 缝隙），每步读同一像素：第 3 步还是压暗值、
      **第 4 步（只调用了 `compose`）突然变亮**，而且 `marks` 是空的 → 只能是 `compose` 自己。
    根因：`compose()` 本意是**1:1 位图坐标**绘制，但调用它的上下文已经被 `setTransform(scale,…)` 缩过，
    于是 `drawImage(bitmap, 0, 0)` **又被缩了一次**，原图被画到了错误的位置和比例
    （`896×0.5≈453`、`504×0.5≈255`，正好等于选区——这就是用户说的「大小跟着选区变」）。
    修法有两步，缺一不可：`compose()` 先 `setTransform(1,0,0,1,0,0)` 归一化；
    **并且把「画原图」抽成一个只做一件事的 `drawFrame(target)`**，由调用方负责摆好坐标变换。
    **教训：任何「按 1:1 像素」绘制的函数，进门第一件事就是把变换归一化，不要依赖调用方的上下文状态；
    一个函数只干一件事，坐标变换由调用方显式给出。**
12. **可见层必须自己画一遍，不能「镜像」工作层。** 之前可见层是 `drawImage(screenCanvas)` 的副本——
    副本一旦在某个环节丢了压暗，整幅就变亮。现在 `paint(pctx)` 直接画可见层，两层同一个配方。
    另外**遮罩必须最后画**：曾经用 `destination-over` 先铺遮罩、再垫原图，结果是原图盖住遮罩。
13. **隐藏截图要等窗口真的从合成器消失。** 固定睡 120ms 不够：实测抓到的截图**顶部有一条贯穿整个宽度的
    白色带**（窗口自己的白色区域，桌面上没有这种东西）。现在改成：等 `IsWindowVisible` 变假（上限 1.5s）
    再多等一帧。
14. **最小化的窗口也要能被隐藏。** `Plausible()` 原本要求窗口面积 ≥ 200×150，而最小化的窗口实测只有
    **107×19**——于是「隐藏本窗口截图」在窗口最小化时报「找不到要隐藏的 DSH 窗口」。现在 `IsIconic()`
    的窗口直接放行：最小化本身就是「这就是目标窗口」的强证据。
15. **cover 的取舍**：画布尺寸 = 窗口尺寸、画面放大到铺满（`Math.max`）。用「装得下」（`Math.min`）会在
    上下或左右留出没画到的带子，**露出真实桌面**（实测：1280×820 窗口得到 1280×720 画布、贴在 y=50）。
    代价是截图比例与窗口不一致时会裁掉少量边缘；导出 PNG 仍是选区原始像素，不受影响。
16. **偶发：`capture.ps1` 极小概率返回一张几乎空白的图**（20KB，正常应为 3–6MB）。表现为「截出来一片黑」。
    已观测到 3 次，重跑即正常；尚未加自动重试。

## 验证方式

宿主半（真截图，不 mock）：

```
node "F:\desktop\project 2\dsh-screenshot-research\test-host.mjs"          # 直接截图，26 项
node "F:\desktop\project 2\dsh-screenshot-research\test-host.mjs" --hide   # 隐藏窗口路径
```

客户端半与界面（无头 Edge，独立临时 profile，不碰用户浏览器；自签凭据库 cookie 登录）：

```
node "F:\desktop\project 2\dsh-screenshot-research\test-client.mjs"              # 假 DOM 离线跑客户端半，40 项
node "F:\desktop\project 2\dsh-screenshot-research\ui-probe.mjs" --shot out.png   # 看界面 / 读 __DSH_BOOT__
node "F:\desktop\project 2\dsh-screenshot-research\deliver-probe.mjs"             # 直连 __dshShot.deliver() 验附件投递
node "F:\desktop\project 2\dsh-screenshot-research\e2e-shot.mjs"                  # 全流程（见下）
node "F:\desktop\project 2\dsh-screenshot-research\e2e-shot.mjs" --hide           # 同上，走隐藏窗口
node "F:\desktop\project 2\dsh-screenshot-research\e2e-shot.mjs" --viewport 2560x1440 --no-confirm
                                                                                  # 模拟「窗口已全屏」时测浮层缩放/坐标
```

`e2e-shot.mjs` 逐步断言（约 37 项）：按钮存在 → 侧边栏开一个真实会话 → 读到一个当前会话 id →
菜单两项 → 浮层出现且画布带全屏帧 → **未申请全屏**且浮层覆盖整窗 → **未选区被压暗** →
**浮层把整屏截图放大到铺满窗口（cover）**（画布尺寸 = 窗口尺寸）→
拖框 → 工具条（红框/箭头/文字 T + 8 色 + 撤销/重选/完成）→ **拖角手柄放大** → **框内拖动平移（大小不变）** →
**方向键微调** → 画箭头 → 文字工具落点输入并回车提交 → 点「完成」→ 输入框里出现图片附件 →
**交付的 PNG 尺寸等于调整后的选区**（读浮层的 `__dshShotState`，不靠猜像素）→
**没有新建会话、还在同一个会话里** → **`role="status"` 里找不到常驻提示**（同时验证临时 toast 确实出现了）
→ 无未捕获异常 / 无 console error。

**客户端为此留了两个调试接缝**（都不影响界面）：
- `apply()` 把控制器挂到 `window.__dshShot`（卸载时清理）→ `deliver-probe.mjs` 直接调
  `window.__dshShot.deliver(blob, w, h)` 把「附件投递」与「浮层拖拽」分开测；
- 浮层容器上有只读属性 `__dshShotState`，返回 `{selection, marks, tool, color}`，
  测试直接读真实选区数据（**别用「亮像素反推选区」**——截下来的游戏画面本身就有亮像素，会把整屏算进去，
  我在这上面白绕过一圈）。
开发中正是靠它定位到「`sessions.create` 与导航被塞进同一个 catch」这个 bug 的。

实测数据（2026-10-04，2560×1440 双屏拼合）：
- 采集脚本整体 **约 650 ms**（分解：PowerShell 启动 + 程序集 91 ms、窗口识别 ~200 ms、CopyFromScreen 54 ms、PNG 编码 215 ms）
  —— 最初是 **2912 ms**，瓶颈在窗口识别：`Process.MainModule.FileName` 为了拿进程名要读整个模块表，对满屏候选窗口逐个调用极贵。
  改用 Win32 `QueryFullProcessImageNameW`（`PROCESS_QUERY_LIMITED_INFORMATION`）后降到 ~650 ms，顺带对提权窗口也能读到名字。
- 隐藏窗口路径 **约 1.1 s**（含 400 ms 沉降）。
- 界面里从点菜单到浮层出现：**直接截图 ~1.0 s、隐藏窗口 ~1.5 s**（优化前是 3.5 s）。
- 端到端（点菜单 → 浮层 → 拖框 → 缩放 → 移动 → 标注 → 完成 → 附件出现在输入框）实测 **全绿**，
  直接截图 / 隐藏窗口 / 大视口三条路线各约 30 项断言。
- 附件落地后输入框上方会出现一行提示：`截图已放入输入框（W×H）`，下面就是那张图的缩略图；
  **图片落在你当前打开的那个对话里**（这一条有专门的回归断言：截图前后会话数与当前会话 id 都不许变）。

## 客户端 bundle 的加载与缓存（排查界面不更新时先看这段）

- 客户端半由服务端按 `exports["./client"]` 现读文件提供，URL 是**组合式**的：
  `plugins/??dsh-shot/client.js&rev=<rev>`。单独的 `plugins/dsh-shot/client.js` 是 **404**（那是组合路由的保留形态）。
- `rev` 在**启动时**按文件内容算一次，写进首页 HTML 的 `window.__DSH_BOOT__`。所以：
  - 改 `lib/client.js` 后**必须重启应用**（或让服务重算清单）才会生效；刷新页面没用——URL 没变，浏览器用缓存。
  - 改 `cordis.patch.yml` / `package.json` 同样要重启（清单只在启动时生成）。
  - `lib/index.js`（宿主半）改完也要重启：插件是启动时挂载的。

## 已知边界

- **仅 Windows**（PowerShell + Win32）。
- 捕获的是**整个虚拟屏幕**（全部显示器拼起来的坐标空间），浮层把它**放大到铺满窗口**再显示（cover，
   `Math.max`），多出的边缘裁掉。两条硬要求：① 画布尺寸必须等于**窗口尺寸**——用「装得下」会在上下
   （或左右）留出没画到的带子，**露出真实桌面**（就是用户报的「左上角亮了一块 / 像画中画」）；
   ② 画布不能是 2560×1440 位图尺寸（大画布在合成器里不被完整重绘，会留过期贴图）。
   绘制坐标仍全部是位图坐标，靠 `render()` 里的变换映射到画布上。
- 浮层里框选的范围受**窗口大小**限制（因为不放大窗口）；截图像素仍是全屏原生分辨率，导出的是选区原始像素。
  cover 会裁掉与窗口比例不符的那部分边缘（截图 1.78 铺进较方的窗口时，上下或左右少一点）。
- 选区手柄在浮层里约 11 CSS 像素，窗口/缩放变化后会按比例换算，始终好点。
- 隐藏本窗口时，DSH 会短暂从屏幕上消失（约 0.5～1.1 秒）；若捕获失败会立刻恢复。
- 「直接截图」时挡住目标窗口的东西会一起被拍进去——这正是「隐藏本窗口截图」存在的理由。
- 在「新会话」页（没有当前会话）截图时，会自动新建一个会话并把图片放进它的输入框（与直接发消息的行为一致）。
