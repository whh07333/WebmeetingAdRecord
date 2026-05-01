// speaker-detector.js - 说话人识别和区分模块

class SpeakerDetector {
  constructor() {
    this.speakers = new Map(); // 存储说话人特征
    this.nextSpeakerId = 1;
    this.featureVectors = new Map(); // 存储特征向量
    this.clusterModel = null;
    this.isInitialized = false;
    this.config = {
      minSamplesForCluster: 3,      // 聚类所需的最小样本数
      maxSpeakers: 10,              // 最大说话人数量
      similarityThreshold: 0.7,     // 相似度阈值
      minSegmentDuration: 1000,     // 最小语音段时长(ms)
      featureExtractionWindow: 2048, // 特征提取窗口大小
      overlapRatio: 0.5             // 窗口重叠比例
    };
  }

  async init() {
    try {
      console.log('初始化说话人检测器...');
      
      // 初始化特征提取器
      await this.initFeatureExtractor();
      
      // 初始化聚类模型
      await this.initClusterModel();
      
      this.isInitialized = true;
      console.log('✅ 说话人检测器初始化完成');
      return true;
      
    } catch (error) {
      console.error('说话人检测器初始化失败:', error);
      return false;
    }
  }

  async initFeatureExtractor() {
    // 初始化音频特征提取器
    // 这里可以使用MFCC、频谱特征等
    this.featureExtractor = {
      extract: async (audioData) => {
        return this.extractBasicFeatures(audioData);
      }
    };
  }

  async initClusterModel() {
    // 初始化聚类模型
    // 这里可以使用简单的K-means或更复杂的聚类算法
    this.clusterModel = {
      clusters: [],
      centroid: null,
      
      addSample: (features, speakerId) => {
        if (!this.clusters[speakerId]) {
          this.clusters[speakerId] = {
            samples: [],
            centroid: null,
            lastUpdated: Date.now()
          };
        }
        
        this.clusters[speakerId].samples.push(features);
        
        // 更新聚类中心
        this.updateClusterCentroid(speakerId);
      },
      
      predict: (features) => {
        return this.findClosestCluster(features);
      },
      
      updateClusterCentroid: (speakerId) => {
        const cluster = this.clusters[speakerId];
        if (!cluster || cluster.samples.length === 0) return;
        
        // 计算平均值作为中心
        const numFeatures = cluster.samples[0].length;
        const centroid = new Array(numFeatures).fill(0);
        
        for (const sample of cluster.samples) {
          for (let i = 0; i < numFeatures; i++) {
            centroid[i] += sample[i];
          }
        }
        
        for (let i = 0; i < numFeatures; i++) {
          centroid[i] /= cluster.samples.length;
        }
        
        cluster.centroid = centroid;
        cluster.lastUpdated = Date.now();
      },
      
      findClosestCluster: (features) => {
        let closestSpeakerId = null;
        let minDistance = Infinity;
        
        for (const [speakerId, cluster] of Object.entries(this.clusters)) {
          if (!cluster.centroid) continue;
          
          const distance = this.calculateDistance(features, cluster.centroid);
          
          if (distance < minDistance) {
            minDistance = distance;
            closestSpeakerId = parseInt(speakerId);
          }
        }
        
        return {
          speakerId: closestSpeakerId,
          distance: minDistance,
          confidence: this.distanceToConfidence(minDistance)
        };
      }
    };
  }

  extractBasicFeatures(audioData) {
    // 提取基本音频特征
    const features = [];
    
    if (!audioData || !audioData.timeDomain) {
      return features;
    }
    
    const { timeDomain, frequencyDomain } = audioData;
    
    // 1. 音量特征
    features.push(this.calculateVolume(timeDomain));
    features.push(this.calculateRMS(timeDomain));
    features.push(this.calculatePeak(timeDomain));
    
    // 2. 频谱特征
    if (frequencyDomain) {
      features.push(this.calculateSpectralCentroid(frequencyDomain));
      features.push(this.calculateSpectralFlatness(frequencyDomain));
      features.push(this.calculateSpectralRolloff(frequencyDomain));
    }
    
    // 3. 过零率
    features.push(this.calculateZeroCrossingRate(timeDomain));
    
    // 4. 基频估计
    if (frequencyDomain && audioData.sampleRate) {
      const pitch = this.estimatePitch(frequencyDomain, audioData.sampleRate);
      features.push(pitch);
    }
    
    return features;
  }

