// content.js - 网页会议录音内容脚本（仅保留UI辅助逻辑）

// 防护性检查：确保chrome.runtime可用
if (typeof chrome === 'undefined' || typeof chrome.runtime === 'undefined') {
  console.warn('[Meeting Recorder] Chrome runtime API不可用，可能是特殊页面，跳过初始化');
} else {

class MeetingRecorderContent {
  constructor() {
    this.init();
  }

  init() {
    console.log('[Meeting Recorder] 内容脚本已加载（UI辅助模式）');

    // 监听来自后台的消息
    if (chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        this.handleMessage(message, sender, sendResponse);
        return true;
      });
    }

    // 检查当前页面是否是会议页面
    this.checkIfMeetingPage();
  }

  async checkIfMeetingPage() {
    const meetingKeywords = [
      'zoom', 'teams', 'meet', 'webex', 'conference',
      '会议', 'meeting', 'call', 'video', 'audio'
    ];

    const pageText = document.body.textContent.toLowerCase();
    const isMeetingPage = meetingKeywords.some(keyword => pageText.includes(keyword));

    if (isMeetingPage) {
      console.log('[Meeting Recorder] 检测到会议页面');
      this.injectMeetingUI();
    }
  }

  injectMeetingUI() {
    // 检查是否已注入
    if (document.getElementById('meeting-recorder-control')) {
      return;
    }

    // 在页面右下角添加一个小的控制按钮（仅用于唤起侧边栏）
    const controlButton = document.createElement('div');
    controlButton.id = 'meeting-recorder-control';
    controlButton.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white;
      padding: 12px 20px;
      border-radius: 25px;
      cursor: pointer;
      z-index: 99999;
      box-shadow: 0 4px 15px rgba(0,0,0,0.2);
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px;
      transition: all 0.3s ease;
    `;

    const micIcon = document.createElement('span');
    micIcon.textContent = '🎤';
    const labelText = document.createElement('span');
    labelText.textContent = '会议录音';
    controlButton.appendChild(micIcon);
    controlButton.appendChild(labelText);

    controlButton.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'showRecorderPopup' });
    });

    document.body.appendChild(controlButton);

    // 鼠标悬停效果
    controlButton.addEventListener('mouseenter', () => {
      controlButton.style.transform = 'translateY(-2px)';
      controlButton.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)';
    });

    controlButton.addEventListener('mouseleave', () => {
      controlButton.style.transform = 'translateY(0)';
      controlButton.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
    });
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        case 'ping':
          // 响应ping消息，用于检测content.js是否已加载
          sendResponse({ success: true, message: 'content.js已就绪' });
          break;

        case 'showRecorderControl':
          // 显示录音器控制按钮（已自动注入）
          sendResponse({ success: true, message: '控制按钮已显示' });
          break;

        default:
          sendResponse({ success: true, message: '消息已接收' });
      }
    } catch (error) {
      console.error('[Meeting Recorder] 处理消息时出错:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
}

// 初始化内容脚本
const recorder = new MeetingRecorderContent();

} // chrome runtime 检查结束