(function () {
  "use strict";

  const TARGET_API_PATH = "StreamGenerate";
  const MODE_URL_PATH = "_/BardChatUi/data/batchexecute?rpcids=otAQ7b";

  // --- 日志工具 ---
  const log = (step, ...args) =>
    console.log(`%c[自动化脚本][${step}]`, "color: #1a73e8; font-weight: bold;", ...args);
  const error = (step, ...args) =>
    console.error(`%c[自动化脚本][${step}]`, "color: #d93025; font-weight: bold;", ...args);
  const warn = (step, ...args) =>
    console.warn(`%c[自动化脚本][${step}]`, "color: #f7b400; font-weight: bold;", ...args);

  // --- 解码工具 ---
  function decodeUrlEncoded(str) {
    return decodeURIComponent(str.replace(/\+/g, " "));
  }

  function decodeAndPrettyPrintJson(encoded) {
    try {
      const decoded = decodeUrlEncoded(encoded);
      return JSON.stringify(JSON.parse(decoded), null, 2);
    } catch (e) {
      return `无法解码/解析 JSON: ${encoded.substring(0, 200)}...`;
    }
  }

  // --- 响应解析器 ---
  function parseXMLResponseBody(responseText) {
    const lines = responseText.split("\n");
    let aiText = "";
    let conversationId = null;

    for (const line of lines) {
      const clean = line.trim();
      if (!clean || clean.startsWith(")]}'") || /^\d+$/.test(clean)) continue;

      try {
        const parsed = JSON.parse(clean);
        if (Array.isArray(parsed) && parsed[0][0] === "wrb.fr") {
          if (parsed[0][1] === "otAQ7b") {
            const modes = JSON.parse(parsed[0][2]);
            window.chatGPTUserInfo.modes.push(...(modes?.[15]?.map(x => x[1]) || []));
          } else {
            const inner = JSON.parse(parsed[0][2]);
            if (!conversationId && inner?.[1]?.[0]?.startsWith("c_")) {
              conversationId = inner[1][0];
            }
            if (Array.isArray(inner?.[4]?.[0]?.[1])) {
              for (const segment of inner[4][0][1]) {
                if (typeof segment === "string") aiText += segment;
              }
            }
          }
        }
        if (parsed[0][0] === "e") {
          window.AI = { ...window.AI, isComplete: true};
          log("完成检测", "状态码检测到完成 (方式1)");
        }
      } catch (err) {
        warn("XML解析", "JSON 解析失败", err, clean.substring(0, 100));
      }
    }

    window.AI = { ...window.AI, aiText, conversationId};
    log("AI", { aiText, conversationId });
  }

  // --- 用户信息提取 ---
  function getUserInfo() {
    const email = document.getElementsByName("og-profile-acct")?.[0]?.content || "";
    const proButton = Array.from(
      document.querySelectorAll("button.mdc-button.mat-mdc-button-base")
    ).find(btn => btn.innerText.includes("PRO"));
    const isAPayingUser = Boolean(proButton);
    window.chatGPTUserInfo = { email, isAPayingUser, modes: [] };
  }

  // --- fetch 拦截器 ---
  function startApiInterceptor() {
    log("Fetch", `启用 fetch 拦截器`);
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
      const resource = args[0];
      const options = args[1] || {};
      const method = options.method || "GET";

      let requestUrl = "";
      if (typeof resource === "string") requestUrl = resource;
      else if (resource instanceof Request) requestUrl = resource.url;

      let path = "";
      try {
        path = new URL(requestUrl, location.origin).pathname;
      } catch (e) {
        error("Fetch", "构建 URL 失败:", e);
      }

      if (path.includes(TARGET_API_PATH)) {
        log("Fetch", `捕获请求: ${method} ${requestUrl}`);

        if (options.body?.startsWith("f.req=")) {
          const decoded = decodeAndPrettyPrintJson(options.body.substring(6));
          log("Fetch", `请求体解码:`, decoded);
        }

        const response = await originalFetch(resource, options);
        const cloned = response.clone();
        try {
          const text = await cloned.text();
          log("Fetch", "响应体:", text);
        } catch (e) {
          error("Fetch", "读取失败", e);
        }

        return response;
      }

      return originalFetch(...args);
    };
  }

  // --- XMLHttpRequest 拦截器 ---
  function startXMLInterceptor() {
    log("XHR", "启用 XMLHttpRequest 拦截器...");
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...args) {
      this._requestMethod = method;
      this._requestUrl = url;
      return originalOpen.call(this, method, url, ...args);
    };

    XMLHttpRequest.prototype.send = function (body) {
      const url = this._requestUrl || "";
      if (url.includes(TARGET_API_PATH) || url.includes(MODE_URL_PATH)) {
        const _this = this;
        const originalOnReadyStateChange = this.onreadystatechange;

        this.onreadystatechange = function () {
          if (_this.readyState === 4) {
            try {
              parseXMLResponseBody(_this.responseText);
            } catch (e) {
              error("XHR", "解析失败:", e);
            }
          }
          if (originalOnReadyStateChange) {
            originalOnReadyStateChange.apply(this, arguments);
          }
        };
      }

      return originalSend.call(this, body);
    };
  }

  // --- 工具函数 ---
  async function waitForElement(selector, maxWait = 5000, interval = 200) {
    const maxTries = Math.ceil(maxWait / interval);
    for (let i = 0; i < maxTries; i++) {
      const el = document.querySelector(selector);
      if (el) return el;
      await new Promise(r => setTimeout(r, interval));
    }
    return null;
  }

  function getRandomQuestion() {
    const questions = [
      "你好，请用中文写一首关于春天的五言绝句。",
      "请解释一下什么是人工智能？",
      "能否推荐几本值得一读的科幻小说？",
      "如何制作一份美味的蛋炒饭？",
      "请简单介绍一下JavaScript编程语言。",
      "什么是区块链技术？它有什么应用？",
      "请写一个关于友谊的短故事。",
      "如何保持身体健康？",
      "请解释量子物理学的基本概念。",
      "分享一些学习新技能的有效方法。",
      "请用中文写一首关于秋天的七言律诗。",
      "什么是机器学习？它是如何工作的？",
      "请推荐一些适合初学者的编程资源。",
      "如何培养良好的阅读习惯？",
      "请简单介绍一下可持续发展的概念。",
    ];
    const i = Math.floor(Math.random() * questions.length);
    const q = questions[i];
    log("问题选择", `[${i + 1}/${questions.length}] ${q}`);
    return q;
  }

  async function clickNewChatButton(maxWait) {
    const selector = 'button[data-test-id="expanded-button"]';
    const btn = await waitForElement(selector, maxWait);
    if (!btn) return warn("未找到“发起新对话”按钮");

    const maxTries = 50;
    for (let i = 0; i < maxTries; i++) {
      if (!btn.disabled && btn.getAttribute("aria-disabled") !== "true") {
        btn.click();
        log("点击", "发起新对话按钮");
        return;
      }
      await new Promise(r => setTimeout(r, 200));
    }

    warn("发起新对话按钮不可用");
  }

  async function setTextToRichInput(text) {
    const input = await waitForElement(".ql-editor.textarea");
    if (!input) return warn("找不到输入框");

    input.innerHTML = `<p>${text}</p>`;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function deleteConversationById(conversationId) {
    if (!conversationId) return warn("无对话 ID，无法删除");

    const convSel = `[data-test-id="conversation"][jslog*="${conversationId}"]`;
    const conv = await waitForElement(convSel, 8000);
    if (!conv) return warn("未找到对话", conversationId);

    const menuBtn = conv.closest(".conversation-items-container")?.querySelector("button.conversation-actions-menu-button");
    if (!menuBtn) return warn("未找到菜单按钮");

    menuBtn.click();
    log("点击", "对话菜单");

    await sleep(1000);
    const deleteBtn = await waitForElement(`button[data-test-id="delete-button"][jslog*="${conversationId}"]`, 5000);
    if (!deleteBtn) return warn("未找到删除按钮");
    deleteBtn.click();
    log("点击", "删除按钮");

    await sleep(1000);
    const confirmBtn = await waitForElement(`button[data-test-id="confirm-button"][jslog*="${conversationId}"]`, 5000);
    if (!confirmBtn) return warn("未找到确认删除按钮");
    confirmBtn.click();
    log("点击", "确认删除");
  }

  async function sendCurrentInput() {
    const sendBtn = await waitForElement("button.send-button:not([disabled])", 8000);
    if (sendBtn) {
      sendBtn.click();
      log("点击", "发送按钮");
    } else {
      warn("发送按钮不可用");
    }
  }

  function switchingModels(modeName) {
    // 切换到目标模型
    document.querySelector("button.logo-pill-btn").click();
    setTimeout(() => {}, 1000);
    const modeLIst = document.querySelectorAll(
      "button.mat-mdc-menu-item.mat-focus-indicator.bard-mode-list-button.ng-star-inserted"
    );
    for (let index = 0; index < modeLIst.length; index++) {
      if (
        modeLIst[index]
          .querySelector(".mode-desc.gds-label-m-alt")
          .innerText.trim() === modeName
      ) {
        modeLIst[index].click();
      }
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // --- 主流程 ---
  (async () => {
    // 打开监控
    startApiInterceptor();
    startXMLInterceptor();
    // 获取用户信息
    getUserInfo();
    log("UserInfo", window.chatGPTUserInfo);
    window.AI = {isComplete: false};
    // 切到新对话
    await clickNewChatButton(0);
    // 随机一个问题
    const question = getRandomQuestion();
    // 切换目标模型
    // switchingModels();
    // 填写问题
    await setTextToRichInput(question);
    // 点击发送按钮
    await sendCurrentInput();

    while (!window.AI.isComplete) {
      await sleep(200);
    }
    // 删除对话
    await deleteConversationById(window.AI?.conversationId);
    // 切换到新对话
    await clickNewChatButton(10000);
  })();
})();