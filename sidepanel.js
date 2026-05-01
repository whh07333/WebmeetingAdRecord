// sidepanel.js - 网页会议录音器侧边栏逻辑（直接与background通信）

class MeetingRecorderSidePanel {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.recordingStartTime = null;
    this.recordingTimer = null;
    this.elapsedTime = 0;
    this.speakers = new Map();
    this.transcriptions = [];
    this.audioChunks = [];
    this.settings = null;

    // 分析状态控制
    this.isAnalyzing = false;
    this.analysisMessageListener = null;
    this.lastRecordingBlob = null;
    this.lastRecordingUrl = null;

    // 实时转写状态
    this.interimTranscription = null;

    // DOM 元素
    this.recordingStatus = document.getElementById('recordingStatus');
    this.recordingTime = document.getElementById('recordingTime');
    this.speakerCount = document.getElementById('speakerCount');
    this.fileSize = document.getElementById('fileSize');
    this.recordingIndicator = document.getElementById('recordingIndicator');
    this.speakerDisplay = document.getElementById('speakerDisplay');
    this.transcriptionList = document.getElementById('transcriptionList');
    this.progressFill = document.getElementById('progressFill');
    this.progressPercent = document.getElementById('progressPercent');

    // 按钮
    this.startBtn = document.getElementById('startBtn');
    this.pauseBtn = document.getElementById('pauseBtn');
    this.stopBtn = document.getElementById('stopBtn');
    this.analyzeBtn = document.getElementById('analyzeBtn');
    this.settingsBtn = document.getElementById('settingsBtn');

    // 音频可视化
    this.waveformCanvas = document.getElementById('waveformCanvas');
    this.canvasContext = null;
    this.animationId = null;

