// popup.js - 网页会议录音器弹出窗口逻辑

class MeetingRecorderPopup {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.recordingStartTime = null;
    this.recordingTimer = null;
    this.elapsedTime = 0;
    this.speakers = new Map();
    this.transcriptions = [];
    this.audioChunks = [];
    this.mediaRecorder = null;
    this.audioContext = null;
    this.analyser = null;
    this.canvasContext = null;
    this.animationId = null;
    
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
    
    this.init();
  }

  async init() {
    console.log('🎤 会议录音器初始化...');
    
    // 加载设置
    await this.loadSettings();
    
    // 绑定事件
    this.startBtn.addEventListener('click', () => this.startRecording());
    this.pauseBtn.addEventListener('click', () => this.togglePause());
    this.stopBtn.addEventListener('click', () => this.stopRecording());
    this.analyzeBtn.addEventListener('click', () => this.analyzeRecording());
    this.settingsBtn.addEventListener('click', () => this.openSettings());
    
    // 初始化音频可视化
    this.initAudioVisualizer();
    
    // 监听来自内容脚本和后台的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message);
    });
    
    // 更新UI状态
    this.updateUIState();
    
    // 检查当前标签页是否在会议中
    await this.checkCurrentTab();
    
    console.log('✅ 会议录音器初始化完成');
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get([
        'audioQuality', 'audioFormat', 'savePath', 'speakerDetection',
        'realTimeTranscription', 'autoAnalyze', 'aiProvider', 'apiKey',
        'whisperModel', 'speakerModel', 'outputFormat', 'notifications',
        'keepAudioDuringRecording'
      ]);

      this.settings = {
        audioQuality: result.audioQuality || 'high',
        audioFormat: result.audioFormat || 'mp3',
        savePath: result.savePath || '~/Recordings',
        speakerDetection: result.speakerDetection !== false,
        realTimeTranscription: result.realTimeTranscription !== false,
        autoAnalyze: result.autoAnalyze || false,
        aiProvider: result.aiProvider || 'openai',
        apiKey: result.apiKey || '',
        whisperModel: result.whisperModel || 'whisper-1',
        speakerModel: result.speakerModel || 'pyannote',
        outputFormat: result.outputFormat || 'markdown',
        notifications: result.notifications !== false,
        keepAudioDuringRecording: result.keepAudioDuringRecording !== false
      };

      console.log('设置加载成功:', this.settings);
    } catch (error) {
      console.error('加载设置失败:', error);
      this.settings = this.getDefaultSettings();
    }
  }

  getDefaultSettings() {
    return {
      audioQuality: 'high',
      audioFormat: 'mp3',
      savePath: '~/Recordings',
      speakerDetection: true,
      realTimeTranscription: true,
      autoAnalyze: false,
      aiProvider: 'openai',
      apiKey: '',
      whisperModel: 'whisper-1',
      speakerModel: 'pyannote',
      outputFormat: 'markdown',
      notifications: true,
      keepAudioDuringRecording: true
    };
  }

  async checkCurrentTab() {
    try {
      // 安全检查：确保chrome.tabs可用
      if (!chrome.tabs || !chrome.tabs.query) {
        console.warn('chrome.tabs API不可用');
        return;
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        // 检查是否是常见的会议网站
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

  async startRecording() {
    if (this.isRecording) return;

    const errorSteps = []; // 记录每一步的错误信息

    try {
      console.log('🎬 开始录音流程...');

      // ========== 步骤1: 获取当前标签页 ==========
      console.log('[步骤1] 获取当前标签页...');

      // 安全检查：确保chrome.tabs可用
      if (!chrome.tabs || !chrome.tabs.query) {
        const error = 'chrome.tabs API不可用，请确保在扩展上下文中运行';
        errorSteps.push(`步骤1失败: ${error}`);
        this.showError(error);
        return;
      }

      let tab;
      try {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
          const error = '无法获取当前标签页';
          errorSteps.push(`步骤1失败: ${error}`);
          this.showError(error);
          return;
        }
        console.log('[步骤1] 成功 - 标签页ID:', tab.id, 'URL:', tab.url);
      } catch (err) {
        errorSteps.push(`步骤1异常: ${err.message}`);
        this.showError(`获取标签页失败: ${err.message}`);
        return;
      }

      // ========== 步骤2: 检查标签页类型 ==========
      console.log('[步骤2] 检查标签页类型...');
      if (!tab.url) {
        const error = '无法获取标签页URL，请刷新页面后重试';
        errorSteps.push(`步骤2失败: ${error}`);
        this.showError(error);
        return;
      }

      if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') ||
          tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://')) {
        const error = '无法在浏览器内部页面录音，请切换到普通网页（如任意网站）后重试';
        errorSteps.push(`步骤2失败: ${error}`);
        this.showError(error);
        return;
      }
      console.log('[步骤2] 成功 - 标签页类型正常');

      // ========== 步骤3: 获取 tabCapture streamId ==========
      console.log('[步骤3] 获取标签页音频流ID...');
      let streamId;
      try {
        streamId = await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error('获取音频流ID超时（10秒），可能是浏览器权限问题'));
          }, 10000);

          // 关键修复：必须同时指定 targetTabId 和 consumerTabId
          // targetTabId: 要捕获音频的标签页
          // consumerTabId: 将使用流的标签页（这里是同一个标签页）
          chrome.tabCapture.getMediaStreamId({
            targetTabId: tab.id,
            consumerTabId: tab.id
          }, (id) => {
            clearTimeout(timeoutId);
            if (chrome.runtime.lastError) {
              const errMsg = chrome.runtime.lastError.message;
              console.error('[步骤3] chrome.tabCapture.getMediaStreamId 错误:', errMsg);
              reject(new Error(`获取音频流ID失败: ${errMsg}`));
            } else if (!id) {
              reject(new Error('获取音频流ID返回空值'));
            } else {
              console.log('[步骤3] 成功获取 streamId:', id.substring(0, 20) + '...');
              resolve(id);
            }
          });
        });
      } catch (err) {
        errorSteps.push(`步骤3异常: ${err.message}`);
        this.showError(`获取音频流失败: ${err.message}\n\n请在扩展权限设置中开启「允许访问所有网站」权限，然后刷新页面重试`);
        return;
      }

      // ========== 步骤4: 发送消息到内容脚本 ==========
      console.log('[步骤4] 发送录音消息到内容脚本...');
      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, {
          action: 'startRecording',
          settings: this.settings,
          streamId: streamId
        });
      } catch (error) {
        console.log('[步骤4] 内容脚本可能未加载，尝试注入...', error.message);

        // 尝试注入内容脚本
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });

          // 等待内容脚本初始化
          await new Promise(resolve => setTimeout(resolve, 500));

          // 重新发送消息
          response = await chrome.tabs.sendMessage(tab.id, {
            action: 'startRecording',
            settings: this.settings,
            streamId: streamId
          });
        } catch (injectError) {
          errorSteps.push(`步骤4异常: 注入内容脚本失败 - ${injectError.message}`);
          this.showError(`无法在当前页面录音: ${injectError.message}\n\n请刷新页面后重试`);
          return;
        }
      }

      // ========== 步骤5: 检查响应 ==========
      console.log('[步骤5] 检查录音响应...', response);

      if (response && response.success) {
        this.isRecording = true;
        this.recordingStartTime = Date.now();
        this.elapsedTime = 0;
        this.speakers.clear();
        this.transcriptions = [];
        this.audioChunks = [];

        // 开始计时器
        this.startTimer();

        // 显示录音指示器
        this.recordingIndicator.style.display = 'flex';

        // 网页纯音频录制模式，不需要实时说话人检测
        // 显示"音频录制中"而非误导性的说话人数量
        this.speakerCount.textContent = '音频录制中';

        // 更新UI状态
        this.updateUIState();

        // 开始音频可视化
        this.startAudioVisualization();

        // 根据用户设置决定是否取消页面静音
        // Chrome 捕获标签页音频时默认会静音页面
        // 如果用户开启「录音时保留网页声音」，则取消静音
        if (this.settings.keepAudioDuringRecording) {
          try {
            await chrome.tabs.update(tab.id, { muted: false });
            console.log('✅ [静音控制] 页面静音已取消，网页声音正常播放');
          } catch (muteError) {
            console.warn('⚠️ [静音控制] 取消页面静音失败（不影响录音）:', muteError.message);
          }
        } else {
          console.log('🔇 [静音控制] 用户选择录音时静音网页');
        }

        // 显示通知
        this.showNotification('✅ 录音已开始', 'success');

        console.log('✅ 录音流程完成，状态正常');
      } else {
        // 获取具体错误信息
        const errorMsg = response?.error || '未知错误';
        const errorDetails = response?.details || '';
        errorSteps.push(`步骤5失败: ${errorMsg}`);

        // 显示详细错误信息
        this.showError(`录音启动失败:\n${errorMsg}${errorDetails ? '\n\n详情: ' + errorDetails : ''}`);
      }
    } catch (error) {
      console.error('❌ 录音流程异常:', error);
      errorSteps.push(`全局异常: ${error.message}`);
      this.showError(`录音失败: ${error.message}\n\n请尝试：\n1. 刷新页面\n2. 检查浏览器权限\n3. 确保页面有音频播放`);
    }
  }

  togglePause() {
    if (!this.isRecording) return;

    this.isPaused = !this.isPaused;

    if (this.isPaused) {
      // 暂停录音
      clearInterval(this.recordingTimer);
      this.showNotification('录音已暂停', 'warning');

      // 发送暂停消息（安全检查）
      if (chrome.tabs && chrome.tabs.query && chrome.tabs.sendMessage) {
        chrome.tabs.query({ active: true, currentWindow: true })
          .then(([tab]) => {
            if (tab) {
              chrome.tabs.sendMessage(tab.id, { action: 'pauseRecording' });
            }
          }).catch(err => console.warn('暂停消息发送失败:', err.message));
      }
    } else {
      // 恢复录音
      this.startTimer();
      this.showNotification('恢复录音', 'info');

      // 发送恢复消息（安全检查）
      if (chrome.tabs && chrome.tabs.query && chrome.tabs.sendMessage) {
        chrome.tabs.query({ active: true, currentWindow: true })
          .then(([tab]) => {
            if (tab) {
              chrome.tabs.sendMessage(tab.id, { action: 'resumeRecording' });
            }
          }).catch(err => console.warn('恢复消息发送失败:', err.message));
      }
    }

    this.updateUIState();
  }

  async stopRecording() {
    if (!this.isRecording) return;

    try {
      console.log('🛑 停止录音...');

      // 停止计时器
      this.stopTimer();

      // 停止音频可视化
      this.stopAudioVisualization();

      // 发送停止消息（安全检查）
      if (chrome.tabs && chrome.tabs.query && chrome.tabs.sendMessage) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          await chrome.tabs.sendMessage(tab.id, { action: 'stopRecording' });
        }
      }

      this.isRecording = false;
      this.isPaused = false;

      // 隐藏录音指示器
      this.recordingIndicator.style.display = 'none';

      // 录音结束后，说话人区分在转写阶段执行
      // 清空之前的说话人数据，等待转写分析
      this.speakers.clear();
      this.speakerCount.textContent = '待分析';

      // 更新UI状态
      this.updateUIState();

      // 显示通知
      this.showNotification('录音已停止', 'info');

      // 如果设置了自动分析，开始分析
      if (this.settings.autoAnalyze) {
        setTimeout(() => this.analyzeRecording(), 1000);
      }

      console.log('✅ 录音已停止');
    } catch (error) {
      console.error('停止录音失败:', error);
      this.showError(`停止录音失败: ${error.message}`);
    }
  }

  async analyzeRecording() {
    if (this.isRecording) {
      this.showError('请先停止录音');
      return;
    }

    try {
      console.log('🤖 开始AI分析...');

      // 显示进度
      this.updateProgress(10, '准备分析数据...');

      // 安全检查：确保chrome.tabs可用
      if (!chrome.tabs || !chrome.tabs.query || !chrome.tabs.sendMessage) {
        throw new Error('chrome.tabs API不可用');
      }

      // 获取录音数据
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        throw new Error('无法获取标签页');
      }

      // 请求分析
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'analyzeRecording',
        settings: this.settings
      });

      if (response && response.success) {
        this.updateProgress(30, '正在转文字...');

        // 监听分析进度
        this.listenForAnalysisProgress();

        // 显示通知
        this.showNotification('开始AI分析', 'info');
      } else {
        throw new Error(response?.error || '开始分析失败');
      }
    } catch (error) {
      console.error('开始分析失败:', error);
      this.showError(`开始分析失败: ${error.message}`);
      this.updateProgress(0, '分析失败');
    }
  }

  listenForAnalysisProgress() {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'analysisProgress') {
        this.updateProgress(message.progress, message.message);
      }
      
      if (message.type === 'analysisComplete') {
        this.updateProgress(100, '分析完成');
        this.showAnalysisResults(message.results);
      }
      
      if (message.type === 'analysisError') {
        this.updateProgress(0, '分析失败');
        this.showError(`分析失败: ${message.error}`);
      }
    });
  }

  showAnalysisResults(results) {
    console.log('分析结果:', results);
    
    // 显示通知
    this.showNotification('分析完成！点击查看结果', 'success');
    
    // 打开结果页面
    this.openResultsPage(results);
  }

  openResultsPage(results) {
    // 创建结果页面
    const resultsPage = window.open('', '_blank');
    
    if (resultsPage) {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>会议分析结果</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            .result-section { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 8px; }
            .speaker-tag { background: #e3f2fd; padding: 4px 8px; border-radius: 4px; margin-right: 8px; }
            .action-item { margin: 10px 0; padding: 10px; background: #f5f5f5; border-left: 4px solid #4caf50; }
          </style>
        </head>
        <body>
          <h1>📊 会议分析结果</h1>
          
          <div class="result-section">
            <h2>会议摘要</h2>
            <p>${results.summary || '无摘要'}</p>
          </div>
          
          <div class="result-section">
            <h2>说话人分析</h2>
            <div id="speakers"></div>
          </div>
          
          <div class="result-section">
            <h2>详细记录</h2>
            <div id="transcription"></div>
          </div>
          
          <div class="result-section">
            <h2>行动项</h2>
            <div id="actionItems"></div>
          </div>
          
          <script>
            // 填充数据
            document.getElementById('speakers').innerHTML = '${JSON.stringify(results.speakers || [])}';
            document.getElementById('transcription').innerHTML = '${JSON.stringify(results.transcription || [])}';
            document.getElementById('actionItems').innerHTML = '${JSON.stringify(results.actionItems || [])}';
          </script>
        </body>
        </html>
      `;
      
      resultsPage.document.write(html);
      resultsPage.document.close();
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
    // 估算文件大小（假设160kbps的MP3）
    const bitrate = this.settings.audioQuality === 'high' ? 192 : 
                   this.settings.audioQuality === 'medium' ? 128 : 64;
    
    const sizeMB = (bitrate * this.elapsedTime / 8000 / 1000).toFixed(2);
    this.fileSize.textContent = `${sizeMB} MB`;
  }

  updateUIState() {
    // 更新状态显示
    if (this.isRecording) {
      if (this.isPaused) {
        this.recordingStatus.textContent = '已暂停';
        this.recordingStatus.className = 'status-value status-paused';
      } else {
        this.recordingStatus.textContent = '录音中';
        this.recordingStatus.className = 'status-value status-recording';
      }
      // 录音中显示"音频录制中"，不显示说话人数量
      this.speakerCount.textContent = '音频录制中';
    } else {
      this.recordingStatus.textContent = '就绪';
      this.recordingStatus.className = 'status-value status-ready';
      // 非录音状态，如果有说话人数据则显示，否则显示"就绪"
      if (this.speakers.size > 0) {
        this.speakerCount.textContent = `${this.speakers.size} 人`;
      } else {
        this.speakerCount.textContent = '就绪';
      }
    }

    // 更新按钮状态
    this.startBtn.disabled = this.isRecording;
    this.pauseBtn.disabled = !this.isRecording;
    this.stopBtn.disabled = !this.isRecording;
    this.analyzeBtn.disabled = this.isRecording;

    // 更新暂停按钮文本（使用textContent避免XSS）
    this.pauseBtn.textContent = this.isPaused ? '▶️ 恢复' : '⏸️ 暂停';
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
      
      // 清空画布
      ctx.clearRect(0, 0, width, height);
      
      // 绘制背景
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(0, 0, width, height);
      
      // 绘制波形（模拟）
      const time = Date.now() / 1000;
      const amplitude = 30;
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
      
      // 继续动画
      this.animationId = requestAnimationFrame(drawWaveform);
    };
    
    drawWaveform();
  }

  stopAudioVisualization() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    
    // 清空画布
    const ctx = this.canvasContext;
    const width = this.waveformCanvas.width;
    const height = this.waveformCanvas.height;
    
    ctx.clearRect(0, 0, width, height);
  }

  handleMessage(message) {
    switch (message.type) {
      case 'speakerDetected':
        this.handleSpeakerDetection(message.speaker);
        break;

      case 'transcriptionUpdate':
        this.handleTranscriptionUpdate(message.transcription);
        break;

      case 'recordingError':
        this.showError(`录音错误: ${message.error}`);
        this.stopRecording();
        break;

      case 'recordingWarning':
        console.warn('⚠️ 录音警告:', message.warning);
        this.showNotification(message.warning, 'warning');
        break;

      case 'audioChunk':
        this.handleAudioChunk(message.chunk);
        break;
    }
  }

  handleSpeakerDetection(speaker) {
    // 网页纯音频录制模式：录音中不处理说话人检测事件
    // 说话人区分在录音结束后的转写阶段执行
    if (this.isRecording) {
      console.log('[Meeting Recorder] 录音中跳过说话人检测事件');
      return;
    }

    if (!this.speakers.has(speaker.id)) {
      this.speakers.set(speaker.id, speaker);

      // 更新说话人显示
      this.updateSpeakerDisplay();

      // 更新说话人数量（仅在非录音状态下更新）
      if (!this.isRecording) {
        this.speakerCount.textContent = `${this.speakers.size} 人`;
      }
    }
  }

  updateSpeakerDisplay() {
    this.speakerDisplay.innerHTML = '';
    
    const colors = ['#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#00f2fe'];
    
    let index = 0;
    for (const [id, speaker] of this.speakers) {
      const color = colors[index % colors.length];
      
      const badge = document.createElement('div');
      badge.className = 'speaker-badge';
      badge.innerHTML = `
        <div class="speaker-color" style="background: ${color}"></div>
        <span>${speaker.name || `说话人${id}`}</span>
        <span class="quality-badge">${speaker.confidence ? `${Math.round(speaker.confidence * 100)}%` : '新'}</span>
      `;
      
      this.speakerDisplay.appendChild(badge);
      index++;
    }
  }

  handleTranscriptionUpdate(transcription) {
    this.transcriptions.push(transcription);
    
    // 更新转文字显示
    this.updateTranscriptionDisplay();
  }

  updateTranscriptionDisplay() {
    // 只显示最新的10条
    const recentTranscriptions = this.transcriptions.slice(-10);
    
    if (recentTranscriptions.length === 0) {
      this.transcriptionList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎯</div>
          <div class="empty-text">开始录音后，将显示实时转文字结果</div>
        </div>
      `;
      return;
    }
    
    this.transcriptionList.innerHTML = '';
    
    recentTranscriptions.forEach((item, index) => {
      const color = this.getSpeakerColor(item.speakerId);
      
      const transcriptItem = document.createElement('div');
      transcriptItem.className = 'transcription-item';
      transcriptItem.innerHTML = `
        <div>
          <span class="speaker-tag" style="background: ${color}20; border-left-color: ${color}">
            ${item.speakerName || `说话人${item.speakerId}`}
          </span>
          <span class="timestamp">${this.formatTime(item.timestamp)}</span>
        </div>
        <div class="transcription-text">${item.text}</div>
      `;
      
      this.transcriptionList.appendChild(transcriptItem);
    });
    
    // 滚动到底部
    this.transcriptionList.scrollTop = this.transcriptionList.scrollHeight;
  }

  getSpeakerColor(speakerId) {
    const colors = ['#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#00f2fe'];
    return colors[speakerId % colors.length];
  }

  formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  }

  handleAudioChunk(chunk) {
    this.audioChunks.push(chunk);
  }

  showNotification(message, type = 'info') {
    if (!this.settings.notifications) return;
    
    const icon = type === 'error' ? '❌' : 
                type === 'warning' ? '⚠️' : 
                type === 'success' ? '✅' : 'ℹ️';
    
    console.log(`${icon} ${message}`);
    
    // 也可以使用Chrome通知API
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '会议录音器',
      message: message,
      priority: type === 'error' ? 2 : 1
    });
  }

  showError(message) {
    this.showNotification(message, 'error');

    // 在界面上显示详细错误提示
    const statusEl = document.getElementById('recordingStatus');
    if (statusEl) {
      statusEl.textContent = '出错';
      statusEl.className = 'status-value status-paused';
      statusEl.title = message; // 鼠标悬停显示完整错误
    }

    // 在控制台输出完整错误
    console.error('🔴 录音错误:', message);

    // 尝试在界面中找错误提示元素并显示
    let errorDisplay = document.getElementById('errorDisplay');
    if (!errorDisplay) {
      // 创建错误显示区域
      errorDisplay = document.createElement('div');
      errorDisplay.id = 'errorDisplay';
      errorDisplay.style.cssText = `
        background: #fee2e2;
        border: 1px solid #ef4444;
        color: #991b1b;
        padding: 10px;
        margin: 10px;
        border-radius: 8px;
        font-size: 12px;
        max-height: 150px;
        overflow-y: auto;
        white-space: pre-wrap;
        word-break: break-word;
      `;
      const container = document.querySelector('.status-section') || document.body;
      container.parentNode.insertBefore(errorDisplay, container.nextSibling);
    }

    // 显示错误信息（最多显示500字符）
    const displayMessage = message.length > 500 ? message.substring(0, 500) + '...' : message;
    errorDisplay.textContent = `❌ ${displayMessage}`;
    errorDisplay.style.display = 'block';

    // 5秒后自动隐藏错误提示
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
  new MeetingRecorderPopup();
});