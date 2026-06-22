// 前端 AI 聊天功能 (修复版)
(function () {
    'use strict';

    const is_debug = true; // 可以继续用 debug 模式，但逻辑已修复

    const config = {
        apiUrl: 'https://api.qyserver.top/api/ai/stream',
        // apiUrl: 'http://localhost:3001/api/ai/stream',
        maxHistoryChars: 2000,
        timeout: 60000,
    };

    const messagesEl = document.getElementById('messages');
    const promptEl = document.getElementById('prompt');
    const sendBtn = document.getElementById('sendBtn');

    let messageHistory = [];

    const tokenStats = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cacheHitTokens: 0,

        reset() {
            this.promptTokens = 0;
            this.completionTokens = 0;
            this.totalTokens = 0;
            this.cacheHitTokens = 0;
        },

        getSummary() {
            return `- 共消耗: ${this.totalTokens} | 输入:${this.promptTokens}, 命中:${this.cacheHitTokens}, 输出:${this.completionTokens}`;
        }
    };

    function appendMessage(text, role) {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.justifyContent = role === 'user' ? 'flex-end' : 'flex-start';
        const div = document.createElement('div');
        div.className = 'msg ' + role;
        if (role === 'bot' && text && typeof marked === 'function') {
            div.innerHTML = marked.parse(text);
        } else {
            div.textContent = text;
        }
        wrapper.appendChild(div);
        messagesEl.appendChild(wrapper);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return { wrapper, div };
    }

    const thinkTextList = [
        "思考中...",
        "烧烤中...",
        "深度烧烤中...",
        "少女祈祷中..."
    ];
    
    function showThinking() {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.justifyContent = 'flex-start';
        const div = document.createElement('div');
        div.className = 'msg bot';
        div.style.color = '#aaa';
        div.textContent = thinkTextList[Math.floor(Math.random() * thinkTextList.length)];
        wrapper.appendChild(div);
        messagesEl.appendChild(wrapper);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return wrapper;
    }

    function removeElement(el) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    function clearInput() { promptEl.value = ''; }
    function getInputValue() { return promptEl.value.trim(); }

    function getTotalChars(history) {
        return history.reduce((sum, msg) => sum + (msg.content || '').length, 0);
    }

    function trimHistory(history, maxChars) {
        while (history.length >= 2 && getTotalChars(history) > maxChars) {
            history.shift();
            history.shift();
        }
    }

    async function* streamFromBackend(messages) {
        const payload = { messages: messages };
        const response = await fetch(config.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(config.timeout)
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || errorData.error || `HTTP ${response.status}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data:')) {
                    const jsonStr = trimmed.slice(5).trim();
                    if (jsonStr === '[DONE]') return;
                    try {
                        const parsed = JSON.parse(jsonStr);
                        yield parsed;
                    } catch (e) { /* 忽略 */ }
                }
            }
        }
    }

    // ==================== 主流程 ====================
    async function sendMessage(userText) {
        if (!userText) return;

        appendMessage(userText, 'user');
        clearInput();
        messageHistory.push({ role: 'user', content: userText });

        const thinkingWrapper = showThinking();
        tokenStats.reset();

        let finalReply = '';
        let tokenInfoText = '';
        let botMessageWrapper = null;
        let botMessageDiv = null;

        function ensureBotContainer() {
            if (!botMessageWrapper) {
                const result = appendMessage('', 'bot');
                botMessageWrapper = result.wrapper;
                botMessageDiv = result.div;
            }
        }

        function streamUpdate(text) {
            ensureBotContainer();
            if (botMessageDiv) {
                if (typeof marked === 'function') {
                    botMessageDiv.innerHTML = marked.parse(text);
                } else {
                    botMessageDiv.textContent = text;
                }
            }
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        function finalRender(text) {
            ensureBotContainer();
            if (botMessageDiv) {
                if (typeof marked === 'function') {
                    botMessageDiv.innerHTML = marked.parse(text);
                } else {
                    botMessageDiv.textContent = text;
                }
            }
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        function appendDebugInfo(chunks) {
            if (!botMessageWrapper) return;
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'margin-top:8px;';
            const details = document.createElement('details');
            details.style.cssText = 'font-size:11px;';
            const summary = document.createElement('summary');
            summary.style.cssText = 'color:#999;cursor:pointer;';
            summary.textContent = `📋 原始响应 (${chunks.length} 块)`;
            details.appendChild(summary);
            const pre = document.createElement('pre');
            pre.style.cssText = 'background:#f5f5f5;padding:8px;border-radius:4px;overflow-x:auto;max-height:300px;font-size:10px;color:#666;margin-top:4px;';
            pre.textContent = JSON.stringify(chunks, null, 2);
            details.appendChild(pre);
            wrapper.appendChild(details);
            botMessageWrapper.insertAdjacentElement('afterend', wrapper);
        }

        try {
            let rawChunks = [];

            for await (const chunk of streamFromBackend(messageHistory)) {
                rawChunks.push(chunk);

                // 🟢 解析后端推送的自定义事件
                if (chunk.type === 'status') {
                    // 直接在后端拼好的灰色提示文字，原样显示
                    const statusWrapper = document.createElement('div');
                    statusWrapper.style.display = 'flex';
                    statusWrapper.style.justifyContent = 'flex-start';
                    statusWrapper.style.marginTop = '2px';
                    const statusDiv = document.createElement('div');
                    statusDiv.style.cssText = 'color:#999;font-size:11px;white-space: pre-wrap;'; // 🟢 保留换行
                    statusDiv.textContent = chunk.text; // 🟢 直接显示后端传来的文字
                    statusWrapper.appendChild(statusDiv);
                    messagesEl.appendChild(statusWrapper);
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                    continue;
                }

                const delta = chunk.choices?.[0]?.delta;
                if (delta?.content) {
                    // 🟢 收到第一个字时，移除"思考中..."提示
                    if (!finalReply) {
                        removeElement(thinkingWrapper);
                    }
                    finalReply += delta.content;
                    streamUpdate(finalReply);
                }
                if (chunk.usage) {
                    tokenStats.promptTokens += chunk.usage.prompt_tokens || 0;
                    tokenStats.completionTokens += chunk.usage.completion_tokens || 0;
                    tokenStats.totalTokens += chunk.usage.total_tokens || 0;
                    tokenStats.cacheHitTokens += chunk.usage.prompt_cache_hit_tokens || 0;
                }
            }

            // 🟢 如果循环结束也没有任何回复，也要移除"思考中..."
            // 但如果已经被移除了，再移除一次也没关系
            removeElement(thinkingWrapper);

            if (finalReply) finalRender(finalReply);
            tokenInfoText = tokenStats.getSummary();

            if (finalReply) {
                messageHistory.push({ role: 'assistant', content: finalReply });
                trimHistory(messageHistory, config.maxHistoryChars);
            }

            // 🟢 确保在AI消息容器创建后才显示debug信息
            if (is_debug && rawChunks.length > 0) {
                // 如果没有任何回复，debug信息就没有容身之处，直接不显示
                if (finalReply) {
                    appendDebugInfo(rawChunks);
                }
            }

            if (tokenInfoText) {
                const tokenDiv = document.createElement('div');
                tokenDiv.style.cssText = 'font-size:10px;color:#999;margin-top:2px;margin-left:4px;';
                tokenDiv.textContent = tokenInfoText;
                const lastChild = messagesEl.lastElementChild;
                if (lastChild) {
                    lastChild.insertAdjacentElement('afterend', tokenDiv);
                }
            }

        } catch (err) {
            // 🟢 发生错误，也要移除"思考中..."
            removeElement(thinkingWrapper);
            appendMessage('请求失败：' + err.message, 'bot');
            console.error('AI 请求错误:', err);
        }
    }

    sendBtn.addEventListener('click', () => sendMessage(getInputValue()));
    promptEl.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(getInputValue()); });

    window.AiChat = {
        sendMessage,
        clearHistory: () => { messageHistory = []; },
        getHistory: () => messageHistory,
        getTokenStats: () => tokenStats,
    };
})();