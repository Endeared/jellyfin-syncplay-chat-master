(function () {
    'use strict';

    if (window.__syncPlayChatLoaded) {
        return;
    }

    window.__syncPlayChatLoaded = true;

    const buttonId = 'syncPlayChatButton';
    const markerClass = 'syncPlayChatButton';
    const floatingHostId = 'syncPlayChatFloatingHost';
    const panelId = 'syncPlayChatPanel';
    const messagesId = 'syncPlayChatMessages';
    const statusId = 'syncPlayChatStatus';
    const inputId = 'syncPlayChatInput';
    const sendButtonId = 'syncPlayChatSendButton';
    const messagePollIntervalMs = 2000;
    const chatContextCacheMs = 30000;
    const maxVisibleMessages = 100;
    const sidebarWidthPx = 450;
    const storagePrefix = 'syncPlayChatMessages:';
    let shouldShowButton = false;
    let refreshInProgress = false;
    let sendInProgress = false;
    let messagePollInProgress = false;
    let addButtonQueued = false;
    let chatPanelVisible = false;
    let bodyLayoutAdjusted = false;
    let originalBodyPaddingRight = '';
    let baseBodyPaddingRight = '0px';
    let lastChatContext = null;
    let lastChatContextResolvedAt = 0;
    let lastRenderedGroupId = '';
    let lastRenderedMessages = [];

    function normalizeId(value) {
        if (value === null || value === undefined) {
            return '';
        }

        return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function logDebug(message, details) {
        if (!window || !window.console || typeof window.console.log !== 'function') {
            return;
        }

        if (details === undefined) {
            window.console.log('[SyncPlayChat]', message);
            return;
        }

        window.console.log('[SyncPlayChat]', message, details);
    }

    function getControlHost() {
        const placementTarget = findButtonPlacementTarget();
        if (placementTarget) {
            return placementTarget.controlHost;
        }

        return findVisibleElement([
            '.videoOsdBottom .buttons',
            '.videoOsdBottom .videoOsdBottomButtons',
            '.videoOsdBottom .osdControls',
            '[class*="videoOsd"] [class*="buttons"]',
            '[class*="videoOsd"] [class*="controls"]',
            '.buttons'
        ]);
    }

    function findVisibleElement(selectors) {
        for (let i = 0; i < selectors.length; i += 1) {
            const elements = document.querySelectorAll(selectors[i]);
            for (let j = 0; j < elements.length; j += 1) {
                if (isElementUsable(elements[j])) {
                    return elements[j];
                }
            }
        }

        return null;
    }

    function isElementUsable(element) {
        if (!element) {
            return false;
        }

        const style = window.getComputedStyle(element);
        return style.display !== 'none'
            && style.visibility !== 'hidden'
            && style.opacity !== '0'
            && element.getClientRects().length > 0;
    }

    function getButtonsHostForControl(control) {
        if (!control) {
            return null;
        }

        if (typeof control.closest === 'function') {
            return control.closest('.buttons') || control.parentElement;
        }

        return control.parentElement;
    }

    function findButtonPlacementTarget() {
        const fullscreenButtons = Array.prototype.slice.call(document.querySelectorAll('.btnFullscreen'));
        let fallbackTarget = null;
        let visibleHostFallback = null;

        for (let i = 0; i < fullscreenButtons.length; i += 1) {
            const fullscreenButton = fullscreenButtons[i];
            const controlHost = getButtonsHostForControl(fullscreenButton);
            if (!controlHost) {
                continue;
            }

            const target = {
                controlHost: controlHost,
                fullscreenButton: fullscreenButton
            };

            if (!fallbackTarget) {
                fallbackTarget = target;
            }

            if (isElementUsable(controlHost)) {
                if (!visibleHostFallback) {
                    visibleHostFallback = target;
                }

                if (!fullscreenButton.classList.contains('hide')) {
                    return target;
                }
            }
        }

        if (visibleHostFallback) {
            return visibleHostFallback;
        }

        if (fallbackTarget) {
            return fallbackTarget;
        }

        const fallbackHost = findVisibleElement([
            '.videoOsdBottom .buttons',
            '.videoOsdBottom .videoOsdBottomButtons',
            '.videoOsdBottom .osdControls',
            '[class*="videoOsd"] [class*="buttons"]',
            '[class*="videoOsd"] [class*="controls"]',
            '.buttons'
        ]);

        return fallbackHost
            ? {
                controlHost: fallbackHost,
                fullscreenButton: null
            }
            : null;
    }

    function getFloatingHost() {
        let host = document.getElementById(floatingHostId);
        if (host) {
            applyFloatingHostLayout(host);
            return host;
        }

        host = document.createElement('div');
        host.id = floatingHostId;
        host.style.position = 'fixed';
        host.style.zIndex = '99999';
        host.style.display = 'flex';
        host.style.gap = '0.5rem';
        applyFloatingHostLayout(host);
        document.body.appendChild(host);
        return host;
    }

    function isMobileViewport() {
        if (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) {
            return true;
        }

        return window.innerWidth <= 640;
    }

    function applyFloatingHostLayout(host) {
        const mobile = isMobileViewport();
        host.style.flexDirection = 'column';
        host.style.top = mobile
            ? (chatPanelVisible ? 'calc(45vh + 0.75rem)' : '0.75rem')
            : '50%';
        host.style.right = mobile || !chatPanelVisible ? '1rem' : 'calc(1rem + ' + sidebarWidthPx + 'px)';
        host.style.bottom = 'auto';
        host.style.left = mobile ? '1rem' : 'auto';
        host.style.alignItems = mobile ? 'stretch' : 'flex-end';
        host.style.maxWidth = mobile ? 'none' : 'calc(100vw - 2rem)';
        host.style.transform = mobile ? 'none' : 'translateY(-50%)';

        const panel = document.getElementById(panelId);
        if (panel) {
            applyChatPanelLayout(panel);
        }
    }

    function applyDocumentLayout() {
        if (!document.body) {
            return;
        }

        const shouldAdjustBody = chatPanelVisible && !isMobileViewport();
        document.body.classList.toggle('syncPlayChatSidebarOpen', shouldAdjustBody);
        if (!shouldAdjustBody && bodyLayoutAdjusted) {
            document.body.style.paddingRight = originalBodyPaddingRight;
            bodyLayoutAdjusted = false;
        }

        const host = document.getElementById(floatingHostId);
        if (host) {
            applyFloatingHostLayout(host);
        }
    }

    function ensureSidebarLayoutStyles() {
        if (document.getElementById('syncPlayChatSidebarLayoutStyles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'syncPlayChatSidebarLayoutStyles';
        style.textContent = [
            'body.syncPlayChatSidebarOpen { overflow-x: hidden !important; }',
            'body.syncPlayChatSidebarOpen .skinHeader,',
            'body.syncPlayChatSidebarOpen .mainAnimatedPages,',
            'body.syncPlayChatSidebarOpen .page,',
            'body.syncPlayChatSidebarOpen .libraryPage,',
            'body.syncPlayChatSidebarOpen .videoPlayerContainer,',
            'body.syncPlayChatSidebarOpen [class*="videoPlayerContainer"],',
            'body.syncPlayChatSidebarOpen .htmlvideoplayer,',
            'body.syncPlayChatSidebarOpen .videoOsdTop,',
            'body.syncPlayChatSidebarOpen .videoOsdBottom,',
            'body.syncPlayChatSidebarOpen .osdHeader,',
            'body.syncPlayChatSidebarOpen .osdControls,',
            'body.syncPlayChatSidebarOpen .nowPlayingBar,',
            'body.syncPlayChatSidebarOpen .backgroundContainer,',
            'body.syncPlayChatSidebarOpen .backdropContainer {',
            '    left: 0 !important;',
            '    right: auto !important;',
            '    width: calc(100vw - ' + sidebarWidthPx + 'px) !important;',
            '    max-width: calc(100vw - ' + sidebarWidthPx + 'px) !important;',
            '    margin-left: 0 !important;',
            '    margin-right: 0 !important;',
            '}',
            'body.syncPlayChatSidebarOpen .videoPlayerContainer video,',
            'body.syncPlayChatSidebarOpen [class*="videoPlayerContainer"] video,',
            'body.syncPlayChatSidebarOpen .htmlvideoplayer video {',
            '    width: 100% !important;',
            '    max-width: 100% !important;',
            '}'
        ].join('\n');
        document.head.appendChild(style);
    }

    function setChatButtonIcon(button) {
        const iconElement = button.querySelector('span, i');
        if (iconElement) {
            iconElement.classList.remove('fullscreen');
            iconElement.classList.remove('hide');
            iconElement.classList.add('chat');
            iconElement.textContent = 'chat';
            iconElement.setAttribute('aria-hidden', 'true');
            return;
        }

        button.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 4h16v11H8l-4 4V4z"/></svg>';
    }

    function createButton(fullscreenButton) {
        const button = fullscreenButton ? fullscreenButton.cloneNode(true) : document.createElement('button');
        button.id = buttonId;
        button.type = 'button';
        button.classList.remove('btnFullscreen');
        button.classList.remove('hide');
        button.classList.remove(markerClass);
        button.classList.add(markerClass);
        if (!button.classList.contains('emby-button')) {
            button.classList.add('emby-button');
        }

        button.setAttribute('aria-label', 'SyncPlay chat');
        button.title = 'SyncPlay chat';
        button.removeAttribute('data-action');
        button.removeAttribute('data-command');
        button.removeAttribute('data-id');
        button.removeAttribute('is');
        setChatButtonIcon(button);
        button.style.display = 'inline-flex';
        button.style.setProperty('display', 'inline-flex', 'important');
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
        button.style.flex = '0 0 auto';
        button.style.alignSelf = 'center';
        button.style.padding = '0.42rem 0.62rem';
        button.style.borderRadius = '50%';
        button.style.background = 'transparent';
        button.style.color = '#fff';
        button.style.border = '0';
        button.style.fontSize = '0.9rem';
        button.style.cursor = 'pointer';
        button.style.minWidth = '2.4rem';
        button.style.minHeight = '2.4rem';
        button.setAttribute('aria-controls', panelId);
        button.setAttribute('aria-expanded', 'false');
        button.onclick = null;
        button.addEventListener('click', function () {
            toggleChatPanel(button);
        });
        return button;
    }

    function createChatPanel() {
        const panel = document.createElement('div');
        panel.id = panelId;
        panel.style.display = 'none';
        panel.style.position = 'fixed';
        panel.style.flexDirection = 'column';
        panel.style.gap = '0.55rem';
        panel.style.padding = '0.65rem';
        panel.style.background = 'rgba(0, 0, 0, 0.92)';
        panel.style.border = '1px solid rgba(255, 255, 255, 0.25)';
        panel.style.boxShadow = '-0.4rem 0 1.5rem rgba(0, 0, 0, 0.45)';
        panel.style.color = '#fff';
        panel.style.boxSizing = 'border-box';
        panel.style.fontFamily = '"Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
        panel.style.letterSpacing = '0.01em';
        panel.style.zIndex = '99998';
        applyChatPanelLayout(panel);
        isolateChatPanelEvents(panel);

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.gap = '0.75rem';

        const title = document.createElement('div');
        title.textContent = 'SyncPlay Chat';
        title.style.fontWeight = '600';
        title.style.fontSize = '0.95rem';

        header.appendChild(title);

        const messages = document.createElement('div');
        messages.id = messagesId;
        messages.setAttribute('aria-live', 'polite');
        messages.style.display = 'flex';
        messages.style.flexDirection = 'column';
        messages.style.gap = '0.5rem';
        messages.style.flex = '1 1 auto';
        messages.style.minHeight = '6rem';
        messages.style.overflowY = 'auto';
        messages.style.padding = '0.35rem';
        messages.style.borderRadius = '0.55rem';
        messages.style.background = 'rgba(255, 255, 255, 0.08)';

        const status = document.createElement('div');
        status.id = statusId;
        status.style.minHeight = '1rem';
        status.style.fontSize = '0.78rem';
        status.style.opacity = '0.8';

        const composer = document.createElement('div');
        composer.style.display = 'flex';
        composer.style.alignItems = 'flex-end';
        composer.style.gap = '0.45rem';

        const input = document.createElement('textarea');
        input.id = inputId;
        input.rows = 1;
        input.placeholder = 'Type a message';
        input.setAttribute('aria-label', 'SyncPlay chat message');
        input.wrap = 'soft';
        input.style.width = '100%';
        input.style.minHeight = '2rem';
        input.style.height = '2rem';
        input.style.maxHeight = '7rem';
        input.style.padding = '0.35rem 0.55rem';
        input.style.lineHeight = '1.2rem';
        input.style.boxSizing = 'border-box';
        input.style.borderRadius = '0.45rem';
        input.style.border = '1px solid rgba(255, 255, 255, 0.25)';
        input.style.background = 'rgba(20, 20, 20, 0.8)';
        input.style.color = '#fff';
        input.style.fontFamily = 'inherit';
        input.style.fontSize = '0.92rem';
        input.style.resize = 'none';
        input.style.overflowX = 'hidden';
        input.style.overflowY = 'auto';
        input.style.whiteSpace = 'pre-wrap';
        input.style.wordBreak = 'break-word';

        input.addEventListener('keydown', handleComposerKeydown, true);
        input.addEventListener('keypress', handleComposerKeydown, true);

        input.addEventListener('keyup', function (event) {
            event.stopPropagation();
        });

        input.addEventListener('input', function () {
            autoResizeComposerInput();
        });

        composer.appendChild(input);
        panel.appendChild(header);
        panel.appendChild(messages);
        panel.appendChild(status);
        panel.appendChild(composer);
        applyChatPanelLayout(panel);
        return panel;
    }

    function isolateChatPanelEvents(panel) {
        [
            'click',
            'dblclick',
            'mousedown',
            'mouseup',
            'mousemove',
            'pointerdown',
            'pointerup',
            'pointermove',
            'touchstart',
            'touchend',
            'touchmove',
            'wheel',
            'keydown',
            'keypress',
            'keyup'
        ].forEach(function (eventName) {
            panel.addEventListener(eventName, function (event) {
                event.stopPropagation();
            });
        });
    }

    function applyChatPanelLayout(panel) {
        const mobile = isMobileViewport();
        panel.style.top = '0';
        panel.style.right = '0';
        panel.style.left = mobile ? '0' : 'auto';
        panel.style.bottom = mobile ? 'auto' : '0';
        panel.style.width = mobile ? 'auto' : sidebarWidthPx + 'px';
        panel.style.height = mobile ? '45vh' : '100vh';
        panel.style.maxWidth = mobile ? 'none' : sidebarWidthPx + 'px';
        panel.style.maxHeight = mobile ? '45vh' : '100vh';
        panel.style.borderRadius = mobile ? '0 0 0.75rem 0.75rem' : '0';

        const messages = document.getElementById(messagesId);
        if (messages) {
            messages.style.maxHeight = mobile ? '24vh' : 'none';
        }
    }

    function getOrCreateChatPanel() {
        let panel = document.getElementById(panelId);
        if (panel) {
            applyChatPanelLayout(panel);
            return panel;
        }

        panel = createChatPanel();
        document.body.appendChild(panel);
        return panel;
    }

    function autoResizeComposerInput() {
        const input = document.getElementById(inputId);
        if (!input) {
            return;
        }

        input.style.height = 'auto';
        const minHeightPx = 32;
        const maxHeightPx = 112;
        const nextHeight = Math.max(minHeightPx, Math.min(maxHeightPx, input.scrollHeight));
        input.style.height = String(nextHeight) + 'px';
    }

    function handleComposerKeydown(event) {
        event.stopPropagation();

        const isEnter = event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter';
        if (isEnter && !event.shiftKey) {
            event.preventDefault();
            if (typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation();
            }

            sendComposerMessage();
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            hideChatPanel();
        }
    }

    function isTextInputTarget(target) {
        if (!target || !target.tagName) {
            return false;
        }

        const tagName = target.tagName.toLowerCase();
        return tagName === 'input'
            || tagName === 'textarea'
            || tagName === 'select'
            || target.isContentEditable;
    }

    function focusComposerInput() {
        const input = document.getElementById(inputId);
        if (!input) {
            return false;
        }

        window.setTimeout(function () {
            input.focus();
            if (typeof input.select === 'function' && !input.value) {
                input.select();
            }
        }, 0);
        return true;
    }

    function handleGlobalChatFocusShortcut(event) {
        if (!chatPanelVisible || event.defaultPrevented || isTextInputTarget(event.target)) {
            return;
        }

        const isSlash = event.key === '/' || event.code === 'Slash';
        const isEnter = event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter';
        if (!isSlash && !isEnter) {
            return;
        }

        if (focusComposerInput()) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation();
            }
        }
    }

    function setComposerBusy(isBusy) {
        const input = document.getElementById(inputId);
        const sendButton = document.getElementById(sendButtonId);

        if (input) {
            input.disabled = isBusy;
        }

        if (sendButton) {
            sendButton.disabled = isBusy;
            sendButton.style.opacity = isBusy ? '0.75' : '1';
        }
    }

    function hideChatPanel() {
        const panel = document.getElementById(panelId);
        if (panel) {
            panel.style.display = 'none';
        }

        chatPanelVisible = false;
        applyDocumentLayout();

        const button = document.getElementById(buttonId);
        if (button) {
            button.style.opacity = '1';
            button.setAttribute('aria-expanded', 'false');
        }
    }

    function toggleChatPanel(button) {
        const panel = document.getElementById(panelId);
        if (chatPanelVisible && panel && panel.style.display !== 'none') {
            hideChatPanel();
            return;
        }

        openChatPanel(button);
    }

    function openChatPanel(button) {
        const panel = getOrCreateChatPanel();

        panel.style.display = 'flex';
        chatPanelVisible = true;
        applyDocumentLayout();
        scrollMessagesToBottom();
        pollChatMessages();

        const chatButton = button || document.getElementById(buttonId);
        if (chatButton) {
            chatButton.style.opacity = '0.85';
            chatButton.setAttribute('aria-expanded', 'true');
        }

        const input = document.getElementById(inputId);
        if (input) {
            window.setTimeout(function () {
                autoResizeComposerInput();
                input.focus();
            }, 0);
        }
    }

    function scrollMessagesToBottom() {
        const messages = document.getElementById(messagesId);
        if (messages) {
            messages.scrollTop = messages.scrollHeight;
        }
    }

    function getMessageUserName(chatMessage) {
        return chatMessage.userName || chatMessage.UserName || 'Someone';
    }

    function getMessageUserId(chatMessage) {
        return chatMessage.userId || chatMessage.UserId || '';
    }

    function getMessageText(chatMessage) {
        return chatMessage.text || chatMessage.Text || '';
    }

    function getUserImageUrl(userId) {
        if (!userId || !window.ApiClient || typeof window.ApiClient.getUrl !== 'function') {
            return '';
        }

        return window.ApiClient.getUrl('Users/' + encodeURIComponent(userId) + '/Images/Primary?fillWidth=64&fillHeight=64&quality=90');
    }

    function createAvatarElement(group) {
        const avatar = document.createElement('div');
        avatar.style.width = '2rem';
        avatar.style.height = '2rem';
        avatar.style.flex = '0 0 2rem';
        avatar.style.borderRadius = '50%';
        avatar.style.border = '2px solid rgba(255, 255, 255, 0.38)';
        avatar.style.background = 'linear-gradient(135deg, rgba(0, 164, 220, 0.85), rgba(115, 83, 186, 0.85))';
        avatar.style.display = 'flex';
        avatar.style.alignItems = 'center';
        avatar.style.justifyContent = 'center';
        avatar.style.overflow = 'hidden';
        avatar.style.boxSizing = 'border-box';
        avatar.style.color = '#fff';
        avatar.style.fontWeight = '700';
        avatar.style.fontSize = '0.9rem';
        avatar.textContent = (group.userName || '?').slice(0, 1).toUpperCase();

        const imageUrl = getUserImageUrl(group.userId);
        if (imageUrl) {
            const image = document.createElement('img');
            image.src = imageUrl;
            image.alt = '';
            image.style.width = '100%';
            image.style.height = '100%';
            image.style.objectFit = 'cover';
            image.addEventListener('load', function () {
                avatar.textContent = '';
                avatar.appendChild(image);
            }, { once: true });
        }

        return avatar;
    }

    function createMessageGroupRow(group) {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'flex-start';
        row.style.gap = '0.5rem';

        const bubble = document.createElement('div');
        bubble.style.display = 'flex';
        bubble.style.flexDirection = 'column';
        bubble.style.gap = '0.35rem';
        bubble.style.minWidth = '0';
        bubble.style.flex = '1 1 auto';
        bubble.style.padding = '0.48rem 0.58rem';
        bubble.style.borderRadius = '0.8rem';
        bubble.style.background = 'rgba(255, 255, 255, 0.09)';
        bubble.style.boxShadow = 'inset 0 0 0 1px rgba(255, 255, 255, 0.06)';

        const senderElement = document.createElement('div');
        senderElement.textContent = group.userName || 'Someone';
        senderElement.style.fontWeight = '600';
        senderElement.style.fontSize = '0.8rem';
        senderElement.style.opacity = '0.92';
        senderElement.style.letterSpacing = '0.015em';
        bubble.appendChild(senderElement);

        group.messages.forEach(function (chatMessage) {
            const messageElement = document.createElement('div');
            messageElement.textContent = getMessageText(chatMessage);
            messageElement.style.fontSize = '0.93rem';
            messageElement.style.lineHeight = '1.32rem';
            messageElement.style.whiteSpace = 'pre-wrap';
            messageElement.style.wordBreak = 'break-word';
            bubble.appendChild(messageElement);
        });

        row.appendChild(createAvatarElement(group));
        row.appendChild(bubble);
        return row;
    }

    function groupConsecutiveMessages(messages) {
        const groups = [];
        messages.forEach(function (message) {
            const userName = getMessageUserName(message);
            const userId = getMessageUserId(message);
            const lastGroup = groups.length > 0 ? groups[groups.length - 1] : null;
            if (lastGroup && lastGroup.userName === userName && lastGroup.userId === userId) {
                lastGroup.messages.push(message);
                return;
            }

            groups.push({
                userName: userName,
                userId: userId,
                messages: [message]
            });
        });

        return groups;
    }

    function normalizeChatMessages(response) {
        let normalized = response;
        if (typeof normalized === 'string') {
            try {
                normalized = JSON.parse(normalized);
            } catch (parseError) {
                logDebug('Failed to parse chat messages response JSON', parseError);
                return [];
            }
        }

        if (normalized && typeof normalized === 'object' && normalized.responseJSON && typeof normalized.responseJSON === 'object') {
            normalized = normalized.responseJSON;
        }

        if (Array.isArray(normalized)) {
            return normalized;
        }

        if (normalized && Array.isArray(normalized.Messages)) {
            return normalized.Messages;
        }

        if (normalized && Array.isArray(normalized.messages)) {
            return normalized.messages;
        }

        return [];
    }

    function getMessageId(chatMessage) {
        return chatMessage.id || chatMessage.Id || '';
    }

    function mergeChatMessages(existingMessages, newMessages) {
        const merged = [];
        const seenIds = {};

        (existingMessages || []).concat(newMessages || []).forEach(function (message) {
            if (!message) {
                return;
            }

            const id = getMessageId(message);
            if (id && seenIds[id]) {
                return;
            }

            if (id) {
                seenIds[id] = true;
            }

            merged.push(message);
        });

        return merged.slice(-maxVisibleMessages);
    }

    function getMessageStorageKey(groupId) {
        return storagePrefix + (groupId || 'unknown');
    }

    function saveMessagesToStorage(groupId, messages) {
        if (!window.localStorage || !groupId) {
            return;
        }

        try {
            window.localStorage.setItem(getMessageStorageKey(groupId), JSON.stringify(messages.slice(-maxVisibleMessages)));
        } catch (storageError) {
            logDebug('Failed to save SyncPlay chat messages', storageError);
        }
    }

    function loadMessagesFromStorage(groupId) {
        if (!window.localStorage || !groupId) {
            return [];
        }

        try {
            const raw = window.localStorage.getItem(getMessageStorageKey(groupId));
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (storageError) {
            logDebug('Failed to load SyncPlay chat messages', storageError);
            return [];
        }
    }

    function renderChatMessages(groupId, messages) {
        getOrCreateChatPanel();

        const container = document.getElementById(messagesId);
        if (!container) {
            return;
        }

        const visibleMessages = messages.slice(-maxVisibleMessages);
        const nextIds = visibleMessages.map(getMessageId).join('|');
        if (groupId === lastRenderedGroupId && container.getAttribute('data-sync-play-chat-message-ids') === nextIds) {
            return;
        }

        const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 48;
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        groupConsecutiveMessages(visibleMessages).forEach(function (group) {
            container.appendChild(createMessageGroupRow(group));
        });

        container.setAttribute('data-sync-play-chat-message-ids', nextIds);
        lastRenderedGroupId = groupId || '';
        lastRenderedMessages = visibleMessages;
        saveMessagesToStorage(groupId, visibleMessages);

        if (wasNearBottom) {
            scrollMessagesToBottom();
        }
    }

    function showChatStatus(text) {
        const status = document.getElementById(statusId);
        if (status) {
            status.textContent = text || '';
        }
    }

    function getComposerMessageText() {
        const input = document.getElementById(inputId);
        if (!input) {
            return '';
        }

        return (input.value || '').trim();
    }

    function clearComposerInput() {
        const input = document.getElementById(inputId);
        if (input) {
            input.value = '';
            autoResizeComposerInput();
        }
    }

    function sendComposerMessage() {
        const text = getComposerMessageText();
        if (!text) {
            return;
        }

        onChatButtonClick(text);
    }

    function extractSyncPlayGroupId(session) {
        const playState = session && session.PlayState;
        const groupId = (session && session.PlayState && session.PlayState.SyncPlayGroupId)
            || (session && session.PlayState && session.PlayState.SyncPlayGroup)
            || (session && session.SyncPlayGroupId)
            || (session && session.SyncPlayGroup)
            || (session && session.SyncPlayGroup && session.SyncPlayGroup.Id)
            || (playState && playState.SyncPlayGroup && playState.SyncPlayGroup.Id)
            || (playState && playState.SyncPlayInfo && playState.SyncPlayInfo.GroupId)
            || (session && session.AdditionalData && session.AdditionalData.SyncPlayGroupId)
            || '';

        return typeof groupId === 'string' ? groupId : '';
    }

    function findFullscreenButton(controlHost) {
        if (controlHost) {
            return controlHost.querySelector('.btnFullscreen');
        }

        const target = findButtonPlacementTarget();
        return target ? target.fullscreenButton : null;
    }

    function getOrCreateOverlayButton(host) {
        let overlayButton = null;
        Array.prototype.slice.call(document.querySelectorAll('.' + markerClass)).forEach(function (button) {
            if (button.parentElement === host && !overlayButton) {
                overlayButton = button;
                return;
            }

            button.remove();
        });

        if (!overlayButton) {
            overlayButton = createButton();
            host.appendChild(overlayButton);
        } else if (overlayButton.parentElement !== host) {
            host.appendChild(overlayButton);
        }

        return overlayButton;
    }

    function isPlaybackActive() {
        return !!document.querySelector('.videoPlayerContainer, [class*="videoPlayerContainer"], .htmlvideoplayer');
    }

    function getCurrentUserId() {
        if (!window.ApiClient) {
            return '';
        }

        if (typeof window.ApiClient.getCurrentUserId === 'function') {
            return window.ApiClient.getCurrentUserId() || '';
        }

        if (typeof window.ApiClient.userId === 'function') {
            return window.ApiClient.userId() || '';
        }

        if (typeof window.ApiClient._userId === 'string') {
            return window.ApiClient._userId;
        }

        if (window.ApiClient._serverInfo && typeof window.ApiClient._serverInfo.UserId === 'string') {
            return window.ApiClient._serverInfo.UserId;
        }

        return '';
    }

    function getCurrentUserIds() {
        const raw = getCurrentUserId();
        const ids = [];

        if (raw) {
            ids.push(raw);
        }

        const normalized = normalizeId(raw);
        if (normalized && ids.indexOf(normalized) === -1) {
            ids.push(normalized);
        }

        return ids;
    }

    function getCurrentUserName() {
        if (!window.ApiClient) {
            return '';
        }

        const serverInfo = window.ApiClient._serverInfo;
        if (serverInfo && typeof serverInfo.UserName === 'string' && serverInfo.UserName.length > 0) {
            return serverInfo.UserName;
        }

        if (window.Dashboard && window.Dashboard.getCurrentUser) {
            const currentUser = window.Dashboard.getCurrentUser();
            if (currentUser && typeof currentUser.Name === 'string' && currentUser.Name.length > 0) {
                return currentUser.Name;
            }
        }

        return '';
    }

    function getCurrentDeviceId() {
        if (!window.ApiClient) {
            return '';
        }

        if (typeof window.ApiClient.deviceId === 'function') {
            return window.ApiClient.deviceId() || '';
        }

        if (typeof window.ApiClient._deviceId === 'string') {
            return window.ApiClient._deviceId;
        }

        return '';
    }

    function hasSyncPlayGroup(session) {
        return extractSyncPlayGroupId(session).length > 0;
    }

    function collectStringValues(value, output) {
        if (value === null || value === undefined) {
            return;
        }

        if (typeof value === 'string') {
            output.push(value);
            return;
        }

        if (Array.isArray(value)) {
            value.forEach(function (item) {
                collectStringValues(item, output);
            });
            return;
        }

        if (typeof value === 'object') {
            Object.keys(value).forEach(function (key) {
                collectStringValues(value[key], output);
            });
        }
    }

    function normalizeSessionsResponse(response) {
        if (Array.isArray(response)) {
            return response;
        }

        if (response && Array.isArray(response.Items)) {
            return response.Items;
        }

        if (response && Array.isArray(response.Sessions)) {
            return response.Sessions;
        }

        return [];
    }

    function normalizeGroupsResponse(response) {
        if (Array.isArray(response)) {
            return response;
        }

        if (response && Array.isArray(response.Groups)) {
            return response.Groups;
        }

        if (response && Array.isArray(response.Items)) {
            return response.Items;
        }

        return [];
    }

    function objectContainsString(value, expectedLowerValue) {
        if (!value || !expectedLowerValue) {
            return false;
        }

        if (typeof value === 'string') {
            const normalizedActual = normalizeId(value);
            const normalizedExpected = normalizeId(expectedLowerValue);

            if (!normalizedActual || !normalizedExpected) {
                return false;
            }

            return normalizedActual === normalizedExpected;
        }

        if (Array.isArray(value)) {
            return value.some(function (item) {
                return objectContainsString(item, expectedLowerValue);
            });
        }

        if (typeof value === 'object') {
            return Object.keys(value).some(function (key) {
                return objectContainsString(value[key], expectedLowerValue);
            });
        }

        return false;
    }

    function buildSessionsPaths() {
        const userIds = getCurrentUserIds();
        const paths = ['Sessions'];

        userIds.forEach(function (id) {
            const path = 'Sessions?UserId=' + encodeURIComponent(id);
            if (paths.indexOf(path) === -1) {
                paths.push(path);
            }
        });

        return paths;
    }

    async function fetchJson(path) {
        if (!window.ApiClient) {
            return null;
        }

        const normalizedPath = typeof path === 'string' && path.charAt(0) === '/' ? path.slice(1) : path;
        const url = typeof window.ApiClient.getUrl === 'function'
            ? window.ApiClient.getUrl(normalizedPath)
            : normalizedPath;

        if (typeof window.ApiClient.ajax === 'function') {
            return window.ApiClient.ajax({
                type: 'GET',
                url: url,
                dataType: 'json'
            });
        }

        if (typeof window.ApiClient.getJSON === 'function') {
            return window.ApiClient.getJSON(url);
        }

        return null;
    }

    async function postJson(path, data, expectJsonResponse) {
        if (!window.ApiClient) {
            return null;
        }

        const normalizedPath = typeof path === 'string' && path.charAt(0) === '/' ? path.slice(1) : path;
        const url = typeof window.ApiClient.getUrl === 'function'
            ? window.ApiClient.getUrl(normalizedPath)
            : normalizedPath;

        if (typeof window.ApiClient.ajax === 'function') {
            const request = {
                type: 'POST',
                url: url,
                contentType: 'application/json; charset=utf-8',
                data: JSON.stringify(data || {})
            };

            if (expectJsonResponse) {
                request.dataType = 'json';
            }

            return window.ApiClient.ajax(request);
        }

        if (typeof window.fetch === 'function') {
            const response = await window.fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json; charset=utf-8'
                },
                body: JSON.stringify(data || {})
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            if (expectJsonResponse) {
                return response.json();
            }

            return null;
        }

        return null;
    }

    function matchesCurrentUser(session) {
        const currentUserIds = getCurrentUserIds();
        if (!currentUserIds.length) {
            return true;
        }

        const sessionUserId = (session && session.UserId) || (session && session.User && session.User.Id) || '';
        const normalizedSessionUserId = normalizeId(sessionUserId);
        return currentUserIds.some(function (id) {
            return normalizeId(id) === normalizedSessionUserId;
        });
    }

    function getCurrentSessionIds(sessions) {
        return sessions
            .filter(matchesCurrentUser)
            .map(function (session) { return session && session.Id; })
            .filter(function (id) { return typeof id === 'string' && id.length > 0; });
    }

    function getCurrentSession(sessions) {
        const currentDeviceId = normalizeId(getCurrentDeviceId());
        const matchingUserSessions = sessions.filter(matchesCurrentUser);

        if (currentDeviceId) {
            const exactDeviceSession = matchingUserSessions.find(function (session) {
                return normalizeId(session && session.DeviceId) === currentDeviceId;
            });

            if (exactDeviceSession) {
                return exactDeviceSession;
            }
        }

        return matchingUserSessions.length > 0 ? matchingUserSessions[0] : null;
    }

    function mapKnownSessionIds(sessions) {
        const map = {};
        sessions.forEach(function (session) {
            const sessionId = session && session.Id;
            if (typeof sessionId === 'string' && sessionId.length > 0) {
                map[normalizeId(sessionId)] = sessionId;
            }
        });

        return map;
    }

    function filterSessionIdsToKnownSessions(sessionIds, sessions) {
        const knownSessionIds = mapKnownSessionIds(sessions);
        const filtered = [];

        sessionIds.forEach(function (id) {
            const knownId = knownSessionIds[normalizeId(id)];
            if (knownId && filtered.indexOf(knownId) === -1) {
                filtered.push(knownId);
            }
        });

        return filtered;
    }

    function summarizeError(error) {
        if (!error) {
            return 'Unknown error';
        }

        if (typeof error === 'string') {
            return error;
        }

        if (error.message) {
            return error.message;
        }

        if (error.status || error.statusText) {
            return 'HTTP ' + (error.status || 'unknown') + ' ' + (error.statusText || '').trim();
        }

        if (error.responseJSON) {
            try {
                return JSON.stringify(error.responseJSON);
            } catch (jsonErr) {
                return 'Response JSON serialization failed';
            }
        }

        if (error.responseText) {
            return String(error.responseText).slice(0, 500);
        }

        try {
            return JSON.stringify(error).slice(0, 500);
        } catch (jsonErr) {
            return 'Unserializable error object';
        }
    }

    function isLikelySessionId(value) {
        if (typeof value !== 'string') {
            return false;
        }

        const trimmed = value.trim();
        return /^[a-f0-9]{32}$/i.test(trimmed) || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(trimmed);
    }

    function resolveSyncPlayGroupId(group) {
        const direct = (group && group.Id)
            || (group && group.GroupId)
            || (group && group.Group && group.Group.Id)
            || (group && group.GroupInfo && group.GroupInfo.Id)
            || '';

        if (typeof direct === 'string' && direct.length > 0) {
            return direct;
        }

        const values = [];
        collectStringValues(group, values);
        const possibleGroupId = values.find(function (value) {
            return isLikelySessionId(value);
        });

        return possibleGroupId || '';
    }

    function extractLikelySessionIdsFromGroup(group) {
        const fromSessionKeys = [];

        function walk(value) {
            if (value === null || value === undefined) {
                return;
            }

            if (Array.isArray(value)) {
                value.forEach(walk);
                return;
            }

            if (typeof value !== 'object') {
                return;
            }

            Object.keys(value).forEach(function (key) {
                const child = value[key];
                const normalizedKey = normalizeId(key);
                if ((normalizedKey === 'sessionid' || normalizedKey.indexOf('sessionid') !== -1) && typeof child === 'string' && child.length > 0) {
                    fromSessionKeys.push(child);
                }
                walk(child);
            });
        }

        walk(group);

        const values = [];
        collectStringValues(group, values);

        const unique = [];
        fromSessionKeys.forEach(function (value) {
            if (typeof value !== 'string' || value.length === 0) {
                return;
            }

            if (unique.indexOf(value) === -1) {
                unique.push(value);
            }
        });

        values.forEach(function (value) {
            if (!isLikelySessionId(value)) {
                return;
            }

            if (unique.indexOf(value) === -1) {
                unique.push(value);
            }
        });

        return unique;
    }

    async function fetchSyncPlayGroupDetails(groups) {
        const detailGroups = [];

        for (let i = 0; i < groups.length; i += 1) {
            const group = groups[i];
            const groupId = resolveSyncPlayGroupId(group);
            if (!groupId) {
                continue;
            }

            try {
                const details = await fetchJson('SyncPlay/' + encodeURIComponent(groupId));
                if (details) {
                    detailGroups.push(details);
                }
            } catch (err) {
                logDebug('Failed to fetch SyncPlay group details', { groupId: groupId, error: err });
            }
        }

        return detailGroups;
    }

    function getGroupIdsForCurrentUserSessions(sessions) {
        const groupIds = [];
        sessions
            .filter(matchesCurrentUser)
            .forEach(function (session) {
                const groupId = extractSyncPlayGroupId(session);
                if (groupId && groupIds.indexOf(groupId) === -1) {
                    groupIds.push(groupId);
                }
            });

        return groupIds;
    }

    function findSessionIdsByGroupIds(sessions, groupIds) {
        if (!groupIds.length) {
            return [];
        }

        const normalizedGroupIds = groupIds.map(normalizeId).filter(Boolean);
        return sessions
            .filter(function (session) {
                const sessionGroupId = normalizeId(extractSyncPlayGroupId(session));
                return normalizedGroupIds.indexOf(sessionGroupId) !== -1;
            })
            .map(function (session) { return session && session.Id; })
            .filter(function (id) { return typeof id === 'string' && id.length > 0; });
    }

    function findSessionIdsInGroupPayload(groups, sessions) {
        if (!groups.length || !sessions.length) {
            return [];
        }

        const normalizedSessionIds = {};
        sessions.forEach(function (session) {
            const sessionId = session && session.Id;
            if (typeof sessionId === 'string' && sessionId.length > 0) {
                normalizedSessionIds[normalizeId(sessionId)] = sessionId;
            }
        });

        const matchingIds = [];

        groups.forEach(function (group) {
            if (!groupsContainCurrentUser([group], sessions)) {
                return;
            }

            const values = [];
            collectStringValues(group, values);
            values.forEach(function (value) {
                const normalizedValue = normalizeId(value);
                const sessionId = normalizedSessionIds[normalizedValue];
                if (sessionId && matchingIds.indexOf(sessionId) === -1) {
                    matchingIds.push(sessionId);
                }
            });
        });

        return matchingIds;
    }

    function findGroupsByGroupIds(groups, groupIds) {
        if (!groups.length || !groupIds.length) {
            return [];
        }

        const normalizedGroupIds = groupIds.map(normalizeId).filter(Boolean);
        return groups.filter(function (group) {
            return normalizedGroupIds.indexOf(normalizeId(resolveSyncPlayGroupId(group))) !== -1;
        });
    }

    function mergeSessionsUnique(primary, secondary) {
        const map = {};

        (primary || []).forEach(function (session) {
            const id = session && session.Id;
            if (typeof id === 'string' && id.length > 0) {
                map[id] = session;
            }
        });

        (secondary || []).forEach(function (session) {
            const id = session && session.Id;
            if (typeof id === 'string' && id.length > 0 && !map[id]) {
                map[id] = session;
            }
        });

        return Object.keys(map).map(function (id) {
            return map[id];
        });
    }

    function extractParticipantTokens(groups) {
        const userIds = [];
        const userNames = [];

        groups.forEach(function (group) {
            if (!group || !Array.isArray(group.Participants)) {
                return;
            }

            group.Participants.forEach(function (participant) {
                if (typeof participant === 'string' && participant.length > 0) {
                    if (isLikelySessionId(participant)) {
                        if (userIds.indexOf(participant) === -1) {
                            userIds.push(participant);
                        }
                        return;
                    }

                    if (userNames.indexOf(participant) === -1) {
                        userNames.push(participant);
                    }
                    return;
                }

                if (!participant || typeof participant !== 'object') {
                    return;
                }

                const participantUserId = participant.UserId || (participant.User && participant.User.Id) || '';
                if (typeof participantUserId === 'string' && participantUserId.length > 0 && userIds.indexOf(participantUserId) === -1) {
                    userIds.push(participantUserId);
                }

                const participantUserName = participant.UserName || (participant.User && participant.User.Name) || '';
                if (typeof participantUserName === 'string' && participantUserName.length > 0 && userNames.indexOf(participantUserName) === -1) {
                    userNames.push(participantUserName);
                }
            });
        });

        return {
            userIds: userIds,
            userNames: userNames
        };
    }

    async function fetchSessionsForUserIds(userIds) {
        const sessionsById = {};

        for (let i = 0; i < userIds.length; i += 1) {
            const userId = userIds[i];
            if (!userId) {
                continue;
            }

            try {
                const response = await fetchJson('Sessions?UserId=' + encodeURIComponent(userId));
                const sessions = normalizeSessionsResponse(response);
                sessions.forEach(function (session) {
                    const sessionId = session && session.Id;
                    if (typeof sessionId === 'string' && sessionId.length > 0) {
                        sessionsById[sessionId] = session;
                    }
                });
            } catch (err) {
                logDebug('Failed to fetch participant sessions by user ID', { userId: userId, error: err });
            }
        }

        return Object.keys(sessionsById).map(function (id) {
            return sessionsById[id];
        });
    }

    function buildCurrentIdentityTokens(sessions) {
        const tokens = [];

        getCurrentUserIds().forEach(function (id) {
            if (id && tokens.indexOf(id) === -1) {
                tokens.push(id);
            }
        });

        const currentUserName = getCurrentUserName();
        if (currentUserName && tokens.indexOf(currentUserName) === -1) {
            tokens.push(currentUserName);
        }

        getCurrentSessionIds(sessions).forEach(function (sessionId) {
            if (sessionId && tokens.indexOf(sessionId) === -1) {
                tokens.push(sessionId);
            }
        });

        sessions
            .filter(matchesCurrentUser)
            .forEach(function (session) {
                const userName = (session && session.UserName)
                    || (session && session.User && session.User.Name)
                    || '';
                if (userName && tokens.indexOf(userName) === -1) {
                    tokens.push(userName);
                }
            });

        return tokens;
    }

    function payloadContainsAnyIdentity(payload, identityTokens) {
        if (!payload || !identityTokens.length) {
            return false;
        }

        return identityTokens.some(function (token) {
            return objectContainsString(payload, token);
        });
    }

    function hasIntersection(left, right) {
        if (!left.length || !right.length) {
            return false;
        }

        const rightLookup = {};
        right.forEach(function (value) {
            rightLookup[normalizeId(value)] = true;
        });

        return left.some(function (value) {
            return !!rightLookup[normalizeId(value)];
        });
    }

    async function isCurrentUserInGroupsViaDetails(groups, sessions) {
        const localSessionIds = getCurrentSessionIds(sessions);
        const identityTokens = buildCurrentIdentityTokens(sessions);
        if (!localSessionIds.length || !groups.length) {
            return false;
        }

        const groupIds = getGroupIdsForCurrentUserSessions(sessions);
        const scopedGroups = findGroupsByGroupIds(groups, groupIds);
        const groupsForLookup = scopedGroups.length > 0 ? scopedGroups : groups;
        const groupDetailPayloads = await fetchSyncPlayGroupDetails(groupsForLookup);

        const sessionIdsFromGroupDetails = [];
        let matchedIdentityInDetails = false;
        groupDetailPayloads.forEach(function (groupDetail) {
            if (!matchedIdentityInDetails && payloadContainsAnyIdentity(groupDetail, identityTokens)) {
                matchedIdentityInDetails = true;
            }

            extractLikelySessionIdsFromGroup(groupDetail).forEach(function (id) {
                if (sessionIdsFromGroupDetails.indexOf(id) === -1) {
                    sessionIdsFromGroupDetails.push(id);
                }
            });
        });

        const knownSessionIds = filterSessionIdsToKnownSessions(sessionIdsFromGroupDetails, sessions);
        if (hasIntersection(localSessionIds, knownSessionIds)) {
            return true;
        }

        return matchedIdentityInDetails;
    }

    function showLocalToast(text) {
        showChatStatus(text);
        logDebug('SyncPlay chat status', text);
    }

    function extractParticipantsFromGroups(groups) {
        const participants = [];

        groups.forEach(function (group) {
            const groupParticipants = group && group.Participants;
            if (!Array.isArray(groupParticipants)) {
                return;
            }

            groupParticipants.forEach(function (participant) {
                if (typeof participant === 'string' && participant.length > 0 && participants.indexOf(participant) === -1) {
                    participants.push(participant);
                    return;
                }

                if (participant && typeof participant === 'object') {
                    const userName = participant.UserName || (participant.User && participant.User.Name) || '';
                    const deviceName = participant.DeviceName || participant.Device || '';

                    if (typeof userName === 'string' && userName.length > 0 && participants.indexOf(userName) === -1) {
                        participants.push(userName);
                    }

                    if (typeof deviceName === 'string' && deviceName.length > 0 && participants.indexOf(deviceName) === -1) {
                        participants.push(deviceName);
                    }
                }
            });
        });

        return participants;
    }

    async function resolveChatContext(forceRefresh) {
        const now = Date.now();
        if (!forceRefresh && lastChatContext && now - lastChatContextResolvedAt < chatContextCacheMs) {
            return lastChatContext;
        }

        const sessions = await fetchSessions();
        const groupsResponse = await fetchJson('SyncPlay/List');
        const groups = normalizeGroupsResponse(groupsResponse);
        const currentSession = getCurrentSession(sessions);
        const groupIds = getGroupIdsForCurrentUserSessions(sessions);
        const groupsBySessionGroupIds = findGroupsByGroupIds(groups, groupIds);
        const relevantGroups = groups.filter(function (group) {
            return groupsContainCurrentUser([group], sessions);
        });
        let groupsForDetailLookup = [];

        if (groupsBySessionGroupIds.length > 0) {
            groupsForDetailLookup = groupsBySessionGroupIds;
        } else if (relevantGroups.length > 0) {
            groupsForDetailLookup = relevantGroups;
        } else if (groups.length === 1) {
            groupsForDetailLookup = [groups[0]];
        }

        const preferredGroupId = groupIds.length > 0 ? groupIds[0] : resolveSyncPlayGroupId(groupsForDetailLookup[0] || groups[0]);
        const context = {
            groupId: preferredGroupId || '',
            senderSessionId: currentSession && currentSession.Id,
            participants: extractParticipantsFromGroups(groupsForDetailLookup.length > 0 ? groupsForDetailLookup : groups)
        };
        lastChatContext = context;
        lastChatContextResolvedAt = now;
        return context;
    }

    function buildChatQuery(context) {
        const query = [];
        if (context && context.groupId) {
            query.push('groupId=' + encodeURIComponent(context.groupId));
        }

        if (context && context.senderSessionId) {
            query.push('senderSessionId=' + encodeURIComponent(context.senderSessionId));
        }

        if (context && context.participants && context.participants.length) {
            query.push('participantsCsv=' + encodeURIComponent(context.participants.join(',')));
        }

        return query.length > 0 ? '?' + query.join('&') : '';
    }

    async function fetchChatMessages(context) {
        const response = await fetchJson('SyncPlayChat/Messages' + buildChatQuery(context));
        return normalizeChatMessages(response);
    }

    async function pollChatMessages() {
        if (messagePollInProgress || !chatPanelVisible) {
            return;
        }

        messagePollInProgress = true;
        try {
            const context = await resolveChatContext(false);
            if (context.groupId) {
                const storedMessages = loadMessagesFromStorage(context.groupId);
                if (storedMessages.length > 0) {
                    renderChatMessages(context.groupId, storedMessages);
                }
            }

            const messages = await fetchChatMessages(context);
            renderChatMessages(context.groupId, messages);
            showChatStatus('');
        } catch (err) {
            logDebug('Failed to poll SyncPlay chat messages', err);
        } finally {
            messagePollInProgress = false;
        }
    }

    async function sendMessageViaServer(text, context) {
        const response = await postJson('SyncPlayChat/Send', {
            GroupId: context.groupId || '',
            SenderSessionId: context.senderSessionId || '',
            Text: text,
            ParticipantsCsv: (context.participants || []).join(',')
        }, true);

        let normalized = response;
        if (typeof normalized === 'string') {
            try {
                normalized = JSON.parse(normalized);
            } catch (parseError) {
                logDebug('Failed to parse server chat send response JSON', {
                    response: response,
                    error: parseError
                });
                normalized = null;
            }
        }

        if (normalized && typeof normalized === 'object' && normalized.responseJSON && typeof normalized.responseJSON === 'object') {
            normalized = normalized.responseJSON;
        }

        if (!normalized || typeof normalized !== 'object') {
            logDebug('Unexpected server chat send response shape', { response: response, normalized: normalized });
            return {
                attempted: 0,
                sent: 0,
                failed: 0
            };
        }

        return {
            attempted: Number(normalized.Attempted) || 0,
            sent: Number(normalized.Sent) || 0,
            failed: Number(normalized.Failed) || 0,
            message: normalized.Message || normalized.message || null
        };
    }

    async function onChatButtonClick(chatText) {
        if (sendInProgress) {
            return;
        }

        const trimmedText = typeof chatText === 'string' ? chatText.trim() : '';
        if (!trimmedText) {
            return;
        }

        sendInProgress = true;
        setComposerBusy(true);

        try {
            const context = await resolveChatContext(false);
            const result = await sendMessageViaServer(trimmedText, context);

            logDebug('Sync chat send result', result);

            if (result && result.sent > 0) {
                clearComposerInput();
                if (result.message) {
                    const messageGroupId = result.message.groupId || result.message.GroupId || context.groupId;
                    renderChatMessages(messageGroupId, mergeChatMessages(lastRenderedMessages, [result.message]));
                }

                pollChatMessages();
            } else {
                showLocalToast('Failed to send SyncPlay chat message.');
            }
        } catch (err) {
            logDebug('Failed to send SyncPlay chat message', err);
            showLocalToast('Failed to send SyncPlay chat message.');
        } finally {
            sendInProgress = false;
            setComposerBusy(false);
        }
    }

    function groupsContainCurrentUser(groups, sessions) {
        const identityTokens = buildCurrentIdentityTokens(sessions);
        if (identityTokens.length === 0) {
            return false;
        }

        return groups.some(function (group) {
            return payloadContainsAnyIdentity(group, identityTokens);
        });
    }

    async function fetchSessions() {
        const paths = buildSessionsPaths();
        const sessionsById = {};
        const sessionsWithoutId = [];

        for (let i = 0; i < paths.length; i += 1) {
            const path = paths[i];
            try {
                const response = await fetchJson(path);
                const sessions = normalizeSessionsResponse(response);
                sessions.forEach(function (session) {
                    const sessionId = session && session.Id;
                    if (typeof sessionId === 'string' && sessionId.length > 0) {
                        sessionsById[sessionId] = session;
                        return;
                    }

                    sessionsWithoutId.push(session);
                });
            } catch (err) {
                logDebug('Failed to fetch sessions path', { path: path, error: err });
            }
        }

        const dedupedSessions = Object.keys(sessionsById).map(function (id) {
            return sessionsById[id];
        });

        if (dedupedSessions.length === 0 && sessionsWithoutId.length > 0) {
            return sessionsWithoutId;
        }

        return dedupedSessions;
    }

    async function isCurrentUserInSyncPlayGroup() {
        if (!window.ApiClient) {
            return false;
        }

        const sessions = await fetchSessions();
        const matchingUserSessions = sessions.filter(matchesCurrentUser);
        if (matchingUserSessions.length === 0) {
            return false;
        }

        if (matchingUserSessions.some(hasSyncPlayGroup)) {
            return true;
        }

        try {
            const groupsResponse = await fetchJson('SyncPlay/List');
            const groups = normalizeGroupsResponse(groupsResponse);
            if (groups.length > 0) {
                if (groupsContainCurrentUser(groups, sessions)) {
                    return true;
                }

                if (await isCurrentUserInGroupsViaDetails(groups, sessions)) {
                    return true;
                }
            }
        } catch (err) {
            logDebug('SyncPlay list request failed', err);
        }

        logDebug('Current user not in any SyncPlay group', {
            matchingUserSessions: matchingUserSessions.length
        });
        return false;
    }

    async function refreshSyncPlayState() {
        if (refreshInProgress) {
            return;
        }

        refreshInProgress = true;

        try {
            shouldShowButton = await isCurrentUserInSyncPlayGroup();
            if (!shouldShowButton) {
                lastChatContext = null;
                lastChatContextResolvedAt = 0;
                lastRenderedGroupId = '';
            }
        } catch (err) {
            logDebug('Failed to refresh SyncPlay state', err);
            return;
        } finally {
            refreshInProgress = false;
            addButton();
        }
    }

    function addButton() {
        addButtonQueued = false;

        const floatingHost = getFloatingHost();
        const shouldShowChatUi = isPlaybackActive();
        if (!shouldShowChatUi) {
            hideChatPanel();
            Array.prototype.slice.call(document.querySelectorAll('.' + markerClass)).forEach(function (button) {
                button.remove();
            });
            return;
        }

        getOrCreateChatPanel();
        getOrCreateOverlayButton(floatingHost);
        applyFloatingHostLayout(floatingHost);
    }

    function scheduleAddButton() {
        if (addButtonQueued) {
            return;
        }

        addButtonQueued = true;
        window.requestAnimationFrame(addButton);
    }

    function start() {
        if (!document.body) {
            return;
        }

        window.__syncPlayChatLoaded = true;
        ensureSidebarLayoutStyles();

        const observer = new MutationObserver(scheduleAddButton);
        observer.observe(document.body, { childList: true, subtree: true });

        addButton();
        window.setInterval(scheduleAddButton, 500);
        window.setInterval(pollChatMessages, messagePollIntervalMs);
        window.addEventListener('resize', function () {
            applyDocumentLayout();
        });
        document.addEventListener('keydown', handleGlobalChatFocusShortcut, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
