export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function onRequestPost(context) {
  try {
    const request = context.request;
    const incoming = await request.formData();

    const apiKeyFromHeader = request.headers
      .get('Authorization')
      ?.replace('Bearer ', '')
      ?.trim();

    const apiKeyFromForm = (incoming.get('api_key') || '').toString().trim();
    const apiKey = apiKeyFromHeader || apiKeyFromForm;

    if (!apiKey) {
      return jsonResponse({ error: '缺少API Key' }, 400);
    }

    const prompt = (incoming.get('prompt') || '').toString().trim();
    if (!prompt) {
      return jsonResponse({ error: '缺少提示词 prompt' }, 400);
    }

    // 前端上传字段是 images，这里统一转换为上游要求的 image
    const imageFiles = incoming.getAll('images').filter(Boolean);
    if (imageFiles.length < 1) {
      return jsonResponse({ error: '请上传至少一张图片' }, 400);
    }
    if (imageFiles.length > 3) {
      return jsonResponse({ error: '最多只能上传三张图片' }, 400);
    }

    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('model', (incoming.get('model') || 'Qwen-Image-Edit-2511').toString());
    formData.append('num_inference_steps', (incoming.get('num_inference_steps') || '8').toString());
    formData.append('guidance_scale', (incoming.get('guidance_scale') || '8').toString());

    const width = incoming.get('width');
    const height = incoming.get('height');
    const seed = incoming.get('seed');

    if (width) formData.append('width', width.toString());
    if (height) formData.append('height', height.toString());
    if (seed) formData.append('seed', seed.toString());

    // 和本地后端一致补齐 task_types，避免上游内部异常
    if (imageFiles.length >= 1) formData.append('task_types', 'id');
    if (imageFiles.length >= 2) formData.append('task_types', 'style');
    if (imageFiles.length >= 3) formData.append('task_types', 'composition');

    for (const file of imageFiles) {
      formData.append('image', file, file.name || 'image.png');
    }

    const submitResponse = await fetch('https://ai.gitee.com/v1/async/images/edits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Failover-Enabled': 'true',
      },
      body: formData,
    });

    const submitData = await safeJson(submitResponse);

    if (!submitResponse.ok) {
      return jsonResponse(
        {
          error: submitData?.error || submitData?.message || '提交任务失败',
          detail: submitData,
          status: submitResponse.status,
        },
        submitResponse.status,
      );
    }

    // 上游少数情况会直接回图
    if (submitData?.output?.image) {
      return proxyImageResult(submitData.output.image);
    }

    if (!submitData?.task_id) {
      return jsonResponse(
        {
          error: '上游返回异常，缺少task_id',
          detail: submitData,
        },
        500,
      );
    }

    // 改为前端轮询，避免单次请求子请求超限
    return jsonResponse(
      {
        status: 'processing',
        task_id: submitData.task_id,
        message: '任务已提交，前端轮询中',
      },
      202,
    );
  } catch (error) {
    return jsonResponse({ error: error?.message || 'Pages Function 处理失败' }, 500);
  }
}

async function proxyImageResult(imageUrl) {
  if (typeof imageUrl !== 'string') {
    return jsonResponse({ error: '图片结果格式异常' }, 500);
  }

  if (imageUrl.startsWith('http')) {
    const imageResponse = await fetch(imageUrl);
    return new Response(imageResponse.body, {
      status: imageResponse.status,
      headers: {
        'Content-Type': imageResponse.headers.get('Content-Type') || 'image/png',
        ...corsHeaders(),
      },
    });
  }

  const binary = atob(stripDataUrlPrefix(imageUrl));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      ...corsHeaders(),
    },
  });
}

function stripDataUrlPrefix(base64String) {
  const marker = 'base64,';
  const idx = base64String.indexOf(marker);
  return idx >= 0 ? base64String.slice(idx + marker.length) : base64String;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Origin, X-Requested-With',
    'Access-Control-Max-Age': '86400',
  };
}
