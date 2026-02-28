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

    if (submitData?.output?.image) {
      return proxyImageResult(submitData.output.image);
    }

    if (!submitData?.task_id) {
      return jsonResponse(submitData || { error: '上游返回异常，缺少task_id' }, submitResponse.status || 500);
    }

    let result = null;
    for (let i = 0; i < 60; i++) {
      await sleep(1500);

      const statusResponse = await fetch(`https://ai.gitee.com/api/v1/task/${submitData.task_id}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      const statusData = await safeJson(statusResponse);
      const status = statusData?.status || statusData?.task_status || statusData?.state;

      if (['succeeded', 'SUCCEEDED', 'completed', 'success'].includes(status)) {
        result = statusData?.output || statusData?.data || statusData?.result || statusData?.image;
        break;
      }

      if (['failed', 'FAILED', 'error'].includes(status)) {
        return jsonResponse({ error: statusData?.error || statusData?.message || '任务失败' }, 500);
      }
    }

    if (!result) {
      return jsonResponse({ error: '任务超时' }, 504);
    }

    const imageCandidate =
      typeof result === 'string'
        ? result
        : result?.image || result?.file_url || result?.url || result?.data;

    if (!imageCandidate) {
      return jsonResponse({ error: '无法解析返回结果', raw: result }, 500);
    }

    if (typeof imageCandidate === 'string' && imageCandidate.startsWith('http')) {
      return proxyImageResult(imageCandidate);
    }

    if (typeof imageCandidate === 'string') {
      const binary = atob(stripDataUrlPrefix(imageCandidate));
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

    return jsonResponse({ error: '结果格式不支持', raw: result }, 500);
  } catch (error) {
    return jsonResponse({ error: error?.message || 'Pages Function 处理失败' }, 500);
  }
}

async function proxyImageResult(imageUrl) {
  const imageResponse = await fetch(imageUrl);
  return new Response(imageResponse.body, {
    status: imageResponse.status,
    headers: {
      'Content-Type': imageResponse.headers.get('Content-Type') || 'image/png',
      ...corsHeaders(),
    },
  });
}

function stripDataUrlPrefix(base64String) {
  const marker = 'base64,';
  const idx = base64String.indexOf(marker);
  return idx >= 0 ? base64String.slice(idx + marker.length) : base64String;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
