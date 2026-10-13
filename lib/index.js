/**
 * dsh-omni-modal — 全模态（生图 / 生视频）模型配置插件 · 宿主半
 *
 * 职责：
 *   1. 维护一份本地配置（多套档案，可切换），落盘在 <dataDir>/config.json；
 *   2. 暴露 /omni-modal/* 的 REST 路由，供设置页读写配置与测试连通性；
 *   3. 注册三个模型可见工具：generate_image / generate_video / check_video。
 *
 * 约束（来自 DSH 插件契约）：
 *   - 宿主半零 `@deepseek-ai/*` 裸导入，只能用 `node:*` 与相对路径；
 *   - 工具 parameters / output.schema 必须是**标准 JSON Schema**
 *     （`required` 是字符串数组）——第三方插件拿不到 defineTool 的属性表 DSL；
 *   - output.render 的返回值会被 deepFreeze 快照，必须是纯 JSON 数据。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync, createReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname, extname, basename, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

export const name = 'dsh-omni-modal';

const PLUGIN_NAME = 'dsh-omni-modal';
const ROUTE_BASE = '/omni-modal';
const MEDIA_PREFIX = `${ROUTE_BASE}/media/`;

/** 图片类型 -> 扩展名 */
const IMAGE_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const IMAGE_MEDIA_TYPES = new Set(Object.keys(IMAGE_EXT));

const VIDEO_EXT = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'application/octet-stream': '.mp4',
};

// ─────────────────────────────────────────────────────────── 数据目录

function dataDir() {
  const override = process.env.DSH_OMNI_DATA_DIR;
  return override && override.trim() ? resolve(override.trim()) : join(homedir(), '.dsh-omni-modal');
}

function configPath() {
  return join(dataDir(), 'config.json');
}

function mediaDir() {
  return join(dataDir(), 'media');
}

function tasksPath() {
  return join(dataDir(), 'tasks.json');
}

function ensureDir(dir) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    if (err && err.code !== 'EEXIST') throw err;
  }
}

// ─────────────────────────────────────────────────────────── 配置模型

function defaultImage() {
  return {
    baseUrl: '',
    apiKey: '',
    model: '',
    size: '1024x1024',
    path: '/images/generations',
    extra: '',
  };
}

function defaultVideo() {
  return {
    baseUrl: '',
    apiKey: '',
    model: '',
    size: '',
    seconds: '',
    submitPath: '/videos/generations',
    queryPath: '/videos/generations/{id}',
    extra: '',
  };
}

function defaultProfile(id, label) {
  return { id, label: label || id, image: defaultImage(), video: defaultVideo() };
}

function defaultConfig() {
  return { version: 1, active: 'default', profiles: { default: defaultProfile('default', '默认档案') } };
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : value === void 0 || value === null ? fallback : String(value);
}

function normalizeSide(raw, fallback) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of Object.keys(fallback)) out[key] = asString(src[key], fallback[key]);
  return out;
}

function normalizeProfile(raw, fallbackId) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const id = asString(src.id, fallbackId).trim() || fallbackId;
  return {
    id,
    label: asString(src.label, id).trim() || id,
    image: normalizeSide(src.image, defaultImage()),
    video: normalizeSide(src.video, defaultVideo()),
  };
}

function normalizeConfig(raw) {
  const base = defaultConfig();
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const profilesRaw = src.profiles && typeof src.profiles === 'object' && !Array.isArray(src.profiles) ? src.profiles : null;
  const profiles = {};
  if (profilesRaw) {
    for (const key of Object.keys(profilesRaw)) {
      const profile = normalizeProfile(profilesRaw[key], key);
      profiles[profile.id] = profile;
    }
  }
  if (Object.keys(profiles).length === 0) profiles.default = base.profiles.default;
  let active = asString(src.active, '');
  if (!Object.prototype.hasOwnProperty.call(profiles, active)) active = Object.keys(profiles)[0];
  return { version: 1, active, profiles };
}

function loadConfig() {
  const file = configPath();
  if (!existsSync(file)) return defaultConfig();
  try {
    return normalizeConfig(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return defaultConfig();
  }
}

function saveConfig(config) {
  ensureDir(dataDir());
  const file = configPath();
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, file);
  try {
    statSync(file);
  } catch {
    /* ignore */
  }
  return config;
}

// ─────────────────────────────────────────────────────────── 任务登记

function loadTasks() {
  const file = tasksPath();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((row) => row && typeof row === 'object') : [];
  } catch {
    return [];
  }
}

