export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function onRequestPost(context) {
  try {
    const request = context.request;
    const incomingFormData = await request.formData();

    const apiKeyFromHeader = request.headers
      .get('Authorization')
      ?.replace('Bearer ', '')
      ?.trim();

    const apiKeyFromForm = (incomingFormData.get('api_key') || '')
      .toString()
      .trim();

    const apiKey = apiKeyFromHeader || apiKeyFromForm;
    if (!apiKey) {
      return jsonResponse({ error: '缺少API Key' }, 400);
    }

    incomingFormData.delete('api_key');

    const submitResponse = await fetch('https://ai.gitee.com/v1/async/images/edits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Failover-Enabled': 'true',
      },
      body: incomingFormData,
    });

    const submitData = await safeJson(submitResponse);

    // 上游少数情况会直接回图
    if (submitData?.output?.image) {
      return proxyImageResult(submitData.output.image);
    }

    if (!submitData?.task_id) {
      return jsonResponse(submitData || { error: '上游返回异常，缺少task_id' }, submitResponse.status || 500);
    }

    // 改为前端轮询，避免单次请求子请求超限
    return jsonResponse({
      status: 'processing',
      task_id: submitData.task_id,
      message: '任务已提交，前端轮询中',
    }, 202);
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
