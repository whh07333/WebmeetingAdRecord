// audio-processor.js - 音频处理模块

class AudioProcessor {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.vadProcessor = null;
    this.speakerDetector = null;
    this.isProcessing = false;
  }

  async init() {
    try {
      // 创建音频上下文
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      console.log('✅ 音频处理器初始化完成');
      return true;
    } catch (error) {
      console.error('音频处理器初始化失败:', error);
      return false;
    }
  }

  async processAudioStream(stream, options = {}) {
    if (!this.audioContext) {
      await this.init();
    }

    try {
      // 创建音频源
      const source = this.audioContext.createMediaStreamSource(stream);
      
      // 创建分析器
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = options.fftSize || 2048;
      this.analyser.smoothingTimeConstant = options.smoothingTimeConstant || 0.8;
      
      // 连接节点
      source.connect(this.analyser);
      
      // 如果需要，创建更多处理节点
      if (options.enableFilters) {
        await this.setupAudioFilters(source);
      }
      
      this.isProcessing = true;
      return true;
      
    } catch (error) {
      console.error('处理音频流失败:', error);
      return false;
    }
  }

  async setupAudioFilters(source) {
    // 创建高通滤波器（去除低频噪音）
    const highpassFilter = this.audioContext.createBiquadFilter();
    highpassFilter.type = 'highpass';
    highpassFilter.frequency.value = 80; // 80Hz高通
    
    // 创建低通滤波器（去除高频噪音）
    const lowpassFilter = this.audioContext.createBiquadFilter();
    lowpassFilter.type = 'lowpass';
    lowpassFilter.frequency.value = 8000; // 8kHz低通
    
    // 创建动态压缩器（平衡音量）
    const compressor = this.audioContext.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 30;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    
    // 连接处理链
    source.connect(highpassFilter);
    highpassFilter.connect(lowpassFilter);
    lowpassFilter.connect(compressor);
    compressor.connect(this.analyser);
    
    console.log('✅ 音频滤波器已设置');
  }

  getAudioData() {
    if (!this.analyser || !this.isProcessing) {
      return null;
    }

    try {
      // 获取时域数据
      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      this.analyser.getByteTimeDomainData(dataArray);
      
      // 获取频域数据
      const freqDataArray = new Uint8Array(bufferLength);
      this.analyser.getByteFrequencyData(freqDataArray);
      
      return {
        timeDomain: dataArray,
        frequencyDomain: freqDataArray,
        sampleRate: this.audioContext.sampleRate,
        bufferLength: bufferLength
      };
      
    } catch (error) {
      console.error('获取音频数据失败:', error);
      return null;
    }
  }

  analyzeAudioFeatures(audioData) {
    if (!audioData) return null;
    
    const { timeDomain, frequencyDomain } = audioData;
    
    // 计算基本特征
    const features = {
      // 音量相关
      volume: this.calculateVolume(timeDomain),
      volumeRMS: this.calculateRMS(timeDomain),
      volumePeak: this.calculatePeak(timeDomain),
      
      // 频谱相关
      spectralCentroid: this.calculateSpectralCentroid(frequencyDomain),
      spectralFlatness: this.calculateSpectralFlatness(frequencyDomain),
      spectralRolloff: this.calculateSpectralRolloff(frequencyDomain, 0.85),
      
      // 其他特征
      zeroCrossingRate: this.calculateZeroCrossingRate(timeDomain),
      pitch: this.estimatePitch(frequencyDomain, this.audioContext.sampleRate),
      
      // 时间戳
      timestamp: Date.now()
    };
    
    // 检测语音活动
    features.isSpeech = this.detectSpeechActivity(features);
    
    return features;
  }

  calculateVolume(dataArray) {
    // 计算平均音量
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const value = (dataArray[i] - 128) / 128;
      sum += Math.abs(value);
    }
    return sum / dataArray.length;
  }

  calculateRMS(dataArray) {
    // 计算均方根
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const value = (dataArray[i] - 128) / 128;
      sum += value * value;
    }
    return Math.sqrt(sum / dataArray.length);
  }

  calculatePeak(dataArray) {
    // 计算峰值
    let peak = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const value = Math.abs((dataArray[i] - 128) / 128);
      if (value > peak) peak = value;
    }
    return peak;
  }

  calculateSpectralCentroid(freqData) {
    // 计算频谱质心
    let total = 0;
    let weightedTotal = 0;
    
    for (let i = 0; i < freqData.length; i++) {
      const magnitude = freqData[i] / 255;
      total += magnitude;
      weightedTotal += i * magnitude;
    }
    
    return total > 0 ? weightedTotal / total : 0;
  }

  calculateSpectralFlatness(freqData) {
    // 计算频谱平坦度
    let geometricMean = 0;
    let arithmeticMean = 0;
    
    for (let i = 0; i < freqData.length; i++) {
      const magnitude = freqData[i] / 255 + 0.0001; // 避免0值
      geometricMean += Math.log(magnitude);
      arithmeticMean += magnitude;
    }
    
    geometricMean = Math.exp(geometricMean / freqData.length);
    arithmeticMean = arithmeticMean / freqData.length;
    
    return arithmeticMean > 0 ? geometricMean / arithmeticMean : 0;
  }

  calculateSpectralRolloff(freqData, percentile = 0.85) {
    // 计算频谱滚降点
    let totalEnergy = 0;
    for (let i = 0; i < freqData.length; i++) {
      totalEnergy += freqData[i];
    }
    
    const targetEnergy = totalEnergy * percentile;
    let accumulated = 0;
    
    for (let i = 0; i < freqData.length; i++) {
      accumulated += freqData[i];
      if (accumulated >= targetEnergy) {
        return i;
      }
    }
    
    return freqData.length - 1;
  }

  calculateZeroCrossingRate(dataArray) {
    // 计算过零率
    let crossings = 0;
    let prevValue = (dataArray[0] - 128) / 128;
    
    for (let i = 1; i < dataArray.length; i++) {
      const currentValue = (dataArray[i] - 128) / 128;
      if (prevValue * currentValue < 0) {
        crossings++;
      }
      prevValue = currentValue;
    }
    
    return crossings / dataArray.length;
  }

  estimatePitch(freqData, sampleRate) {
    // 简单的基频估计
    let maxMagnitude = 0;
    let maxIndex = 0;
    
    for (let i = 0; i < freqData.length; i++) {
      if (freqData[i] > maxMagnitude) {
        maxMagnitude = freqData[i];
        maxIndex = i;
      }
    }
    
    // 转换为频率
    const nyquist = sampleRate / 2;
    const frequency = maxIndex * nyquist / freqData.length;
    
    return frequency;
  }

  detectSpeechActivity(features) {
    // 简单的语音活动检测
    const { volumeRMS, zeroCrossingRate, spectralCentroid } = features;
    
    // 阈值（可根据实际调整）
    const volumeThreshold = 0.01;
    const zcrThreshold = 0.01;
    const centroidThreshold = 10;
    
    return volumeRMS > volumeThreshold && 
           zeroCrossingRate > zcrThreshold && 
           spectralCentroid > centroidThreshold;
  }

  async startVoiceActivityDetection(callback, options = {}) {
    if (!this.analyser) {
      console.error('音频分析器未初始化');
      return false;
    }

    const config = {
      threshold: options.threshold || 0.02,
      minDuration: options.minDuration || 100, // 毫秒
      silenceDuration: options.silenceDuration || 500, // 毫秒
      ...options
    };

    let isSpeech = false;
    let speechStartTime = null;
    let silenceStartTime = null;

    const detect = () => {
      if (!this.isProcessing) return;

      const audioData = this.getAudioData();
      if (!audioData) {
        requestAnimationFrame(detect);
        return;
      }

      const features = this.analyzeAudioFeatures(audioData);
      const currentTime = Date.now();

      if (features.isSpeech && features.volumeRMS > config.threshold) {
        // 检测到语音
        if (!isSpeech) {
          isSpeech = true;
          speechStartTime = currentTime;
          silenceStartTime = null;
          
          if (callback.onSpeechStart) {
            callback.onSpeechStart({
              timestamp: currentTime,
              features: features
            });
          }
        }
        
        // 更新语音活动
        if (callback.onSpeechActivity) {
          callback.onSpeechActivity({
            timestamp: currentTime,
            features: features,
            duration: currentTime - speechStartTime
          });
        }
        
      } else {
        // 静音或噪音
        if (isSpeech) {
          if (!silenceStartTime) {
            silenceStartTime = currentTime;
          }
          
          const silenceDuration = currentTime - silenceStartTime;
          
          if (silenceDuration >= config.silenceDuration) {
            // 语音结束
            isSpeech = false;
            const speechDuration = silenceStartTime - speechStartTime;
            
            if (speechDuration >= config.minDuration) {
              if (callback.onSpeechEnd) {
                callback.onSpeechEnd({
                  startTime: speechStartTime,
                  endTime: silenceStartTime,
                  duration: speechDuration,
                  features: features
                });
              }
            }
            
            speechStartTime = null;
            silenceStartTime = null;
          }
        }
      }

      requestAnimationFrame(detect);
    };

    detect();
    return true;
  }

  async extractAudioSegment(stream, startTime, duration) {
    // 提取指定时间段的音频
    return new Promise((resolve, reject) => {
      try {
        const mediaRecorder = new MediaRecorder(stream);
        const chunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };
        
        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
          resolve(blob);
        };
        
        mediaRecorder.onerror = (error) => {
          reject(new Error(`提取音频失败: ${error}`));
        };
        
        // 开始录制指定时长
        mediaRecorder.start();
        
        setTimeout(() => {
          mediaRecorder.stop();
        }, duration);
        
      } catch (error) {
        reject(error);
      }
    });
  }

  async convertAudioFormat(audioBlob, targetFormat = 'wav') {
    // 转换音频格式
    return new Promise((resolve, reject) => {
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const reader = new FileReader();
        
        reader.onload = async (event) => {
          try {
            const arrayBuffer = event.target.result;
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            // 根据目标格式处理
            let outputBlob;
            
            switch (targetFormat.toLowerCase()) {
              case 'wav':
                outputBlob = this.encodeWAV(audioBuffer);
                break;
              case 'mp3':
                // 需要MP3编码器库
                outputBlob = await this.encodeMP3(audioBuffer);
                break;
              default:
                outputBlob = audioBlob;
            }
            
            resolve(outputBlob);
            
          } catch (error) {
            reject(error);
          }
        };
        
        reader.onerror = (error) => {
          reject(error);
        };
        
        reader.readAsArrayBuffer(audioBlob);
        
      } catch (error) {
        reject(error);
      }
    });
  }

  encodeWAV(audioBuffer) {
    // 简单的WAV编码
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length * numChannels * 2;
    const buffer = new ArrayBuffer(44 + length);
    const view = new DataView(buffer);
    
    // WAV头部
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + length, true);
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    this.writeString(view, 36, 'data');
    view.setUint32(40, length, true);
    
    // 音频数据
    const channels = [];
    for (let i = 0; i < numChannels; i++) {
      channels.push(audioBuffer.getChannelData(i));
    }
    
    let offset = 44;
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, channels[channel][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }
    
    return new Blob([buffer], { type: 'audio/wav' });
  }

  async encodeMP3(audioBuffer) {
    // 需要引入MP3编码器库，这里返回原始数据
    console.warn('MP3编码需要额外库支持，返回原始音频');
    return this.encodeWAV(audioBuffer);
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  async compressAudio(audioBlob, quality = 0.7) {
    // 音频压缩
    return new Promise((resolve, reject) => {
      try {
        const audio = new Audio();
        audio.src = URL.createObjectURL(audioBlob);
        
        audio.onloadedmetadata = () => {
          // 这里可以实现音频压缩逻辑
          // 实际压缩需要更复杂的处理
          resolve(audioBlob);
        };
        
        audio.onerror = (error) => {
          reject(error);
        };
        
      } catch (error) {
        reject(error);
      }
    });
  }

  async normalizeAudio(audioBlob, targetLevel = -1.0) {
    // 音频标准化（音量调整）
    return new Promise(async (resolve, reject) => {
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        // 计算当前峰值
        let peak = 0;
        const channelData = audioBuffer.getChannelData(0);
        
        for (let i = 0; i < channelData.length; i++) {
          const value = Math.abs(channelData[i]);
          if (value > peak) peak = value;
        }
        
        // 计算增益
        const gain = Math.pow(10, targetLevel / 20) / peak;
        
        // 应用增益
        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
          const channelData = audioBuffer.getChannelData(channel);
          for (let i = 0; i < channelData.length; i++) {
            channelData[i] *= gain;
          }
        }
        
        // 重新编码为WAV
        const normalizedBlob = this.encodeWAV(audioBuffer);
        resolve(normalizedBlob);
        
      } catch (error) {
        reject(error);
      }
    });
  }

  async removeNoise(audioBlob, noiseProfile = null) {
    // 噪声消除（简化版）
    console.log('噪声消除功能需要更复杂的实现');
    return audioBlob; // 返回原始音频
  }

  stopProcessing() {
    this.isProcessing = false;
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.analyser = null;
    console.log('✅ 音频处理已停止');
  }

  getStatus() {
    return {
      isProcessing: this.isProcessing,
      isInitialized: !!this.audioContext,
      sampleRate: this.audioContext ? this.audioContext.sampleRate : null,
      contextState: this.audioContext ? this.audioContext.state : null
    };
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioProcessor;
} else {
  window.AudioProcessor = AudioProcessor;
}