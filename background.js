// background.js - 网页会议录音器后台服务（使用Offscreen Document处理录音）

class MeetingRecorderBackground {
  constructor() {
    this.settings = null;
    this.offscreenDocumentCreated = false;

    this.init();
  }

  async init() {
    console.log('[Meeting Recorder] 后台服务已启动（Offscreen模式）');

    // 加载设置
    await this.loadSettings();

    // 监听消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // 保持消息通道开放
    });

    // 监听安装事件
    chrome.runtime.onInstalled.addListener(() => {
      this.setupDefaultSettings();
    });

    // 监听扩展图标点击，打开侧边栏
    if (chrome.action && chrome.action.onClicked) {
      chrome.action.onClicked.addListener((tab) => {
        this.openSidePanel(tab);
      });
    }
  }

  // 打开侧边栏
  async openSidePanel(tab) {
    try {
      if (chrome.sidePanel && chrome.sidePanel.open) {
        await chrome.sidePanel.open({ tabId: tab.id });
        console.log('[Meeting Recorder] 侧边栏已打开');
      } else {
        console.warn('[Meeting Recorder] sidePanel API不可用');
      }
    } catch (error) {
      console.error('[Meeting Recorder] 打开侧边栏失败:', error);
    }
  }

  async loadSettings() {
    try {
      // 优先读取 recorderSettings (options.js 保存的格式)
      const result = await chrome.storage.sync.get(['recorderSettings']);

      if (result.recorderSettings) {
        this.settings = {
          aiProvider: result.recorderSettings.aiProvider || 'openai',
          apiKey: result.recorderSettings.apiKey || '',
          baseUrl: result.recorderSettings.baseUrl || 'https://api.openai.com/v1',
          model: result.recorderSettings.model || 'gpt-3.5-turbo',
          audioQuality: result.recorderSettings.audioQuality || 'medium',
          keepAudioDuringRecording: result.recorderSettings.keepAudioDuringRecording !== false,
          autoSave: result.recorderSettings.autoSave !== false,
          autoTranscribe: result.recorderSettings.autoTranscribe || false,
          speakerDiarization: result.recorderSettings.speakerDiarization || false,
          summaryType: result.recorderSettings.summaryType || 'detailed',
          autoDownloadSummary: result.recorderSettings.autoDownloadSummary || false,
          notifications: true
        };
      } else {
        this.settings = this.getDefaultSettings();
      }

      console.log('[Meeting Recorder] 设置加载成功');

    } catch (error) {
      console.error('[Meeting Recorder] 加载设置失败:', error);
      this.settings = this.getDefaultSettings();
    }
  }

  getDefaultSettings() {
    return {
      aiProvider: 'openai',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-3.5-turbo',
      audioQuality: 'medium',
      keepAudioDuringRecording: true,
      autoSave: true,
      autoTranscribe: false,
      speakerDiarization: false,
      summaryType: 'detailed',
      autoDownloadSummary: false,
      notifications: true
    };
  }

  setupDefaultSettings() {
    const defaultSettings = this.getDefaultSettings();

    chrome.storage.sync.set({ recorderSettings: defaultSettings }, () => {
      console.log('[Meeting Recorder] 默认设置已保存');
    });
  }

  /**
   * 创建 Offscreen Document
   */
  async createOffscreenDocument() {
    if (this.offscreenDocumentCreated) {
      try {
        // 检查是否已存在
        const existingContexts = await chrome.runtime.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT'],
          documentUrls: [chrome.runtime.getURL('offscreen.html')]
        });

        if (existingContexts.length > 0) {
          console.log('[Meeting Recorder] Offscreen Document 已存在');
          return;
        }
      } catch (e) {
        // 忽略错误，继续创建
      }
    }

    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: '录制标签页音频需要使用 getUserMedia API'
      });
      this.offscreenDocumentCreated = true;
      console.log('[Meeting Recorder] Offscreen Document 已创建');
    } catch (error) {
      if (error.message.includes('already exists')) {
        this.offscreenDocumentCreated = true;
        console.log('[Meeting Recorder] Offscreen Document 已存在');
      } else {
        console.error('[Meeting Recorder] 创建 Offscreen Document 失败:', error);
        throw error;
      }
    }
  }

  /**
   * 关闭 Offscreen Document
   */
  async closeOffscreenDocument() {
    try {
      await chrome.offscreen.closeDocument();
      this.offscreenDocumentCreated = false;
      console.log('[Meeting Recorder] Offscreen Document 已关闭');
    } catch (error) {
      // 忽略关闭错误
    }
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        case 'startRecording':
          // 开始录音
          await this.startRecording(message.tabId, sendResponse);
          break;

        case 'pauseRecording':
          // 暂停录音
          await this.pauseRecording(sendResponse);
          break;

        case 'resumeRecording':
          // 恢复录音
          await this.resumeRecording(sendResponse);
          break;

        case 'stopRecording':
          // 停止录音
          await this.stopRecording(sendResponse);
          break;

        case 'getRecordingStatus':
          // 获取录音状态（转发到 offscreen）
          await this.forwardToOffscreen(message, sendResponse);
          break;

        case 'saveRecording':
          // 保存录音文件
          await this.saveRecording(message.audioUrl, message.filename, message.duration);
          sendResponse({ success: true });
          break;

        case 'captureError':
          // 来自 offscreen 的错误
          this.notifySidePanel({
            type: 'recordingError',
            error: message.error
          });
          sendResponse({ success: true });
          break;

        case 'showRecorderPopup':
          await this.showRecorderPopup();
          sendResponse({ success: true });
          break;

        default:
          // 对于未知消息类型，返回成功响应避免阻塞
          console.warn('[Meeting Recorder] 未处理的消息类型:', message.type);
          sendResponse({ success: true, warning: '未处理的消息类型' });
      }
    } catch (error) {
      console.error('[Meeting Recorder] 处理消息时出错:', error);

      if (sendResponse) {
        sendResponse({ success: false, error: error.message });
      }
    }
  }

  /**
   * 开始录音
   */
  async startRecording(tabId, sendResponse) {
    try {
      console.log('[Meeting Recorder] 开始录音，目标标签页:', tabId);

      // 检查标签页是否存在
      const tab = await chrome.tabs.get(tabId);
      if (!tab) {
        sendResponse({ success: false, error: '❌ 标签页不存在' });
        return;
      }

      // 前置检查1：检查URL类型（Chrome系统页面）
      if (!tab.url) {
        sendResponse({ success: false, error: '❌ 无法获取页面URL，请打开普通网页后重试' });
        return;
      }

      const blockedPrefixes = ['chrome://', 'edge://', 'about:', 'chrome-extension://', 'file://'];
      const isBlockedPage = blockedPrefixes.some(prefix => tab.url.startsWith(prefix));

      if (isBlockedPage) {
        sendResponse({
          success: false,
          error: '❌ 无法录制Chrome系统页面，请打开普通http/https网页后重试'
        });
        return;
      }

      // 前置检查2：检查URL协议是否支持
      if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) {
        sendResponse({
          success: false,
          error: '❌ 仅支持http/https协议的网页，当前页面不支持录音'
        });
        return;
      }

      // 使用 chrome.tabCapture.getMediaStreamId 获取 streamId
      const streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tabId
      });

      if (!streamId) {
        sendResponse({ success: false, error: '获取 streamId 失败' });
        return;
      }

      console.log('[Meeting Recorder] streamId 已获取:', streamId.substring(0, 20) + '...');

      // 创建 Offscreen Document
      await this.createOffscreenDocument();

      // 发送消息给 offscreen 开始捕获
      const response = await chrome.runtime.sendMessage({
        type: 'startCapture',
        streamId: streamId
      });

      if (response && response.success) {
        console.log('[Meeting Recorder] 录音已启动');
        sendResponse({ success: true, message: '录音已开始' });
      } else {
        const errorMsg = response?.error || '未知错误';
        sendResponse({ success: false, error: errorMsg });
      }

    } catch (error) {
      console.error('[Meeting Recorder] 启动录音失败:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * 暂停录音
   */
  async pauseRecording(sendResponse) {
    await this.forwardToOffscreen({ type: 'pauseCapture' }, sendResponse);
  }

  /**
   * 恢复录音
   */
  async resumeRecording(sendResponse) {
    await this.forwardToOffscreen({ type: 'resumeCapture' }, sendResponse);
  }

  /**
   * 停止录音
   */
  async stopRecording(sendResponse) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'stopCapture' });

      if (response && response.success) {
        console.log('[Meeting Recorder] 录音已停止');
        sendResponse({ success: true, message: '录音已停止' });
      } else {
        sendResponse({ success: false, error: response?.error || '停止失败' });
      }
    } catch (error) {
      console.error('[Meeting Recorder] 停止录音失败:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * 转发消息到 Offscreen Document
   */
  async forwardToOffscreen(message, sendResponse) {
    try {
      const response = await chrome.runtime.sendMessage(message);
      sendResponse(response || { success: true });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * 保存录音文件
   */
  async saveRecording(audioUrl, filename, duration) {
    try {
      console.log('[Meeting Recorder] 保存录音文件:', filename);

      // 检查是否启用自动保存（默认开启）
      const autoSave = this.settings.autoSave !== false;

      if (autoSave) {
        // 自动下载音频文件
        await chrome.downloads.download({
          url: audioUrl,
          filename: filename,
          saveAs: false
        });

        console.log('[Meeting Recorder] 录音已自动保存:', filename);
      } else {
        console.log('[Meeting Recorder] 自动保存已禁用，跳过下载');
      }

      // 显示通知
      if (this.settings.notifications) {
        const notificationMessage = autoSave
          ? `文件: ${filename}\n时长: ${Math.round(duration / 1000)}秒\n已保存到下载目录`
          : `文件: ${filename}\n时长: ${Math.round(duration / 1000)}秒\n请手动下载`;

        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon48.png'),
          title: autoSave ? '录音已保存' : '录音已完成',
          message: notificationMessage,
          priority: 1
        });
      }

      // 发送保存成功消息到侧边栏
      this.notifySidePanel({
        type: 'recordingSaved',
        filename: filename,
        autoSaved: autoSave,
        duration: duration
      });

      console.log('[Meeting Recorder] 录音处理完成:', filename);

    } catch (error) {
      console.error('[Meeting Recorder] 保存录音失败:', error);

      if (this.settings.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon48.png'),
          title: '保存失败',
          message: `错误: ${error.message}`,
          priority: 2
        });
      }
    }
  }

  /**
   * 通知侧边栏
   */
  async notifySidePanel(message) {
    try {
      // 尝试通过 runtime.sendMessage 广播（侧边栏会监听）
      chrome.runtime.sendMessage(message).catch(() => {
        // 如果没有监听者，忽略错误
      });
    } catch (error) {
      console.warn('[Meeting Recorder] 通知侧边栏失败:', error.message);
    }
  }

  async showRecorderPopup() {
    // 安全检查
    if (!chrome.tabs || !chrome.tabs.query) {
      console.warn('[Meeting Recorder] chrome.tabs API不可用');
      return;
    }
    // 获取当前标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab) {
      // 在标签页中显示录音器界面
      if (chrome.tabs && chrome.tabs.sendMessage) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'showRecorderControl'
        });
      }
    }
  }
}

// 初始化后台服务
const backgroundService = new MeetingRecorderBackground();
