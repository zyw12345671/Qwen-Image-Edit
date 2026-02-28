export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function onRequestPost(context) {
  try {
    const request = context.request;
    const body = await request.json();

    const taskId = body?.task_id;
    const apiKey = body?.api_key;

    if (!taskId) {
      return jsonResponse({ error: '缺少 task_id' }, 400);
    }
    if (!apiKey) {
      return jsonResponse({ error: '缺少 api_key' }, 400);
    }

    const statusResponse = await fetch(`https://ai.gitee.com/api/v1/task/${taskId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const statusData = await safeJson(statusResponse);
    if (!statusResponse.ok) {
      return jsonResponse(statusData || { error: '查询任务状态失败' }, statusResponse.status);
    }

    return jsonResponse(statusData, 200);
  } catch (error) {
    return jsonResponse({ error: error?.message || 'task-status 处理失败' }, 500);
  }
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
