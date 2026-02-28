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

    // 先查新接口
    const primary = await fetch(`https://ai.gitee.com/api/v1/task/${taskId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const primaryData = await safeJson(primary);
    if (primary.ok && primaryData) {
      return jsonResponse(normalizeTaskData(primaryData), 200);
    }

    // 兜底：老接口
    const fallback = await fetch(`https://ai.gitee.com/v1/async/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const fallbackData = await safeJson(fallback);
    if (fallback.ok && fallbackData) {
      return jsonResponse(normalizeTaskData(fallbackData), 200);
    }

    return jsonResponse(
      {
        error: '查询任务状态失败',
        primary_status: primary.status,
        fallback_status: fallback.status,
        primary_data: primaryData,
        fallback_data: fallbackData,
      },
      502,
    );
  } catch (error) {
    return jsonResponse({ error: error?.message || 'task-status 处理失败' }, 500);
  }
}

function normalizeTaskData(raw) {
  const statusRaw = raw?.status || raw?.task_status || raw?.state || raw?.taskState || raw?.data?.status;
  const status = String(statusRaw || '').toLowerCase();

  const output =
    raw?.output ||
    raw?.result ||
    raw?.data?.output ||
    raw?.data?.result ||
    raw?.data ||
    raw?.image;

  const normalized = {
    ...raw,
    status,
    output,
  };

  return normalized;
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
