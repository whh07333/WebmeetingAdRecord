// options.js - 设置页面逻辑
document.addEventListener('DOMContentLoaded', init);

const defaultSettings = {
  aiProvider: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-3.5-turbo',
  audioQuality: 'medium',
  keepAudioDuringRecording: true,
  autoSave: true,
  autoTranscribe: true,
  speakerDiarization: true,
  summaryType: 'detailed',
  autoDownloadSummary: true
};

function init() {
  // 加载保存的设置
  loadSettings();

  // 绑定事件
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('resetBtn').addEventListener('click', resetSettings);
}

async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get('recorderSettings');
    const settings = result.recorderSettings || defaultSettings;

    // 填充表单
    document.getElementById('aiProvider').value = settings.aiProvider;
    document.getElementById('apiKey').value = settings.apiKey;
    document.getElementById('baseUrl').value = settings.baseUrl;
    document.getElementById('model').value = settings.model;
    document.getElementById('audioQuality').value = settings.audioQuality;
    document.getElementById('keepAudioDuringRecording').checked = settings.keepAudioDuringRecording !== false;
    document.getElementById('autoSave').checked = settings.autoSave;
    document.getElementById('autoTranscribe').checked = settings.autoTranscribe;
    document.getElementById('speakerDiarization').checked = settings.speakerDiarization;
    document.getElementById('summaryType').value = settings.summaryType;
    document.getElementById('autoDownloadSummary').checked = settings.autoDownloadSummary;
  } catch (error) {
    console.error('加载设置失败:', error);
    showToast('加载设置失败', 'error');
  }
}

async function saveSettings() {
  try {
    const settings = {
      aiProvider: document.getElementById('aiProvider').value,
      apiKey: document.getElementById('apiKey').value.trim(),
      baseUrl: document.getElementById('baseUrl').value.trim(),
      model: document.getElementById('model').value.trim(),
      audioQuality: document.getElementById('audioQuality').value,
      keepAudioDuringRecording: document.getElementById('keepAudioDuringRecording').checked,
      autoSave: document.getElementById('autoSave').checked,
      autoTranscribe: document.getElementById('autoTranscribe').checked,
      speakerDiarization: document.getElementById('speakerDiarization').checked,
      summaryType: document.getElementById('summaryType').value,
      autoDownloadSummary: document.getElementById('autoDownloadSummary').checked
    };

    await chrome.storage.sync.set({ recorderSettings: settings });
    showToast('设置保存成功！');
  } catch (error) {
    console.error('保存设置失败:', error);
    showToast('保存设置失败', 'error');
  }
}

async function resetSettings() {
  if (!confirm('确定要恢复默认设置吗？所有自定义配置都会被清空。')) {
    return;
  }

  try {
    await chrome.storage.sync.remove('recorderSettings');
    loadSettings();
    showToast('已恢复默认设置');
  } catch (error) {
    console.error('恢复默认设置失败:', error);
    showToast('恢复默认设置失败', 'error');
  }
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  
  if (type === 'error') {
    toast.style.background = '#ef4444';
  } else {
    toast.style.background = '#10b981';
  }

  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}