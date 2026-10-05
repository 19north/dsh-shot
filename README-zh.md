# dsh-shot — 输入框截图控件（框选 + 标注 / 可隐藏本窗口）

> [English](./README.md) · **中文** ·
> [Español](./README-es.md) · [Português](./README-pt.md) · [हिन्दी](./README-hi.md)
>
> 这是一份**节译**：完整内容以 [README.md](./README.md) 为准，
> 实现与决策记录见 [DESIGN.md](./DESIGN.md)。标题保留英文，方便五语对照。

给 DeepSeek Harness 的输入框加一个相机按钮：点开有两项——**直接截图**（立刻抓整个虚拟屏幕）
与**隐藏本窗口截图**（先把 DSH 窗口藏起来、抓屏、再**原样**恢复，包括"原本是最小化"）。

## Requirements

- DeepSeek Harness `0.1.7` 或更新，desktop / web profile。
- **Windows**：抓屏走 PowerShell + Win32。
- Node `^22.19.0 || >=24.0.0`。
- **无运行时依赖**：宿主半只 import `node:*`。

## Install

```sh
dsh plugin --profile <profile> add ./dsh-shot              # 从源码目录
dsh plugin --profile <profile> add ./dsh-shot-0.1.0.tgz    # 从 tarball（pnpm pack 产物）
```

装完**重启应用**：客户端 bundle 的版本号在启动时计算，刷新页面不够。

## Use

1. 点输入框 `＋` 旁边的相机按钮，选其中一项。
2. 浮层盖住窗口：**拖一个框**选区域。
3. 需要就标注，然后确认；图片进入输入框草稿。

| 操作 | 效果 |
|---|---|
| 拖**八个手柄**（四角 + 四边中点） | 按那个方向缩放 |
| 在**框内拖动** | 整体平移，大小不变 |
| **方向键** | 逐像素微调；按住 **Shift** 每次 10 像素 |
| **右键** / 「重选」 | 退回「没有选区」，重新框 |
| **Esc** / 右键 | 逐级回退（撤标注 → 重选 → 退出） |

工具：**红框**、**箭头**、**文字**（点一下落点 → 输入 → **回车**确认，**Esc** 取消；
**双击可改已有文字**）、**8 色**调色板、**撤销**、**重选**。文字带半透明暗色衬底，
任何底色上都看得清。

## How it fits together

| 半边 | 文件 | 跑在哪 |
|---|---|---|
| 宿主 | `lib/index.js` | DSH 服务端；注册 `/api/dsh-shot/*` 路由，拉起 `scripts/capture.ps1` |
| 客户端 | `lib/client.js` | 浏览器；输入框按钮 + 框选/标注浮层 |
| 抓屏 | `scripts/capture.ps1` | 独立的 PowerShell 子进程；找 DSH 窗口、隐藏/恢复、抓虚拟屏幕 |

客户端半边在 `package.json` 的 `dsh.client` 里声明，由 `/plugins/dsh-shot/client.js` 提供。

## Known limitations

- **仅 Windows**：抓屏路径是 Win32 + DWM。
- 浮层盖的是**窗口**而不是屏幕：整屏截图按「铺满窗口」缩放，比例不符的部分会被裁掉。
  多显示器被当成一块虚拟屏幕，**小窗口够不到它的每个角**。
- 「隐藏本窗口截图」期间 DSH 会消失约 0.3–1.2 秒。
- 偶发：抓屏脚本可能返回一张几乎空白的图（几十 KB 而不是几 MB），重截即可；自动重试尚未实现。

## Development

```sh
dsh-plugin-dev check --cwd .     # 静态契约检查
dsh-plugin-dev verify --cwd .    # 打包 + 在一次性 DSH_HOME 里装/启/卸
```

无头回归脚本在包外（`dsh-screenshot-research/`）。

## License

MIT。
