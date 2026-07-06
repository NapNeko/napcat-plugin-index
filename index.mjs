import fs from "node:fs/promises";
import path from "node:path";
import dns from "node:dns";

const PLUGIN_ID = "napcat-plugin-glm-4-7-flash";

const DEFAULT_CONFIG = {
  apiKey: "",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  model: "glm-4.7-flash",
  preferIPv4: true,
  logNetworkErrorDetail: true,
  targetQQ: "",
  triggerMode: "mention_or_reply",
  enablePrivateChat: false,
  enableTemporarySessionChat: false,
  privateChatAdminOnly: false,
  adminQQ: "",
  stripTrigger: true,
  quoteReply: true,
  replyWithAt: false,
  systemPrompt: "你是一个友好、简洁、可靠的 QQ 聊天助手。优先使用中文回答。",
  maxHistoryRounds: 8,
  temperature: 0.7,
  maxTokens: 1024,
  autoContinueTruncated: true,
  maxContinuationRounds: 2,
  continuationPrompt: "继续上一次回答，不要重复已经说过的内容，直接从中断处继续。",
  timeoutMs: 120000,
  maxAttempts: 3,
  retryDelayMs: 2500,
  maxReplyChars: 3500,
  resetCommand: "/重置会话",
  busyMessage: "上一条还在思考中，请稍等一下。",
  missingApiKeyMessage: "请先在 NapCat 插件配置里填写 GLM API Key。",
  emptyPromptMessage: "我在，请把问题和 @ 或回复一起发来。",
  timeoutMessage: "请求 GLM 超时了，请稍后再试；如果经常出现，请检查服务器网络或把请求超时调大。",
  networkErrorMessage: "连接 GLM 接口失败，我已经自动重试过了。请检查服务器网络、DNS、代理或防火墙。",
  rateLimitMessage: "GLM-4.7-Flash 当前访问量过大，我已经自动重试过了。请稍后再试。",
  errorMessage: "GLM 暂时没有回应，请稍后再试。"
};

let currentConfig = { ...DEFAULT_CONFIG };
let botQQ = "";
let configFile = "";
let currentDnsOrder = "";
const sessions = new Map();
const inFlight = new Set();