function saveTasks(rows) {
  ensureDir(dataDir());
  const file = tasksPath();
  const trimmed = rows.slice(-200);
  writeFileSync(file, `${JSON.stringify(trimmed, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return trimmed;
}

function rememberTask(record) {
  const rows = loadTasks().filter((row) => row.taskId !== record.taskId);
  rows.push(record);
  saveTasks(rows);
}

function findTask(taskId) {
  return loadTasks().find((row) => row.taskId === taskId);
}

// ─────────────────────────────────────────────────────────── HTTP 工具

function joinUrl(base, path) {
  const b = asString(base).trim().replace(/\/+$/, '');
  const p = asString(path).trim();
  if (!p) return b;
  // 路径本身已是完整 URL 时直接使用，不再拼接 baseUrl。
  // 有些服务的查询接口不在 baseUrl 之下（例如 Agnes 的 /agnesapi 在 /v1 之外），
  // 只靠拼接无法表达，必须在「查询路径」里写完整地址。
  if (/^https?:\/\//i.test(p)) return p;
  return `${b}${p.startsWith('/') ? p : `/${p}`}`;
}

function authHeaders(apiKey) {
  const key = asString(apiKey).trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function requestText(url, options = {}) {
  const { method = 'GET', headers = {}, body, signal, timeoutMs = 180000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => controller.abort(signal && signal.reason ? signal.reason : new Error('aborted'));
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, contentType: asString(res.headers.get('content-type')) };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

async function requestJson(url, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  const res = await requestText(url, { ...options, headers });
  let json = null;
  if (res.text) {
    try {
      json = JSON.parse(res.text);
    } catch {
      json = null;
    }
  }
  return { ...res, json };
}

async function fetchBytes(url, options = {}) {
  const { headers = {}, signal, timeoutMs = 300000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => controller.abort(signal && signal.reason ? signal.reason : new Error('aborted'));
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: res.ok, status: res.status, bytes: buf, contentType: asString(res.headers.get('content-type')) };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

function parseExtra(raw, where) {
  const text = asString(raw).trim();
  if (!text) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${where} 的「额外参数」不是合法 JSON：${err && err.message ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${where} 的「额外参数」必须是一个 JSON 对象`);
  }
  return parsed;
}

// ─────────────────────────────────────────────────────────── 图片嗅探

function sniffImageType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && bytes.toString('latin1', 0, 6).startsWith('GIF8')) return 'image/gif';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