  calculateVolume(dataArray) {
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const value = (dataArray[i] - 128) / 128;
      sum += Math.abs(value);
    }
    return sum / dataArray.length;
  }

  calculateRMS(dataArray) {
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const value = (dataArray[i] - 128) / 128;
      sum += value * value;
    }
    return Math.sqrt(sum / dataArray.length);
  }

  calculatePeak(dataArray) {
    let peak = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const value = Math.abs((dataArray[i] - 128) / 128);
      if (value > peak) peak = value;
    }
    return peak;
  }

  calculateSpectralCentroid(freqData) {
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
    let geometricMean = 0;
    let arithmeticMean = 0;
    
    for (let i = 0; i < freqData.length; i++) {
      const magnitude = freqData[i] / 255 + 0.0001;
      geometricMean += Math.log(magnitude);
      arithmeticMean += magnitude;
    }
    
    geometricMean = Math.exp(geometricMean / freqData.length);
    arithmeticMean = arithmeticMean / freqData.length;
    
    return arithmeticMean > 0 ? geometricMean / arithmeticMean : 0;
  }

  calculateSpectralRolloff(freqData, percentile = 0.85) {
    let totalEnergy = 0;
    for (let i = 0; i < freqData.length; i++) {
      totalEnergy += freqData[i];
    }
    
    const targetEnergy = totalEnergy * percentile;
    let accumulated = 0;
    
    for (let i = 0; i < freqData.length; i++) {
      accumulated += freqData[i];
      if (accumulated >= targetEnergy) {
        return i / freqData.length;
      }
    }
    
    return 1;
  }

  calculateZeroCrossingRate(dataArray) {
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
    let maxMagnitude = 0;
    let maxIndex = 0;
    
    for (let i = 0; i < freqData.length; i++) {
      if (freqData[i] > maxMagnitude) {
        maxMagnitude = freqData[i];
        maxIndex = i;
      }
    }
    
    const nyquist = sampleRate / 2;
    const frequency = maxIndex * nyquist / freqData.length;
    
    // 转换为对数尺度
    return Math.log10(frequency + 1);
  }

  calculateDistance(features1, features2) {
    // 计算欧氏距离
    if (features1.length !== features2.length) {
      return Infinity;
    }
    
    let sum = 0;
    for (let i = 0; i < features1.length; i++) {
      const diff = features1[i] - features2[i];
      sum += diff * diff;
    }
    
    return Math.sqrt(sum);
  }

  distanceToConfidence(distance) {
    // 将距离转换为置信度（0-1）
    const maxDistance = 10; // 假设的最大距离
    const normalized = Math.min(distance / maxDistance, 1);
    return 1 - normalized;
  }

  async detectSpeaker(audioData, metadata = {}) {
    if (!this.isInitialized) {
      await this.init();
    }
    
    try {
      // 提取特征
      const features = await this.featureExtractor.extract(audioData);
      
      if (features.length === 0) {
        return {
          success: false,
          error: '无法提取音频特征'
        };
      }
      
      // 查找最近的聚类
      const prediction = this.clusterModel.predict(features);
      
      let speakerId = prediction.speakerId;
      let confidence = prediction.confidence;
      let isNewSpeaker = false;
      
      // 判断是否为新的说话人
      if (!speakerId || confidence < this.config.similarityThreshold) {
        // 创建新的说话人
        if (this.speakers.size >= this.config.maxSpeakers) {
          // 达到最大说话人数，替换最久未更新的说话人
          speakerId = this.findOldestSpeaker();
        } else {
          // 创建新说话人
          speakerId = this.nextSpeakerId++;
        }
        
        isNewSpeaker = true;
        confidence = 0.5; // 新说话人的初始置信度
      }
      
      // 更新聚类模型
      this.clusterModel.addSample(features, speakerId);
      
      // 更新说话人信息
      if (!this.speakers.has(speakerId)) {
        this.speakers.set(speakerId, {
          id: speakerId,
          name: `说话人${speakerId}`,
          firstDetected: Date.now(),
          lastDetected: Date.now(),
          detectionCount: 0,
          totalSpeakingTime: 0,
          features: [],
          confidence: 0,
          metadata: {}
        });
      }
      
      const speaker = this.speakers.get(speakerId);
      speaker.lastDetected = Date.now();
      speaker.detectionCount++;
      speaker.confidence = (speaker.confidence * (speaker.detectionCount - 1) + confidence) / speaker.detectionCount;
      
      if (metadata.duration) {
        speaker.totalSpeakingTime += metadata.duration;
      }
      
      speaker.features.push(features);
      // 限制特征数量
      if (speaker.features.length > 100) {
        speaker.features = speaker.features.slice(-100);
      }
      
      // 更新元数据
      if (metadata.emotion) {
        speaker.metadata.lastEmotion = metadata.emotion;
      }
      
      this.speakers.set(speakerId, speaker);
      
      return {
        success: true,
        speaker: speaker,
        isNewSpeaker: isNewSpeaker,
        confidence: confidence,
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error('说话人检测失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  findOldestSpeaker() {
    let oldestSpeakerId = null;
    let oldestTime = Infinity;
    
    for (const [speakerId, speaker] of this.speakers) {
      if (speaker.lastDetected < oldestTime) {
        oldestTime = speaker.lastDetected;
        oldestSpeakerId = speakerId;
      }
    }
    
    return oldestSpeakerId;
  }

  async processAudioStream(stream, callback, options = {}) {
    if (!this.isInitialized) {
      await this.init();
    }
    
    const config = {
      ...this.config,
      ...options
    };
    
    let audioProcessor = null;
    let isProcessing = false;
    
    try {
      // 初始化音频处理器
      audioProcessor = new (window.AudioProcessor || AudioProcessor)();
      await audioProcessor.init();
      await audioProcessor.processAudioStream(stream);
      
      let speechStartTime = null;
      let currentSpeechBuffer = [];
      let currentSpeaker = null;
      
      // 开始语音活动检测
      await audioProcessor.startVoiceActivityDetection({
        onSpeechStart: (data) => {
          speechStartTime = data.timestamp;
          currentSpeechBuffer = [];
          currentSpeaker = null;
          
          console.log('检测到语音开始:', data.timestamp);
        },
        
        onSpeechActivity: (data) => {
          // 收集音频数据用于说话人检测
          if (audioProcessor) {
            const audioData = audioProcessor.getAudioData();
            if (audioData) {
              currentSpeechBuffer.push({
                timestamp: data.timestamp,
                audioData: audioData,
                features: data.features
              });
            }
          }
        },
        
        onSpeechEnd: async (data) => {
          const speechDuration = data.duration;
          
          if (speechDuration < config.minSegmentDuration) {
            console.log('语音段太短，跳过:', speechDuration, 'ms');
            return;
          }
          
          console.log('检测到语音结束，时长:', speechDuration, 'ms');
          
          try {
            // 从缓冲区提取特征
            if (currentSpeechBuffer.length > 0) {
              // 使用中间样本的特征
              const middleIndex = Math.floor(currentSpeechBuffer.length / 2);
              const sample = currentSpeechBuffer[middleIndex];
              
              // 检测说话人
              const detectionResult = await this.detectSpeaker(
                sample.audioData,
                {
                  duration: speechDuration,
                  startTime: speechStartTime,
                  endTime: data.timestamp,
                  emotion: this.analyzeEmotion(sample.features)
                }
              );
              
              if (detectionResult.success) {
                currentSpeaker = detectionResult.speaker;
                
                // 回调处理结果
                if (callback.onSpeakerDetected) {
                  callback.onSpeakerDetected({
                    speaker: currentSpeaker,
                    isNewSpeaker: detectionResult.isNewSpeaker,
                    confidence: detectionResult.confidence,
                    startTime: speechStartTime,
                    endTime: data.timestamp,
                    duration: speechDuration,
                    timestamp: detectionResult.timestamp
                  });
                }
              }
            }
            
          } catch (error) {
            console.error('处理语音段失败:', error);
          }
          
          // 清理缓冲区
          currentSpeechBuffer = [];
          speechStartTime = null;
          currentSpeaker = null;
        }
      }, config);
      
      isProcessing = true;
      console.log('✅ 说话人检测已开始');
      
      return {
        stop: () => {
          if (audioProcessor) {
            audioProcessor.stopProcessing();
          }
          isProcessing = false;
          console.log('说话人检测已停止');
        },
        isProcessing: () => isProcessing
      };
      
    } catch (error) {
      console.error('处理音频流失败:', error);
      
      if (audioProcessor) {
        audioProcessor.stopProcessing();
      }
      
      throw error;
    }
  }

  analyzeEmotion(features) {
    // 简单的情绪分析（基于音频特征）
    const { volumeRMS, pitch, spectralCentroid, zeroCrossingRate } = features;
    
    let emotion = 'neutral';
    
    if (volumeRMS > 0.1 && pitch > 2.0 && spectralCentroid > 50) {
      emotion = 'excited';
    } else if (volumeRMS < 0.05 && pitch < 1.5 && zeroCrossingRate < 0.05) {
      emotion = 'calm';
    } else if (volumeRMS > 0.08 && zeroCrossingRate > 0.1) {
      emotion = 'agitated';
    }
    
    return emotion;
  }

  getSpeakers() {
    return Array.from(this.speakers.values()).map(speaker => ({
      ...speaker,
      features: undefined // 不返回原始特征数据
    }));
  }

  getSpeaker(speakerId) {
    const speaker = this.speakers.get(speakerId);
    if (speaker) {
      return {
        ...speaker,
        features: undefined
      };
    }
    return null;
  }

  updateSpeakerName(speakerId, name) {
    if (this.speakers.has(speakerId)) {
      const speaker = this.speakers.get(speakerId);
      speaker.name = name;
      this.speakers.set(speakerId, speaker);
      return true;
    }
    return false;
  }

  mergeSpeakers(speakerId1, speakerId2) {
    if (!this.speakers.has(speakerId1) || !this.speakers.has(speakerId2)) {
      return false;
    }
    
    const speaker1 = this.speakers.get(speakerId1);
    const speaker2 = this.speakers.get(speakerId2);
    
    // 合并特征
    speaker1.features = [...speaker1.features, ...speaker2.features];
    speaker1.detectionCount += speaker2.detectionCount;
    speaker1.totalSpeakingTime += speaker2.totalSpeakingTime;
    speaker1.confidence = (speaker1.confidence + speaker2.confidence) / 2;
    
    // 使用较早的检测时间
    if (speaker2.firstDetected < speaker1.firstDetected) {
      speaker1.firstDetected = speaker2.firstDetected;
    }
    
    // 删除第二个说话人
    this.speakers.delete(speakerId2);
    
    // 更新聚类模型（需要重新训练）
    this.retrainClusterModel();
    
    return true;
  }

  retrainClusterModel() {
    // 重新训练聚类模型
    console.log('重新训练聚类模型...');
    
    // 清空现有聚类
    this.clusterModel.clusters = [];
    
    // 使用所有说话人的特征重新训练
    for (const [speakerId, speaker] of this.speakers) {
      for (const features of speaker.features) {
        this.clusterModel.addSample(features, speakerId);
      }
    }
    
    console.log('聚类模型重新训练完成');
  }

  reset() {
    this.speakers.clear();
    this.nextSpeakerId = 1;
    this.featureVectors.clear();
    this.clusterModel = null;
    this.isInitialized = false;
    
    // 重新初始化
    this.init();
    
    console.log('说话人检测器已重置');
  }

  getStatistics() {
    const totalDetections = Array.from(this.speakers.values())
      .reduce((sum, speaker) => sum + speaker.detectionCount, 0);
    
    const totalSpeakingTime = Array.from(this.speakers.values())
      .reduce((sum, speaker) => sum + speaker.totalSpeakingTime, 0);
    
    return {
      totalSpeakers: this.speakers.size,
      totalDetections: totalDetections,
      totalSpeakingTime: totalSpeakingTime,
      averageConfidence: this.speakers.size > 0 
        ? Array.from(this.speakers.values())
            .reduce((sum, speaker) => sum + speaker.confidence, 0) / this.speakers.size
        : 0
    };
  }

  exportModel() {
    return {
      speakers: Array.from(this.speakers.entries()),
      nextSpeakerId: this.nextSpeakerId,
      config: this.config,
      timestamp: Date.now()
    };
  }

  importModel(modelData) {
    try {
      this.speakers = new Map(modelData.speakers);
      this.nextSpeakerId = modelData.nextSpeakerId;
      this.config = { ...this.config, ...modelData.config };
      
      // 重新初始化聚类模型
      this.retrainClusterModel();
      
      console.log('说话人模型导入成功');
      return true;
      
    } catch (error) {
      console.error('导入说话人模型失败:', error);
      return false;
    }
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SpeakerDetector;
} else {
  window.SpeakerDetector = SpeakerDetector;
}