export const plugin_config_ui = [
  {
    key: "apiKey",
    type: "string",
    label: "GLM API Key",
    description: "智谱 BigModel API Key。也可以留空并使用环境变量 ZHIPUAI_API_KEY 或 GLM_API_KEY。",
    default: DEFAULT_CONFIG.apiKey,
    placeholder: "填入你的 API Key"
  },
  {
    key: "baseUrl",
    type: "string",
    label: "接口地址",
    description: "OpenAI 兼容接口根地址。默认会自动拼接 /chat/completions。",
    default: DEFAULT_CONFIG.baseUrl
  },
  {
    key: "model",
    type: "string",
    label: "模型",
    description: "默认对接 GLM-4.7-Flash。",
    default: DEFAULT_CONFIG.model
  },
  {
    key: "preferIPv4",
    type: "boolean",
    label: "优先使用 IPv4",
    description: "开启后让 Node 网络请求优先走 IPv4，可解决 curl 正常但 fetch failed 的一部分情况。",
    default: DEFAULT_CONFIG.preferIPv4
  },
  {
    key: "logNetworkErrorDetail",
    type: "boolean",
    label: "记录网络错误详情",
    description: "开启后 fetch failed 会额外记录底层原因，例如 DNS、IPv6、TLS 或连接重置。",
    default: DEFAULT_CONFIG.logNetworkErrorDetail
  },
  {
    key: "targetQQ",
    type: "string",
    label: "触发 QQ",
    description: "群聊中只有 @这个 QQ 或回复这个 QQ 发出的消息才触发。留空时自动使用当前登录 QQ。",
    default: DEFAULT_CONFIG.targetQQ,
    placeholder: "例如 123456789"
  },
  {
    key: "triggerMode",
    type: "select",
    label: "群聊触发方式",
    description: "控制群聊里哪些消息会触发模型。",
    default: DEFAULT_CONFIG.triggerMode,
    options: [
      { label: "@ 或回复", value: "mention_or_reply" },
      { label: "仅 @", value: "mention" },
      { label: "仅回复", value: "reply" }
    ]
  },
  {
    key: "enablePrivateChat",
    type: "boolean",
    label: "允许私聊直接触发",
    description: "关闭时，私聊也需要回复目标 QQ 消息才触发。",
    default: DEFAULT_CONFIG.enablePrivateChat
  },
  {
    key: "enableTemporarySessionChat",
    type: "boolean",
    label: "允许临时会话回复",
    description: "开启后，群临时会话等非好友私聊也可以按私聊规则触发。",
    default: DEFAULT_CONFIG.enableTemporarySessionChat
  },
  {
    key: "privateChatAdminOnly",
    type: "boolean",
    label: "私聊仅回复管理员",
    description: "开启后，私聊只响应管理员 QQ，普通用户私聊会被忽略。",
    default: DEFAULT_CONFIG.privateChatAdminOnly
  },
  {
    key: "adminQQ",
    type: "string",
    label: "管理员 QQ",
    description: "多个 QQ 可用逗号、空格或换行分隔。私聊仅回复管理员开启时使用。",
    default: DEFAULT_CONFIG.adminQQ,
    placeholder: "例如 123456789,987654321"
  },
  {
    key: "stripTrigger",
    type: "boolean",
    label: "移除触发标记",
    description: "发送给模型前移除 @目标 QQ 和回复标记。",
    default: DEFAULT_CONFIG.stripTrigger
  },
  {
    key: "quoteReply",
    type: "boolean",
    label: "回复时引用原消息",
    description: "开启后，机器人回复会引用触发它的那条消息。",
    default: DEFAULT_CONFIG.quoteReply
  },
  {
    key: "replyWithAt",
    type: "boolean",
    label: "群聊回复时 @发送者",
    description: "开启后，群聊回答前会 @提问者。",
    default: DEFAULT_CONFIG.replyWithAt
  },
  {
    key: "systemPrompt",
    type: "string",
    label: "系统提示词",
    description: "每次请求都会带给模型的角色设定。",
    default: DEFAULT_CONFIG.systemPrompt
  },
  {
    key: "maxHistoryRounds",
    type: "number",
    label: "记忆轮数",
    description: "每个群成员或私聊保留的上下文轮数。设为 0 可关闭记忆。",
    default: DEFAULT_CONFIG.maxHistoryRounds
  },
  {
    key: "temperature",
    type: "number",
    label: "温度",
    description: "越高越发散，建议 0.3 到 0.9。",
    default: DEFAULT_CONFIG.temperature
  },
  {
    key: "maxTokens",
    type: "number",
    label: "最大输出 Tokens",
    default: DEFAULT_CONFIG.maxTokens
  },
  {
    key: "autoContinueTruncated",
    type: "boolean",
    label: "自动续写截断回复",
    description: "模型因为输出长度限制中断时，自动继续请求并拼接后再发送。",
    default: DEFAULT_CONFIG.autoContinueTruncated
  },
  {
    key: "maxContinuationRounds",
    type: "number",
    label: "截断续写轮数",
    description: "仅在自动续写截断回复开启时生效。建议 1 到 3。",
    default: DEFAULT_CONFIG.maxContinuationRounds
  },
  {
    key: "timeoutMs",
    type: "number",
    label: "请求超时毫秒",
    default: DEFAULT_CONFIG.timeoutMs
  },
  {
    key: "maxAttempts",
    type: "number",
    label: "最大请求次数",
    description: "包含第一次请求。填 3 表示最多请求 3 次。",
    default: DEFAULT_CONFIG.maxAttempts
  },
  {
    key: "retryDelayMs",
    type: "number",
    label: "重试基础间隔毫秒",
    description: "每次重试会按 1x、2x、3x 递增等待。",
    default: DEFAULT_CONFIG.retryDelayMs
  },
  {
    key: "maxReplyChars",
    type: "number",
    label: "单条回复最大字数",
    description: "超过后会分段发送。",
    default: DEFAULT_CONFIG.maxReplyChars
  },
  {
    key: "resetCommand",
    type: "string",
    label: "重置会话命令",
    description: "在触发消息中发送这个命令可清空当前会话记忆。",
    default: DEFAULT_CONFIG.resetCommand
  },
  {
    key: "busyMessage",
    type: "string",
    label: "忙碌提示",
    default: DEFAULT_CONFIG.busyMessage
  },
  {
    key: "missingApiKeyMessage",
    type: "string",
    label: "未配置 Key 提示",
    default: DEFAULT_CONFIG.missingApiKeyMessage
  },
  {
    key: "emptyPromptMessage",
    type: "string",
    label: "空问题提示",
    default: DEFAULT_CONFIG.emptyPromptMessage
  },
  {
    key: "timeoutMessage",
    type: "string",
    label: "超时提示",
    default: DEFAULT_CONFIG.timeoutMessage
  },
  {
    key: "networkErrorMessage",
    type: "string",
    label: "网络失败提示",
    default: DEFAULT_CONFIG.networkErrorMessage
  },
  {
    key: "rateLimitMessage",
    type: "string",
    label: "模型繁忙提示",
    default: DEFAULT_CONFIG.rateLimitMessage
  },
  {
    key: "errorMessage",
    type: "string",
    label: "错误提示",
    default: DEFAULT_CONFIG.errorMessage
  }
];