function sniffImageSize(bytes, mediaType) {
  try {
    if (mediaType === 'image/png' && bytes.length >= 24) {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (mediaType === 'image/gif' && bytes.length >= 10) {
      return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    }
    if (mediaType === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = bytes[offset + 1];
        const length = bytes.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
    if (mediaType === 'image/webp' && bytes.length >= 30) {
      const fourcc = bytes.toString('latin1', 12, 16);
      if (fourcc === 'VP8X') {
        const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
        const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
        return { width, height };
      }
      if (fourcc === 'VP8 ' && bytes.length >= 30) {
        return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
      }
      if (fourcc === 'VP8L' && bytes.length >= 25) {
        const bits = bytes.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    /* 嗅探失败不影响主流程 */
  }
  return null;
}

// ─────────────────────────────────────────────────────────── 落盘

function uniqueName(prefix, ext) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${prefix}-${stamp}-${randomUUID().slice(0, 8)}${ext}`;
}

function writeMedia(bytes, prefix, ext, saveTo) {
  const target = saveTo
    ? isAbsolute(saveTo)
      ? saveTo
      : resolve(saveTo)
    : join(mediaDir(), uniqueName(prefix, ext));
  ensureDir(dirname(target));
  writeFileSync(target, bytes);
  return target;
}

// ─────────────────────────────────────────────────────────── 结果解析

function pickString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function extractImagePayload(json) {
  const data = json && typeof json === 'object' ? json : {};
  const list = Array.isArray(data.data) ? data.data : Array.isArray(data.images) ? data.images : Array.isArray(data.output) ? data.output : null;
  const first = list && list.length > 0 ? list[0] : data.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : data;
  const node = first && typeof first === 'object' ? first : {};
  const b64 = pickString(node.b64_json, node.b64Json, node.image_base64, node.imageBase64, node.base64, data.b64_json);
  const url = pickString(node.url, node.image_url, node.imageUrl, node.output_url, data.url);
  const revised = pickString(node.revised_prompt, node.revisedPrompt, data.revised_prompt);
  return { b64, url, revised };
}

function extractTaskId(json) {
  const data = json && typeof json === 'object' ? json : {};
  const nested = data.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : {};
  const output = data.output && typeof data.output === 'object' && !Array.isArray(data.output) ? data.output : {};
  // video_id / videoId 放在最前：有些服务（如 Agnes）返回的 id 是内部任务号，
  // 查询时要用 video_id，用错会查不到任务。
  return pickString(
    data.video_id,
    data.videoId,
    nested.video_id,
    nested.videoId,
    data.id,
    data.task_id,
    data.taskId,
    data.request_id,
    data.requestId,
    nested.id,
    nested.task_id,
    nested.taskId,
    output.video_id,
    output.videoId,
    output.task_id,
    output.taskId,
    output.id,
  );
}

function normalizeVideoStatus(raw) {
  const value = asString(raw).trim().toLowerCase();
  if (!value) return 'pending';
  if (['succeeded', 'success', 'completed', 'complete', 'done', 'finished', 'ok', 'ready'].includes(value)) return 'succeeded';
  if (['failed', 'failure', 'error', 'cancelled', 'canceled', 'expired', 'rejected'].includes(value)) return 'failed';
  return 'running';
}

function extractVideoStatus(json) {
  const data = json && typeof json === 'object' ? json : {};
  const nested = data.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : {};
  const output = data.output && typeof data.output === 'object' && !Array.isArray(data.output) ? data.output : {};
  return pickString(data.status, data.state, data.task_status, data.taskStatus, nested.status, nested.state, output.status, output.state);
}

function extractVideoUrl(json) {
  const data = json && typeof json === 'object' ? json : {};
  const nested = data.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : {};
  const output = data.output && typeof data.output === 'object' && !Array.isArray(data.output) ? data.output : {};
  const outputList = Array.isArray(data.output) ? data.output : null;
  const nestedVideos = Array.isArray(nested.videos) ? nested.videos : null;
  const nestedOutput = Array.isArray(nested.output) ? nested.output : null;
  // 嵌套对象形状：{ video: { url } } / { video: { video_url } } / { result: { url } } 等
  const video = data.video && typeof data.video === 'object' && !Array.isArray(data.video) ? data.video : {};
  const nestedVideo = nested.video && typeof nested.video === 'object' && !Array.isArray(nested.video) ? nested.video : {};
  const outputVideo = output.video && typeof output.video === 'object' && !Array.isArray(output.video) ? output.video : {};
  const result = data.result && typeof data.result === 'object' && !Array.isArray(data.result) ? data.result : {};
  const direct = pickString(
    data.video_url,
    data.videoUrl,
    data.url,
    video.url,
    video.video_url,
    video.videoUrl,
    result.url,
    result.video_url,
    result.videoUrl,
    nested.video_url,
    nested.videoUrl,
    nested.url,
    nestedVideo.url,
    nestedVideo.video_url,
    nestedVideo.videoUrl,
    output.video_url,
    output.videoUrl,
    output.url,
    outputVideo.url,
    outputVideo.video_url,
    outputVideo.videoUrl,
    outputList && outputList[0] && (outputList[0].url || outputList[0].video_url),
    nestedVideos && nestedVideos[0] && (nestedVideos[0].url || nestedVideos[0].video_url),
    nestedOutput && nestedOutput[0] && (nestedOutput[0].url || nestedOutput[0].video_url),
  );
  return direct;
}

function extractVideoError(json) {
  const data = json && typeof json === 'object' ? json : {};
  const nested = data.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : {};
  const output = data.output && typeof data.output === 'object' && !Array.isArray(data.output) ? data.output : {};
  const err = data.error && typeof data.error === 'object' ? data.error : {};
  return pickString(err.message, data.message, data.error_message, data.errorMessage, nested.message, nested.error, output.message, output.error);
}

// ─────────────────────────────────────────────────────────── 业务逻辑

function resolveSide(config, kind, profileId) {
  const requested = asString(profileId).trim();
  const id = requested || config.active;
  let profile = config.profiles[id];
  // 显式指定的档案不存在时必须报错：静默回退到别的档案会让模型拿错误的模型名/端点
  // 去生成，而且它自己完全看不出来（返回里还写着它要的那个档案名）。
  if (!profile && requested) {
    const known = Object.keys(config.profiles).map((key) => `「${config.profiles[key].label}」(${key})`).join('、');
    throw new Error(`档案「${requested}」不存在。当前可用档案：${known || '（无）'}。可用「全模态设置」页新建，或省略 profile 参数使用当前激活档案。`);
  }
  if (!profile) profile = config.profiles[config.active] || Object.values(config.profiles)[0];
  const side = kind === 'video' ? profile.video : profile.image;
  return { profile, side };
}

/**
 * 清洗「接口地址」。常见误填：把文档里的示例命令连请求方法一起抄进来，
 * 例如 "POST https://api.example.com/v1"。这里剥掉开头的方法词，
 * 剩下的部分才是真正的地址。
 */
function cleanBaseUrl(raw) {
  let value = asString(raw).trim();
  // 剥掉开头的 HTTP 方法（POST/GET/PUT/PATCH/DELETE，可重复出现）
  for (;;) {
    const next = value.replace(/^(POST|GET|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i, '');
    if (next === value) break;
    value = next.trim();
  }
  return value.replace(/\/+$/, '');
}

function requireEndpoint(side, label) {
  const baseUrl = cleanBaseUrl(side.baseUrl);
  const raw = asString(side.baseUrl).trim();
  if (!baseUrl) throw new Error(`${label} 尚未配置「接口地址」，请先在「全模态设置」里填写并保存`);
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error(
      `${label} 的「接口地址」必须以 http:// 或 https:// 开头（当前填写：${raw}）。` +
        `这里只填地址本身，不要把请求方法（POST/GET）或整条 curl 命令抄进来。`,
    );
  }
  const model = asString(side.model).trim();
  if (!model) throw new Error(`${label} 尚未配置「模型名称」`);
  return { baseUrl, model };
}

/** 只校验地址（查询任务时不需要模型名）。 */
function requireBaseUrl(side, label) {
  const baseUrl = cleanBaseUrl(side.baseUrl);
  const raw = asString(side.baseUrl).trim();
  if (!baseUrl) throw new Error(`${label} 尚未配置「接口地址」，请先在「全模态设置」里填写并保存`);
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error(
      `${label} 的「接口地址」必须以 http:// 或 https:// 开头（当前填写：${raw}）。` +
        `这里只填地址本身，不要把请求方法（POST/GET）或整条 curl 命令抄进来。`,
    );
  }
  return baseUrl;
}

