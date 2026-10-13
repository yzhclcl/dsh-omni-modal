# dsh-omni-modal（全模态设置）

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-2ea44f)](https://github.com/topics/dsh-plugin)

**给没有生图 / 生视频能力的模型补上这两项能力 —— 不用改 DSH 一行源码。**

`dsh-omni-modal` 在 DSH 的「设置」左栏新增一个 **全模态设置** 分区：把 harness 指向任意 **OpenAI 兼容**的生图 / 生视频端点，并注册三个模型可见的工具：

| 工具 | 作用 |
| --- | --- |
| `generate_image` | 同步文生图。图片落盘为 PNG/JPEG/WebP，附件服务可用时还会返回一张可直接预览的图片卡片。 |
| `generate_video` | 异步提交。立刻返回任务 id，视频还在渲染。 |
| `check_video` | 查询该任务；成功后自动把成品视频下载到本地。 |

状态：可用，跟随 Harness 开发者预览版演进，接口可能变化。

![生图 tab](docs/screenshot-image-tab.png)

![生视频 tab](docs/screenshot-video-tab.png)

## 特性

- **可实时编辑的设置页** —— 是真正的 DSH 设置分区（不是静态技能）。改完端点、密钥、模型、路径或默认尺寸，点「保存」即对三个工具生效，无需重启。
- **多套配置档案** —— 可并存多套端点，各自命名，随时切换生效档案。每个工具也支持可选的 `profile` 参数，单次调用临时改用非生效档案。
- **生图与生视频分开配置** —— 两类 API 的形状往往不同。每套档案为两侧各存一份独立的 `baseUrl` / `apiKey` / `model` / 路径 / 尺寸。
- **额外请求参数** —— 一个自由 JSON 对象，会合并进请求体，用于传递端点特有的参数（`{"quality":"high"}`、`{"mode":"text","aspect_ratio":"16:9"}` 等）。
- **连通性测试** —— 一键探测 `GET <baseUrl>/models`（不支持时回退探测接口地址本身），不消耗生成额度。
- **生视频天然异步** —— 提交、记任务、稍后查询。任务记录跨重启保留。
- **无构建步骤** —— 宿主半是纯 ESM，客户端半是手写 CJS bundle，不需要编译，也不需要打包器。

## 安装

需要 Node.js ≥ 18 与 DeepSeek Harness。

```bash
dsh plugin --profile <profile> add github:yzhclcl/dsh-omni-modal
```

`<profile>` 是你的 DSH 档案名（`web`、`desktop` 等）。加 `#v0.1.0` 可锁定到某个 tag。

装完 **重启 DSH** —— 宿主半在启动时注册路由与工具，设置分区出现在「设置 → 全模态设置」。

### 手工安装（无 pnpm / 离线）

把本仓库复制到一个固定位置，然后在 `~/.dsh/profiles/<profile>/package.json` 中加上：

```jsonc
{
  "dependencies": {
    "dsh-omni-modal": "link:/absolute/path/to/dsh-omni-modal"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-omni-modal"]
    }
  }
}
```

并在 `pnpm-lock.yaml` 的 `importers.` → `dependencies` 段补上同名条目，然后建立链接：

```powershell
New-Item -ItemType SymbolicLink `
  -Path "$HOME\.dsh\profiles\<profile>\node_modules\dsh-omni-modal" `
  -Target "/absolute/path/to/dsh-omni-modal"
```

> **不要**把包复制进 `node_modules` 代替链接。DSH 以 `Symbol` 作为跨模块调用密钥，模块重复加载会让 Symbol 互不相等，导致所有工具调用抛 `Cannot read properties of undefined (reading 'prepare')`，且重启无法恢复。

## 使用

装好之后直接对 agent 说话即可：

- 「画一个浅蓝盘子上的草莓」→ `generate_image`
- 「做一段小红纸船顺流而下的短视频」→ `generate_video`，随后 `check_video`

### 设置页

| 分区 | 内容 |
| --- | --- |
| 配置档案 | 选择当前生效档案、改档案名、新增（复制当前档案）/ 删除档案 |
| 生图 | 接口地址、API Key、模型名称、请求路径、默认尺寸、额外请求参数 |
| 生视频 | 接口地址、API Key、模型名称、提交路径、查询路径、默认分辨率、默认时长、额外请求参数 |
| 任务记录 | 已提交的生视频任务及其状态 / 产物路径 |

要点：

- **保存后立即对工具生效，无需重启。**
- **「接口地址」只填地址本身。** 照文档抄时很容易把示例里的请求方法一起抄进来（写成 `POST https://api.example.com/v1`）；插件会自动剥掉开头的 `POST`/`GET` 等词，但只填 `https://api.example.com/v1` 更稳妥。
- **「查询路径」支持两种写法**：相对路径（如 `/videos/generations/{id}`）拼在接口地址之后；或 **完整 URL**（如 `https://api.example.com/agnesapi?video_id={id}&model_name={model}`）原样使用。当查询接口根本不在 baseUrl 之下时，只能用后者。
- 查询路径里可用的占位符：

  | 占位符 | 替换为 |
  | --- | --- |
  | `{id}` | 提交时拿到的任务 ID |
  | `{model}` | 该档案配置的模型名 |

- 三个工具**始终使用「当前生效档案」**，除非显式传入 `profile`。

### 工具

```
generate_image(prompt, size?, model?, profile?, save_to?)
generate_video(prompt, model?, profile?, size?, seconds?, image_url?)
check_video(task_id, profile?, save_to?)
```

- `generate_image` 同步返回。图片落盘到插件数据目录的 `media/`，若附件服务可用还会生成图片附件，在对话里直接可见。**模型侧看不到图片内容** —— 要看图请对返回的路径再调 `read_image`。
- `generate_video` 异步：提交后立刻返回 `taskId`。之后用 `check_video(task_id)` 查询；状态变成 `succeeded` 时会自动把成品下载到 `media/`。
- 传入**不存在的档案会直接报错并列出可用档案**，不会静默回退到别的档案 —— 否则模型会悄悄用错端点与模型，而返回里仍写着它要的那个档案名，完全看不出问题。
- `check_video` 的失败是**软失败**：任务查不到（404）、下载地址不可用或下载失败，都返回 `status: "failed"` / `"succeeded"` 加 `message`，而不是抛异常。这些是可预期的业务结果，抛异常会让整轮工具调用失败。
- 视频地址识别覆盖多种常见返回形状：`video_url` / `videoUrl` / `url`、嵌套 `video.url`、`data.*`、`output.*`、`result.*`、`videos[0].url` 等。
- 任务 ID 的识别优先取 `video_id` / `videoId`，其次才是 `id` / `task_id` —— 有些服务（如 Agnes）返回的 `id` 是内部任务号，用它查询会查不到。
- 接口返回 **429（限流）/ 503（繁忙、队列满）** 时，错误信息里会附带「稍等一会儿再试」的提示：这两类是可重试的服务端状态，不是配置错误。

## 接入示例：Agnes AI

Agnes AI 的图片与视频端点形状不同，视频侧需要按官方文档配置。以 `apihub.agnes-ai.com` 为例：

**生图**

| 字段 | 值 |
| --- | --- |
| 接口地址 | `https://apihub.agnes-ai.com/v1` |
| 模型名称 | `agnes-image-2.5-flash` |
| 请求路径 | `/images/generations` |
| 默认尺寸 | 如 `1312x736` |

**生视频**

| 字段 | 值 |
| --- | --- |
| 接口地址 | `https://apihub.agnes-ai.com/v1` |
| 模型名称 | `agnes-video-2.5-flash` |
| 提交路径 | `/videos` |
| 查询路径 | `https://apihub.agnes-ai.com/agnesapi?video_id={id}&model_name={model}` |
| 默认分辨率 | `720P`（Flash 仅支持 `720P`，其它值返回 400） |
| 默认时长 | `5`（字符串，范围 `"4"`–`"12"`） |
| 额外请求参数 | `{"mode":"text","aspect_ratio":"16:9"}` |

- 视频提交是 `POST /v1/videos`（**不是** `/v1/videos/generations`），且 `mode` 是必填项（`text` / `keyframe` / `reference`），放进「额外请求参数」。
- 查询走 `GET /agnesapi?video_id=…&model_name=…`，**不在 `/v1` 之下**，所以「查询路径」要写完整 URL。
- 输出宽高由 `aspect_ratio` 决定：`21:9`→1680x720、`16:9`→1280x704、`4:3`→960x720、`1:1`→720x720、`3:4`→720x960、`9:16`→720x1280。
- 免费额度限流较严格；短时间内反复调用会收到 429，等一会儿即可恢复。

## 数据位置

| 内容 | 路径 |
| --- | --- |
| 配置 | `~/.dsh-omni-modal/config.json`（含 API Key，权限 0600） |
| 生成产物 | `~/.dsh-omni-modal/media/` |
| 视频任务记录 | `~/.dsh-omni-modal/tasks.json` |

设置环境变量 `DSH_OMNI_DATA_DIR` 可整体改到别处（便于隔离测试）。

## 卸载

```bash
dsh plugin --profile <profile> remove dsh-omni-modal
```

手工安装的话，删掉依赖与 bundles 条目、`pnpm-lock.yaml` 里的同名条目，然后删除符号链接：

```powershell
cmd /c rmdir "$HOME\.dsh\profiles\<profile>\node_modules\dsh-omni-modal"
```

> 删符号链接只能用 `cmd /c rmdir` 或 `[IO.Directory]::Delete(path, $false)`；**绝不要用 `Remove-Item -Recurse`** —— 它会顺着链接删掉源目录。操作前先完全退出 DSH。

`~/.dsh-omni-modal/` 为插件数据，按需自行删除。

## 实现说明

- `lib/index.js` — 宿主半（Node ESM）：配置存储、`/omni-modal/*` 路由、三个工具的定义与注册。
- `lib/client.js` — 浏览器半（手写 CJS bundle，经 `window.__ModuleLoader__.load` 装载）：注册 `settings.section` 座位并渲染设置页。
- `cordis.patch.yml` — 插件名册插入行，由 `dsh.bundle.patch` 承载。

宿主半**不导入任何 `@deepseek-ai/*` 裸模块**（第三方插件解析不到那些内部导出），只用 `node:*` 与相对路径；工具的参数与输出 schema 一律写成**标准 JSON Schema**（`required` 为字符串数组），而非 `defineTool` 的属性表 DSL —— 后者会让 LLM API 拒绝整个函数 schema。

## English

See [README.md](README.md).

## License

[MIT](LICENSE)