export const plugin_config_schema = plugin_config_ui;

export async function plugin_init(ctx) {
  configFile = getConfigFile(ctx);
  currentConfig = await loadConfig(ctx);
  applyNetworkPreferences(ctx);
  botQQ = currentConfig.targetQQ || await getLoginQQ(ctx);

  if (!botQQ) {
    ctx.logger.warn("未能自动获取登录 QQ，请在插件配置中填写触发 QQ。");
  }

  ctx.logger.info(`GLM-4.7-Flash 插件已启动，群聊触发 QQ: ${botQQ || "未设置"}`);
}

export async function plugin_get_config(ctx) {
  configFile = getConfigFile(ctx);
  currentConfig = await loadConfig(ctx);
  return currentConfig;
}

export async function plugin_set_config(ctx, config) {
  configFile = getConfigFile(ctx);
  currentConfig = normalizeConfig(config);
  applyNetworkPreferences(ctx);
  await saveConfig(currentConfig);
  if (currentConfig.targetQQ) {
    botQQ = currentConfig.targetQQ;
  } else {
    botQQ = await getLoginQQ(ctx);
  }
}

export async function plugin_on_config_change(ctx, _ui, _key, _value, currentConfigFromUI) {
  currentConfig = normalizeConfig(currentConfigFromUI);
  applyNetworkPreferences(ctx);
  await saveConfig(currentConfig);
  botQQ = currentConfig.targetQQ || botQQ || await getLoginQQ(ctx);
}

export async function plugin_onmessage(ctx, event) {
  try {
    if (event?.post_type && event.post_type !== "message") return;
    if (!isMessageEvent(event)) return;

    const targetQQ = resolveTargetQQ();
    if (targetQQ && String(event.user_id) === targetQQ) return;

    const trigger = await getTriggerState(ctx, event, targetQQ);
    if (!trigger.allowed) return;

    const prompt = extractPrompt(event, targetQQ);
    const sessionKey = getSessionKey(event);

    if (isResetCommand(prompt)) {
      sessions.delete(sessionKey);
      await sendReply(ctx, event, "会话已重置。");
      return;
    }

    if (!prompt) {
      await sendReply(ctx, event, currentConfig.emptyPromptMessage);
      return;
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      await sendReply(ctx, event, currentConfig.missingApiKeyMessage);
      return;
    }

    if (inFlight.has(sessionKey)) {
      await sendReply(ctx, event, currentConfig.busyMessage);
      return;
    }

    inFlight.add(sessionKey);
    try {
      const answer = await askGLM(ctx, sessionKey, prompt, event, apiKey);
      await sendReply(ctx, event, answer || currentConfig.errorMessage);
    } finally {
      inFlight.delete(sessionKey);
    }
  } catch (error) {
    if (isAbortError(error)) {
      ctx.logger.error(`GLM 请求超时，已中断。本次超时设置: ${currentConfig.timeoutMs}ms`, error);
    } else if (isNetworkError(error)) {
      ctx.logger.warn(`GLM 网络连接失败，已尝试 ${getMaxAttempts()} 次: ${formatNetworkError(error)}`);
    } else if (isRateLimitError(error)) {
      ctx.logger.warn(`GLM 模型繁忙或限流，状态码 ${error.status || "unknown"}，错误码 ${error.apiCode || "unknown"}`);
    } else {
      ctx.logger.error("GLM 插件处理消息失败:", error);
    }

    const message = isAbortError(error)
      ? currentConfig.timeoutMessage
      : isNetworkError(error)
        ? currentConfig.networkErrorMessage
      : isRateLimitError(error)
        ? currentConfig.rateLimitMessage
        : currentConfig.errorMessage;
    await sendReply(ctx, event, message).catch((sendError) => {
      ctx.logger.error("发送错误提示失败:", sendError);
    });
  }
}