/** 从任意形态的响应体里提取人话错误信息。 */
function extractError(json) {
  return extractVideoError(json);
}

async function runImageGeneration({ config, prompt, size, model, profileId, saveTo, signal, attachments }) {
  const { profile, side } = resolveSide(config, 'image', profileId);
  const label = `档案「${profile.label}」的生图配置`;
  const { baseUrl, model: configuredModel } = requireEndpoint(side, label);
  const useModel = asString(model).trim() || configuredModel;
  const useSize = asString(size).trim() || asString(side.size).trim();
  const extra = parseExtra(side.extra, label);

  const body = { model: useModel, prompt, n: 1, ...(useSize ? { size: useSize } : {}), response_format: 'b64_json', ...extra };
  const url = joinUrl(baseUrl, asString(side.path).trim() || '/images/generations');
  const res = await requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(side.apiKey) },
    body: JSON.stringify(body),
    signal,
    timeoutMs: 600000,
  });

  if (!res.ok) {
    const detail = extractError(res.json) || res.text.slice(0, 400);
    const hint = res.status === 429
      ? '（触发接口限流：稍等一会儿再试，或换用别的档案/密钥）'
      : res.status === 503
        ? '（服务端繁忙或队列已满：稍等一会儿再试）'
        : '';
    throw new Error(`生图接口返回 HTTP ${res.status}：${detail || '（无响应体）'}${hint}`);
  }

  const payload = extractImagePayload(res.json);
  let bytes = null;
  let mediaType = '';
  if (payload.b64) {
    bytes = Buffer.from(payload.b64, 'base64');
  } else if (payload.url) {
    const download = await fetchBytes(payload.url, { signal, timeoutMs: 300000 });
    if (!download.ok) throw new Error(`图片下载失败：HTTP ${download.status}`);
    bytes = download.bytes;
    mediaType = download.contentType.split(';')[0].trim();
  }
  if (!bytes || bytes.length === 0) {
    throw new Error(`生图接口未返回图片数据（响应片段：${res.text.slice(0, 400) || '（空）'}）`);
  }
  if (!IMAGE_MEDIA_TYPES.has(mediaType)) mediaType = sniffImageType(bytes);
  if (!IMAGE_MEDIA_TYPES.has(mediaType)) {
    throw new Error('无法识别返回的图片格式（只支持 PNG / JPEG / WebP / GIF）');
  }

  const sniffed = sniffImageSize(bytes, mediaType);
  const path = writeMedia(bytes, 'image', IMAGE_EXT[mediaType], saveTo);

  let ref = null;
  if (attachments && typeof attachments.saveImage === 'function') {
    try {
      ref = await attachments.saveImage({ data: new Uint8Array(bytes), mediaType, name: basename(path) });
    } catch {
      ref = null;
    }
  }

  const width = ref && ref.width ? ref.width : sniffed ? sniffed.width : 0;
  const height = ref && ref.height ? ref.height : sniffed ? sniffed.height : 0;
  const out = {
    profile: profile.id,
    profileLabel: profile.label,
    model: useModel,
    path,
    mediaType,
    bytes: bytes.length,
    width,
    height,
    ...(payload.revised ? { revisedPrompt: payload.revised } : {}),
    ...(ref && ref.attachmentId
      ? {
          attachment: {
            attachmentId: ref.attachmentId,
            mediaType: ref.mediaType || mediaType,
            bytes: ref.bytes || bytes.length,
            width: ref.width || width,
            height: ref.height || height,
            ...(ref.name ? { name: ref.name } : {}),
            ...(ref.originalDimensions ? { originalDimensions: { ...ref.originalDimensions } } : {}),
          },
        }
      : {}),
  };
  return out;
}