    this.init();
  }

  async init() {
    console.log('会议录音器侧边栏初始化...');

    // 加载设置
    await this.loadSettings();

    // 初始化音频可视化
    this.initAudioVisualizer();

    // 绑定事件
    this.startBtn.addEventListener('click', () => this.startRecording());
    this.pauseBtn.addEventListener('click', () => this.togglePause());
    this.stopBtn.addEventListener('click', () => this.stopRecording());
    this.analyzeBtn.addEventListener('click', () => this.analyzeRecording());
    this.settingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.openSettings();
    });

    // 监听来自后台的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message);
    });

    // 更新UI状态
    this.updateUIState();

    // 检查当前标签页是否在会议中
    await this.checkCurrentTab();

    console.log('会议录音器侧边栏初始化完成');
  }

  async loadSettings() {
    try {
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

      console.log('设置加载成功:', this.settings);
    } catch (error) {
      console.error('加载设置失败:', error);
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

  async checkCurrentTab() {
    try {
      if (!chrome.tabs || !chrome.tabs.query) {
        console.warn('chrome.tabs API不可用');
        return;
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const meetingDomains = [
          'zoom.us', 'teams.microsoft.com', 'meet.google.com',
          'webex.com', 'gotomeeting.com', 'bluejeans.com',
          'whereby.com', 'lark.com', 'feishu.cn'
        ];

        const isMeetingSite = meetingDomains.some(domain => tab.url && tab.url.includes(domain));

        if (isMeetingSite) {
          this.showNotification('检测到会议网站，可以开始录音', 'info');
        }
      }
    } catch (error) {
      console.error('检查标签页失败:', error);
    }
  }

  /**
   * 开始录音（直接向background发送消息）
   */
  async startRecording() {
    if (this.isRecording) return;

    try {
      console.log('开始录音...');

      // 获取当前活动标签页
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        this.showError('无法获取当前标签页');
        return;
      }

      // 检查标签页类型
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') ||
          tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://')) {
        this.showError('无法在浏览器内部页面录音');
        return;
      }

      // 直接向background发送录音请求
      const response = await chrome.runtime.sendMessage({
        type: 'startRecording',
        tabId: tab.id
      });

      if (response && response.success) {
        this.isRecording = true;
        this.recordingStartTime = Date.now();
        this.elapsedTime = 0;
        this.speakers.clear();
        this.transcriptions = [];
        this.audioChunks = [];

        this.startTimer();
        this.recordingIndicator.style.display = 'flex';
        this.speakerCount.textContent = '音频录制中';
        this.updateUIState();
        this.startAudioVisualization();

        this.showNotification('录音已开始', 'success');
        console.log('录音已开始');
      } else {
        const errorMsg = response?.error || '未知错误';
        this.showError(`录音失败: ${errorMsg}`);
      }

    } catch (error) {
      console.error('录音异常:', error);
      this.showError(`录音失败: ${error.message}`);
    }
  }

  /**
   * 切换暂停/恢复（直接向background发送消息）
   */
  async togglePause() {
    if (!this.isRecording) return;

    this.isPaused = !this.isPaused;

    if (this.isPaused) {
      clearInterval(this.recordingTimer);
      this.showNotification('录音已暂停', 'warning');

      // 直接向background发送暂停请求
      await chrome.runtime.sendMessage({ type: 'pauseRecording' });
    } else {
      this.startTimer();
      this.showNotification('恢复录音', 'info');

      // 直接向background发送恢复请求
      await chrome.runtime.sendMessage({ type: 'resumeRecording' });
    }

    this.updateUIState();
  }

  /**
   * 停止录音（直接向background发送消息）
   */
  async stopRecording() {
    if (!this.isRecording) return;

    try {
      console.log('停止录音...');

      // 直接向background发送停止请求
      await chrome.runtime.sendMessage({ type: 'stopRecording' });

      this.stopTimer();
      this.stopAudioVisualization();

      this.isRecording = false;
      this.isPaused = false;

      this.recordingIndicator.style.display = 'none';
      this.speakers.clear();
      this.speakerCount.textContent = '待分析';

      this.updateUIState();
      this.showNotification('录音已停止', 'info');

      console.log('录音已停止');
    } catch (error) {
      console.error('停止录音失败:', error);
      this.showError(`停止录音失败: ${error.message}`);
    }
  }

  handleRecordingSaved(message) {
    this.showNotification('文件已保存到下载目录', 'success');
    if (message.filename) {
      console.log('[Meeting Recorder] 录音已保存:', message.filename);
    }
  }

  async analyzeRecording() {
    if (this.isRecording) {
      this.showError('请先停止录音');
      return;
    }

    if (this.isAnalyzing) {
      this.showError('正在分析中，请稍候...');
      return;
    }

    if (!this.settings.apiKey) {
      this.showError('请先在设置中配置 API Key');
      return;
    }

    try {
      this.isAnalyzing = true;
      this.updateProgress(5, '准备分析数据...');
      this.updateAnalyzeButtonState();

      let pageContext = '';
      try {
        if (chrome.tabs && chrome.tabs.query) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab && tab.title) {
            pageContext = `页面标题: ${tab.title}`;
          }
        }
      } catch (e) {
        console.warn('获取页面信息失败:', e);
      }

      this.updateProgress(10, '构建分析请求...');

      const analysisResults = await this.callAiApi(pageContext);

      this.updateProgress(90, '处理分析结果...');
      this.displayAnalysisResults(analysisResults);

      this.updateProgress(100, '分析完成');
      this.showNotification('分析完成', 'success');

    } catch (error) {
      console.error('分析失败:', error);
      this.showError(`分析失败: ${error.message}`);
      this.updateProgress(0, '分析失败');
    } finally {
      this.isAnalyzing = false;
      this.updateAnalyzeButtonState();
    }
  }

  async callAiApi(pageContext) {
    const { aiProvider, apiKey, baseUrl, model, summaryType } = this.settings;

    const systemPrompt = this.buildSystemPrompt(summaryType);
    const userPrompt = this.buildUserPrompt(pageContext);

    this.updateProgress(20, '正在调用 AI API...');

    try {
      let normalizedBaseUrl = baseUrl.trim();
      if (normalizedBaseUrl.endsWith('/')) {
        normalizedBaseUrl = normalizedBaseUrl.slice(0, -1);
      }

      const endpoint = `${normalizedBaseUrl}/chat/completions`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 4000
        })
      });

      this.updateProgress(50, '等待 API 响应...');

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;

        if (response.status === 401) {
          throw new Error('API Key 无效或已过期，请检查设置');
        } else if (response.status === 403) {
          throw new Error('无权限访问该模型，请检查 API Key 权限');
        } else if (response.status === 404) {
          throw new Error('API 地址无效或模型不存在，请检查设置');
        } else if (response.status === 429) {
          throw new Error('API 请求频率超限，请稍后重试');
        } else if (response.status >= 500) {
          throw new Error('AI 服务暂时不可用，请稍后重试');
        }

        throw new Error(errorMessage);
      }

      this.updateProgress(70, '解析响应数据...');

      const data = await response.json();

      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('API 返回数据格式异常');
      }

      const content = data.choices[0].message.content;
      return this.parseAiResponse(content);

    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('网络连接失败，请检查网络或 API 地址是否正确');
      }
      throw error;
    }
  }

  buildSystemPrompt(summaryType) {
    const basePrompt = `你是一个专业的会议纪要助手。你的任务是根据用户提供的信息，生成结构化的会议分析报告。

请按照以下 JSON 格式返回结果，不要包含其他文字：
{
  "meetingInfo": {
    "title": "会议标题",
    "date": "日期",
    "duration": "时长估算",
    "participants": ["参会人员列表"]
  },
  "summary": "会议摘要（200字以内）",
  "keyPoints": ["关键要点1", "关键要点2"],
  "decisions": ["决策1", "决策2"],
  "actionItems": [
    {"assignee": "负责人", "task": "任务内容", "deadline": "截止日期", "priority": "优先级"}
  ],
  "sentimentAnalysis": {
    "overall": "整体情绪评估",
    "suggestions": "改进建议"
  }
}`;

    if (summaryType === 'brief') {
      return basePrompt + '\n\n请生成简洁摘要，重点突出核心结论和关键行动项。';
    } else if (summaryType === 'action') {
      return basePrompt + '\n\n请重点提取行动项和待办任务，其他内容可简化。';
    }

    return basePrompt + '\n\n请生成详细纪要，包含完整的分析内容。';
  }

  buildUserPrompt(pageContext) {
    let prompt = '请分析以下会议信息：\n\n';

    if (pageContext) {
      prompt += `来源: ${pageContext}\n\n`;
    }

    prompt += `录音时间: ${this.formatRecordingTime()}\n`;
    prompt += `录音时长: ${this.formatElapsedTime()}\n\n`;

    if (this.transcriptions.length > 0) {
      prompt += '转写内容:\n';
      this.transcriptions.slice(-20).forEach(t => {
        prompt += `- ${t.text}\n`;
      });
    }

    prompt += '\n请根据以上信息生成会议分析报告。';

    return prompt;
  }

  formatRecordingTime() {
    if (!this.recordingStartTime) return '未知';
    return new Date(this.recordingStartTime).toLocaleString('zh-CN');
  }

  formatElapsedTime() {
    const hours = Math.floor(this.elapsedTime / 3600000);
    const minutes = Math.floor((this.elapsedTime % 3600000) / 60000);
    const seconds = Math.floor((this.elapsedTime % 60000) / 1000);
    return `${hours}时${minutes}分${seconds}秒`;
  }

  parseAiResponse(content) {
    try {
      let jsonContent = content;
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonContent = jsonMatch[1].trim();
      }

      const result = JSON.parse(jsonContent);

      return {
        meetingInfo: result.meetingInfo || {
          title: '会议记录',
          date: new Date().toLocaleDateString('zh-CN'),
          duration: this.formatElapsedTime(),
          participants: ['参会人员']
        },
        summary: result.summary || '无摘要',
        keyPoints: result.keyPoints || [],
        decisions: result.decisions || [],
        actionItems: result.actionItems || [],
        sentimentAnalysis: result.sentimentAnalysis || {
          overall: '中性',
          suggestions: '暂无建议'
        },
        rawContent: content
      };
    } catch (parseError) {
      console.warn('JSON 解析失败，使用原始内容:', parseError);

      return {
        meetingInfo: {
          title: '会议记录',
          date: new Date().toLocaleDateString('zh-CN'),
          duration: this.formatElapsedTime(),
          participants: ['参会人员']
        },
        summary: 'AI 返回内容无法解析为结构化数据',
        keyPoints: [],
        decisions: [],
        actionItems: [],
        sentimentAnalysis: {
          overall: '未知',
          suggestions: '请检查 API 返回格式'
        },
        rawContent: content
      };
    }
  }

  displayAnalysisResults(results) {
    const resultsContainer = document.getElementById('analysisResults');
    if (!resultsContainer) {
      console.error('找不到分析结果容器');
      return;
    }

    resultsContainer.style.display = 'block';
    this.buildResultsDom(resultsContainer, results);
  }

  buildResultsDom(container, results) {
    const { meetingInfo, summary, keyPoints, decisions, actionItems, sentimentAnalysis } = results;

    container.textContent = '';

    const header = document.createElement('div');
    header.className = 'analysis-header';

    const title = document.createElement('h3');
    title.textContent = '会议分析结果';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'closeResultsBtn';
    closeBtn.className = 'btn-close';
    closeBtn.textContent = '×';
    closeBtn.title = '关闭';
    closeBtn.onclick = () => { container.style.display = 'none'; };

    header.appendChild(title);
    header.appendChild(closeBtn);
    container.appendChild(header);

    const content = document.createElement('div');
    content.className = 'analysis-content';

    const infoCard = document.createElement('div');
    infoCard.className = 'info-card';

    const infoRows = [
      ['标题', meetingInfo.title],
      ['日期', meetingInfo.date],
      ['时长', meetingInfo.duration],
      ['参会人', (meetingInfo.participants || []).join(', ')]
    ];

    infoRows.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'info-row';

      const strong = document.createElement('strong');
      strong.textContent = label + ': ';
      row.appendChild(strong);
      row.appendChild(document.createTextNode(value || ''));

      infoCard.appendChild(row);
    });

    content.appendChild(infoCard);

    const summarySection = this.createSection('会议摘要');
    const summaryP = document.createElement('p');
    summaryP.textContent = summary || '无摘要';
    summarySection.appendChild(summaryP);
    content.appendChild(summarySection);

    if (keyPoints && keyPoints.length > 0) {
      const keySection = this.createSection('关键要点');
      const ul = document.createElement('ul');
      keyPoints.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p;
        ul.appendChild(li);
      });
      keySection.appendChild(ul);
      content.appendChild(keySection);
    }

    if (decisions && decisions.length > 0) {
      const decisionSection = this.createSection('决策事项');
      const ul = document.createElement('ul');
      decisions.forEach(d => {
        const li = document.createElement('li');
        li.textContent = d;
        ul.appendChild(li);
      });
      decisionSection.appendChild(ul);
      content.appendChild(decisionSection);
    }

    if (actionItems && actionItems.length > 0) {
      const actionSection = this.createSection('行动项');
      const actionContainer = document.createElement('div');
      actionContainer.className = 'action-items';

      actionItems.forEach(item => {
        const actionDiv = document.createElement('div');
        actionDiv.className = 'action-item';

        const taskDiv = document.createElement('div');
        taskDiv.className = 'action-task';
        taskDiv.textContent = item.task || '';
        actionDiv.appendChild(taskDiv);

        const metaDiv = document.createElement('div');
        metaDiv.className = 'action-meta';

        const assignee = document.createElement('span');
        assignee.textContent = '负责人: ' + (item.assignee || '未分配');

        const deadline = document.createElement('span');
        deadline.textContent = '截止: ' + (item.deadline || '待定');

        const priority = document.createElement('span');
        priority.className = 'priority-tag';
        priority.textContent = item.priority || '中';

        metaDiv.appendChild(assignee);
        metaDiv.appendChild(deadline);
        metaDiv.appendChild(priority);

        actionDiv.appendChild(metaDiv);
        actionContainer.appendChild(actionDiv);
      });

      actionSection.appendChild(actionContainer);
      content.appendChild(actionSection);
    }

    if (sentimentAnalysis) {
      const sentimentSection = this.createSection('情绪分析');
      const sentimentDiv = document.createElement('div');
      sentimentDiv.className = 'sentiment';

      const overall = document.createElement('span');
      overall.textContent = '整体: ' + (sentimentAnalysis.overall || '中性');
      sentimentDiv.appendChild(overall);

      if (sentimentAnalysis.suggestions) {
        const suggestions = document.createElement('p');
        suggestions.className = 'suggestions';
        suggestions.textContent = sentimentAnalysis.suggestions;
        sentimentDiv.appendChild(suggestions);
      }

      sentimentSection.appendChild(sentimentDiv);
      content.appendChild(sentimentSection);
    }

    container.appendChild(content);

    const footer = document.createElement('div');
    footer.className = 'analysis-footer';

    const downloadBtn = document.createElement('button');
    downloadBtn.id = 'downloadResultBtn';
    downloadBtn.className = 'btn btn-primary';
    downloadBtn.textContent = '下载结果';
    downloadBtn.onclick = () => this.downloadAnalysisResults(results);

    footer.appendChild(downloadBtn);
    container.appendChild(footer);
  }

  createSection(title) {
    const section = document.createElement('div');
    section.className = 'section';

    const h4 = document.createElement('h4');
    h4.textContent = title;
    section.appendChild(h4);

    return section;
  }

  downloadAnalysisResults(results) {
    const content = this.formatResultsAsMarkdown(results);
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `meeting_analysis_${timestamp}.md`;

    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }).then(() => {
      this.showNotification('分析结果已下载', 'success');
    }).catch((error) => {
      this.showError(`下载失败: ${error.message}`);
    });
  }

  formatResultsAsMarkdown(results) {
    const { meetingInfo, summary, keyPoints, decisions, actionItems, sentimentAnalysis } = results;

    let md = `# ${meetingInfo.title || '会议记录'}\n\n`;
    md += `**日期**: ${meetingInfo.date || ''}\n`;
    md += `**时长**: ${meetingInfo.duration || ''}\n`;
    md += `**参会人**: ${(meetingInfo.participants || []).join(', ')}\n\n`;

    md += `## 会议摘要\n\n${summary || '无摘要'}\n\n`;

    if (keyPoints && keyPoints.length > 0) {
      md += `## 关键要点\n\n`;
      keyPoints.forEach(p => {
        md += `- ${p}\n`;
      });
      md += '\n';
    }

    if (decisions && decisions.length > 0) {
      md += `## 决策事项\n\n`;
      decisions.forEach(d => {
        md += `- ${d}\n`;
      });
      md += '\n';
    }

    if (actionItems && actionItems.length > 0) {
      md += `## 行动项\n\n`;
      md += `| 任务 | 负责人 | 截止日期 | 优先级 |\n`;
      md += `|------|--------|----------|--------|\n`;
      actionItems.forEach(item => {
        md += `| ${item.task || ''} | ${item.assignee || '未分配'} | ${item.deadline || '待定'} | ${item.priority || '中'} |\n`;
      });
      md += '\n';
    }

    if (sentimentAnalysis) {
      md += `## 情绪分析\n\n`;
      md += `整体: ${sentimentAnalysis.overall || '中性'}\n`;
      if (sentimentAnalysis.suggestions) {
        md += `建议: ${sentimentAnalysis.suggestions}\n`;
      }
    }

    return md;
  }

  updateAnalyzeButtonState() {
    if (this.analyzeBtn) {
      this.analyzeBtn.disabled = this.isRecording || this.isAnalyzing;
      this.analyzeBtn.textContent = this.isAnalyzing ? '分析中...' : 'AI分析';
    }
  }

  startTimer() {
    this.recordingTimer = setInterval(() => {
      this.elapsedTime += 1000;
      this.updateRecordingTime();
      this.updateFileSize();
    }, 1000);
  }

  stopTimer() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  updateRecordingTime() {
    const hours = Math.floor(this.elapsedTime / 3600000);
    const minutes = Math.floor((this.elapsedTime % 3600000) / 60000);
    const seconds = Math.floor((this.elapsedTime % 60000) / 1000);

    const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    this.recordingTime.textContent = timeString;
  }

  updateFileSize() {
    const bitrate = this.settings.audioQuality === 'high' ? 192 :
                   this.settings.audioQuality === 'medium' ? 128 : 64;

    const sizeMB = (bitrate * this.elapsedTime / 8000 / 1000).toFixed(2);
    this.fileSize.textContent = `${sizeMB} MB`;
  }

  updateUIState() {
    if (this.isRecording) {
      if (this.isPaused) {
        this.recordingStatus.textContent = '已暂停';
        this.recordingStatus.className = 'status-value status-paused';
      } else {
        this.recordingStatus.textContent = '录音中';
        this.recordingStatus.className = 'status-value status-recording';
      }
      this.speakerCount.textContent = '音频录制中';
    } else {
      this.recordingStatus.textContent = '就绪';
      this.recordingStatus.className = 'status-value status-ready';
      if (this.speakers.size > 0) {
        this.speakerCount.textContent = `${this.speakers.size} 人`;
      } else {
        this.speakerCount.textContent = '就绪';
      }
    }

    this.startBtn.disabled = this.isRecording;
    this.pauseBtn.disabled = !this.isRecording;
    this.stopBtn.disabled = !this.isRecording;
    this.analyzeBtn.disabled = this.isRecording;

    this.pauseBtn.textContent = this.isPaused ? '恢复' : '暂停';
  }

  updateProgress(percent, message) {
    this.progressFill.style.width = `${percent}%`;
    this.progressPercent.textContent = `${percent}%`;

    if (message) {
      console.log(`进度: ${percent}% - ${message}`);
    }
  }

  initAudioVisualizer() {
    this.canvasContext = this.waveformCanvas.getContext('2d');
    this.waveformCanvas.width = this.waveformCanvas.offsetWidth;
    this.waveformCanvas.height = this.waveformCanvas.offsetHeight;
  }

  startAudioVisualization() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }

    const drawWaveform = () => {
      if (!this.isRecording || this.isPaused) return;

      const width = this.waveformCanvas.width;
      const height = this.waveformCanvas.height;
      const ctx = this.canvasContext;

      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(0, 0, width, height);

      const time = Date.now() / 1000;
      const amplitude = 25;
      const frequency = 0.05;

      ctx.beginPath();
      ctx.strokeStyle = '#667eea';
      ctx.lineWidth = 2;

      for (let x = 0; x < width; x++) {
        const y = height / 2 + Math.sin(x * frequency + time) * amplitude;

        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();

      this.animationId = requestAnimationFrame(drawWaveform);
    };

    drawWaveform();
  }

  stopAudioVisualization() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    const ctx = this.canvasContext;
    const width = this.waveformCanvas.width;
    const height = this.waveformCanvas.height;

    ctx.clearRect(0, 0, width, height);
  }

  handleMessage(message) {
    switch (message.type) {
      case 'recordingSaved':
        this.handleRecordingSaved(message);
        break;

      case 'recordingError':
        this.showError(`录音错误: ${message.error}`);
        this.stopRecording();
        break;

      case 'speakerDetected':
        if (!this.speakers.has(message.speaker.id)) {
          this.speakers.set(message.speaker.id, message.speaker);
          this.updateSpeakerDisplay();
        }
        break;

      case 'transcriptionUpdate':
        this.transcriptions.push(message.transcription);
        this.updateTranscriptionDisplay();
        break;
    }
  }

  updateSpeakerDisplay() {
    this.speakerDisplay.textContent = '';

    const colors = ['#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#00f2fe'];

    let index = 0;
    for (const [id, speaker] of this.speakers) {
      const color = colors[index % colors.length];

      const badge = document.createElement('div');
      badge.className = 'speaker-badge';

      const colorDiv = document.createElement('div');
      colorDiv.className = 'speaker-color';
      colorDiv.style.background = color;

      const nameSpan = document.createElement('span');
      nameSpan.textContent = speaker.name || `说话人${id}`;

      const qualitySpan = document.createElement('span');
      qualitySpan.className = 'quality-badge';
      qualitySpan.textContent = speaker.confidence ? `${Math.round(speaker.confidence * 100)}%` : '新';

      badge.appendChild(colorDiv);
      badge.appendChild(nameSpan);
      badge.appendChild(qualitySpan);

      this.speakerDisplay.appendChild(badge);
      index++;
    }
  }

  updateTranscriptionDisplay() {
    const recentTranscriptions = this.transcriptions.slice(-20);

    if (recentTranscriptions.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';

      const emptyIcon = document.createElement('div');
      emptyIcon.className = 'empty-icon';
      emptyIcon.textContent = '🎯';

      const emptyText = document.createElement('div');
      emptyText.className = 'empty-text';
      emptyText.textContent = '开始录音后，将显示实时转文字结果';

      emptyState.appendChild(emptyIcon);
      emptyState.appendChild(emptyText);

      this.transcriptionList.textContent = '';
      this.transcriptionList.appendChild(emptyState);
      return;
    }

    this.transcriptionList.textContent = '';

    const colors = ['#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#00f2fe'];

    recentTranscriptions.forEach((item) => {
      const color = colors[item.speakerId % colors.length];

      const transcriptItem = document.createElement('div');
      transcriptItem.className = 'transcription-item';

      const headerDiv = document.createElement('div');

      const speakerTag = document.createElement('span');
      speakerTag.className = 'speaker-tag';
      speakerTag.style.background = `${color}20`;
      speakerTag.style.borderLeftColor = color;
      speakerTag.textContent = item.speakerName || `说话人${item.speakerId}`;

      const timestamp = document.createElement('span');
      timestamp.className = 'timestamp';
      timestamp.textContent = this.formatTime(item.timestamp);

      headerDiv.appendChild(speakerTag);
      headerDiv.appendChild(timestamp);

      const textDiv = document.createElement('div');
      textDiv.className = 'transcription-text';
      textDiv.textContent = item.text;

      transcriptItem.appendChild(headerDiv);
      transcriptItem.appendChild(textDiv);

      this.transcriptionList.appendChild(transcriptItem);
    });

    this.transcriptionList.scrollTop = this.transcriptionList.scrollHeight;
  }

  formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  showNotification(message, type = 'info') {
    if (!this.settings.notifications) return;

    const icon = type === 'error' ? '❌' :
                type === 'warning' ? '⚠️' :
                type === 'success' ? '✅' : 'ℹ️';

    console.log(`${icon} ${message}`);

    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: '会议录音器',
      message: message,
      priority: type === 'error' ? 2 : 1
    });
  }

  showError(message) {
    this.showNotification(message, 'error');

    const statusEl = document.getElementById('recordingStatus');
    if (statusEl) {
      statusEl.textContent = '出错';
      statusEl.className = 'status-value status-paused';
      statusEl.title = message;
    }

    console.error('录音错误:', message);

    let errorDisplay = document.getElementById('errorDisplay');
    if (!errorDisplay) {
      errorDisplay = document.createElement('div');
      errorDisplay.id = 'errorDisplay';
      const container = document.querySelector('.status-card') || document.body;
      container.parentNode.insertBefore(errorDisplay, container.nextSibling);
    }

    const displayMessage = message.length > 500 ? message.substring(0, 500) + '...' : message;
    errorDisplay.textContent = `${displayMessage}`;
    errorDisplay.style.display = 'block';

    setTimeout(() => {
      if (errorDisplay && !this.isRecording) {
        errorDisplay.style.display = 'none';
      }
      if (statusEl && !this.isRecording) {
        statusEl.textContent = '就绪';
        statusEl.className = 'status-value status-ready';
        statusEl.title = '';
      }
    }, 5000);
  }

  openSettings() {
    chrome.runtime.openOptionsPage();
  }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
  new MeetingRecorderSidePanel();
});
