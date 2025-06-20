(function() {
    'use strict';

    // ---------------------- 新聊天按钮点击方法 ----------------------
    function clickNewChatButton() {
        const newChatButton = document.querySelector('a[data-testid="create-new-chat-button"]');
        if (newChatButton) {
            console.log("成功找到元素:", newChatButton);
            newChatButton.click();
            console.log("元素已被点击。");
        } else {
            console.error("未能找到带有 data-testid='create-new-chat-button' 的元素。");
        }
    }

    // 预留对外API请求方法
    // function sendToYourApi(result) {
    //   fetch('https://your-api.com/xxx', {
    //     method: 'POST',
    //     body: JSON.stringify({ result }),
    //     headers: { 'Content-Type': 'application/json' }
    //   });
    // }

    window.chatGPTUserInfo = window.chatGPTUserInfo || {};

    function log(step, ...args) {
        console.log(`[ChatGPT-Auto][${step}]`, ...args);
    }
    function error(step, ...args) {
        console.error(`[ChatGPT-Auto][${step}]`, ...args);
    }

    let deleteTriggered = false;
    function startApiInterceptor() {
        log('Init', 'API拦截器已启动，准备拦截用户数据和对话响应...');
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            let requestUrl;
            const resource = args[0];
            if (typeof resource === 'string') {
                requestUrl = resource;
            } else if (resource instanceof Request) {
                requestUrl = resource.url;
            }
            const options = args[1] || {};
            if (options.headers) {
                let auth = null;
                if (typeof options.headers.get === 'function') {
                    auth = options.headers.get('Authorization');
                } else if (options.headers.Authorization) {
                    auth = options.headers.Authorization;
                } else if (options.headers.authorization) {
                    auth = options.headers.authorization;
                }
                if (auth && auth.startsWith('Bearer ')) {
                    const token = auth.substring(7);
                    if (window._chatgpt_dynamic_token !== token) {
                        window._chatgpt_dynamic_token = token;
                        log('UserInfo', '动态提取到 Authorization token');
                    }
                }
            }
            // 只脚本消费流并自动删除
            const path = requestUrl ? new URL(requestUrl).pathname : '';
            if (path.startsWith('/backend-api/f/conversation') && args[1]?.method === 'POST') {
                log('Ask', '拦截到主对话流 POST 请求:', requestUrl);
                if (args[1] && args[1].body) {
                    try {
                        const requestBody = JSON.parse(args[1].body);
                        log('Ask', '发送的问题:', requestBody);
                    } catch (e) {
                        log('Ask', '请求体解析失败');
                    }
                }
                const response = await originalFetch(...args);
                try {
                    const reader = response.body.getReader();
                    let aiText = '';
                    const decoder = new TextDecoder();
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const chunk = decoder.decode(value);
                        // 逐行处理，只拼接AI回复文本
                        chunk.split('\n').forEach(line => {
                            if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                                try {
                                    const json = JSON.parse(line.slice(6));
                                    if (typeof json.v === 'string') aiText += json.v;
                                    if (json.o === 'append' && typeof json.v === 'string') aiText += json.v;
                                    // 兼容部分流格式
                                    if (json.v?.message?.content?.parts?.[0] && aiText === '') {
                                        aiText += json.v.message.content.parts[0];
                                    }
                                } catch {}
                            }
                        });
                    }
                    log('Ask', '✅ 脚本消费AI回复:', aiText);
                    // sendToYourApi(aiText); // 需要时可打开
                    await deleteLastConversation();
                } catch (err) {
                    error('Ask', '读取流时发生错误:', err);
                }
                // 返回空响应给页面，页面不会显示AI回复
                return new Response('', { status: 200, headers: response.headers });
            }
            // 其他接口正常返回
            const response = await originalFetch(...args);
            return response;
        };
    }

    let lastConversationId = null;
    let lastQuestion = '';
    let lastAIResponse = '';
    async function handleConversationStream(stream, isMainStream) {
        let reader;
        try {
            reader = stream.getReader();
        } catch (err) {
            error('Ask', '获取流 reader 失败:', err);
            return;
        }
        log('Ask', '开始接收流式响应...');
        let assistantMessage = '';
        try {
            while (true) {
                let done, value;
                try {
                    ({ done, value } = await reader.read());
                } catch (err) {
                    error('Ask', '读取流时发生错误:', err);
                    break;
                }
                if (done) {
                    log('Ask', '流式响应接收完毕。');
                    if (assistantMessage) {
                        log('Ask', '✅ 最终拼接的AI回复:', assistantMessage);
                        lastAIResponse = assistantMessage;
                    }
                    if (isMainStream && !deleteTriggered) {
                        deleteTriggered = true;
                        setTimeout(() => {
                            log('Delete', '等待1秒后开始删除本次对话（等待AI回复完全渲染，类型：安全等待，时长：1000ms）');
                            deleteLastConversation();
                        }, 1000);
                    }
                    break;
                }
                const lines = value.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                        const jsonStr = line.substring(6).trim();
                        if (!jsonStr) continue;
                        try {
                            const data = JSON.parse(jsonStr);
                            let textChunk = '';
                            if (data.o === 'append' && typeof data.v === 'string') {
                                textChunk = data.v;
                            } else if (typeof data.v === 'string') {
                                textChunk = data.v;
                            } else if (data.v?.message?.content?.parts?.[0]) {
                                const initialContent = data.v.message.content.parts[0];
                                if (initialContent && assistantMessage === '') {
                                    textChunk = initialContent;
                                }
                            }
                            if (textChunk) {
                                assistantMessage += textChunk;
                            }
                            const convId = data.conversation_id || data.v?.conversation_id;
                            if (convId) {
                                lastConversationId = convId;
                            }
                        } catch (e) {}
                    }
                }
            }
        } catch (err) {
            error('Ask', '处理流时发生异常:', err);
        }
    }

    function setPromptText(text) {
        const promptTextarea = document.getElementById('prompt-textarea');
        if (!promptTextarea) {
            error('Ask', '未找到输入框，无法写入文本');
            return;
        }
        promptTextarea.innerText = text;
        const inputEvent = new Event('input', { bubbles: true, cancelable: true });
        promptTextarea.dispatchEvent(inputEvent);
        log('Ask', `已写入文本: "${text}"`);
        clickSendButtonWhenReady();
    }
    function clickSendButtonWhenReady(timeout = 5000) {
        log('Ask', '等待发送按钮变为可用状态（类型：UI等待，最多5000ms）');
        const startTime = Date.now();
        const interval = setInterval(() => {
            const sendButton = document.querySelector('[data-testid="send-button"]');
            if (sendButton && !sendButton.disabled) {
                clearInterval(interval);
                log('Ask', '发送按钮已可用，执行点击！');
                sendButton.click();
                return;
            }
            if (Date.now() - startTime > timeout) {
                clearInterval(interval);
                error('Ask', '等待发送按钮超时。');
            }
        }, 100);
    }
    function waitForChatReadyAndSetPrompt(text, timeout = 15000) {
        log('Ask', '等待聊天组件...（类型：UI等待，最多15000ms）');
        const startTime = Date.now();
        const interval = setInterval(() => {
            const promptEl = document.getElementById('prompt-textarea');
            if (promptEl) {
                clearInterval(interval);
                log('Ask', '聊天组件已找到');
                setPromptText(text);
                return;
            }
            if (Date.now() - startTime > timeout) {
                clearInterval(interval);
                error('Ask', '等待聊天组件超时');
            }
        }, 200);
    }

    const randomQuestions = [
        '你好，请用中文写一首关于春天的五言绝句。',
        '请解释一下什么是人工智能？',
        '能否推荐几本值得一读的科幻小说？',
        '如何制作一份美味的蛋炒饭？',
        '请简单介绍一下JavaScript编程语言。',
        '什么是区块链技术？它有什么应用？',
        '请写一个关于友谊的短故事。',
        '如何保持身体健康？',
        '请解释量子物理学的基本概念。',
        '分享一些学习新技能的有效方法。',
        '请用中文写一首关于秋天的七言律诗。',
        '什么是机器学习？它是如何工作的？',
        '请推荐一些适合初学者的编程资源。',
        '如何培养良好的阅读习惯？',
        '请简单介绍一下可持续发展的概念。'
    ];
    function getRandomQuestion() {
        const randomIndex = Math.floor(Math.random() * randomQuestions.length);
        const question = randomQuestions[randomIndex];
        log('Ask', `随机选择问题 [${randomIndex + 1}/${randomQuestions.length}]: ${question}`);
        lastQuestion = question;
        return question;
    }

    async function deleteLastConversation() {
        log('Delete', '准备删除本次对话...');
        const hasAuth = await waitForAuth(10000);
        if (!hasAuth) {
            error('Delete', '等待认证信息超时，无法删除对话');
            return;
        }
        const conversations = await getConversations();
        if (!conversations.length) {
            log('Delete', '没有找到对话记录，无需删除');
            return;
        }
        let targetConv = null;
        if (lastConversationId) {
            targetConv = conversations.find(c => c.id === lastConversationId);
        }
        if (!targetConv) {
            targetConv = conversations[0];
        }
        log('Delete', '待删除对话:', targetConv);
        const success = await deleteConversation(targetConv.id);
        if (success) {
            log('Delete', '✅ 删除本次对话成功');
            clickNewChatButton();
        } else {
            error('Delete', '❌ 删除本次对话失败');
        }
    }
    function getAccessToken() {
        if (window._chatgpt_dynamic_token) {
            return window._chatgpt_dynamic_token;
        }
        try {
            const keys = Object.keys(localStorage);
            for (const key of keys) {
                if (key.includes('auth') || key.includes('token')) {
                    const value = localStorage.getItem(key);
                    if (value && value.startsWith('eyJ')) {
                        return value;
                    }
                    try {
                        const parsed = JSON.parse(value);
                        if (parsed.accessToken && parsed.accessToken.startsWith('eyJ')) {
                            return parsed.accessToken;
                        }
                    } catch (e) { continue; }
                }
            }
        } catch (e) {}
        return null;
    }
    async function waitForAuth(maxWaitTime = 10000) {
        return new Promise((resolve) => {
            let attempts = 0;
            const maxAttempts = maxWaitTime / 1000;
            const checkAuth = () => {
                attempts++;
                const token = getAccessToken();
                if (token) {
                    log('Delete', '已获取到认证token');
                    resolve(true);
                    return;
                }
                if (attempts >= maxAttempts) {
                    resolve(false);
                    return;
                }
                setTimeout(checkAuth, 1000);
            };
            checkAuth();
        });
    }
    function getRequestHeaders() {
        const accessToken = getAccessToken();
        const headers = {
            'Accept': '*/*',
            'Content-Type': 'application/json',
            'Cookie': document.cookie,
            'Referer': 'https://chatgpt.com/',
            'User-Agent': navigator.userAgent,
            'Origin': 'https://chatgpt.com'
        };
        if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
        return headers;
    }
    async function getConversations() {
        try {
            const headers = getRequestHeaders();
            const response = await fetch('https://chatgpt.com/backend-api/conversations?offset=0&limit=28&order=updated&is_archived=false', {
                method: 'GET',
                headers: headers,
                credentials: 'same-origin'
            });
            if (!response.ok) {
                error('Delete', `获取对话列表失败: ${response.status}`);
                return [];
            }
            const data = await response.json();
            log('Delete', `获取到 ${data.items?.length || 0} 条对话`);
            return data.items || [];
        } catch (err) {
            error('Delete', '获取对话列表错误:', err);
            return [];
        }
    }
    async function deleteConversation(conversationId) {
        try {
            const headers = getRequestHeaders();
            const response = await fetch(`https://chatgpt.com/backend-api/conversation/${conversationId}`, {
                method: 'PATCH',
                headers: headers,
                credentials: 'same-origin',
                body: JSON.stringify({ is_archived: true })
            });
            if (response.ok) {
                log('Delete', `✅ 成功删除对话: ${conversationId}`);
                return true;
            } else {
                error('Delete', `❌ 删除失败: ${response.status}`);
                return false;
            }
        } catch (err) {
            error('Delete', '删除对话错误:', err);
            return false;
        }
    }

    // ---------------------- 主流程启动 ----------------------
    startApiInterceptor();
    setTimeout(() => {
        log('Main', '等待页面加载完成后启动自动化流程（类型：页面加载等待，时长：3000ms）');
        setTimeout(() => {
            log('Main', '当前用户信息:', window.chatGPTUserInfo);
        }, 2000);
        clickNewChatButton();
        const randomQuestion = getRandomQuestion();
        waitForChatReadyAndSetPrompt(randomQuestion);
    }, 3000);

})();
