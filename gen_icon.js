
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];
sizes.forEach(size => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // 完全透明背景
  ctx.clearRect(0, 0, size, size);
  
  // 画纯白色饱满麦克风，占满90%空间
  const micWidth = size * 0.35;
  const micHeight = size * 0.55;
  const micX = (size - micWidth) / 2;
  const micY = size * 0.15;
  
  // 麦克风主体圆角矩形
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(micX, micY, micWidth, micHeight, micWidth / 2);
  ctx.fill();
  
  // 麦克风底座
  const baseWidth = micWidth * 1.5;
  const baseHeight = size * 0.12;
  const baseX = (size - baseWidth) / 2;
  const baseY = micY + micHeight + size * 0.05;
  ctx.beginPath();
  ctx.roundRect(baseX, baseY, baseWidth, baseHeight, baseHeight / 2);
  ctx.fill();
  
  // 麦克风连接线
  const lineWidth = size * 0.08;
  const lineYStart = baseY + baseHeight + size * 0.03;
  const lineYEnd = size * 0.85;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(size / 2, lineYStart);
  ctx.lineTo(size / 2, lineYEnd);
  ctx.stroke();
  
  // 保存为PNG
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(__dirname, 'icons', `icon${size}.png`), buffer);
  console.log(`✅ 生成${size}x${size}透明背景白色麦克风图标成功`);
});
