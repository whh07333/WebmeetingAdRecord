// mp3-encoder.js - 使用 lamejs 将 PCM 音频数据编码为 MP3
// 在 offscreen.html 中通过 script 标签引入，lamejs 会挂载全局 lamejs 对象

class Mp3Encoder {
  /**
   * 将 AudioBuffer 编码为 MP3 Blob
   * @param {AudioBuffer} audioBuffer - 解码后的音频数据
   * @param {number} bitRate - MP3 比特率 (64, 128, 192 kbps)
   * @returns {Promise<Blob>} MP3 Blob
   */
  static encode(audioBuffer, bitRate = 128) {
    return new Promise((resolve, reject) => {
      try {
        const channels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, bitRate);

        const mp3Data = [];
        const sampleBlockSize = 1152; // MP3 帧大小

        // 获取左右声道数据（转为 Int16）
        const leftChannel = audioBuffer.getChannelData(0);
        const rightChannel = channels > 1 ? audioBuffer.getChannelData(1) : null;

        // Float32 → Int16 转换
        const leftInt16 = Mp3Encoder.floatTo16BitPCM(leftChannel);
        const rightInt16 = rightChannel ? Mp3Encoder.floatTo16BitPCM(rightChannel) : null;

        // 分块编码
        let offset = 0;
        while (offset < leftInt16.length) {
          const leftChunk = leftInt16.subarray(offset, offset + sampleBlockSize);
          let mp3buf;

          if (channels > 1 && rightInt16) {
            const rightChunk = rightInt16.subarray(offset, offset + sampleBlockSize);
            mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
          } else {
            mp3buf = mp3encoder.encodeBuffer(leftChunk);
          }

          if (mp3buf.length > 0) {
            mp3Data.push(mp3buf);
          }

          offset += sampleBlockSize;
        }

        // 刷新剩余数据
        const endBuf = mp3encoder.flush();
        if (endBuf.length > 0) {
          mp3Data.push(endBuf);
        }

        const blob = new Blob(mp3Data, { type: 'audio/mpeg' });
        console.log('[Mp3Encoder] 编码完成，大小:', blob.size, '比特率:', bitRate, 'kbps');
        resolve(blob);

      } catch (error) {
        console.error('[Mp3Encoder] 编码失败:', error);
        reject(error);
      }
    });
  }

  /**
   * Float32 音频数据转 Int16
   */
  static floatTo16BitPCM(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  }

  /**
   * 将 webm Blob 解码为 AudioBuffer
   * @param {Blob} webmBlob - webm 格式的音频 Blob
   * @returns {Promise<AudioBuffer>}
   */
  static async decodeWebmToAudioBuffer(webmBlob) {
    const arrayBuffer = await webmBlob.arrayBuffer();
    const audioContext = new AudioContext();
    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      console.log('[Mp3Encoder] 解码完成，采样率:', audioBuffer.sampleRate,
        '声道:', audioBuffer.numberOfChannels,
        '时长:', audioBuffer.duration.toFixed(2) + 's');
      return audioBuffer;
    } finally {
      await audioContext.close();
    }
  }

  /**
   * 完整的 webm → mp3 转换流程
   * @param {Blob} webmBlob - webm 音频 Blob
   * @param {string} quality - 音质等级: high(192kbps) / medium(128kbps) / low(64kbps)
   * @returns {Promise<Blob>} MP3 Blob
   */
  static async convertWebmToMp3(webmBlob, quality = 'medium') {
    const bitRateMap = {
      high: 192,
      medium: 128,
      low: 64
    };
    const bitRate = bitRateMap[quality] || 128;

    console.log('[Mp3Encoder] 开始转换 webm → mp3，质量:', quality, '比特率:', bitRate);
    const audioBuffer = await Mp3Encoder.decodeWebmToAudioBuffer(webmBlob);
    const mp3Blob = await Mp3Encoder.encode(audioBuffer, bitRate);
    return mp3Blob;
  }
}
