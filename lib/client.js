/**
 * dsh-omni-modal — 全模态（生图 / 生视频）模型配置插件 · 浏览器半
 *
 * 形态：手写 CJS bundle（`window.__ModuleLoader__.load({ id, factory })`）。
 * 本机没有 esbuild / pnpm，所以不走上游那套构建链，直接按 wallpaper-engine
 * 的「手写产物」范式交付：factory 只注册，物化时才执行；尾部必须导出
 * `apply` 与 `inject`。
 *
 * require 目标只用平台 seed 表里的 `react`（README 明确：React / Cordis /
 * 静态 UI 库在外壳初始化时冻结进模块表，动态 bundle 精确针对该基座解析）。
 * 样式走官方同款 `data-plugin-css` 幂等注入，不额外依赖任何 UI 包。
 */

window.__ModuleLoader__.load({
	id: "dsh-omni-modal",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// ────────────────────────────────────────────────────── 基座

		const React = require("react");
		const h = React.createElement;
		const { useState, useEffect, useCallback } = React;

		const BASE = "/omni-modal";

		// ────────────────────────────────────────────────────── 样式

		const CSS = `
.omni-root { display: flex; flex-direction: column; gap: 16px; padding: 4px 2px 24px; font-size: 13px; color: var(--dsw-alias-label-primary, #e6e6e6); }
.omni-title { font-size: 16px; font-weight: 600; margin: 0; }
.omni-sub { color: var(--dsw-alias-label-tertiary, #9aa0a6); font-size: 12px; line-height: 1.6; margin: 0; }
.omni-card { border: 1px solid rgba(127,127,127,0.22); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 12px; background: rgba(127,127,127,0.04); }
.omni-card-title { font-weight: 600; font-size: 13px; margin: 0; display: flex; align-items: center; gap: 8px; }
.omni-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
.omni-field { display: flex; flex-direction: column; gap: 4px; flex: 1 1 220px; min-width: 180px; }
.omni-field-wide { flex: 1 1 100%; }
.omni-label { font-size: 12px; color: var(--dsw-alias-label-primary, #e6e6e6); }
.omni-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary, #9aa0a6); }
.omni-input, .omni-textarea, .omni-select { width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 7px; border: 1px solid rgba(127,127,127,0.3); background: rgba(0,0,0,0.18); color: inherit; font: inherit; outline: none; }
.omni-input:focus, .omni-textarea:focus, .omni-select:focus { border-color: var(--dsw-static-blue-500, #4c8dff); }
.omni-textarea { min-height: 62px; resize: vertical; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.omni-btn { padding: 7px 14px; border-radius: 7px; border: 1px solid rgba(127,127,127,0.3); background: rgba(127,127,127,0.10); color: inherit; font: inherit; cursor: pointer; white-space: nowrap; }
.omni-btn:hover:not(:disabled) { background: rgba(127,127,127,0.20); }
.omni-btn:disabled { opacity: 0.45; cursor: default; }
.omni-btn-primary { background: var(--dsw-static-blue-600, #2f6fe0); border-color: transparent; color: #fff; }
.omni-btn-primary:hover:not(:disabled) { background: var(--dsw-static-blue-500, #4c8dff); }
.omni-btn-danger { color: var(--dsw-alias-state-error-primary, #ff6b6b); }
.omni-tabs { display: flex; gap: 6px; }
.omni-tab { padding: 6px 12px; border-radius: 999px; border: 1px solid rgba(127,127,127,0.28); background: transparent; color: inherit; font: inherit; cursor: pointer; font-size: 12px; }
.omni-tab[data-active="true"] { background: rgba(127,127,127,0.20); font-weight: 600; }
.omni-note { border-radius: 8px; padding: 8px 11px; font-size: 12px; line-height: 1.6; }
.omni-note-ok { background: rgba(46,160,67,0.14); color: var(--dsw-alias-state-success-primary, #3fb950); }
.omni-note-err { background: rgba(248,81,73,0.14); color: var(--dsw-alias-state-error-primary, #ff6b6b); }
.omni-note-info { background: rgba(127,127,127,0.12); color: var(--dsw-alias-label-tertiary, #9aa0a6); }
.omni-tasks { display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow: auto; }
.omni-task { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; border-bottom: 1px solid rgba(127,127,127,0.14); padding: 7px 2px; font-size: 12px; }
.omni-mono { font-family: ui-monospace, Menlo, Consolas, monospace; word-break: break-all; }
.omni-badge { display: inline-block; margin-left: 8px; padding: 1px 8px; border-radius: 999px; font-size: 11px; line-height: 1.6; background: rgba(127,127,127,0.16); color: var(--dsw-alias-label-tertiary, #9aa0a6); }
.omni-badge[data-status="succeeded"] { background: rgba(46,160,67,0.16); color: var(--dsw-alias-state-success-primary, #3fb950); }
.omni-badge[data-status="failed"] { background: rgba(248,81,73,0.16); color: var(--dsw-alias-state-error-primary, #ff6b6b); }
.omni-badge[data-status="running"] { background: rgba(210,153,34,0.18); color: #d29922; }
.omni-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.omni-spacer { flex: 1 1 auto; }
`;

		const CSS_TAG_ID = "dsh-omni-modal/client.css";
		function installCss() {
			if (typeof document === "undefined") return;
			if (document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG_ID) + ']') !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-omni-modal";
			tag.dataset.pluginCss = CSS_TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		// ────────────────────────────────────────────────────── 宿主 API

		function apiUrl(path) {
			const p = String(path == null ? "" : path);
			if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith("data:") || p.startsWith("blob:")) return p;
			if (p.startsWith(BASE)) return p;
			return BASE + (p.startsWith("/") ? p : "/" + p);
		}

		async function apiFetch(path, options) {
			const o = options || {};
			const url = apiUrl(path);
			const init = { method: o.method || "GET", cache: o.cache || "no-store" };
			if (o.headers) init.headers = o.headers;
			if (o.body !== undefined) init.body = o.body;
			if (o.signal) init.signal = o.signal;
			let response;
			try {
				response = await fetch(url, init);
			} catch (e) {
				return { ok: false, status: 0, data: null, error: String((e && e.message) || e), url };
			}
			let data = null;
			let error = "";
			if (o.parse !== false && o.parse !== "none") {
				try {
					data = await response.json();
				} catch {
					try {
						const text = await response.text();
						data = text ? JSON.parse(text) : null;
					} catch (e2) {
						data = null;
						error = "parse:" + String((e2 && e2.message) || e2);
					}
				}
			}
			return { ok: response.ok, status: response.status, data, error, response, url };
		}

		const apiJson = (path, options) => apiFetch(path, Object.assign({ method: "GET" }, options));
		const apiPostJson = (path, payload, options) =>
			apiFetch(path, Object.assign({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload === undefined ? {} : payload) }, options));

		// ────────────────────────────────────────────────────── 小工具

		function clone(value) {
			return value === undefined ? value : JSON.parse(JSON.stringify(value));
		}

		function messageOf(result, fallback) {
			const data = result && result.data;
			if (data && typeof data === "object") {
				if (typeof data.message === "string" && data.message) return data.message;
				if (typeof data.error === "string" && data.error) return data.error;
			}
			if (result && result.error) return result.error;
			if (result && result.status) return `HTTP ${result.status}`;
			return fallback || "未知错误";
		}

		function statusLabel(status) {
			const s = String(status || "").toLowerCase();
			if (s === "succeeded") return "已完成";
			if (s === "failed") return "失败";
			if (s === "running") return "进行中";
			return status ? String(status) : "未知";
		}

		// ────────────────────────────────────────────────────── 基础控件

		function TextField(props) {
			const { label, hint, value, onChange, placeholder, type, wide, disabled } = props;
			return h(
				"label",
				{ className: "omni-field" + (wide ? " omni-field-wide" : "") },
				h("span", { className: "omni-label" }, label),
				h("input", {
					className: "omni-input",
					type: type || "text",
					value: value == null ? "" : value,
					placeholder: placeholder || "",
					disabled: disabled === true,
					onChange: (e) => onChange(e.target.value),
				}),
				hint ? h("span", { className: "omni-hint" }, hint) : null,
			);
		}

		function SecretField(props) {
			const { label, hint, value, onChange, placeholder } = props;
			const [shown, setShown] = useState(false);
			return h(
				"label",
				{ className: "omni-field" },
				h(
					"span",
					{ className: "omni-label" },
					label,
					h(
						"button",
						{
							type: "button",
							className: "omni-btn",
							style: { marginLeft: 8, padding: "1px 8px", fontSize: 11 },
							onClick: () => setShown((v) => !v),
						},
						shown ? "隐藏" : "显示",
					),
				),
				h("input", {
					className: "omni-input",
					type: shown ? "text" : "password",
					autoComplete: "new-password",
					value: value == null ? "" : value,
					placeholder: placeholder || "",
					onChange: (e) => onChange(e.target.value),
				}),
				hint ? h("span", { className: "omni-hint" }, hint) : null,
			);
		}

		function TextAreaField(props) {
			const { label, hint, value, onChange, placeholder } = props;
			return h(
				"label",
				{ className: "omni-field omni-field-wide" },
				h("span", { className: "omni-label" }, label),
				h("textarea", {
					className: "omni-textarea",
					value: value == null ? "" : value,
					placeholder: placeholder || "",
					onChange: (e) => onChange(e.target.value),
				}),
				hint ? h("span", { className: "omni-hint" }, hint) : null,
			);
		}

		// ────────────────────────────────────────────────────── 配置页

		function sideFields(kind) {
			return kind === "video"
				? [
						["submitPath", "提交路径", "POST 提交任务，默认 /videos/generations"],
						["queryPath", "查询路径", "用 {id} 占位任务 ID，默认 /videos/generations/{id}"],
						["size", "默认分辨率", "例如 1280x720，留空则不带该参数"],
						["seconds", "默认时长（秒）", "例如 5，留空则不带该参数"],
					]
				: [
						["path", "请求路径", "默认 /images/generations"],
						["size", "默认尺寸", "例如 1024x1024，留空则不带该参数"],
					];
		}

		function OmniModalSection() {
			const [loading, setLoading] = useState(true);
			const [loadError, setLoadError] = useState("");
			const [dataDir, setDataDir] = useState("");
			const [draft, setDraft] = useState(null);
			const [activeId, setActiveId] = useState("");
			const [tab, setTab] = useState("image");
			const [tasks, setTasks] = useState([]);
			const [notice, setNotice] = useState(null);
			const [saving, setSaving] = useState(false);
			const [testing, setTesting] = useState("");
			const [newName, setNewName] = useState("");

			const load = useCallback(async () => {
				const res = await apiJson("/config");
				if (!res.ok || !res.data || res.data.ok !== true) {
					setLoadError(messageOf(res, "读取配置失败"));
					setLoading(false);
					return;
				}
				setLoadError("");
				setDataDir(res.data.dataDir || "");
				setDraft(clone(res.data.config));
				setActiveId(res.data.config.active || "");
				setTasks(Array.isArray(res.data.tasks) ? res.data.tasks : []);
				setLoading(false);
			}, []);

			useEffect(() => {
				load();
			}, [load]);

			const profile = draft && draft.profiles ? draft.profiles[activeId] : null;

			const patchSide = (kind, key, value) => {
				setDraft((prev) => {
					if (!prev || !prev.profiles[activeId]) return prev;
					const next = clone(prev);
					next.profiles[activeId][kind][key] = value;
					return next;
				});
				setNotice(null);
			};

			const patchLabel = (value) => {
				setDraft((prev) => {
					if (!prev || !prev.profiles[activeId]) return prev;
					const next = clone(prev);
					next.profiles[activeId].label = value;
					return next;
				});
				setNotice(null);
			};

			const save = async () => {
				if (!draft) return;
				setSaving(true);
				const res = await apiPostJson("/config", { config: draft });
				setSaving(false);
				if (res.ok && res.data && res.data.ok === true) {
					setDraft(clone(res.data.config));
					setNotice({ ok: true, message: "已保存到 " + (dataDir || "插件数据目录") + "。" });
				} else {
					setNotice({ ok: false, message: messageOf(res, "保存失败") });
				}
			};

			const test = async (kind) => {
				setTesting(kind);
				const res = await apiPostJson("/test", { kind, profile: activeId });
				setTesting("");
				if (res.ok && res.data) {
					setNotice({ ok: res.data.ok === true, message: res.data.message || (res.data.ok ? "接口可达" : "接口不可达") });
				} else {
					setNotice({ ok: false, message: messageOf(res, "测试失败") });
				}
			};

			const activate = async (id) => {
				const res = await apiPostJson("/activate", { id });
				if (res.ok && res.data && res.data.ok === true) {
					setDraft(clone(res.data.config));
					setActiveId(id);
					setNotice({ ok: true, message: `已切换到档案「${id}」，工具会立即使用这套配置。` });
				} else {
					setNotice({ ok: false, message: messageOf(res, "切换失败") });
				}
			};

			const addProfile = () => {
				const raw = (newName || "").trim();
				const id = raw && !Object.prototype.hasOwnProperty.call(draft.profiles, raw) ? raw : `profile-${Object.keys(draft.profiles).length + 1}`;
				const label = raw || `档案 ${Object.keys(draft.profiles).length + 1}`;
				setDraft((prev) => {
					const next = clone(prev);
					const seed = clone(next.profiles[next.active] || Object.values(next.profiles)[0]);
					seed.id = id;
					seed.label = label;
					next.profiles[id] = seed;
					return next;
				});
				setActiveId(id);
				setNewName("");
				setNotice({ ok: true, message: `已新增档案「${label}」（内容复制自当前档案），记得点「保存」。` });
			};

			const removeProfile = () => {
				const ids = Object.keys(draft.profiles);
				if (ids.length <= 1) {
					setNotice({ ok: false, message: "至少要保留一套档案。" });
					return;
				}
				setDraft((prev) => {
					const next = clone(prev);
					delete next.profiles[activeId];
					return next;
				});
				const rest = ids.filter((id) => id !== activeId);
				setActiveId(rest[0]);
				setNotice({ ok: true, message: "已删除该档案，记得点「保存」。" });
			};

			const clearTasks = async () => {
				const res = await apiFetch("/tasks", { method: "DELETE", parse: false });
				if (res.ok) setTasks([]);
			};

			if (loading) return h("div", { className: "omni-root" }, h("p", { className: "omni-sub" }, "正在读取配置…"));
			if (loadError) {
				return h(
					"div",
					{ className: "omni-root" },
					h("h2", { className: "omni-title" }, "全模态设置"),
					h("div", { className: "omni-note omni-note-err" }, loadError),
				);
			}
			if (!draft || !profile) return null;

			const noticeEl = notice
				? h("div", { className: "omni-note " + (notice.ok ? "omni-note-ok" : "omni-note-err") }, notice.message)
				: null;

			const header = h(
				"div",
				{ className: "omni-root", style: { padding: 0 } },
				h("h2", { className: "omni-title" }, "全模态设置"),
				h(
					"p",
					{ className: "omni-sub" },
					"给没有生图 / 生视频能力的模型补上这两项能力。配置保存在 ",
					h("span", { className: "omni-mono" }, dataDir || "(插件数据目录)"),
					"；模型工具 generate_image / generate_video / check_video 始终使用「当前生效档案」。",
				),
			);

			const profileCard = h(
				"div",
				{ className: "omni-card" },
				h("p", { className: "omni-card-title" }, "配置档案"),
				h(
					"div",
					{ className: "omni-row" },
					h(
						"label",
						{ className: "omni-field" },
						h("span", { className: "omni-label" }, "当前生效档案"),
						h(
							"select",
							{
								className: "omni-select",
								value: activeId,
								onChange: (e) => {
									const id = e.target.value;
									setActiveId(id);
									if (draft.active !== id) activate(id);
								},
							},
							Object.values(draft.profiles).map((p) => h("option", { key: p.id, value: p.id }, `${p.label}（${p.id}）${p.id === draft.active ? " · 生效中" : ""}`)),
						),
					),
					h(TextField, { label: "档案名称", value: profile.label, onChange: patchLabel }),
					h(
						"div",
						{ className: "omni-field" },
						h("span", { className: "omni-label" }, "新增档案"),
						h(
							"div",
							{ className: "omni-row", style: { flexWrap: "nowrap" } },
							h("input", {
								className: "omni-input",
								placeholder: "新档案名（可留空）",
								value: newName,
								onChange: (e) => setNewName(e.target.value),
							}),
							h("button", { type: "button", className: "omni-btn", onClick: addProfile }, "新增"),
							h("button", { type: "button", className: "omni-btn omni-btn-danger", onClick: removeProfile }, "删除"),
						),
					),
				),
			);

			const side = profile[tab === "video" ? "video" : "image"];
			const kind = tab === "video" ? "video" : "image";

			const sideCard = h(
				"div",
				{ className: "omni-card" },
				h(
					"div",
					{ className: "omni-actions" },
					h("p", { className: "omni-card-title", style: { margin: 0 } }, kind === "video" ? "生视频配置" : "生图配置"),
					h("span", { className: "omni-spacer" }),
					h("button", { type: "button", className: "omni-btn", disabled: testing !== "", onClick: () => test(kind) }, testing === kind ? "测试中…" : "测试连通性"),
				),
				h(TextField, {
					label: "接口地址（Base URL）",
					hint: "OpenAI 兼容端点，例如 https://api.example.com/v1",
					value: side.baseUrl,
					placeholder: "https://api.example.com/v1",
					onChange: (v) => patchSide(kind, "baseUrl", v),
					wide: true,
				}),
				h(SecretField, {
					label: "API Key",
					hint: "以 Bearer 方式发送；留空则不发送 Authorization 头。",
					value: side.apiKey,
					placeholder: "sk-…",
					onChange: (v) => patchSide(kind, "apiKey", v),
				}),
				h("div", { className: "omni-row" }, h(TextField, { label: "模型名称", value: side.model, placeholder: kind === "video" ? "例如 sora-2 / veo-3" : "例如 gpt-image-1 / seedream-4", onChange: (v) => patchSide(kind, "model", v) })),
				h(
					"div",
					{ className: "omni-row" },
					sideFields(kind).map(([key, label, hint]) =>
						h(TextField, { key, label, hint, value: side[key], onChange: (v) => patchSide(kind, key, v) }),
					),
				),
				h(TextAreaField, {
					label: "额外请求参数（JSON，可选）",
					hint: "会合并进请求体，用来传各家特有的参数，例如 {\"quality\":\"high\",\"watermark\":false}",
					value: side.extra,
					placeholder: "{}",
					onChange: (v) => patchSide(kind, "extra", v),
				}),
			);

			const tasksCard = h(
				"div",
				{ className: "omni-card" },
				h(
					"div",
					{ className: "omni-actions" },
					h("p", { className: "omni-card-title", style: { margin: 0 } }, "最近提交的生视频任务"),
					h("span", { className: "omni-spacer" }),
					h("button", { type: "button", className: "omni-btn", onClick: load }, "刷新"),
					h("button", { type: "button", className: "omni-btn omni-btn-danger", onClick: clearTasks }, "清空记录"),
				),
				tasks.length === 0
					? h("p", { className: "omni-sub" }, "还没有任务记录。用 generate_video 提交任务后会出现在这里。")
					: h(
						"div",
						{ className: "omni-tasks" },
						tasks.map((row) =>
							h(
								"div",
								{ key: row.taskId, className: "omni-task" },
								h(
									"div",
									null,
									h("span", { className: "omni-mono" }, row.taskId),
									row.status ? h("span", { className: "omni-badge", "data-status": String(row.status) }, statusLabel(row.status)) : null,
								),
								h("div", { className: "omni-hint" }, `${row.profileLabel || row.profile || ""} · ${row.model || ""} · ${row.createdAt || ""}`),
								h("div", { className: "omni-hint" }, row.path || row.url || row.message || row.baseUrl || ""),
							),
						),
					),
			);

			const footer = h(
				"div",
				{ className: "omni-actions" },
				h("button", { type: "button", className: "omni-btn omni-btn-primary", disabled: saving, onClick: save }, saving ? "保存中…" : "保存配置"),
				h("button", { type: "button", className: "omni-btn", onClick: load }, "重新读取"),
				h("span", { className: "omni-sub" }, "保存后立即对工具生效，无需重启。"),
			);

			return h(
				"div",
				{ className: "omni-root" },
				header,
				noticeEl,
				profileCard,
				h(
					"div",
					{ className: "omni-tabs" },
					h("button", { type: "button", className: "omni-tab", "data-active": String(tab === "image"), onClick: () => setTab("image") }, "生图"),
					h("button", { type: "button", className: "omni-tab", "data-active": String(tab === "video"), onClick: () => setTab("video") }, "生视频"),
					h("button", { type: "button", className: "omni-tab", "data-active": String(tab === "tasks"), onClick: () => setTab("tasks") }, "任务记录"),
				),
				tab === "tasks" ? tasksCard : sideCard,
				footer,
			);
		}

		// ────────────────────────────────────────────────────── 入口

		const inject = ["slots"];

		function apply(ctx) {
			installCss();
			if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function") return;
			ctx.effect(
				() =>
					ctx.slots.inject("settings.section", () =>
						ctx.slots.register(
							{
								name: "settings.section",
								id: "omni-modal",
								order: 20,
								label: () => "全模态设置",
							},
							OmniModalSection,
						),
					),
				"dsh-omni-modal: settings section",
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