export function plugin_cleanup(ctx) {
  sessions.clear();
  inFlight.clear();
  ctx.logger.info("GLM-4.7-Flash 插件已清理。");
}

function isMessageEvent(event) {
  return event && (event.message_type === "group" || event.message_type === "private");
}

async function getTriggerState(ctx, event, targetQQ) {
  const isPrivate = event.message_type === "private";
  const repliedToTarget = await isReplyToTarget(ctx, event, targetQQ);

  if (isPrivate) {
    if (isTemporaryPrivateEvent(event) && !currentConfig.enableTemporarySessionChat) {
      return { allowed: false, reason: "temporary_private_disabled" };
    }
    if (currentConfig.privateChatAdminOnly) {
      return { allowed: isAdminQQ(event.user_id), reason: "private_admin_only" };
    }
    return { allowed: currentConfig.enablePrivateChat || repliedToTarget, reason: "private" };
  }

  const mentionedTarget = isMentioningTarget(event, targetQQ);
  if (currentConfig.triggerMode === "mention") {
    return { allowed: mentionedTarget, reason: "mention" };
  }
  if (currentConfig.triggerMode === "reply") {
    return { allowed: repliedToTarget, reason: "reply" };
  }
  return { allowed: mentionedTarget || repliedToTarget, reason: "mention_or_reply" };
}

function isAdminQQ(userId) {
  const senderQQ = String(userId || "").replace(/\D/g, "");
  if (!senderQQ) return false;
  return normalizeQQList(currentConfig.adminQQ).includes(senderQQ);
}

function isTemporaryPrivateEvent(event) {
  if (event.message_type !== "private") return false;
  if (event.group_id || event?.sender?.group_id) return true;

  const subType = String(event.sub_type ?? event.subType ?? "").trim().toLowerCase();
  if (!subType) return false;
  return !["friend", "好友"].includes(subType);
}

function isMentioningTarget(event, targetQQ) {
  if (!targetQQ) return false;

  for (const segment of getSegments(event)) {
    if (segment?.type !== "at") continue;
    const qq = segmentQQ(segment);
    if (qq === targetQQ) return true;
  }

  return new RegExp(`\\[CQ:at,qq=${escapeRegExp(targetQQ)}\\]`).test(String(event.raw_message || ""));
}

async function isReplyToTarget(ctx, event, targetQQ) {
  if (!targetQQ) return false;

  const replySegments = getSegments(event).filter((segment) => segment?.type === "reply");
  const rawReplyIds = [...String(event.raw_message || "").matchAll(/\[CQ:reply,id=([^\],]+)[^\]]*\]/g)]
    .map((match) => match[1]);

  const replyIds = new Set();
  for (const segment of replySegments) {
    const directQQ = segmentQQ(segment);
    if (directQQ === targetQQ) return true;
    const id = segment?.data?.id ?? segment?.data?.message_id;
    if (id !== undefined && id !== null) replyIds.add(String(id));
  }
  for (const id of rawReplyIds) {
    replyIds.add(String(id));
  }

  for (const replyId of replyIds) {
    const repliedMessage = await getMessageById(ctx, replyId);
    const senderQQ = String(
      repliedMessage?.user_id ??
      repliedMessage?.sender?.user_id ??
      repliedMessage?.message?.user_id ??
      ""
    );
    if (senderQQ === targetQQ) return true;
  }

  return false;
}

async function getMessageById(ctx, messageId) {
  try {
    const parsedId = Number(messageId);
    const params = { message_id: Number.isFinite(parsedId) ? parsedId : messageId };
    const result = await callAction(ctx, "get_msg", params);
    return unwrapActionData(result);
  } catch (error) {
    ctx.logger.warn(`查询被回复消息失败: ${messageId}`, error);
    return undefined;
  }
}

