import React, { useState, useEffect } from 'react';
import { initDB, saveImageToDB, getAllImagesFromDB, deleteImageFromDB, clearAllImagesFromDB } from './db';

function App() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'light';
  });
  const [images, setImages] = useState([]);
  const [prompt, setPrompt] = useState('图1人物穿上图2的服装，和图3人物并肩站立在上海外滩广场上，背景是东方明珠广播电视塔。光线明亮柔和，构图对称，氛围浪漫。');

  const [apiKey, setApiKey] = useState('');
  const [numInferenceSteps, setNumInferenceSteps] = useState(8);
  const [guidanceScale, setGuidanceScale] = useState(8);
  const [seed, setSeed] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryHistory, setGalleryHistory] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('latest');
  const [previewImage, setPreviewImage] = useState(null);
  const [cardInfoId, setCardInfoId] = useState(null);

  useEffect(() => {
    const savedApiKey = localStorage.getItem('apiKey');
    if (savedApiKey) {
      setApiKey(savedApiKey);
    }
  }, []);

  useEffect(() => {
    if (apiKey) {
      localStorage.setItem('apiKey', apiKey);
    }
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      images.forEach(img => {
        if (img.url) {
          URL.revokeObjectURL(img.url);
        }
      });
      if (result) {
        URL.revokeObjectURL(result);
      }
    };
  }, [images, result]);

  useEffect(() => {
    initDB().then(() => {
      getAllImagesFromDB().then((records) => {
        const history = records.map(record => ({
          id: record.id,
          image: record.imageData,
          prompt: record.prompt,
          seed: record.seed,
          numInferenceSteps: record.numInferenceSteps,
          guidanceScale: record.guidanceScale,
          timestamp: record.timestamp,
          date: record.date
        })).sort((a, b) => b.id - a.id);
        setGalleryHistory(history);
      }).catch(err => console.error('Failed to load from DB:', err));
    }).catch(err => console.error('Failed to init DB:', err));
  }, []);

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length + images.length > 3) {
      setError('最多只能上传三张图片');
      return;
    }
    
    const newImages = files.map(file => ({
      id: Date.now() + Math.random(),
      file: file,
      url: URL.createObjectURL(file)
    }));
    
    setImages([...images, ...newImages]);
    setError(null);
  };

  const removeImage = (id) => {
    const imgToRemove = images.find(img => img.id === id);
    if (imgToRemove && imgToRemove.url) {
      URL.revokeObjectURL(imgToRemove.url);
    }
    setImages(images.filter(img => img.id !== id));
  };

  const handleGenerate = async () => {
    if (images.length < 1) {
      setError('请上传至少一张图片');
      return;
    }

    if (images.length > 3) {
      setError('最多只能上传三张图片');
      return;
    }

    if (!prompt) {
      setError('请输入提示词');
      return;
    }

    if (!apiKey) {
      setError('请输入API Key');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('prompt', prompt);
      formData.append('model', 'Qwen-Image-Edit-2511');
      formData.append('num_inference_steps', numInferenceSteps);
      formData.append('guidance_scale', guidanceScale);
      formData.append('api_key', apiKey);
      
      // 默认使用 2048x2048 尺寸
      formData.append('width', 2048);
      formData.append('height', 2048);
      
      // 添加种子值（可选）
      if (seed && seed !== '') {
        formData.append('seed', parseInt(seed));
      }
      
      images.forEach(img => {
        formData.append('images', img.file);
      });

      const workerBaseUrl = (import.meta.env.VITE_WORKER_BASE_URL || '').trim().replace(/\/$/, '');
      const cloudflarePagesApiBase = 'https://qwen-image-edit-cxt.pages.dev';
      const isNetlifyHost = window.location.hostname.includes('netlify.app');

      const candidateApiUrls = ['/api/edit-image'];

      // Netlify 某些情况下代理到外部会 504，这里加 Cloudflare 直连兜底
      if (isNetlifyHost) {
        candidateApiUrls.push(`${cloudflarePagesApiBase}/api/edit-image`);
      }

      if (workerBaseUrl) {
        candidateApiUrls.push(`${workerBaseUrl}/api/edit-image`);
      }

      let response = null;
      let lastFetchError = null;

      for (const apiUrl of candidateApiUrls) {
        try {
          const currentResponse = await fetch(apiUrl, {
            method: 'POST',
            body: formData
          });

          const contentType = currentResponse.headers.get('content-type') || '';

          // 一些 Pages 配置下 /api 会被错误回退到 index.html（200 + text/html）
          if (currentResponse.ok && contentType.includes('text/html')) {
            continue;
          }

          // 命中成功响应
          if (currentResponse.ok) {
            response = currentResponse;
            break;
          }

          // 明确表明该地址未正确转发或网关异常时，继续尝试下一个地址
          if ([404, 405, 502, 503, 504].includes(currentResponse.status)) {
            continue;
          }

          // 其他非 2xx 先返回明确报错
          response = currentResponse;
          break;
        } catch (fetchErr) {
          lastFetchError = fetchErr;
        }
      }

      if (!response) {
        throw new Error(`网络连接失败：${lastFetchError?.message || '无法连接到图片生成服务'}。`);
      }

      // 202: 后端已接单，前端轮询任务结果（避免 Pages Functions 子请求超限）
      if (response.status === 202) {
        const accepted = await response.json();
        const taskId = accepted?.task_id;
        if (!taskId) {
          throw new Error('任务已提交但缺少 task_id');
        }

        let imageUrl = null;
        let lastTaskStatus = 'unknown';
        let lastTaskMessage = '';
        // 任务有时需要较长时间，轮询窗口拉长到约6分钟
        const maxPollAttempts = 180;
        const pollDelayMs = 2000;

        for (let i = 0; i < maxPollAttempts; i++) {
          await new Promise((resolve) => setTimeout(resolve, pollDelayMs));

          const taskStatusApiUrl = isNetlifyHost
            ? `${cloudflarePagesApiBase}/api/task-status`
            : '/api/task-status';

          const taskResp = await fetch(taskStatusApiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              task_id: taskId,
              api_key: apiKey,
            }),
          });

          if (!taskResp.ok) {
            continue;
          }

          const taskData = await taskResp.json();
          const status = String(taskData?.status || taskData?.task_status || taskData?.state || '').toLowerCase();
          const taskMessage =
            taskData?.error ||
            taskData?.message ||
            taskData?.msg ||
            taskData?.detail ||
            taskData?.output?.error ||
            taskData?.output?.message ||
            '';

          if (status) {
            lastTaskStatus = status;
          }
          if (taskMessage) {
            lastTaskMessage = String(taskMessage);
          }

          if (['succeeded', 'completed', 'success'].includes(status)) {
            const result = taskData?.output || taskData?.data || taskData?.result || taskData?.image;
            const imageCandidate =
              typeof result === 'string'
                ? result
                : result?.image || result?.file_url || result?.url || result?.data;

            if (!imageCandidate) {
              throw new Error('任务完成但无图片结果');
            }

            if (typeof imageCandidate === 'string' && imageCandidate.startsWith('http')) {
              imageUrl = imageCandidate;
              break;
            }

            if (typeof imageCandidate === 'string') {
              // base64 兜底
              const binary = atob(imageCandidate.includes('base64,') ? imageCandidate.split('base64,')[1] : imageCandidate);
              const bytes = new Uint8Array(binary.length);
              for (let j = 0; j < binary.length; j++) {
                bytes[j] = binary.charCodeAt(j);
              }
              const base64Blob = new Blob([bytes], { type: 'image/png' });
              const base64Url = URL.createObjectURL(base64Blob);
              setResult(base64Url);
              return;
            }
          }

          if (['failed', 'error'].includes(status)) {
            throw new Error(`任务失败（${status}）：${lastTaskMessage || '上游未返回详细错误'}`);
          }
        }

        if (!imageUrl) {
          const msg = lastTaskMessage ? `；详情：${lastTaskMessage}` : '';
          throw new Error(`任务处理中超时，请稍后再试（最后状态：${lastTaskStatus}${msg}）`);
        }

        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          throw new Error(`拉取结果图失败（HTTP ${imageResponse.status}）`);
        }

        const blob = await imageResponse.blob();
        const url = URL.createObjectURL(blob);
        setResult(url);

        const now = new Date();
        const timestamp = now.getFullYear() + 
          String(now.getMonth() + 1).padStart(2, '0') + 
          String(now.getDate()).padStart(2, '0') + 
          String(now.getHours()).padStart(2, '0') + 
          String(now.getMinutes()).padStart(2, '0') + 
          String(now.getSeconds()).padStart(2, '0');
        const dateStr = now.toLocaleString('zh-CN');

        const newRecord = {
          id: Date.now(),
          image: url,
          prompt: prompt,
          seed: seed || '随机',
          timestamp: timestamp,
          date: dateStr,
          numInferenceSteps: numInferenceSteps,
          guidanceScale: guidanceScale
        };

        saveImageToDB(newRecord).then(savedRecord => {
          const recordToAdd = {
            ...newRecord,
            image: savedRecord.imageData
          };
          setGalleryHistory([recordToAdd, ...galleryHistory]);
        }).catch(err => console.error('Failed to save image:', err));

        return;
      }

      if (!response.ok) {
        let errorMessage = `生成图像失败（HTTP ${response.status}）`;
        try {
          const errorJson = await response.json();
          if (errorJson?.error) {
            errorMessage = `${errorMessage}：${errorJson.error}`;
          }
        } catch {
          // ignore JSON parse error
        }
        throw new Error(errorMessage);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('image/')) {
        const nonImageText = await response.text();
        throw new Error(`接口返回的不是图片：${nonImageText || contentType}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setResult(url);
      
      const now = new Date();
      const timestamp = now.getFullYear() + 
        String(now.getMonth() + 1).padStart(2, '0') + 
        String(now.getDate()).padStart(2, '0') + 
        String(now.getHours()).padStart(2, '0') + 
        String(now.getMinutes()).padStart(2, '0') + 
        String(now.getSeconds()).padStart(2, '0');
      const dateStr = now.toLocaleString('zh-CN');
      
      const newRecord = {
        id: Date.now(),
        image: url,
        prompt: prompt,
        seed: seed || '随机',
        timestamp: timestamp,
        date: dateStr,
        numInferenceSteps: numInferenceSteps,
        guidanceScale: guidanceScale
      };
      
      saveImageToDB(newRecord).then(savedRecord => {
        const recordToAdd = {
          ...newRecord,
          image: savedRecord.imageData
        };
        setGalleryHistory([recordToAdd, ...galleryHistory]);
      }).catch(err => console.error('Failed to save image:', err));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (result) {
      const now = new Date();
      const timestamp = now.getFullYear() + 
        String(now.getMonth() + 1).padStart(2, '0') + 
        String(now.getDate()).padStart(2, '0') + 
        String(now.getHours()).padStart(2, '0') + 
        String(now.getMinutes()).padStart(2, '0') + 
        String(now.getSeconds()).padStart(2, '0');
      const link = document.createElement('a');
      link.href = result;
      link.download = `generated-image${timestamp}.png`;
      link.click();
    }
  };


  return (
    <>
      <div className="background-effects">
        <div className="gradient-orb orb-1"></div>
        <div className="gradient-orb orb-2"></div>
      </div>

      <div className="container">
        <header>
          <div className="header-top">
            <div className="logo">
              <div className="logo-icon">
                <img src="/favicon.svg" alt="Logo" />
              </div>
              <h1>Qwen Image Edit</h1>
            </div>
            <button 
              className="gallery-btn"
              onClick={() => setShowGallery(true)}
              aria-label="画廊"
            >
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
                <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
                <path d="M21 15L16 10L5 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button 
              className="theme-toggle"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              aria-label="切换主题"
            >
              {theme === 'light' ? (
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="2"/>
                  <path d="M12 1V3M12 21V23M4.22 4.22L5.64 5.64M18.36 18.36L19.78 19.78M1 12H3M21 12H23M4.22 19.78L5.64 18.36M18.36 5.64L19.78 4.22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              )}
            </button>
          </div>
          <p className="subtitle">AI 驱动的图生图工具，释放你的创意想象</p>
        </header>

        <main className="main-content">
          <div className="card">
            <div className="card-header">
              <div className="card-icon">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M11 4H4C2.89543 4 2 4.89543 2 6V20C2 21.1046 2.89543 22 4 22H18C19.1046 22 20 21.1046 20 20V13" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M18.5 2.50001C19.3284 1.67158 20.6716 1.67158 21.5 2.50001C22.3284 3.32844 22.3284 4.67158 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h2 className="card-title">设置</h2>
            </div>

            <div className="api-key-section">
              <label className="form-label">API Key</label>
              <div className="api-key-input-wrapper">
                <input 
                  type={showApiKey ? "text" : "password"} 
                  className="form-input"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="请输入你的 API Key"
                />
                <button 
                  type="button" 
                  className="toggle-visibility"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? (
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M17.94 17.94C16.2306 19.243 14.1491 19.9649 12 20C5 20 1 12 1 12C2.24389 9.68192 3.96914 7.65663 6.06 6.06M9.9 4.24C10.5883 4.0789 11.2931 3.99836 12 4C19 4 23 12 23 12C22.393 13.1356 21.6691 14.2047 20.84 15.19M14.12 14.12C13.8454 14.4148 13.5141 14.6512 13.1462 14.8151C12.7782 14.9791 12.3809 15.0673 11.9781 15.0744C11.5753 15.0815 11.1752 15.0074 10.8016 14.8565C10.4281 14.7056 10.0887 14.481 9.80385 14.1962C9.51897 13.9113 9.29439 13.5719 9.14351 13.1984C8.99262 12.8248 8.91853 12.4247 8.92563 12.0219C8.93274 11.6191 9.02091 11.2218 9.18488 10.8538C9.34884 10.4859 9.58525 10.1546 9.88 9.88" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M1 1L23 23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1 12C1 12 5 4 12 4C19 4 23 12 23 12C23 12 19 20 12 20C5 20 1 12 1 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>提示词 (Prompt)</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    type="button"
                    className="icon-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(prompt);
                    }}
                    title="复制提示词"
                  >
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
                      <path d="M5 15H4C2.9 15 2 14.1 2 13V4C2 2.9 2.9 2 4 2H13C14.1 2 15 2.9 15 4V5" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                  </button>
                  <button 
                    type="button"
                    className="icon-btn"
                    onClick={() => setPrompt('')}
                    title="清空提示词"
                  >
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>
              <textarea 
                className="form-textarea"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="输入详细的图像描述..."
              />
            </div>

            <div className="form-group upload-section">
              <label className="form-label">上传图片（1-3张）</label>
              <div className="upload-area">
                <input 
                  type="file" 
                  accept="image/*" 
                  multiple 
                  onChange={handleImageUpload}
                  id="file-upload"
                />
                <label htmlFor="file-upload">
                  <div className="upload-icon">📷</div>
                  <div className="upload-text">点击或拖拽上传图片</div>
                </label>
              </div>
              <div className="image-preview">
                {images.map(img => (
                  <div key={img.id} className="preview-item">
                    <img src={img.url} alt="预览" />
                    <button 
                      className="remove-image"
                      onClick={() => removeImage(img.id)}
                      aria-label="移除图片"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="form-group">
              <div className="slider-group">
                <div className="slider-header">
                  <label className="form-label">推理步数（数值越大图像越清晰，但生成时间越长）</label>
                  <span className="slider-value">{numInferenceSteps}</span>
                </div>
                <input 
                  type="range" 
                  className="form-slider"
                  value={numInferenceSteps}
                  onChange={(e) => setNumInferenceSteps(parseInt(e.target.value))}
                  min="1"
                  max="20"
                  step="1"
                />
              </div>
            </div>

            <div className="form-group">
              <div className="slider-group">
                <div className="slider-header">
                  <label className="form-label">引导比例（数值越高图像越贴合提示词，但降低创意性）</label>
                  <span className="slider-value">{guidanceScale}</span>
                </div>
                <input 
                  type="range" 
                  className="form-slider"
                  value={guidanceScale}
                  onChange={(e) => setGuidanceScale(parseInt(e.target.value))}
                  min="1"
                  max="10"
                  step="1"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">种子值 (Seed)</label>
              <div className="seed-input-wrapper">
                <input 
                  type="number" 
                  className="form-input"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder="留空则随机生成"
                />
                <button 
                  type="button"
                  className="random-seed-btn"
                  onClick={() => setSeed(Math.floor(Math.random() * 2147483647).toString())}
                  title="生成随机种子"
                >
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M21 12a9 9 0 11-6.219-8.56" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            </div>

            <button 
              className={`generate-btn ${loading ? 'loading' : ''}`}
              onClick={handleGenerate}
              disabled={loading}
            >
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>{loading ? '生成中...' : '生成图像'}</span>
            </button>



            {error && (
              <div className="error-message">
                {error}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-icon">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="3" y="3" width="18" height="18" rx="2" stroke="white" strokeWidth="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5" fill="white"/>
                  <path d="M21 15L16 10L5 21" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h2 className="card-title">生成结果</h2>
            </div>

            <div className="result-area">
              {!result ? (
                <div className="result-placeholder">
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                    <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
                    <path d="M21 15L16 10L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <p>上传图片并填写提示词，点击生成按钮</p>
                </div>
              ) : (
                <div className="result-image-container active">
                  <div className="result-image-wrapper">
                    <img src={result} alt="生成结果" className="result-image" />
                  </div>
                  <div className="result-actions">
                    <button className="action-btn primary" onClick={handleDownload}>
                      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M21 15V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M7 10L12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      下载图像
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {loading && (
        <div className="loading-overlay active">
          <div className="loading-spinner-large"></div>
          <p className="loading-text">正在生成图像，请稍候...</p>
          <div className="loading-progress">
            <div className="loading-progress-bar"></div>
          </div>
        </div>
      )}

      {showGallery && (
        <div className={`gallery-modal ${showGallery ? 'active' : ''}`}>
          <div className="gallery-header">
            <h2>画廊</h2>
            <button className="gallery-close" onClick={() => setShowGallery(false)}>
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
          <div className="gallery-content">
            {galleryHistory.length === 0 ? (
              <div className="gallery-empty">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                  <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
                  <path d="M21 15L16 10L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <p>暂无生成记录</p>
              </div>
            ) : (
              <>
                <div className="gallery-toolbar">
                  {isSelectionMode ? (
                    <>
                      <button className="gallery-toolbar-btn" onClick={() => setIsSelectionMode(false)} title="取消选择">
                        <svg viewBox="0 0 24 24" fill="none">
                          <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <button className="gallery-toolbar-btn" onClick={() => {
                        selectedItems.forEach(id => {
                          const link = document.createElement('a');
                          const item = galleryHistory.find(r => r.id === id);
                          if (item) {
                            link.href = item.image;
                            link.download = `generated-image${item.timestamp}.png`;
                            link.click();
                          }
                        });
                      }} title="下载选中">
                        <svg viewBox="0 0 24 24" fill="none">
                          <path d="M21 15V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M7 10L12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <button className="gallery-toolbar-btn" onClick={() => {
                        const newHistory = galleryHistory.filter(item => !selectedItems.includes(item.id));
                        selectedItems.forEach(id => deleteImageFromDB(id).catch(err => console.error('Failed to delete:', err)));
                        setGalleryHistory(newHistory);
                        setSelectedItems([]);
                        setIsSelectionMode(false);
                      }} title="删除选中">
                        <svg viewBox="0 0 24 24" fill="none">
                          <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M8 6V4C8 3.4 8.4 3 9 3H15C15.6 3 16 3.4 16 4V6M19 6V20C19 20.6 18.6 21 18 21H6C5.4 21 5 20.6 5 20V6H19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="gallery-toolbar-btn" onClick={() => setIsSelectionMode(true)} title="选择">
                        <svg viewBox="0 0 24 24" fill="none">
                          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
                          <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
                        </svg>
                      </button>
                      <button className="gallery-toolbar-btn" onClick={() => {
                        if (confirm('确定要清空所有生成记录吗？')) {
                          clearAllImagesFromDB().catch(err => console.error('Failed to clear:', err));
                          setGalleryHistory([]);
                        }
                      }} title="清空全部">
                        <svg viewBox="0 0 24 24" fill="none">
                          <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M8 6V4C8 3.4 8.4 3 9 3H15C15.6 3 16 3.4 16 4V6M19 6V20C19 20.6 18.6 21 18 21H6C5.4 21 5 20.6 5 20V6H19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </>
                  )}
                  <div className="gallery-search">
                    <input 
                      type="text" 
                      placeholder="搜索提示词..." 
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <div className="gallery-sort">
                    <select 
                      className="sort-select" 
                      value={sortOrder}
                      onChange={(e) => setSortOrder(e.target.value)}
                    >
                      <option value="latest">最新</option>
                      <option value="oldest">最早</option>
                    </select>
                  </div>
                </div>
                <div className="gallery-grid">
                  {galleryHistory
                    .filter(record => !searchTerm || record.prompt.toLowerCase().includes(searchTerm.toLowerCase()))
                    .sort((a, b) => sortOrder === 'latest' ? b.id - a.id : a.id - b.id)
                    .map((record) => (
                    <div key={record.id} className={`gallery-card ${cardInfoId === record.id ? 'show-info' : ''}`}>
                      <div 
                        className={`gallery-card-checkbox ${isSelectionMode ? 'visible' : ''} ${selectedItems.includes(record.id) ? 'checked' : ''}`}
                        onClick={(e) => {
                          if (isSelectionMode) {
                            if (selectedItems.includes(record.id)) {
                              setSelectedItems(selectedItems.filter(id => id !== record.id));
                            } else {
                              setSelectedItems([...selectedItems, record.id]);
                            }
                          }
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none">
                          <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      <div className="gallery-card-image-section">
                        <img className="gallery-card-image" src={record.image} alt="生成的图像" onClick={() => setPreviewImage(record.image)} />
                        <div className="gallery-card-actions">
                          <button className="gallery-card-btn" onClick={() => {
                            const link = document.createElement('a');
                            link.href = record.image;
                            link.download = `generated-image${record.timestamp}.png`;
                            link.click();
                          }} title="下载">
                            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M21 15V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M7 10L12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                          <button className="gallery-card-btn" onClick={() => setCardInfoId(cardInfoId === record.id ? null : record.id)} title="信息">
                            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                              <path d="M12 16V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                              <path d="M12 8V8.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                          </button>
                          <button className="gallery-card-btn" onClick={() => {
                            deleteImageFromDB(record.id).catch(err => console.error('Failed to delete:', err));
                            const newHistory = galleryHistory.filter(item => item.id !== record.id);
                            setGalleryHistory(newHistory);
                          }} title="删除">
                            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M8 6V4C8 3.4 8.4 3 9 3H15C15.6 3 16 3.4 16 4V6M19 6V20C19 20.6 18.6 21 18 21H6C5.4 21 5 20.6 5 20V6H19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div className="gallery-card-info">
                        <p className="gallery-card-prompt">{record.prompt}</p>
                        <div className="gallery-card-meta">
                          <span className="gallery-card-tag">推理步数: {record.numInferenceSteps}</span>
                          <span className="gallery-card-tag">引导比例: {record.guidanceScale}</span>
                          <span className="gallery-card-tag">种子: {record.seed}</span>
                        </div>
                        <p className="gallery-card-date">{record.date}</p>
                        <div className="gallery-card-actions">
                          <button className="gallery-card-btn" onClick={() => setCardInfoId(null)} title="返回">
                            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M12 19L5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                          <button className="gallery-card-btn" onClick={() => {
                            const info = `提示词: ${record.prompt}\n推理步数: ${record.numInferenceSteps}\n引导比例: ${record.guidanceScale}\n种子: ${record.seed}\n生成时间: ${record.date}`;
                            const blob = new Blob([info], { type: 'text/plain;charset=utf-8' });
                            const link = document.createElement('a');
                            link.href = URL.createObjectURL(blob);
                            link.download = `image-info-${record.timestamp}.txt`;
                            link.click();
                            URL.revokeObjectURL(link.href);
                          }} title="下载信息">
                            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {previewImage && (
        <div className="preview-modal active" onClick={() => setPreviewImage(null)}>
          <button className="preview-close" onClick={() => setPreviewImage(null)}>
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <img src={previewImage} alt="预览" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

export default App;