async function submitVideoGeneration({ config, prompt, size, seconds, model, imageUrl, profileId, signal }) {
  const { profile, side } = resolveSide(config, 'video', profileId);
  const label = `档案「${profile.label}」的生视频配置`;
  const { baseUrl, model: configuredModel } = requireEndpoint(side, label);
  const useModel = asString(model).trim() || configuredModel;
  const useSize = asString(size).trim() || asString(side.size).trim();
  const useSeconds = asString(seconds).trim() || asString(side.seconds).trim();
  const extra = parseExtra(side.extra, label);

  const body = {
    model: useModel,
    prompt,
    ...(useSize ? { size: useSize } : {}),
    ...(useSeconds ? { seconds: useSeconds } : {}),
    ...(asString(imageUrl).trim() ? { image_url: asString(imageUrl).trim() } : {}),
    ...extra,
  };
  const submitPath = asString(side.submitPath).trim() || '/videos/generations';
  const url = joinUrl(baseUrl, submitPath);
  const res = await requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(side.apiKey) },
    body: JSON.stringify(body),
    signal,
    timeoutMs: 300000,
  });

  if (!res.ok) {
    const detail = extractError(res.json) || res.text.slice(0, 400);
    // 429 / 503 是「过一会儿再来」而不是配置错误，给出可操作的提示，
    // 否则模型会以为是参数写错了，反复改配置重试。
    const hint = res.status === 429
      ? '（触发接口限流：稍等一会儿再试，或换用别的档案/密钥）'
      : res.status === 503
        ? '（服务端繁忙或队列已满：稍等一会儿再试）'
        : '';
    throw new Error(`生视频接口返回 HTTP ${res.status}：${detail || '（无响应体）'}${hint}`);
  }

  const taskId = extractTaskId(res.json);
  if (!taskId) {
    throw new Error(`生视频接口未返回任务 ID（响应片段：${res.text.slice(0, 400) || '（空）'}）。可在档案里调整「提交路径」或改用其它接口。`);
  }
  const status = normalizeVideoStatus(extractVideoStatus(res.json));
  const record = {
    taskId,
    profile: profile.id,
    profileLabel: profile.label,
    model: useModel,
    queryPath: asString(side.queryPath).trim() || '/videos/generations/{id}',
    baseUrl,
    createdAt: new Date().toISOString(),
  };
  rememberTask(record);
  return { taskId, status: status === 'succeeded' ? 'running' : status, profile: profile.id, profileLabel: profile.label, model: useModel };
}

async function pollVideoTask({ config, taskId, profileId, saveTo, signal }) {
  const record = findTask(taskId);
  // 任务记录里的档案可能已被删除：那种情况下退回激活档案，而不是因为「档案不存在」报错
  // ——用户要的是查这个任务，档案只是查它所需的凭据来源。
  const recorded = record && record.profile && config.profiles[record.profile] ? record.profile : '';
  const { profile, side } = resolveSide(config, 'video', asString(profileId).trim() || recorded);
  const label = `档案「${profile.label}」的生视频配置`;
  const baseUrl = requireBaseUrl(side, label);
  const queryTemplate = asString(side.queryPath).trim() || (record && record.queryPath) || '/videos/generations/{id}';
  const useModel = asString(side.model).trim() || (record && record.model) || '';
  // {id} 换任务号；{model} 换模型名（部分服务的查询接口要求带上 model_name）。
  // 模板若本身就是完整 URL（如 https://host/agnesapi?video_id={id}），joinUrl 会原样使用。
  const queryUrl = queryTemplate
    .replace(/\{id\}/g, encodeURIComponent(taskId))
    .replace(/\{model\}/g, encodeURIComponent(useModel));
  const url = joinUrl(baseUrl, queryUrl);

  const res = await requestJson(url, { headers: authHeaders(side.apiKey), signal, timeoutMs: 120000 });
  // 查询失败（任务不存在 / 已过期 / 端点不对）是可预期的业务结果，不抛异常——
  // 抛异常会让整轮工具调用失败，模型反而拿不到「任务查不到」这个信息。
  if (!res.ok) {
    const detail = extractVideoError(res.json) || res.text.slice(0, 400);
    const hint = res.status === 404 || res.status === 405
      ? '（接口返回 404/405：任务 ID 可能不存在或已过期，也可能是「查询路径」配置不对）'
      : '';
    return {
      taskId,
      status: 'failed',
      profile: profile.id,
      profileLabel: profile.label,
      message: `查询任务失败：HTTP ${res.status} ${detail || ''}`.trim() + hint,
    };
  }

  const status = normalizeVideoStatus(extractVideoStatus(res.json));
  const out = { taskId, status, profile: profile.id, profileLabel: profile.label };

  if (status === 'failed') {
    const detail = extractVideoError(res.json);
    return { ...out, ...(detail ? { message: detail } : { message: '任务失败（接口未给出原因）' }) };
  }
  if (status !== 'succeeded') {
    return { ...out, message: '任务仍在进行中，稍后再查。' };
  }

  const videoUrl = extractVideoUrl(res.json);
  if (!videoUrl) {
    // 不把状态降回 running：接口已明确说成功，降级只会让模型无限轮询。
    return {
      ...out,
      status: 'succeeded',
      message: '任务已成功，但响应里没有可识别的视频地址，请检查「查询路径」或接口返回格式。原始响应片段：' + res.text.slice(0, 300),
    };
  }

  // 视频地址可能是相对路径或畸形字符串，fetch 会直接抛 —— 兜住它，
  // 别让「拿到了地址但地址不可用」把整轮工具调用打断。
  let download;
  try {
    download = await fetchBytes(videoUrl, { signal, timeoutMs: 600000 });
  } catch (err) {
    return {
      ...out,
      status: 'succeeded',
      url: videoUrl,
      message: `任务已成功，但视频地址无法访问（${err && err.message ? err.message : String(err)}）。源地址：${videoUrl}`,
    };
  }
  if (!download.ok) {
    return {
      ...out,
      status: 'succeeded',
      url: videoUrl,
      message: `任务已成功，但下载视频失败：HTTP ${download.status}。可直接用上面的源地址自行下载。`,
    };
  }
  const mediaType = asString(download.contentType).split(';')[0].trim();
  const ext = VIDEO_EXT[mediaType] || extname(new URL(videoUrl).pathname) || '.mp4';
  const path = writeMedia(download.bytes, `video-${taskId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'task'}`, ext, saveTo);
  return { ...out, path, mediaType: mediaType || 'video/mp4', bytes: download.bytes.length, url: videoUrl };
}