function extractPrompt(event, targetQQ) {
  const segments = getSegments(event);
  let text = "";

  if (segments.length > 0) {
    text = segments.map((segment) => {
      if (!segment || typeof segment !== "object") return "";
      if (segment.type === "reply" && currentConfig.stripTrigger) return "";
      if (segment.type === "at") {
        const qq = segmentQQ(segment);
        if (currentConfig.stripTrigger && targetQQ && qq === targetQQ) return "";
        return qq ? `@${qq}` : "";
      }
      if (segment.type === "text") {
        return String(segment?.data?.text ?? segment?.data ?? "");
      }
      return `[${segment.type}]`;
    }).join("");
  }

  if (!text) {
    text = String(event.raw_message || "");
  }

  if (currentConfig.stripTrigger) {
    text = stripCQTrigger(text, targetQQ);
  }

  return text.replace(/\u00a0/g, " ").trim();
}

function stripCQTrigger(text, targetQQ) {
  let cleaned = text.replace(/\[CQ:reply,[^\]]+\]/g, "");
  if (targetQQ) {
    cleaned = cleaned.replace(new RegExp(`\\[CQ:at,qq=${escapeRegExp(targetQQ)}\\]`, "g"), "");
  }
  return cleaned.replace(/\[CQ:[^\]]+\]/g, "").trim();
}

async function askGLM(ctx, sessionKey, prompt, event, apiKey) {
  const history = sessions.get(sessionKey) ?? [];
  const userContent = buildUserContent(prompt, event);
  const messages = [
    { role: "system", content: currentConfig.systemPrompt },
    ...history,
    { role: "user", content: userContent }
  ];

  const body = JSON.stringify({
    model: currentConfig.model,
    messages,
    temperature: currentConfig.temperature,
    max_tokens: currentConfig.maxTokens,
    stream: false
  });

  const maxAttempts = getMaxAttempts();
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), currentConfig.timeoutMs);

    try {
      const response = await fetch(buildChatCompletionsUrl(currentConfig.baseUrl), {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body,
        signal: controller.signal
      });

      const bodyText = await response.text();
      if (!response.ok) {
        const error = createGLMApiError(response.status, bodyText);
        if (shouldRetryGLM(error, attempt, maxAttempts)) {
          ctx.logger.warn(`GLM 临时错误，准备第 ${attempt + 1}/${maxAttempts} 次尝试: ${error.message}`);
          await sleep(getRetryDelay(attempt));
          continue;
        }
        throw error;
      }

      const data = JSON.parse(bodyText);
      const choice = data?.choices?.[0] || {};
      let answer = normalizeModelContent(choice?.message?.content);
      let lastContent = answer;
      let finishReason = choice?.finish_reason || choice?.finishReason || "";

      for (let round = 0; currentConfig.autoContinueTruncated && isTruncatedFinishReason(finishReason) && round < getMaxContinuationRounds(); round += 1) {
        ctx.logger.warn(`GLM 回复被长度限制截断，准备续写第 ${round + 1}/${getMaxContinuationRounds()} 轮`);
        if (lastContent) {
          messages.push({ role: "assistant", content: lastContent });
        }
        messages.push({ role: "user", content: currentConfig.continuationPrompt || DEFAULT_CONFIG.continuationPrompt });

        const continuation = await fetchGLMChoice(apiKey, messages);
        lastContent = normalizeModelContent(continuation.content);
        if (lastContent) answer += lastContent;
        finishReason = continuation.finishReason;
      }

      if (isTruncatedFinishReason(finishReason)) {
        ctx.logger.warn(`GLM 回复可能仍被截断，已达到续写上限 ${getMaxContinuationRounds()} 轮`);
      }

      answer = answer.trim();
      remember(sessionKey, { role: "user", content: userContent }, { role: "assistant", content: answer });
      return answer;
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
      if (shouldRetryGLM(error, attempt, maxAttempts)) {
        ctx.logger.warn(`GLM 请求失败，准备第 ${attempt + 1}/${maxAttempts} 次尝试: ${formatNetworkError(error)}`);
        await sleep(getRetryDelay(attempt));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("GLM 请求失败");
}

async function fetchGLMChoice(apiKey, messages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), currentConfig.timeoutMs);

  try {
    const response = await fetch(buildChatCompletionsUrl(currentConfig.baseUrl), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: currentConfig.model,
        messages,
        temperature: currentConfig.temperature,
        max_tokens: currentConfig.maxTokens,
        stream: false
      }),
      signal: controller.signal
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw createGLMApiError(response.status, bodyText);
    }

    const data = JSON.parse(bodyText);
    const choice = data?.choices?.[0] || {};
    return {
      content: choice?.message?.content,
      finishReason: choice?.finish_reason || choice?.finishReason || ""
    };
  } finally {
    clearTimeout(timeout);
  }
}

