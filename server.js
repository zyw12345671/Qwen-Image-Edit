const express = require('express');
const multer = require('multer');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('dist'));

// 使用内存上传，避免磁盘读写开销
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 3,
    fileSize: 20 * 1024 * 1024,
  },
});

app.post('/api/edit-image', upload.fields([{ name: 'images', maxCount: 3 }]), async (req, res) => {
  try {
    const { prompt, model, num_inference_steps, guidance_scale, api_key, width, height, seed } = req.body;
    const files = req.files?.images || [];

    if (files.length < 1) {
      return res.status(400).json({ error: '请上传至少一张图片' });
    }
    if (files.length > 3) {
      return res.status(400).json({ error: '最多只能上传三张图片' });
    }

    const apiKey = api_key || process.env.API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: '缺少API Key' });
    }

    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('model', model || 'Qwen-Image-Edit-2511');
    formData.append('num_inference_steps', num_inference_steps || 8);
    formData.append('guidance_scale', guidance_scale || 8);

    if (width) formData.append('width', width);
    if (height) formData.append('height', height);
    if (seed) formData.append('seed', seed);

    // 与原先行为保持兼容
    if (files.length >= 1) formData.append('task_types', 'id');
    if (files.length >= 2) formData.append('task_types', 'style');
    if (files.length >= 3) formData.append('task_types', 'composition');

    files.forEach((file) => {
      formData.append('image', file.buffer, {
        filename: file.originalname || 'image.png',
        contentType: file.mimetype || 'application/octet-stream',
      });
    });

    const submitResponse = await axios.post('https://ai.gitee.com/v1/async/images/edits', formData, {
      headers: {
        'X-Failover-Enabled': 'true',
        Authorization: `Bearer ${apiKey}`,
        ...formData.getHeaders(),
      },
      timeout: 30000,
    });

    const submitData = submitResponse.data || {};

    // 上游直接返回结果
    if (submitData.output?.image) {
      return await sendImageResult(submitData.output.image, res);
    }

    if (submitData.data) {
      return await sendImageResult(submitData.data, res);
    }

    const taskId = submitData.task_id;
    if (!taskId) {
      return res.status(500).json({ error: '无法获取任务ID' });
    }

    // 轮询优化：更短间隔 + 总超时控制
    const maxAttempts = 60;
    const delayMs = 1500;

    let result = null;
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(delayMs);

      let statusData;
      try {
        const statusResponse = await axios.get(`https://ai.gitee.com/api/v1/task/${taskId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 15000,
        });
        statusData = statusResponse.data || {};
      } catch {
        continue;
      }

      const status = statusData.status || statusData.task_status || statusData.state;
      if (['succeeded', 'SUCCEEDED', 'completed', 'success'].includes(status)) {
        result = statusData.output || statusData.data || statusData.result || statusData.image;
        break;
      }

      if (['failed', 'FAILED', 'error'].includes(status)) {
        return res.status(500).json({ error: statusData.error || statusData.message || '任务执行失败' });
      }
    }

    if (!result) {
      return res.status(504).json({ error: '任务超时' });
    }

    const imageCandidate =
      typeof result === 'string'
        ? result
        : result?.file_url || result?.image || result?.url || result?.data;

    if (!imageCandidate) {
      return res.status(500).json({ error: '无法解析返回的结果' });
    }

    return await sendImageResult(imageCandidate, res);
  } catch (error) {
    const upstreamMsg = error?.response?.data?.error || error?.response?.data?.message;
    return res.status(500).json({ error: upstreamMsg || error.message || '处理请求时出错' });
  }
});

async function sendImageResult(candidate, res) {
  if (typeof candidate !== 'string') {
    return res.status(500).json({ error: '结果格式异常' });
  }

  if (candidate.startsWith('http')) {
    const imageResponse = await axios.get(candidate, { responseType: 'arraybuffer', timeout: 30000 });
    res.set('Content-Type', imageResponse.headers['content-type'] || 'image/png');
    return res.send(imageResponse.data);
  }

  const base64 = stripDataUrlPrefix(candidate);
  const imageBuffer = Buffer.from(base64, 'base64');
  res.set('Content-Type', 'image/png');
  return res.send(imageBuffer);
}

function stripDataUrlPrefix(base64String) {
  const marker = 'base64,';
  const idx = base64String.indexOf(marker);
  return idx >= 0 ? base64String.slice(idx + marker.length) : base64String;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