// ─────────────────────────────────────────────────────────── 路由

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

async function readBody(req, limitBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

function contentTypeFor(file) {
  const ext = extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  return 'application/octet-stream';
}

function registerRoutes(ctx, root) {
  const webServer = ctx.webServer;
  if (!webServer || typeof webServer.register !== 'function') return;
  const disposers = [];

  const register = (route) => {
    try {
      const dispose = webServer.register(route);
      if (typeof dispose === 'function') disposers.push(dispose);
    } catch (err) {
      const log = typeof ctx.logger === 'function' ? ctx.logger(PLUGIN_NAME) : ctx.logger;
      if (log && typeof log.warn === 'function') log.warn(`route ${route.path} not registered: ${err && err.message ? err.message : err}`);
    }
  };

  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/config`,
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          const config = loadConfig();
          return sendJson(res, 200, {
            ok: true,
            config,
            dataDir: dataDir(),
            profiles: Object.values(config.profiles).map((p) => ({ id: p.id, label: p.label })),
            tasks: loadTasks().slice(-20).reverse(),
          });
        }
        if (req.method === 'POST') {
          const body = await readBody(req);
          const next = normalizeConfig(body && body.config ? body.config : body);
          saveConfig(next);
          return sendJson(res, 200, { ok: true, config: next });
        }
        return sendText(res, 405, 'method not allowed');
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err && err.message ? err.message : String(err) });
      }
    },
  });

  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/activate`,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');
        const body = await readBody(req);
        const id = asString(body && body.id).trim();
        const config = loadConfig();
        if (!id || !Object.prototype.hasOwnProperty.call(config.profiles, id)) {
          return sendJson(res, 400, { ok: false, error: `档案「${id || '(空)'}」不存在` });
        }
        config.active = id;
        saveConfig(config);
        return sendJson(res, 200, { ok: true, config });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err && err.message ? err.message : String(err) });
      }
    },
  });

  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/test`,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');
        const body = await readBody(req);
        const kind = asString(body && body.kind, 'image') === 'video' ? 'video' : 'image';
        const config = loadConfig();
        const { profile, side } = resolveSide(config, kind, body && body.profile);
        const label = kind === 'video' ? '生视频' : '生图';
        const baseUrl = asString(side.baseUrl).trim();
        if (!baseUrl) return sendJson(res, 200, { ok: false, message: `${label}配置还没有填「接口地址」` });
        if (!/^https?:\/\//i.test(baseUrl)) return sendJson(res, 200, { ok: false, message: '接口地址必须以 http:// 或 https:// 开头' });
        const headers = authHeaders(side.apiKey);
        const attempt = async (path) => requestJson(joinUrl(baseUrl, path), { headers, timeoutMs: 20000 });
        let probe = await attempt('/models');
        if (probe.status === 404 || probe.status === 405 || probe.status === 501) probe = await attempt('');
        const ok = probe.ok;
        const detail = probe.ok
          ? '接口可达'
          : `HTTP ${probe.status}${probe.text ? ` — ${probe.text.slice(0, 200)}` : ''}`;
        return sendJson(res, 200, {
          ok,
          kind,
          profile: profile.id,
          profileLabel: profile.label,
          status: probe.status,
          message: ok ? `${label}配置：${detail}` : `${label}配置：${detail}`,
        });
      } catch (err) {
        return sendJson(res, 200, { ok: false, message: err && err.message ? err.message : String(err) });
      }
    },
  });

  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/tasks`,
    handler: async (req, res) => {
      try {
        if (req.method === 'DELETE') {
          saveTasks([]);
          return sendJson(res, 200, { ok: true, tasks: [] });
        }
        return sendJson(res, 200, { ok: true, tasks: loadTasks().slice(-50).reverse() });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err && err.message ? err.message : String(err) });
      }
    },
  });

  register({
    kind: 'prefix',
    path: `${ROUTE_BASE}/media`,
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'method not allowed');
        const pathname = new URL(req.url || '/', 'http://x').pathname;
        const rawName = decodeURIComponent(pathname.slice(MEDIA_PREFIX.length));
        if (!rawName || rawName.includes('/') || rawName.includes('\\') || rawName.includes('..')) {
          return sendText(res, 400, 'bad media name');
        }
        const rootDir = mediaDir();
        const target = resolve(rootDir, rawName);
        if (!target.startsWith(rootDir) || !existsSync(target)) return sendText(res, 404, 'not found');
        const info = statSync(target);
        res.statusCode = 200;
        res.setHeader('Content-Type', contentTypeFor(target));
        res.setHeader('Content-Length', String(info.size));
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'HEAD') return res.end();
        createReadStream(target).pipe(res);
      } catch (err) {
        return sendText(res, 500, err && err.message ? err.message : String(err));
      }
    },
  });

  const log = typeof ctx.logger === 'function' ? ctx.logger(PLUGIN_NAME) : ctx.logger;
  if (log && typeof log.info === 'function') log.info(`routes mounted under ${ROUTE_BASE}`);
  root.routeDisposers = disposers;
}