function remember(sessionKey, userMessage, assistantMessage) {
  const maxRounds = currentConfig.maxHistoryRounds;
  if (maxRounds <= 0) return;

  const history = sessions.get(sessionKey) ?? [];
  history.push(userMessage, assistantMessage);
  const maxItems = maxRounds * 2;
  sessions.set(sessionKey, history.slice(-maxItems));
}

function buildUserContent(prompt, event) {
  if (event.message_type !== "group") return prompt;
  const senderName = event?.sender?.card || event?.sender?.nickname || event?.user_id;
  return `${senderName}(${event.user_id})：${prompt}`;
}

async function sendReply(ctx, event, text) {
  if (!event || !isMessageEvent(event)) return;
  const chunks = splitText(String(text || currentConfig.errorMessage), currentConfig.maxReplyChars);

  for (let index = 0; index < chunks.length; index += 1) {
    const firstChunk = index === 0;
    const params = {
      message_type: event.message_type,
      message: buildOutgoingMessage(event, chunks[index], firstChunk)
    };

    if (event.message_type === "group") {
      params.group_id = String(event.group_id);
    } else {
      params.user_id = String(event.user_id);
    }

    await callAction(ctx, "send_msg", params);
  }
}

function buildOutgoingMessage(event, text, firstChunk) {
  const segments = [];
  if (firstChunk && currentConfig.quoteReply && event.message_id !== undefined) {
    segments.push({ type: "reply", data: { id: String(event.message_id) } });
  }
  if (firstChunk && currentConfig.replyWithAt && event.message_type === "group") {
    segments.push({ type: "at", data: { qq: String(event.user_id) } });
    segments.push({ type: "text", data: { text: " " } });
  }
  segments.push({ type: "text", data: { text } });

  return segments.length === 1 ? text : segments;
}

function splitText(text, maxChars) {
  const limit = Math.max(500, Number(maxChars) || DEFAULT_CONFIG.maxReplyChars);
  if (text.length <= limit) return [text];

  const chunks = [];
  for (let start = 0; start < text.length; start += limit) {
    chunks.push(text.slice(start, start + limit));
  }
  return chunks;
}

function getSegments(event) {
  if (Array.isArray(event?.message)) return event.message;
  if (typeof event?.message === "string" && event.message) {
    return [{ type: "text", data: { text: event.message } }];
  }
  return [];
}

function segmentQQ(segment) {
  const data = segment?.data;
  return String(data?.qq ?? data?.user_id ?? data?.uin ?? "").trim();
}

function getSessionKey(event) {
  if (event.message_type === "group") {
    return `group:${event.group_id}:user:${event.user_id}`;
  }
  return `private:${event.user_id}`;
}

function isResetCommand(prompt) {
  const command = String(prompt || "").trim().toLowerCase();
  const custom = String(currentConfig.resetCommand || "").trim().toLowerCase();
  return command && [custom, "/reset", "reset", "重置会话", "清空会话"].includes(command);
}

function getApiKey() {
  return String(
    currentConfig.apiKey ||
    process.env.ZHIPUAI_API_KEY ||
    process.env.GLM_API_KEY ||
    ""
  ).trim();
}

function resolveTargetQQ() {
  return String(currentConfig.targetQQ || botQQ || "").trim();
}

async function getLoginQQ(ctx) {
  try {
    const result = await callAction(ctx, "get_login_info", void 0);
    const data = unwrapActionData(result);
    return String(data?.user_id ?? data?.uin ?? data?.qq ?? "").trim();
  } catch (error) {
    ctx.logger.warn("获取登录 QQ 失败:", error);
    return "";
  }
}

function applyNetworkPreferences(ctx) {
  const desiredOrder = currentConfig.preferIPv4 ? "ipv4first" : "verbatim";
  if (currentDnsOrder === desiredOrder) return;

  try {
    dns.setDefaultResultOrder(desiredOrder);
    currentDnsOrder = desiredOrder;
    ctx?.logger?.info?.(`GLM 网络 DNS 解析顺序已设置为 ${desiredOrder}`);
  } catch (error) {
    ctx?.logger?.warn?.(`设置 GLM 网络 DNS 解析顺序失败: ${formatNetworkError(error)}`);
  }
}

