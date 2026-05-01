// offscreen.js - 离屏文档脚本，处理音频捕获和录制

class OffscreenRecorder {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.mediaRecorder = null;
    this.audioStream = null;
    this.audioChunks = [];
    this.recordingStartTime = null;
    this.messageListenerAdded = false;
    this.audioElement = null; // 隐藏的Audio元素，用于播放音频流

    this.init();
  }

  init() {
    console.log('[Offscreen] 录音器已初始化');

    // 防止重复注册消息监听器
    if (!this.messageListenerAdded) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        this.handleMessage(message, sender, sendResponse);
        return true;
      });
      this.messageListenerAdded = true;
    }
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        case 'startCapture':
          await this.startCapture(message.streamId, sendResponse);
          break;

        case 'pauseCapture':
          await this.pauseCapture(sendResponse);
          break;

        case 'resumeCapture':
          await this.resumeCapture(sendResponse);
          break;

        case 'stopCapture':
          await this.stopCapture(sendResponse);
          break;

        case 'getCaptureStatus':
          sendResponse({
            isRecording: this.isRecording,
            isPaused: this.isPaused,
            duration: this.recordingStartTime ? Date.now() - this.recordingStartTime : 0
          });
          break;

        default:
          // 对于未知消息类型，返回成功响应避免阻塞消息通道
          console.log('[Offscreen] 收到未处理的消息类型:', message.type);
          sendResponse({ success: true, warning: '未处理的消息类型' });
      }
    } catch (error) {
      console.error('[Offscreen] 处理消息时出错:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * 开始捕获音频
   */
  async startCapture(streamId, sendResponse) {
    if (this.isRecording) {
      sendResponse({ success: false, error: '已经在录音中' });
      return;
    }

    try {
      console.log('[Offscreen] 开始捕获音频，streamId:', streamId.substring(0, 20) + '...');

      // 使用 streamId 获取音频流
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamId
          }
        },
        video: false
      });

      console.log('[Offscreen] 音频流已获取');

      // 创建隐藏的Audio元素播放音频流，确保录音时能听到页面声音
      this.audioElement = new Audio();
      this.audioElement.srcObject = this.audioStream;
      this.audioElement.volume = 1.0;
      try {
        await this.audioElement.play();
        console.log('[Offscreen] 音频播放已启动，录音时可正常听到页面声音');
      } catch (playError) {
        console.warn('[Offscreen] 音频播放启动失败，可能影响播放:', playError.message);
      }

      // 启动 MediaRecorder
      this.audioChunks = [];
      const mimeType = 'audio/webm;codecs=opus';
      try {
        this.mediaRecorder = new MediaRecorder(this.audioStream, {
          mimeType: mimeType,
          audioBitsPerSecond: 256000
        });
      } catch (e) {
        console.warn('[Offscreen] 指定编码不支持，使用默认编码');
        this.mediaRecorder = new MediaRecorder(this.audioStream, {
          audioBitsPerSecond: 256000
        });
      }

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.saveAudio();
      };

      this.mediaRecorder.onerror = (event) => {
        console.error('[Offscreen] 录音器错误:', event.error);
        chrome.runtime.sendMessage({
          type: 'captureError',
          error: event.error?.message || '录音器错误'
        });
      };

      // 启动录音
      this.mediaRecorder.start(1000);
      this.isRecording = true;
      this.isPaused = false;
      this.recordingStartTime = Date.now();

      console.log('[Offscreen] 录音已启动');
      sendResponse({ success: true, message: '录音已开始' });

    } catch (error) {
      console.error('[Offscreen] 启动录音失败:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * 暂停捕获
   */
  async pauseCapture(sendResponse) {
    if (!this.isRecording || this.isPaused) {
      sendResponse({ success: false, error: '不在录音中或已暂停' });
      return;
    }

    try {
      this.mediaRecorder.pause();
      this.isPaused = true;

      console.log('[Offscreen] 录音已暂停');
      sendResponse({ success: true, message: '录音已暂停' });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * 恢复捕获
   */
  async resumeCapture(sendResponse) {
    if (!this.isRecording || !this.isPaused) {
      sendResponse({ success: false, error: '未暂停或不在录音中' });
      return;
    }

    try {
      this.mediaRecorder.resume();
      this.isPaused = false;

      console.log('[Offscreen] 录音已恢复');
      sendResponse({ success: true, message: '录音已恢复' });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * 停止捕获
   */
  async stopCapture(sendResponse) {
    if (!this.isRecording) {
      sendResponse({ success: true, message: '已经停止' });
      return;
    }

    try {
      console.log('[Offscreen] 停止录音...');

      // 停止录音器
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }

      // 停止并清理Audio元素
      if (this.audioElement) {
        this.audioElement.pause();
        this.audioElement.srcObject = null;
        this.audioElement = null;
        console.log('[Offscreen] Audio元素已清理');
      }

      // 停止音频轨道
      if (this.audioStream) {
        this.audioStream.getTracks().forEach(track => {
          track.stop();
          console.log('[Offscreen] 音频轨道已停止:', track.kind);
        });
      }

      // 完全清理状态
      this.isRecording = false;
      this.isPaused = false;
      this.mediaRecorder = null;
      this.audioStream = null;

      console.log('[Offscreen] 录音已停止，正在保存...');
      sendResponse({ success: true, message: '录音已停止' });

    } catch (error) {
      console.error('[Offscreen] 停止录音失败:', error);
      // 即使出错也清理状态
      this.isRecording = false;
      this.isPaused = false;
      this.mediaRecorder = null;
      this.audioStream = null;
      if (this.audioElement) {
        this.audioElement.pause();
        this.audioElement.srcObject = null;
        this.audioElement = null;
      }
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * 保存音频数据
   */
  async saveAudio() {
    try {
      if (this.audioChunks.length === 0) {
        console.warn('[Offscreen] 没有录音数据可保存');
        return;
      }

      const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(audioBlob);
      const duration = Date.now() - this.recordingStartTime;

      // 生成文件名
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      const filename = `录音_${year}${month}${day}_${hours}${minutes}${seconds}.webm`;

      // 发送到 background 进行保存
      chrome.runtime.sendMessage({
        type: 'saveRecording',
        audioUrl: audioUrl,
        filename: filename,
        duration: duration
      });

      // 清理
      this.audioChunks = [];
      this.recordingStartTime = null;

      // 延迟清理 URL
      setTimeout(() => URL.revokeObjectURL(audioUrl), 5000);

    } catch (error) {
      console.error('[Offscreen] 保存录音失败:', error);
    }
  }
}

// 初始化录音器
const recorder = new OffscreenRecorder();