// ─────────────────────────────────────────────────────────── 工具
//
// ⚠️ 关键契约：第三方插件**不能** import `@deepseek-ai/dsh-tools` 的
// `defineTool`（宿主半禁止一切 `@deepseek-ai/*` 裸导入），所以这里直接把
// **标准 JSON Schema** 交给 `ctx.tools.register`。`defineTool` 的
// 「属性表 + required:true 布尔」是它自己的 DSL，只有官方包能用；
// 裸注册走的是 `assertSupportedJsonSchema`，`required` 必须是**字符串数组**。
// 支持的关键字只有：type / oneOf / properties / required /
// additionalProperties / items / enum / const + 注解（description/title/default/examples）。

const IMAGE_REF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
  properties: {
    attachmentId: { type: 'string' },
    mediaType: { type: 'string' },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object',
      additionalProperties: false,
      required: ['width', 'height'],
      properties: {
        width: { type: 'integer' },
        height: { type: 'integer' },
      },
    },
  },
};

function defineGenerateImage(runtime) {
  return {
    name: 'generate_image',
    description:
      '用「全模态设置」里配置的生图模型生成图片。图片会保存到本地文件，并作为图片卡片返回。注意：当前路由若不支持图片输入，模型看不到图片内容本身——需要看图时请再用 read_image 读取返回的路径。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: '图片描述（建议写清主体、风格、构图）。' },
        size: { type: 'string', description: '尺寸，例如 1024x1024、1536x1024。留空则用配置里的默认值。' },
        model: { type: 'string', description: '临时覆盖配置里的模型名。' },
        profile: { type: 'string', description: '临时指定使用哪套配置档案（默认用当前生效档案）。' },
        save_to: { type: 'string', description: '另存到的文件路径（绝对路径或相对当前工作目录）。留空则存到插件数据目录。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['profile', 'profileLabel', 'model', 'path', 'mediaType', 'bytes'],
        properties: {
          profile: { type: 'string' },
          profileLabel: { type: 'string' },
          model: { type: 'string' },
          path: { type: 'string' },
          mediaType: { type: 'string' },
          bytes: { type: 'integer' },
          width: { type: 'integer' },
          height: { type: 'integer' },
          revisedPrompt: { type: 'string' },
          attachment: IMAGE_REF_SCHEMA,
        },
      },
      render: (_args, value) => {
        const dims = value.width && value.height ? `，${value.width}x${value.height}px` : '';
        const text = [
          `已用「${value.profileLabel}」档案（模型 ${value.model}）生成图片：`,
          `<path>${value.path}</path>`,
          `<type>image</type>`,
          `<content>`,
          `${value.mediaType} image, ${value.bytes} bytes${dims}`,
          `</content>`,
          value.revisedPrompt ? `\n模型改写后的提示词：${value.revisedPrompt}` : '',
          value.attachment ? '' : '\n（附件服务不可用，图片只落盘，未生成可预览的附件引用。）',
          '若要查看图片内容，请调用 read_image 读取上面的路径。',
        ]
          .filter(Boolean)
          .join('\n');
        return value.attachment ? [{ type: 'text', text }, { type: 'image', attachment: value.attachment }] : [{ type: 'text', text }];
      },
      presentationMeta: (_args, value) => ({ path: value.path }),
    },
    isConcurrencySafe: () => true,
    timeoutMs: 900000,
    async execute(args, exec) {
      const prompt = asString(args.prompt).trim();
      if (!prompt) throw new Error('prompt 不能为空');
      const cwd = exec && exec.agent && exec.agent.session && exec.agent.session.header ? asString(exec.agent.session.header.cwd) : '';
      const saveTo = asString(args.save_to).trim();
      return runImageGeneration({
        config: loadConfig(),
        prompt,
        size: asString(args.size).trim(),
        model: asString(args.model).trim(),
        profileId: asString(args.profile).trim(),
        saveTo: saveTo ? (isAbsolute(saveTo) ? saveTo : resolve(cwd || process.cwd(), saveTo)) : '',
        signal: exec && exec.signal,
        attachments: runtime.getAttachments(),
      });
    },
  };
}

