
const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');

// 生成指定尺寸的图标
async function generateIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // 蓝紫色渐变背景
  const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  gradient.addColorStop(0, '#6366F1');
  gradient.addColorStop(1, '#8B5CF6');
  
  // 绘制圆形背景
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(size/2, size/2, size*0.45, 0, Math.PI * 2);
  ctx.fill();

  // 绘制麦克风图标
  ctx.fillStyle = '#FFFFFF';
  const micWidth = size * 0.22;
  const micHeight = size * 0.33;
  const micX = (size - micWidth)/2;
  const micY = (size - micHeight)/2 - size*0.05;

  // 麦克风主体
  ctx.beginPath();
  ctx.roundRect(micX, micY, micWidth, micHeight, micWidth/2);
  ctx.fill();

  // 麦克风底座
  ctx.beginPath();
  ctx.roundRect(micX - size*0.08, micY + micHeight + size*0.06, micWidth + size*0.16, size*0.08, size*0.04);
  ctx.fill();

  // 麦克风连接线
  ctx.beginPath();
  ctx.moveTo(size/2, micY + micHeight + size*0.14);
  ctx.lineTo(size/2, size*0.74);
  ctx.lineWidth = size*0.06;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineCap = 'round';
  ctx.stroke();

  // 导出为png
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(`./icons/icon${size}.png`, buffer);
  console.log(`✅ 生成 ${size}x${size} 图标成功`);
}

async function main() {
  // 确保icons目录存在
  if (!fs.existsSync('./icons')) {
    fs.mkdirSync('./icons');
  }
  // 生成三个标准尺寸
  await generateIcon(16);
  await generateIcon(48);
  await generateIcon(128);
  console.log('\n🎨 所有图标生成完成，已经替换到icons目录');
}

main().catch(console.error);
