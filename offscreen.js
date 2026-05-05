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
    this.audioElement = null; // 用于播放音频流，解决录音时网页静音问题

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

      // 检查是否有未保存的录音数据，如果有，先保存
      if (this.audioChunks.length > 0) {
        console.log('[Offscreen] 发现未保存的数据，先保存...');
        await this.saveAudio();
      }

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

      // 创建隐藏Audio元素播放音频流，解决录音时网页静音问题
      this.audioElement = new Audio();
      this.audioElement.srcObject = this.audioStream;
      this.audioElement.muted = false;
      this.audioElement.volume = 1;
      this.audioElement.play().then(() => {
        console.log('[Offscreen] 音频播放已启动，录音时可听到页面声音');
      }).catch(err => {
        console.warn('[Offscreen] 音频播放启动失败:', err.message);
      });

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
          // 每10个chunk打印一次日志
          if (this.audioChunks.length % 10 === 0) {
            console.log('[Offscreen] 已收集 chunks:', this.audioChunks.length, '累计大小:', 
              this.audioChunks.reduce((sum, chunk) => sum + chunk.size, 0));
          }
        }
      };

      // onstop 事件不再调用 saveAudio()，由 stopCapture 统一处理
      this.mediaRecorder.onstop = () => {
        console.log('[Offscreen] MediaRecorder onstop 事件触发');
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
    console.log('[Offscreen] stopCapture 被调用，isRecording:', this.isRecording);
    
    if (!this.isRecording) {
      console.log('[Offscreen] 当前不在录音状态');
      sendResponse({ success: true, message: '已经停止' });
      return;
    }

    try {
      console.log('[Offscreen] 停止录音...');

      // 记录停止时间，用于文件名
      this.recordingStopTime = Date.now();
      console.log('[Offscreen] audioChunks 数量:', this.audioChunks.length);

      // 触发 onstop 事件（不会立即执行 onstop 回调）
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        console.log('[Offscreen] 停止 MediaRecorder');
        this.mediaRecorder.stop();
      }

      // 停止音频轨道
      if (this.audioStream) {
        console.log('[Offscreen] 停止音频轨道');
        this.audioStream.getTracks().forEach(track => {
          track.stop();
        });
      }

      // 清理Audio元素
      if (this.audioElement) {
        this.audioElement.pause();
        this.audioElement.srcObject = null;
        this.audioElement = null;
      }

      // 保存录音数据
      console.log('[Offscreen] 开始调用 saveAudio');
      await this.saveAudio();
      console.log('[Offscreen] saveAudio 完成');

      // 清理状态
      this.isRecording = false;
      this.isPaused = false;
      this.mediaRecorder = null;
      this.audioStream = null;
      this.recordingStartTime = null;
      this.recordingStopTime = null;

      console.log('[Offscreen] 录音已停止并保存完成');
      sendResponse({ success: true, message: '录音已停止' });

    } catch (error) {
      console.error('[Offscreen] 停止录音失败:', error);
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
   * 保存音频数据（转换为MP3格式）
   */
  async saveAudio() {
    console.log('[Offscreen] saveAudio 被调用');
    console.log('[Offscreen] audioChunks.length:', this.audioChunks.length);
    
    try {
      if (this.audioChunks.length === 0) {
        console.warn('[Offscreen] 没有录音数据可保存');
        return;
      }

      // 先合并为 webm Blob
      const webmBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
      console.log('[Offscreen] webm Blob 大小:', webmBlob.size);

      // 转换为 MP3
      let finalBlob;
      try {
        if (typeof Mp3Encoder !== 'undefined') {
          console.log('[Offscreen] 开始将 webm 转换为 MP3...');
          const audioQuality = this.getAudioQuality();
          finalBlob = await Mp3Encoder.convertWebmToMp3(webmBlob, audioQuality);
          console.log('[Offscreen] MP3 转换完成，大小:', finalBlob.size);
        } else {
          console.warn('[Offscreen] Mp3Encoder 不可用，回退保存为 webm');
          finalBlob = webmBlob;
        }
      } catch (encodeError) {
        console.error('[Offscreen] MP3 编码失败，回退保存为 webm:', encodeError);
        finalBlob = webmBlob;
      }

      const audioUrl = URL.createObjectURL(finalBlob);
      const duration = this.recordingStartTime ? Date.now() - this.recordingStartTime : 0;

      // 根据最终格式决定文件扩展名
      const isMp3 = finalBlob.type === 'audio/mpeg';
      const ext = isMp3 ? 'mp3' : 'webm';

      // 生成文件名
      const timeToUse = this.recordingStopTime || this.recordingStartTime || Date.now();
      const timeDate = new Date(timeToUse);
      const year = timeDate.getFullYear();
      const month = String(timeDate.getMonth() + 1).padStart(2, '0');
      const day = String(timeDate.getDate()).padStart(2, '0');
      const hours = String(timeDate.getHours()).padStart(2, '0');
      const minutes = String(timeDate.getMinutes()).padStart(2, '0');
      const seconds = String(timeDate.getSeconds()).padStart(2, '0');
      const filename = `录音_${year}${month}${day}_${hours}${minutes}${seconds}.${ext}`;

      console.log('[Offscreen] 开始保存录音，文件:', filename, '格式:', ext);

      // 发送到 background（必须等待发送完成）
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'saveRecording',
          audioUrl: audioUrl,
          filename: filename,
          duration: duration
        });
        console.log('[Offscreen] 保存响应:', response);
      } catch (msgError) {
        console.error('[Offscreen] 发送录音消息失败:', msgError);
      }

      // 清理数据
      this.audioChunks = [];
      console.log('[Offscreen] 数据已清理');

      // 延迟清理 URL
      setTimeout(() => {
        URL.revokeObjectURL(audioUrl);
        console.log('[Offscreen] Blob URL 已清理');
      }, 3000);

    } catch (error) {
      console.error('[Offscreen] 保存录音失败:', error);
    }
  }

  /**
   * 获取当前音频质量设置
   */
  getAudioQuality() {
    // 默认使用 medium，后续可从 background 获取用户设置
    return 'medium';
  }
}

// 初始化录音器
const recorder = new OffscreenRecorder();