function defineGenerateVideo() {
  return {
    name: 'generate_video',
    description:
      '用「全模态设置」里配置的生视频模型提交一个视频生成任务，立刻返回任务 ID（异步）。随后用 check_video 查询进度，成功后会把视频下载到本地。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: '视频描述（建议写清画面、镜头运动、风格）。' },
        model: { type: 'string', description: '临时覆盖配置里的模型名。' },
        profile: { type: 'string', description: '临时指定使用哪套配置档案。' },
        size: { type: 'string', description: '分辨率，例如 1280x720。留空用配置默认值。' },
        seconds: { type: 'string', description: '时长（秒），例如 5。留空用配置默认值。' },
        image_url: { type: 'string', description: '图生视频时传入的参考图地址。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['taskId', 'status', 'profile', 'profileLabel', 'model'],
        properties: {
          taskId: { type: 'string' },
          status: { type: 'string' },
          profile: { type: 'string' },
          profileLabel: { type: 'string' },
          model: { type: 'string' },
        },
      },
      render: (_args, value) =>
        `已提交视频生成任务（档案「${value.profileLabel}」，模型 ${value.model}）。\n<task_id>${value.taskId}</task_id>\n当前状态：${value.status}。稍后用 check_video 传入这个 task_id 查询进度。`,
      presentationMeta: (_args, value) => ({ taskId: value.taskId }),
    },
    timeoutMs: 300000,
    async execute(args, exec) {
      const prompt = asString(args.prompt).trim();
      if (!prompt) throw new Error('prompt 不能为空');
      return submitVideoGeneration({
        config: loadConfig(),
        prompt,
        size: asString(args.size).trim(),
        seconds: asString(args.seconds).trim(),
        model: asString(args.model).trim(),
        imageUrl: asString(args.image_url).trim(),
        profileId: asString(args.profile).trim(),
        signal: exec && exec.signal,
      });
    },
  };
}

function defineCheckVideo() {
  return {
    name: 'check_video',
    description: '查询 generate_video 提交的视频任务；任务成功后会把视频下载到本地并返回文件路径。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['task_id'],
      properties: {
        task_id: { type: 'string', description: 'generate_video 返回的任务 ID。' },
        profile: { type: 'string', description: '临时指定用哪套配置档案查询（默认沿用提交时的档案）。' },
        save_to: { type: 'string', description: '视频另存路径（绝对路径或相对当前工作目录）。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['taskId', 'status', 'profile', 'profileLabel'],
        properties: {
          taskId: { type: 'string' },
          status: { type: 'string' },
          profile: { type: 'string' },
          profileLabel: { type: 'string' },
          path: { type: 'string' },
          url: { type: 'string' },
          mediaType: { type: 'string' },
          bytes: { type: 'integer' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (value.status === 'succeeded' && value.path) {
          return `视频已生成并保存：\n<path>${value.path}</path>\n<type>video</type>\n<content>\n${value.mediaType || 'video/mp4'} video, ${value.bytes || 0} bytes\n</content>\n源地址：${value.url || '(未提供)'}`;
        }
        const lines = [`任务 ${value.taskId} 状态：${value.status}`];
        if (value.url) lines.push(`源地址：${value.url}`);
        if (value.message) lines.push(value.message);
        return lines.join('\n');
      },
      presentationMeta: (_args, value) => ({ taskId: value.taskId, status: value.status }),
    },
    timeoutMs: 900000,
    async execute(args, exec) {
      const taskId = asString(args.task_id).trim();
      if (!taskId) throw new Error('task_id 不能为空');
      const cwd = exec && exec.agent && exec.agent.session && exec.agent.session.header ? asString(exec.agent.session.header.cwd) : '';
      const saveTo = asString(args.save_to).trim();
      return pollVideoTask({
        config: loadConfig(),
        taskId,
        profileId: asString(args.profile).trim(),
        saveTo: saveTo ? (isAbsolute(saveTo) ? saveTo : resolve(cwd || process.cwd(), saveTo)) : '',
        signal: exec && exec.signal,
      });
    },
  };
}

function registerTools(ctx, runtime) {
  const tools = ctx.tools;
  if (!tools || typeof tools.register !== 'function') return;
  ctx.effect(() => tools.register(defineGenerateImage(runtime)), `${PLUGIN_NAME}: generate_image`);
  ctx.effect(() => tools.register(defineGenerateVideo()), `${PLUGIN_NAME}: generate_video`);
  ctx.effect(() => tools.register(defineCheckVideo()), `${PLUGIN_NAME}: check_video`);
  const log = typeof ctx.logger === 'function' ? ctx.logger(PLUGIN_NAME) : ctx.logger;
  if (log && typeof log.info === 'function') log.info('tools registered: generate_image / generate_video / check_video');
}

// ─────────────────────────────────────────────────────────── 入口

export function apply(ctx) {
  const runtime = {
    getAttachments: () => {
      try {
        return ctx.get('attachments') || null;
      } catch {
        return null;
      }
    },
  };

  ensureDir(dataDir());

  ctx.inject(['tools'], (toolCtx) => {
    registerTools(toolCtx, runtime);
  });

  ctx.inject(['webServer'], (webCtx) => {
    registerRoutes(webCtx, runtime);
  });
}

export default { name, apply };