async function callAction(ctx, actionName, params) {
  return ctx.actions.call(actionName, params, ctx.adapterName, ctx.pluginManager.config);
}

function unwrapActionData(result) {
  if (result && typeof result === "object" && "data" in result) return result.data;
  return result;
}

function buildChatCompletionsUrl(baseUrl) {
  const url = String(baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(url)) return url;
  return `${url}/chat/completions`;
}

function normalizeModelContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      return part?.text ?? part?.content ?? part?.data?.text ?? "";
    }).join("");
  }
  return "";
}

async function loadConfig(ctx) {
  const file = getConfigFile(ctx);
  try {
    const raw = await fs.readFile(file, "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      ctx.logger.warn("读取配置失败，将使用默认配置:", error);
    }
    const normalized = normalizeConfig(DEFAULT_CONFIG);
    await saveConfig(normalized);
    return normalized;
  }
}

async function saveConfig(config) {
  if (!configFile) return;
  await fs.mkdir(path.dirname(configFile), { recursive: true });
  await fs.writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function getConfigFile(ctx) {
  const configDir = ctx?.configPath || ctx?.pluginManager?.getPluginConfigPath?.(PLUGIN_ID) || ctx?.pluginPath || ".";
  return path.join(configDir, "config.json");
}

function normalizeConfig(input) {
  const merged = { ...DEFAULT_CONFIG, ...(input || {}) };
  return {
    ...merged,
    apiKey: stringValue(merged.apiKey),
    baseUrl: stringValue(merged.baseUrl, DEFAULT_CONFIG.baseUrl),
    model: stringValue(merged.model, DEFAULT_CONFIG.model),
    preferIPv4: booleanValue(merged.preferIPv4, DEFAULT_CONFIG.preferIPv4),
    logNetworkErrorDetail: booleanValue(merged.logNetworkErrorDetail, DEFAULT_CONFIG.logNetworkErrorDetail),
    targetQQ: stringValue(merged.targetQQ).replace(/\D/g, ""),
    triggerMode: ["mention_or_reply", "mention", "reply"].includes(merged.triggerMode)
      ? merged.triggerMode
      : DEFAULT_CONFIG.triggerMode,
    enablePrivateChat: booleanValue(merged.enablePrivateChat, DEFAULT_CONFIG.enablePrivateChat),
    enableTemporarySessionChat: booleanValue(merged.enableTemporarySessionChat, DEFAULT_CONFIG.enableTemporarySessionChat),
    privateChatAdminOnly: booleanValue(merged.privateChatAdminOnly, DEFAULT_CONFIG.privateChatAdminOnly),
    adminQQ: normalizeQQList(merged.adminQQ).join(","),
    stripTrigger: booleanValue(merged.stripTrigger, DEFAULT_CONFIG.stripTrigger),
    quoteReply: booleanValue(merged.quoteReply, DEFAULT_CONFIG.quoteReply),
    replyWithAt: booleanValue(merged.replyWithAt, DEFAULT_CONFIG.replyWithAt),
    systemPrompt: stringValue(merged.systemPrompt, DEFAULT_CONFIG.systemPrompt),
    maxHistoryRounds: numberValue(merged.maxHistoryRounds, DEFAULT_CONFIG.maxHistoryRounds, 0, 50),
    temperature: numberValue(merged.temperature, DEFAULT_CONFIG.temperature, 0, 2),
    maxTokens: numberValue(merged.maxTokens, DEFAULT_CONFIG.maxTokens, 1, 8192),
    autoContinueTruncated: booleanValue(merged.autoContinueTruncated, DEFAULT_CONFIG.autoContinueTruncated),
    maxContinuationRounds: Math.floor(numberValue(merged.maxContinuationRounds, DEFAULT_CONFIG.maxContinuationRounds, 0, 5)),
    continuationPrompt: stringValue(merged.continuationPrompt, DEFAULT_CONFIG.continuationPrompt),
    timeoutMs: numberValue(merged.timeoutMs, DEFAULT_CONFIG.timeoutMs, 5000, 600000),
    maxAttempts: Math.floor(numberValue(merged.maxAttempts, DEFAULT_CONFIG.maxAttempts, 1, 8)),
    retryDelayMs: numberValue(merged.retryDelayMs, DEFAULT_CONFIG.retryDelayMs, 200, 60000),
    maxReplyChars: numberValue(merged.maxReplyChars, DEFAULT_CONFIG.maxReplyChars, 500, 10000),
    resetCommand: stringValue(merged.resetCommand, DEFAULT_CONFIG.resetCommand),
    busyMessage: stringValue(merged.busyMessage, DEFAULT_CONFIG.busyMessage),
    missingApiKeyMessage: stringValue(merged.missingApiKeyMessage, DEFAULT_CONFIG.missingApiKeyMessage),
    emptyPromptMessage: stringValue(merged.emptyPromptMessage, DEFAULT_CONFIG.emptyPromptMessage),
    timeoutMessage: stringValue(merged.timeoutMessage, DEFAULT_CONFIG.timeoutMessage),
    networkErrorMessage: stringValue(merged.networkErrorMessage, DEFAULT_CONFIG.networkErrorMessage),
    rateLimitMessage: stringValue(merged.rateLimitMessage, DEFAULT_CONFIG.rateLimitMessage),
    errorMessage: stringValue(merged.errorMessage, DEFAULT_CONFIG.errorMessage)
  };
}

function stringValue(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  const text = String(value);
  return text.length > 0 ? text : fallback;
}

function normalizeQQList(value) {
  return String(value || "")
    .split(/\D+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberValue(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function booleanValue(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
}

function isAbortError(error) {
  return error?.name === "AbortError" || /aborted/i.test(String(error?.message || ""));
}

function isNetworkError(error) {
  const message = String(error?.message || "");
  const causeCode = String(error?.cause?.code || "");
  return (
    error instanceof TypeError ||
    /fetch failed|network|socket|connect|dns|getaddrinfo|econn|etimedout|enotfound|eai_again|tls|certificate/i.test(message) ||
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR|CERT|TLS/i.test(causeCode)
  );
}

function formatNetworkError(error) {
  const simpleMessage = String(error?.message || error || "unknown error");
  if (!currentConfig.logNetworkErrorDetail) return simpleMessage;

  const parts = [];
  appendErrorDetails(parts, error, "error");

  let cause = error?.cause;
  for (let depth = 1; cause && depth <= 4; depth += 1) {
    appendErrorDetails(parts, cause, `cause${depth}`);

    if (Array.isArray(cause.errors)) {
      cause.errors.slice(0, 4).forEach((item, index) => {
        appendErrorDetails(parts, item, `cause${depth}.errors${index + 1}`);
      });
    }

    cause = cause.cause;
  }

  return parts.length > 0 ? parts.join("; ") : simpleMessage;
}

function appendErrorDetails(parts, error, label) {
  if (!error) return;
  const fields = [
    ["name", error.name],
    ["message", error.message],
    ["code", error.code],
    ["errno", error.errno],
    ["syscall", error.syscall],
    ["hostname", error.hostname],
    ["host", error.host],
    ["address", error.address],
    ["port", error.port]
  ];
  const text = fields
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
  if (text) parts.push(`${label}(${text})`);
}

function createGLMApiError(status, bodyText) {
  const error = new Error(`GLM API ${status}: ${String(bodyText).slice(0, 500)}`);
  error.name = "GLMApiError";
  error.status = status;
  error.responseBody = bodyText;

  try {
    const body = JSON.parse(bodyText);
    error.apiCode = body?.error?.code;
    error.apiMessage = body?.error?.message;
  } catch {
    error.apiCode = "";
    error.apiMessage = "";
  }

  return error;
}

function isRateLimitError(error) {
  return Number(error?.status) === 429 || String(error?.apiCode || "") === "1305";
}

function shouldRetryGLM(error, attempt, maxAttempts) {
  if (attempt >= maxAttempts) return false;
  if (isNetworkError(error)) return true;
  const status = Number(error?.status);
  return status === 429 || status === 408 || status === 500 || status === 502 || status === 503 || status === 504;
}

function getMaxAttempts() {
  return Math.max(1, Math.floor(Number(currentConfig.maxAttempts) || DEFAULT_CONFIG.maxAttempts));
}

function getMaxContinuationRounds() {
  const value = Number(currentConfig.maxContinuationRounds);
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : DEFAULT_CONFIG.maxContinuationRounds));
}

function isTruncatedFinishReason(reason) {
  return /length|max_tokens|max_output_tokens/i.test(String(reason || ""));
}

function getRetryDelay(attempt) {
  return currentConfig.retryDelayMs * attempt;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
