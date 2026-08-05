import { apiJson, apiOptions } from "@/lib/api";
import { getMoment, getPost, getContentMetrics, recordContentInteraction, toggleContentLike, type ContentTarget, type InteractionKind } from "@/lib/db";
import { getClientIp, getVisitorKey, hashIp } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseTarget(value: unknown): ContentTarget | null {
  return value === "post" || value === "moment" ? value : null;
}

function parseKind(value: unknown): InteractionKind | null {
  return value === "view" || value === "like" ? value : null;
}

function targetExists(targetType: ContentTarget, targetId: number): boolean {
  if (targetType === "post") return Boolean(getPost(targetId)?.status === "published");
  return Boolean(getMoment(targetId));
}

// 轻量内存限频：同一来源 60 秒内最多 30 次互动上报，阻挡批量刷量。
// standalone 多实例/重启后失效，仅作基础防护；visitor_key 去重仍是主防线。
const INTERACTION_WINDOW_MS = 60 * 1000;
const INTERACTION_MAX = 30;
const interactionHits = new Map<string, number[]>();
function allowInteraction(key: string): boolean {
  const ts = Date.now();
  const cutoff = ts - INTERACTION_WINDOW_MS;
  const hits = (interactionHits.get(key) ?? []).filter((t) => t > cutoff);
  // 空窗口的 key 直接删除，避免长期运行内存无限增长
  if (hits.length === 0) {
    interactionHits.delete(key);
    return true;
  }
  if (hits.length >= INTERACTION_MAX) {
    interactionHits.set(key, hits);
    return false;
  }
  hits.push(ts);
  interactionHits.set(key, hits);
  return true;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const targetType = parseTarget(params.get("target_type"));
  const targetId = Number.parseInt(params.get("target_id") ?? "", 10);
  if (!targetType || !Number.isInteger(targetId) || targetId < 1 || !targetExists(targetType, targetId)) {
    return apiJson({ error: "内容不存在" }, 404);
  }
  return apiJson({ data: getContentMetrics(targetType, targetId) });
}

export async function POST(request: Request) {
  let body: { target_type?: unknown; target_id?: unknown; kind?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiJson({ error: "请求格式错误" }, 400);
  }

  const targetType = parseTarget(body.target_type);
  const targetId = Number(body.target_id);
  const kind = parseKind(body.kind);
  if (!targetType || !kind || !Number.isInteger(targetId) || targetId < 1) {
    return apiJson({ error: "参数错误" }, 400);
  }
  if (!targetExists(targetType, targetId)) return apiJson({ error: "内容不存在" }, 404);

  const rateKey = hashIp(getClientIp(request));
  if (!allowInteraction(rateKey)) return apiJson({ error: "操作过于频繁，请稍后再试" }, 429);

  const visitorKey = getVisitorKey(request);
  // like 支持切换（已赞再点取消），view 仍为单向计数
  const metrics = kind === "like"
    ? toggleContentLike(targetType, targetId, visitorKey)
    : recordContentInteraction(targetType, targetId, kind, visitorKey);
  return apiJson({ data: metrics });
}

export function OPTIONS() {
  return apiOptions();
}

