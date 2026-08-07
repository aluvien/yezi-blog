// 前台想法编辑使用独立入口，避免移动端上传请求经过后台 API 路径的代理规则。
// 实际处理仍复用后台上传处理器，并在处理器内部校验 admin_session，不能匿名上传。
export { POST } from "@/app/api/admin/upload/route";

export const runtime = "nodejs";
